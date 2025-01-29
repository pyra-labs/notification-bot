import type { BN } from "@quartz-labs/sdk";
import type { PublicKey } from "@solana/web3.js";

export function bnToDecimal(bn: BN, decimalPlaces: number): number {
    const decimalFactor = 10 ** decimalPlaces;
    return bn.toNumber() / decimalFactor;
}

export function displayAddress(address: PublicKey) {
    return `${address.toBase58().slice(0, 4)}...${address.toBase58().slice(-4)}` 
}