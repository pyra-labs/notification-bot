import config from "./config/config.js";
import { Telegram } from "./clients/telegram.client.js";
import { Supabase } from "./clients/supabase.client.js";
import type { MonitoredAccount } from "./types/interfaces/monitoredAccount.interface.js";
import { MARKET_INDEX_USDC, QuartzClient, type QuartzUser, retryWithBackoff, TOKENS } from "@quartz-labs/sdk";
import { AppLogger } from "@quartz-labs/logger";
import type { MessageCompiledInstruction, VersionedTransactionResponse } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { centsToDollars, checkHasVaultHistory, displayAddress } from "./utils/helpers.js";
import { LOOP_DELAY } from "./config/constants.js";
import { ExistingThresholdError, NoThresholdsError, ThresholdNotFoundError, UserNotFound } from "./config/errors.js";
import type { Subscriber } from "./types/interfaces/subscriber.interface.js";
import AdvancedConnection from "@quartz-labs/connection";

export class NotificationBot extends AppLogger {
    private telegram: Telegram;
    private supabase: Supabase;
    private connection: AdvancedConnection  ;
    private monitoredAccounts: Record<string, MonitoredAccount>;
    private monitoredAccountsInitialized: Promise<void>;
    private quartzClientPromise: Promise<QuartzClient>;

    private loadedAnnouncement = "";

    constructor() {
        super({
            name: "Notification Bot",
            dailyErrorCacheTimeMs: 1000 * 60 * 60 // 1 hour
        });

        this.connection = new AdvancedConnection(config.RPC_URLS);
        this.quartzClientPromise = QuartzClient.fetchClient({connection: this.connection});

        this.telegram = new Telegram(
            this.prepareAnnouncement.bind(this),
            this.getAndClearAnnouncement.bind(this),
            this.getAllChatIds.bind(this),
            this.subscribe.bind(this),
            this.unsubscribe.bind(this),
            this.getSubscriptions.bind(this)
        );
        this.supabase = new Supabase();
        this.monitoredAccounts = {};
        this.monitoredAccountsInitialized = this.loadStoredAccounts();
    }

    private prepareAnnouncement(message: string) {
        this.loadedAnnouncement = message;
    }

    private getAndClearAnnouncement(): string {
        const message = this.loadedAnnouncement;
        this.loadedAnnouncement = "";
        return message;
    }

    private async getAllChatIds(): Promise<number[]> {
        const monitoredAccounts = await this.supabase.getAllAccounts();
        const subscriberChatIDs = monitoredAccounts.flatMap(
            account => account.subscribers.map(subscriber => subscriber.chat_id)
        );
        return subscriberChatIDs;
    }

    private async loadStoredAccounts(): Promise<void> {
        const accounts = await this.supabase.getAllAccounts();
        this.monitoredAccounts = accounts.reduce((acc, account) => {
            acc[account.address.toBase58()] = account;
            return acc;
        }, {} as Record<string, MonitoredAccount>);
    }

    private async getAvailableCredit(user: QuartzUser): Promise<number> {
        const usdcBaseUnits = await user.getWithdrawalLimit(MARKET_INDEX_USDC, false);
        const usdcDecimalPrecision = TOKENS[MARKET_INDEX_USDC].decimalPrecision.toNumber();
        return Math.trunc(usdcBaseUnits / 10 ** (usdcDecimalPrecision - 2));
    }

    private async subscribe(
        chatId: number, 
        address: PublicKey, 
        thresholds: number[]
    ): Promise<number> {
        await this.monitoredAccountsInitialized;
        const quartzClient = await this.quartzClientPromise;
        let available_credit: number;
        try {
            const user = await retryWithBackoff(
                async () => quartzClient.getQuartzAccount(address),
                3
            );
            available_credit = await this.getAvailableCredit(user);
        } catch {
            throw new UserNotFound(address);
        }

        if (thresholds.length === 0) {
            throw new NoThresholdsError(address);
        }

        const existingThresholds = await this.getExitingThresholds(address, chatId);

        for (const threshold of thresholds) {
            if (existingThresholds.includes(threshold)) {
                throw new ExistingThresholdError(threshold);
            }
            this.logger.info(`Subscribing with threshold ${threshold}`);
            await this.supabase.subscribeToWallet(address, chatId, threshold, available_credit);
        }

        const updatedAccount = await this.supabase.getMonitoredAccount(address);
        if (updatedAccount === null) throw new Error("Account not found");
        this.monitoredAccounts[address.toBase58()] = updatedAccount;

        this.logger.info(`${chatId} subscribed to ${address.toBase58()} with thresholds ${thresholds.join(", ")}`);
        return updatedAccount.last_available_credit;
    }

    private async unsubscribe(
        chatId: number,
        address?: PublicKey, 
        thresholds?: number[]
    ): Promise<boolean> {
        await this.monitoredAccountsInitialized;

        // Call unsubscribe on all addresses if none provided
        if (!address) {
            const subscriptions = await this.supabase.getSubscriptions(chatId);
            for (const subscription of subscriptions) {
                await this.unsubscribe(
                    chatId, 
                    subscription.address
                );
            }
            return true;
        }

        const existingThresholds = await this.getExitingThresholds(address, chatId);
        if (existingThresholds.length === 0) {
            throw new NoThresholdsError(address);
        }

        // Set thresholds to all thresholds if none provided
        if (!thresholds || thresholds.length === 0) {
            thresholds = await this.supabase.getThresholds(address, chatId)
                .then(thresholds => thresholds.map(threshold => threshold.available_credit));
            if (!thresholds) {
                throw new NoThresholdsError(address);
            }
        }
        
        // Remove each threshold from database
        const subscriberId = await this.supabase.getSubscriberId(address, chatId);
        for (const threshold of thresholds) {
            if (!existingThresholds.includes(threshold)) {
                throw new ThresholdNotFoundError(threshold);
            }
            const thresholdId = await this.supabase.getThresholdId(subscriberId, threshold);
            await this.supabase.removeThreshold(thresholdId);
        }
        this.logger.info(`${chatId} removed the thresholds ${thresholds.join(", ")} from ${address.toBase58()}`);   

        // Update local state
        const updatedAccount = await this.supabase.getMonitoredAccount(address);
        
        if (updatedAccount === null) {
            delete this.monitoredAccounts[address.toBase58()];
            return true; // No remaining accounts
        }

        this.monitoredAccounts[address.toBase58()] = updatedAccount;
        
        const remainingSubscription = updatedAccount.subscribers.find(subscriber => subscriber.chat_id === chatId);
        const noRemainingThresholds = (remainingSubscription === undefined);
        return noRemainingThresholds;
    }

    private async getSubscriptions(
        chatId: number
    ): Promise<MonitoredAccount[]> {
        return this.supabase.getSubscriptions(chatId);
    }

    private async getExitingThresholds(address: PublicKey, chatId: number): Promise<number[]> {
        await this.monitoredAccountsInitialized;
        const monitoredAccount = await this.getSubscriptions(chatId)
            .then(subs => subs.find(sub => sub.address.equals(address)));
        const existingSubscription = monitoredAccount?.subscribers.find(subscriber => subscriber.chat_id === chatId);
        const thresholds = existingSubscription?.thresholds.map(threshold => threshold.available_credit);
        return thresholds ?? [];
    }

    public async start() {
        const quartzClient = await this.quartzClientPromise;
        await this.monitoredAccountsInitialized;
        await this.setupAutoRepayListener();
        this.logger.info(`Notification Bot initialized with ${Object.keys(this.monitoredAccounts).length} accounts`);

        setInterval(() => {
            this.logger.info(`[${new Date().toISOString()}] Heartbeat | Monitored accounts: ${this.monitoredAccounts.size}`);
        }, 1000 * 60 * 60 * 24); // Every 24 hours

        while (true) {
            const entries = Object.entries(this.monitoredAccounts);
            const owners = entries.map(entry => new PublicKey(entry[0]));

            let users: (QuartzUser | null)[];
            try {
                users = await retryWithBackoff(
                    async () => quartzClient.getMultipleQuartzAccounts(owners)
                );
            } catch (error) {
                if (error instanceof Error && error.message.includes("Account not found for pubkey")) {
                    this.processDeletedAccount(owners);
                } else {
                    this.logger.error(`Error fetching users: ${JSON.stringify(error)}`);
                }
                continue;
            }

            for (let i = 0; i < entries.length; i++) { 
                const entry = entries[i]?.[1];
                if (!entry) continue;

                const user = users[i];
                if (!user) {
                    this.logger.warn(`User not found for account ${entry.address.toBase58()}`);
                    continue;
                }

                try {
                    const currentAvailableCredit = await this.getAvailableCredit(user);
                    if (currentAvailableCredit === entry.last_available_credit) continue;

                    await this.updateAvailableCredit(entry, currentAvailableCredit);
                } catch (error) {
                    this.logger.error(`Error processing account ${entry.address.toBase58()}: ${JSON.stringify(error)}`);
                }
            }

            await new Promise(resolve => setTimeout(resolve, LOOP_DELAY));
        }
    }

    private async setupAutoRepayListener() {
        const quartzClient = await this.quartzClientPromise;

        const INSRTUCTION_NAME = "StartCollateralRepay";
        const ACCOUNT_INDEX_OWNER = 3;

        quartzClient.listenForInstruction(
            INSRTUCTION_NAME,
            async (tx: VersionedTransactionResponse, ix: MessageCompiledInstruction, accountKeys: PublicKey[]) => {
                try {
                    const ownerIndex = ix.accountKeyIndexes?.[ACCOUNT_INDEX_OWNER];
                    if (ownerIndex === undefined || accountKeys[ownerIndex] === undefined) return;
                    const owner = accountKeys[ownerIndex];

                    const monitoredAccount = this.monitoredAccounts[owner.toBase58()];
                    if (!monitoredAccount) return;

                    if (tx.transaction.message.isAccountSigner(ownerIndex)) {
                        return;
                    }

                    const notifiedSubscribers = new Set<number>();
                    for (const subscriber of monitoredAccount.subscribers) {
                        await this.telegram.sendMessage(
                            subscriber.chat_id,
                            `💰 Your loans for account ${displayAddress(owner)} have automatically been repaid by selling your collateral at market rate.`
                        );
                        notifiedSubscribers.add(subscriber.chat_id);
                    }
                    this.logger.info(`Sending auto-repay notification for account ${owner} to ${Array.from(notifiedSubscribers).join(", ")}`);
                } catch (error) {
                    this.logger.error(`Error processing collateral repay instruction: ${JSON.stringify(error)}`);
                }
            }
        )
    }

    private async updateAvailableCredit(account: MonitoredAccount, availableCredit: number) {
        await this.supabase.updateAvailableCredit(account.address, availableCredit);

        const notifiedSubscribers = new Set<number>();
        for (const subscriber of account.subscribers) {
            const subscriberId = await this.supabase.getSubscriberId(account.address, subscriber.chat_id);
            let updatedData = false;
            let notify = false;

            for (const threshold of subscriber.thresholds) {
                if (!threshold.notify) {
                    if (availableCredit >= threshold.available_credit + 500) {
                        updatedData = true;

                        // Enable notifications (has reached 5% above threshold)
                        const thresholdId = await this.supabase.getThresholdId(subscriberId, threshold.available_credit);
                        await this.supabase.updateThreshold(thresholdId, threshold.available_credit, true);
                    }
                    continue;
                }

                if (availableCredit <= threshold.available_credit) {
                    updatedData = true;
                    notify = true;

                    // Disable notifications (until it rises 5% above)
                    const thresholdId = await this.supabase.getThresholdId(subscriberId, threshold.available_credit);
                    await this.supabase.updateThreshold(thresholdId, threshold.available_credit, false);
                }
            }

            if (!updatedData) continue;

            const updatedAccount = await this.supabase.getMonitoredAccount(account.address);
            if (updatedAccount === null) throw new Error("Account not found");
            this.monitoredAccounts[account.address.toBase58()] = updatedAccount;

            if (notify) {
                await this.telegram.sendMessage(
                    subscriber.chat_id,
                    `🚨 Your available credit (${displayAddress(account.address)}) has dropped to ${centsToDollars(availableCredit)}.`
                );
                notifiedSubscribers.add(subscriber.chat_id);
            }
        }

        if (notifiedSubscribers.size > 0) {
            this.logger.info(`Sent available credit notification for account ${account.address.toBase58()} to ${Array.from(notifiedSubscribers).join(", ")}`);
        }
    }

    private async processDeletedAccount(owners: PublicKey[]) {
        for (const owner of owners) {
            const doesUserExist = await QuartzClient.doesQuartzUserExist(this.connection, owner);
            if (doesUserExist) continue;

            const hasVaultHistory = await checkHasVaultHistory(this.connection, owner);
            if (!hasVaultHistory) throw new Error("Account does not exist and has no previous history")

            let account = await this.supabase.getMonitoredAccount(owner);
            if (account === null) {
                account = this.monitoredAccounts[owner.toBase58()] ?? null;
                if (account === null) throw new Error("Already deleted");

                for (const subscriber of account.subscribers) {
                    this.notifyDeletedAccountSubscriber(subscriber, owner);
                }
                return;
            } 
            
            for (const subscriber of account.subscribers) {
                const subscriberId = await this.supabase.getSubscriberId(owner, subscriber.chat_id);
                const thresholds = await this.supabase.getThresholds(owner, subscriber.chat_id);

                for (const threshold of thresholds) {
                    const thresholdId = await this.supabase.getThresholdId(subscriberId, threshold.available_credit);
                    await this.supabase.removeThreshold(thresholdId);
                }
                this.notifyDeletedAccountSubscriber(subscriber, owner);
            }
        }
    }

    private async notifyDeletedAccountSubscriber(subscriber: Subscriber, owner: PublicKey) {
        this.logger.info(`Sending deleted account notification for account ${owner} to ${subscriber.chat_id}`);
        await this.telegram.sendMessage(
            subscriber.chat_id,
            `⚠️ The Quartz account for ${displayAddress(owner)} has been deleted. I'll remove this account from your monitored list.`
        );
    }
}