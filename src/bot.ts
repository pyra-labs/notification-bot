import config from "./config/config.js";
import { Telegram } from "./clients/telegramClient.js";
import { Supabase } from "./clients/supabaseClient.js";
import type { MonitoredAccount } from "./interfaces/monitoredAccount.interface.js";
import { QuartzClient, type QuartzUser, retryWithBackoff } from "@quartz-labs/sdk";
import { AppLogger } from "@quartz-labs/logger";
import { Connection, type MessageCompiledInstruction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { displayAddress } from "./utils/helpers.js";
import { LOOP_DELAY } from "./config/constants.js";

export class HealthMonitorBot extends AppLogger {
    private telegram: Telegram;
    private supabase: Supabase;

    private monitoredAccounts: Record<string, MonitoredAccount>;
    private monitoredAccountsInitialized: Promise<void>;
    private quartzClientPromise: Promise<QuartzClient>;

    constructor() {
        super({
            name: "Health Monitor Bot",
            dailyErrorCacheTimeMs: 1000 * 60 * 60 // 1 hour
        });

        const connection = new Connection(config.RPC_URL);
        this.quartzClientPromise = QuartzClient.fetchClient(connection);

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
                async () => quartzClient.getQuartzAccount(address)
            );
            health = user.getHealth();
        } catch {
            throw new Error("User not found");
        }

        if (thresholds.length === 0) {
            throw new Error("No thresholds provided");
        }

        for (const threshold of thresholds) {
            await this.supabase.subscribeToWallet(address, chatId, threshold, health);
        }

        const updatedAccount = await this.supabase.getMonitoredAccount(address);
        this.monitoredAccounts[address.toBase58()] = updatedAccount;
        
        this.logger.info(`${chatId} subscribed to ${address.toBase58()} with thresholds ${thresholds.join(", ")}`);
        return updatedAccount.lastHealth;
    }

    private async unsubscribe(
        chatId: number,
        address?: PublicKey, 
        thresholds?: number[]
    ) {
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
            return;
        }

        // Set thresholds to all thresholds if none provided
        if (!thresholds || thresholds.length === 0) {
            thresholds = await this.supabase.getThresholds(address, chatId)
                .then(thresholds => thresholds.map(threshold => threshold.percentage));
            if (!thresholds) {
                throw new Error("No thresholds found");
            }
        }
        
        // Remove each threshold from database
        const subscriberId = await this.supabase.getSubscriberId(address, chatId);
        for (const threshold of thresholds) {
            const thresholdId = await this.supabase.getThresholdId(subscriberId, threshold);
            await this.supabase.removeThreshold(thresholdId);
        }

        // Update local state
        const updatedAccounts = await this.getSubscriptions(chatId);
        for (const account of updatedAccounts) {
            this.monitoredAccounts[account.address.toBase58()] = account;
        }

        this.logger.info(`${chatId} removed the thresholds ${thresholds.join(", ")} from ${address.toBase58()}`);
    }

    private async getSubscriptions(
        chatId: number
    ): Promise<MonitoredAccount[]> {
        await this.monitoredAccountsInitialized;
        return this.supabase.getSubscriptions(chatId);
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
                this.logger.error(`Error fetching users: ${error}`);
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

    private async updateHealth(account: MonitoredAccount, health: number) {
        await this.supabase.updateHealth(account.address, health);

        const notifiedSubscribers = new Set<number>();
        for (const subscriber of account.subscribers) {
            const subscriberId = await this.supabase.getSubscriberId(account.address, subscriber.chatId);
            let smallestThresholdPercentage = 100;

            for (const threshold of subscriber.thresholds) {
                if (!threshold.notify) {
                    if (health === 100 || health >= threshold.percentage + 5) {
                        // Enable notifications (has reached 5% above threshold)
                        const thresholdId = await this.supabase.getThresholdId(subscriberId, threshold.percentage);
                        await this.supabase.updateThreshold(thresholdId, threshold.percentage, true);
                    }
                    continue;
                }

                if (health <= threshold.percentage) {
                    // Disable notifications (until it rises 5% above)
                    const thresholdId = await this.supabase.getThresholdId(subscriberId, threshold.percentage);
                    await this.supabase.updateThreshold(thresholdId, threshold.percentage, false);

                    smallestThresholdPercentage = Math.min(smallestThresholdPercentage, threshold.percentage);
                }
            }

            const updatedAccount = await this.supabase.getMonitoredAccount(account.address);
            this.monitoredAccounts[account.address.toBase58()] = updatedAccount;

            if (smallestThresholdPercentage !== 100) {
                await this.telegram.sendMessage(
                    subscriber.chatId,
                    `🚨 Your account health (${displayAddress(account.address)}) has dropped to ${smallestThresholdPercentage}%.`
                );
                notifiedSubscribers.add(subscriber.chatId);
            }
        }

        if (notifiedSubscribers.size > 0) {
            this.logger.info(`Sent health notification for account ${account.address.toBase58()} to ${Array.from(notifiedSubscribers).join(", ")}`);
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
}