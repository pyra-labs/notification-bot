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