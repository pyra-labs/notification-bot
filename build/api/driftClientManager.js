var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Wallet, DriftClient } from "@drift-labs/sdk";
import { HELIUS_RPC_URL, LOCAL_SECRET } from "../utils/config.js";
export class DriftClientManager {
    constructor() {
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.baseReconnectDelay = 1000;
        this.initializeDriftClient();
    }
    initializeDriftClient() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                this.connection = new Connection(HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com');
                const secret = JSON.parse(LOCAL_SECRET !== null && LOCAL_SECRET !== void 0 ? LOCAL_SECRET : "");
                const secretKey = Uint8Array.from(secret);
                const keypair = Keypair.fromSecretKey(secretKey);
                this.wallet = new Wallet(keypair);
                console.log("wallet created with keypair:", this.wallet.publicKey.toBase58());
                this.driftClient = new DriftClient({
                    connection: this.connection,
                    wallet: this.wallet,
                    env: 'mainnet-beta',
                });
                yield this.driftClient.subscribe();
                console.log('DriftClient initialized and subscribed successfully');
                this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
            }
            catch (error) {
                console.error('Error initializing DriftClient:', error);
                this.handleReconnection();
            }
        });
    }
    handleReconnection() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
                console.log(`Attempting to reconnect in ${delay}ms...`);
                setTimeout(() => {
                    this.reconnectAttempts++;
                    this.initializeDriftClient();
                }, delay);
            }
            else {
                console.error('Max reconnection attempts reached. Please check your connection and try again later.');
            }
        });
    }
    getUserHealth(address) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.emulateAccount(new PublicKey(address));
            const user = this.getUser();
            return user.getHealth();
        });
    }
    getSpotMarketAccount(marketIndex) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.driftClient.getSpotMarketAccount(marketIndex);
        });
    }
    getUser() {
        return this.driftClient.getUser();
    }
    emulateAccount(address) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.driftClient.emulateAccount(address);
        });
    }
}
