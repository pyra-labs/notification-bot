import { getVaultPublicKey, retryWithBackoff, type BN } from "@quartz-labs/sdk";
import type { Connection, PublicKey } from "@solana/web3.js";

export function bnToDecimal(bn: BN, decimalPlaces: number): number {
    const decimalFactor = 10 ** decimalPlaces;
    return bn.toNumber() / decimalFactor;
}

export function displayAddress(address: PublicKey) {
    return `${address.toBase58().slice(0, 4)}...${address.toBase58().slice(-4)}` 
}

export async function checkHasVaultHistory(connection: Connection, wallet: PublicKey): Promise<boolean> {
    const vaultPda = getVaultPublicKey(wallet);
    const signatures = await retryWithBackoff(
        async () => connection.getSignaturesForAddress(vaultPda),
        4
    );
    const isSignatureHistory = (signatures.length > 0);
    return isSignatureHistory;
}

export function centsToDollars(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
}

export function dollarsToCents(dollarsStr: string): number {
    const cleanedDollars = dollarsStr.startsWith('$') ? dollarsStr.slice(1) : dollarsStr;
    const dollars = Number.parseFloat(cleanedDollars);
    if (Number.isNaN(dollars)) throw new Error("Invalid dollar amount");
    
    return Math.round(dollars * 100);
}