import config from "./config/config";
import { AppLogger } from "./utils/logger";
import express from "express";
import cors from "cors";
import hpp from "hpp";
import helmet from "helmet";
import { DriftClient, Wallet } from "@drift-labs/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TelegramBot } from "./telegramBot";

export class HealthMonitorBot extends AppLogger {
    public api: express.Application;
    public port: number;
    public isListening: boolean = false;

    private telegramBot: TelegramBot;

    private connection: Connection;
    private driftClient: DriftClient; 
    private initPromise: Promise<boolean>;

    constructor() {
        super("Health Monitor Bot");

        this.port = config.PORT;
        this.api = express();
        this.configureMiddleware();
        this.api.get("/", (req, res) => {
            res.status(200).json({ accounts: 0 }); // TODO - Add account count
        });

        this.telegramBot = new TelegramBot(
            this.startMonitoring,
            this.stopMonitoring
        );

        this.connection = new Connection(config.RPC_URL);
        const wallet = new Wallet(Keypair.generate());
        this.driftClient = new DriftClient({
            connection: this.connection,
            wallet: wallet,
            env: 'mainnet-beta',
        });
        this.initPromise = this.driftClient.subscribe();
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

    private async startMonitoring(address: string, chatId: number) {
        // TODO - Implement
    }

    private async stopMonitoring(chatId: number) {
        // TODO - Implement
    }

    public async start() {
        await this.initPromise;
        await this.listen();

        // TODO - Add monitoring logic
    }
}