import { DriftClient, User as DriftUser, Wallet } from "@drift-labs/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import appConfig from "../config/config.js";

export class DriftClientManager {
	private driftClient!: DriftClient;
	private connection!: Connection;
	private wallet!: Wallet;
	private reconnectAttempts: number = 0;
	private maxReconnectAttempts: number = 10;
	private baseReconnectDelay: number = 1000;
	private initialized: boolean = false;
	private initializationPromise: Promise<void>;

	constructor() {
		this.initializationPromise = this.initializeDriftClient();
	}

	private async initializeDriftClient() {
		try {
			this.connection = new Connection(appConfig.rpcUrl);
			this.wallet = new Wallet(Keypair.generate());

			console.log("wallet created with keypair:", this.wallet.publicKey.toBase58());

			this.driftClient = new DriftClient({
				connection: this.connection,
				wallet: this.wallet,
				env: "mainnet-beta",
			});

			await this.driftClient.subscribe();
			console.log("DriftClient initialized and subscribed successfully");
			this.reconnectAttempts = 0;
			this.initialized = true;
		} catch (error) {
			console.error("Error initializing DriftClient:", error);
			this.handleReconnection();
			throw error;
		}
	}

	private async handleReconnection() {
		if (this.reconnectAttempts < this.maxReconnectAttempts) {
			const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
			console.log(`Attempting to reconnect in ${delay}ms...`);
			setTimeout(() => {
				this.reconnectAttempts++;
				this.initializeDriftClient();
			}, delay);
		} else {
			console.error("Max reconnection attempts reached. Please check your connection and try again later.");
		}
	}

	public async waitForInitialization(): Promise<void> {
		return this.initializationPromise;
	}

	public async getUserHealth(address: string): Promise<number | any> {
		try {
			await this.waitForInitialization();
			await this.emulateAccount(new PublicKey(address));
			const user = this.getUser();
			return user.getHealth();
		} catch (error: any) {
			console.error(`Error getting user health for ${address}: ${error}`);
			return error;
		}
	}

	public async getSpotMarketAccount(marketIndex: number) {
		return await this.driftClient.getSpotMarketAccount(marketIndex);
	}

	getUser(): DriftUser {
		return this.driftClient.getUser();
	}

	async emulateAccount(address: PublicKey) {
		await this.driftClient.emulateAccount(address);
	}
}
