import config from "./config/config";
import { AppLogger } from "./utils/logger";
import express from "express";
import cors from "cors";
import hpp from "hpp";
import helmet from "helmet";
import { DriftClient, Wallet } from "@drift-labs/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Telegram } from "./clients/telegramClient";
import { getQuartzHealth, getUser } from "./utils/helpers";
import { DriftUser } from "./model/driftUser";
import { Supabase } from "./clients/supabaseClient";

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
        address: PublicKey;
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
            this.startMonitoring,
            this.stopMonitoring
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
                address: new PublicKey(account.address),
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
                    `Account ${address} is already being monitored, it's current health is ${quartzHealth}%`
                );
                return;
            }

            await this.supabase.addAccount(address, chatId, quartzHealth);
            this.monitoredAccounts.set(address, {
                address: new PublicKey(address),
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
        } catch (error) {
            this.logger.error(`Error stopping monitoring for chat ${chatId}: ${error}`);
            await this.telegram.api.sendMessage(
                chatId, 
                `Sorry, something went wrong. I've notified the team and we'll look into it ASAP.`
            );
        }
    }

    public async start() {
        await this.loadedAccountsPromise;
        await this.listen();

        // TODO - Add monitoring logic
    }
}