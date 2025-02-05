import config from "./config/config.js";
import { Telegram } from "./clients/telegram.client.js";
import { Supabase } from "./clients/supabase.client.js";
import type { MonitoredAccount } from "./types/interfaces/monitoredAccount.interface.js";
import { QuartzClient, type QuartzUser, retryWithBackoff } from "@quartz-labs/sdk";
import { AppLogger } from "@quartz-labs/logger";
import { Connection, type MessageCompiledInstruction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { checkHasVaultHistory, displayAddress } from "./utils/helpers.js";
import { LOOP_DELAY } from "./config/constants.js";
import { ExistingThresholdError, NoThresholdsError, ThresholdNotFoundError, UserNotFound } from "./config/errors.js";
import type { Subscriber } from "./types/interfaces/subscriber.interface.js";

export class HealthMonitorBot extends AppLogger {
    private telegram: Telegram;
    private supabase: Supabase;
    private connection: Connection;
    private monitoredAccounts: Record<string, MonitoredAccount>;
    private monitoredAccountsInitialized: Promise<void>;
    private quartzClientPromise: Promise<QuartzClient>;

    constructor() {
        super({
            name: "Health Monitor Bot",
            dailyErrorCacheTimeMs: 1000 * 60 * 60 // 1 hour
        });

        this.connection = new Connection(config.RPC_URL);
        this.quartzClientPromise = QuartzClient.fetchClient(this.connection);

        this.telegram = new Telegram(
            this.subscribe.bind(this),
            this.unsubscribe.bind(this),
            this.getSubscriptions.bind(this)
        );
        this.supabase = new Supabase();
        this.monitoredAccounts = {};
        this.monitoredAccountsInitialized = this.loadStoredAccounts();
    }

    private async loadStoredAccounts(): Promise<void> {
        const accounts = await this.supabase.getAllAccounts();
        this.monitoredAccounts = accounts.reduce((acc, account) => {
            acc[account.address.toBase58()] = account;
            return acc;
        }, {} as Record<string, MonitoredAccount>);
    }

    private async subscribe(
        chatId: number, 
        address: PublicKey, 
        thresholds: number[]
    ): Promise<number> {
        await this.monitoredAccountsInitialized;
        const quartzClient = await this.quartzClientPromise;
        let health: number;
        try {
            const user = await retryWithBackoff(
                async () => quartzClient.getQuartzAccount(address),
                3
            );
            health = user.getHealth();
        } catch {
            throw new UserNotFound(address);
        }

        if (thresholds.length === 0) {
            throw new NoThresholdsError(address);
        }

        const existingThresholds = await this.getExitingThresholds(address, chatId);
        for (const threshold of thresholds) {
            if (existingThresholds?.includes(threshold)) {
                throw new ExistingThresholdError(threshold);
            }
            await this.supabase.subscribeToWallet(address, chatId, threshold, health);
        }

        const updatedAccount = await this.supabase.getMonitoredAccount(address);
        if (updatedAccount === null) throw new Error("Account not found");
        this.monitoredAccounts[address.toBase58()] = updatedAccount;
        
        this.logger.info(`${chatId} subscribed to ${address.toBase58()} with thresholds ${thresholds.join(", ")}`);
        return updatedAccount.lastHealth;
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
                .then(thresholds => thresholds.map(threshold => threshold.percentage));
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
        
        const remainingSubscription = updatedAccount.subscribers.find(subscriber => subscriber.chatId === chatId);
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
            .then(subs => subs.find(sub => sub.address.equals(address)))
        const existingSubscription = monitoredAccount?.subscribers.find(subscriber => subscriber.chatId === chatId);
        const thresholds = existingSubscription?.thresholds.map(threshold => threshold.percentage);
        return thresholds ?? [];
    }

    public async start() {
        const quartzClient = await this.quartzClientPromise;
        await this.monitoredAccountsInitialized;
        await this.setupAutoRepayListener();
        this.logger.info(`Health Monitor Bot initialized with ${Object.keys(this.monitoredAccounts).length} accounts`);

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
                    this.logger.error(`Error fetching users: ${error}`);
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
                    const currentHealth = user.getHealth();
                    if (currentHealth === entry.lastHealth) continue;

                    await this.updateHealth(entry, currentHealth);
                } catch (error) {
                    this.logger.error(`Error processing account ${entry.address.toBase58()}: ${error}`);
                }
            }

            await new Promise(resolve => setTimeout(resolve, LOOP_DELAY));
        }
    }

    private async setupAutoRepayListener() {
        const quartzClient = await this.quartzClientPromise;

        const INSRTUCTION_NAME = "StartCollateralRepay";
        const ACCOUNT_INDEX_OWNER = 3;
        const ACCOUNT_INDEX_CALLER = 0;

        quartzClient.listenForInstruction(
            INSRTUCTION_NAME,
            async (instruction: MessageCompiledInstruction, accountKeys: PublicKey[]) => {
                try {
                    const callerIndex = instruction.accountKeyIndexes?.[ACCOUNT_INDEX_CALLER];
                    if (callerIndex === undefined || accountKeys[callerIndex] === undefined) return;
                    const caller = accountKeys[callerIndex];
                    
                    const ownerIndex = instruction.accountKeyIndexes?.[ACCOUNT_INDEX_OWNER];
                    if (ownerIndex === undefined || accountKeys[ownerIndex] === undefined) return;
                    const owner = accountKeys[ownerIndex];

                    const monitoredAccount = this.monitoredAccounts[owner.toBase58()];

                    if (monitoredAccount) {
                        if (caller.equals(owner)) return;

                        const notifiedSubscribers = new Set<number>();
                        for (const subscriber of monitoredAccount.subscribers) {
                            await this.telegram.sendMessage(
                                subscriber.chatId,
                                `💰 Your loans for account ${displayAddress(owner)} have automatically been repaid by selling your collateral at market rate.`
                            );
                            notifiedSubscribers.add(subscriber.chatId);
                        }
                        this.logger.info(`Sending auto-repay notification for account ${owner} to ${Array.from(notifiedSubscribers).join(", ")}`);
                    } else if (!caller.equals(owner)) {
                        this.logger.info(`Detected auto-repay for unmonitored account ${owner}`);
                    }
                } catch (error) {
                    this.logger.error(`Error processing collateral repay instruction: ${error}`);
                }
            }
        )
    }

    private async updateHealth(account: MonitoredAccount, health: number) {
        await this.supabase.updateHealth(account.address, health);

        const notifiedSubscribers = new Set<number>();
        for (const subscriber of account.subscribers) {
            const subscriberId = await this.supabase.getSubscriberId(account.address, subscriber.chatId);
            let updatedData = false;
            let notify = false;

            for (const threshold of subscriber.thresholds) {
                if (!threshold.notify) {
                    if (health === 100 || health >= threshold.percentage + 5) {
                        updatedData = true;

                        // Enable notifications (has reached 5% above threshold)
                        const thresholdId = await this.supabase.getThresholdId(subscriberId, threshold.percentage);
                        await this.supabase.updateThreshold(thresholdId, threshold.percentage, true);
                    }
                    continue;
                }

                if (health <= threshold.percentage) {
                    updatedData = true;
                    notify = true;

                    // Disable notifications (until it rises 5% above)
                    const thresholdId = await this.supabase.getThresholdId(subscriberId, threshold.percentage);
                    await this.supabase.updateThreshold(thresholdId, threshold.percentage, false);
                }
            }

            if (!updatedData) continue;

            const updatedAccount = await this.supabase.getMonitoredAccount(account.address);
            if (updatedAccount === null) throw new Error("Account not found");
            this.monitoredAccounts[account.address.toBase58()] = updatedAccount;

            if (notify) {
                await this.telegram.sendMessage(
                    subscriber.chatId,
                    `🚨 Your account health (${displayAddress(account.address)}) has dropped to ${health}%.`
                );
                notifiedSubscribers.add(subscriber.chatId);
            }
        }

        if (notifiedSubscribers.size > 0) {
            this.logger.info(`Sent health notification for account ${account.address.toBase58()} to ${Array.from(notifiedSubscribers).join(", ")}`);
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
                const subscriberId = await this.supabase.getSubscriberId(owner, subscriber.chatId);
                const thresholds = await this.supabase.getThresholds(owner, subscriber.chatId);

                for (const threshold of thresholds) {
                    const thresholdId = await this.supabase.getThresholdId(subscriberId, threshold.percentage);
                    await this.supabase.removeThreshold(thresholdId);
                }
                this.notifyDeletedAccountSubscriber(subscriber, owner);
            }
        }
    }

    private async notifyDeletedAccountSubscriber(subscriber: Subscriber, owner: PublicKey) {
        this.logger.info(`Sending deleted account notification for account ${owner} to ${subscriber.chatId}`);
        await this.telegram.sendMessage(
            subscriber.chatId,
            `⚠️ The Quartz account for ${displayAddress(owner)} has been deleted. I'll remove this account from your monitored list.`
        );
    }
}