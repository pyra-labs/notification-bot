import config from "./config/config.js";
import { AppLogger } from "./utils/logger.js";
import express from "express";
import cors from "cors";
import hpp from "hpp";
import helmet from "helmet";
import { DriftClient, Wallet } from "@drift-labs/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Telegram } from "./clients/telegramClient.js";
import { getAddressDisplay, getQuartzHealth, getUser, getVault } from "./utils/helpers.js";
import { DriftUser } from "./model/driftUser.js";
import { retryRPCWithBackoff } from "./utils/helpers.js";
import { Supabase } from "./clients/supabaseClient.js";
import { LOOP_DELAY } from "./config/constants.js";

export class HealthMonitorBot extends AppLogger {
    public api: express.Application;
    public port: number;
    public isListening: boolean = false;

    private connection: Connection;
    private driftClient: DriftClient; 
    private driftInitPromise: Promise<boolean>;

    private telegram: Telegram;
    private supabase: Supabase;
    private monitoredAccounts: Map<string, {
        lastHealth: number;
        chatId: number;
    }>;
    private loadedAccountsPromise: Promise<void>;

    constructor() {
        super("Health Monitor Bot");

        this.port = config.PORT;
        this.api = express();
        this.configureMiddleware();
        this.api.get("/", (req, res) => {
            res.status(200).json({ accounts: 0 }); // TODO - Add account count
        });

        this.connection = new Connection(config.RPC_URL);
        const wallet = new Wallet(Keypair.generate());
        this.driftClient = new DriftClient({
            connection: this.connection,
            wallet: wallet,
            env: 'mainnet-beta',
        });
        this.driftInitPromise = this.driftClient.subscribe();

        this.telegram = new Telegram(
            this.startMonitoring.bind(this),
            this.stopMonitoring.bind(this)
        );
        this.supabase = new Supabase();
        this.monitoredAccounts = new Map();
        this.loadedAccountsPromise = this.loadStoredAccounts();
    }

    private configureMiddleware() {
        this.api.use(cors({ origin: "*" }));
        this.api.use(hpp());
        this.api.use(helmet());
        this.api.use(express.json());
    } 

    private async listen() {
        if (this.isListening) {
            this.logger.warn("API is already listening");
            return;
        }

        this.api.listen(this.port, () => {
            this.isListening = true;
            this.logger.info(`API listening on port ${this.port}`);
        });
    }

    private async loadStoredAccounts(): Promise<void> {
        await this.driftInitPromise;

        const accounts = await this.supabase.getAccounts();

        for (const account of accounts) {
            this.monitoredAccounts.set(account.address, {
                lastHealth: account.lastHealth,
                chatId: account.chatId,
            });
        }
    }

    private async startMonitoring(address: string, chatId: number) {
        try {
            let driftUser: DriftUser;
            try {
                driftUser = await getUser(address, this.connection, this.driftClient);
            } catch (error) {
                await this.telegram.api.sendMessage(
                    chatId, 
                    "I couldn't find a Quartz account with this wallet address. Please send the address of a wallet that's been used to create a Quartz account."
                );
                return;
            }

            const driftHealth = driftUser.getHealth();
            const quartzHealth = getQuartzHealth(driftHealth);

            if (this.monitoredAccounts.has(address)) {
                await this.telegram.api.sendMessage(
                    chatId, 
                    `Account ${getAddressDisplay(address)} is already being monitored, it's current health is ${quartzHealth}%`
                );
                return;
            }

            await this.supabase.addAccount(address, chatId, quartzHealth);
            this.monitoredAccounts.set(address, {
                lastHealth: quartzHealth,
                chatId: chatId,
            });

            await this.telegram.api.sendMessage(
                chatId, 
                `I've started monitoring your Quartz account health! I'll send you a message if it drops below 25%, if it drops below 10%, or if it's auto-repaid using your collateral. Your current account health is ${quartzHealth}%`
            );
            await this.telegram.api.sendMessage(
                chatId, 
                `Be sure to turn on notifications in your Telegram app to receive alerts! 🔔`
            );
            await this.telegram.api.sendMessage(
                chatId, 
                `Send /stop to stop receiving messages.`
            );
            this.logger.info(`Started monitoring account ${address}`);
        } catch (error) {
            this.logger.error(`Error starting monitoring for account ${address}: ${error}`);
            await this.telegram.api.sendMessage(
                chatId, 
                `Sorry, something went wrong. I've notified the team and we'll look into it ASAP.`
            );
        }
    }

    private async stopMonitoring(chatId: number) {
        try {
            const addresses: string[] = [];
            for (const [address, data] of this.monitoredAccounts.entries()) {
                if (data.chatId === chatId) addresses.push(address);
            }

            if (addresses.length === 0) {
                await this.telegram.api.sendMessage(
                    chatId,
                    "You don't have any accounts being monitored."
                );
                return;
            }

            await this.supabase.removeAccounts(addresses);
            for (const address of addresses) {
                this.monitoredAccounts.delete(address);
            }

            await this.telegram.api.sendMessage(
                chatId,
                `I've stopped monitoring your Quartz accounts. Just send another address if you want me to start monitoring again!`
            );
            this.logger.info(`Stopped monitoring accounts: ${addresses.join(", ")}`);
        } catch (error) {
            this.logger.error(`Error stopping monitoring for chat ${chatId}: ${error}`);
            await this.telegram.api.sendMessage(
                chatId, 
                `Sorry, something went wrong. I've notified the team and we'll look into it ASAP.`
            );
        }
    }

    public async start() {
        this.listen();
        await this.loadedAccountsPromise;
        this.logger.info(`Health Monitor Bot initialized`);

        while (true) {
            const now = new Date();
            this.logger.info(`[${now.toISOString()}] Checking ${this.monitoredAccounts.size} accounts...`);

            for (const [address, account] of this.monitoredAccounts.entries()) {
                const displayAddress = getAddressDisplay(address);
                const vaultAddress = getVault(new PublicKey(address));
                try {
                    const driftUser = new DriftUser(vaultAddress, this.connection, this.driftClient!);
                    await retryRPCWithBackoff(
                        async () => driftUser.initialize(),
                        3,
                        1_000,
                        this.logger
                    );

                    const driftHealth = driftUser.getHealth();
                    const currentHealth = getQuartzHealth(driftHealth);
                    if (currentHealth === account.lastHealth) continue;

                    if (account.lastHealth > 25 && currentHealth <= 25) {
                        await this.telegram.api.sendMessage(
                            account.chatId,
                            `Your account health for wallet ${displayAddress} has dropped to ${currentHealth}%. Please add more collateral to your account to avoid auto-repay!`
                        );
                        this.logger.info(`Sending health warning to ${address} (was ${account.lastHealth}%, now ${currentHealth}%)`);
                    }

                    if (account.lastHealth > 10 && currentHealth <= 10) {
                        await this.telegram.api.sendMessage(
                            account.chatId,
                            `🚨 Your account health for wallet ${displayAddress} has dropped to ${currentHealth}%. If you don't add more collateral, your loans will be auto-repaid at market rate.`
                        );
                        this.logger.info(`Sending health warning to ${address} (was ${account.lastHealth}%, now ${currentHealth}%)`);
                    }

                    // TODO - Notify on auto-repay

                    this.monitoredAccounts.set(address, {
                        lastHealth: currentHealth,
                        chatId: account.chatId,
                    });
                    this.supabase.updateAccount(address, currentHealth);
                } catch (error) {
                    this.logger.error(`Error finding Drift User for ${address}: ${error}`);
                }
            }

            await new Promise(resolve => setTimeout(resolve, LOOP_DELAY));
        }
    }
}