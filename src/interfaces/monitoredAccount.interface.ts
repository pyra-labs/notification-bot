import type { PublicKey } from "@solana/web3.js";

export interface MonitoredAccount {
    address: PublicKey;
    chatId: number;
    lastHealth: number;
    notifyAtFirstThreshold: boolean;
    notifyAtSecondThreshold: boolean;
    thresholds: number[];
}