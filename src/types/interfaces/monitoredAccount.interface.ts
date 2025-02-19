import type { PublicKey } from "@solana/web3.js";
import type { Subscriber } from "./subscriber.interface.js";

export interface MonitoredAccount {
    address: PublicKey;
    last_available_credit: number;
    subscribers: Subscriber[];
}