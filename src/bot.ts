import config from "./config/config.js";
import { Telegram } from "./clients/telegramClient.js";
import { Supabase } from "./clients/supabaseClient.js";
import type { MonitoredAccount } from "./interfaces/monitoredAccount.interface.js";
import { QuartzClient } from "@quartz-labs/sdk";
import { AppLogger } from "@quartz-labs/logger";
import { Connection } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";

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
    ) {
        await this.monitoredAccountsInitialized;

        if (thresholds.length === 0) {
            throw new Error("No thresholds provided");
        }

        for (const threshold of thresholds) {
            await this.supabase.subscribeToWallet(address, chatId, threshold);
        }

        const updatedAccount = await this.supabase.getMonitoredAccount(address);
        this.monitoredAccounts[address.toBase58()] = updatedAccount;
        
        this.logger.info(`${chatId} subscribed to ${address.toBase58()} with thresholds ${thresholds.join(", ")}`);
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
        // const quartzClient = await this.quartzClientPromise;
        await this.monitoredAccountsInitialized;
        await this.setupAutoRepayListener();

        this.logger.info(`Health Monitor Bot initialized with ${Object.keys(this.monitoredAccounts).length} accounts`);

        // TODO: Implement
    }

    private async setupAutoRepayListener() {
        // TODO: Implement
    }
}