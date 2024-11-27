import { BN, DRIFT_PROGRAM_ID, DriftClient, PublicKey } from "@drift-labs/sdk";
import { FUNDS_PROGRAM_ID, QUARTZ_HEALTH_BUFFER_PERCENTAGE } from "../config/constants";
import { Logger } from "winston";
import { DriftUser } from "../model/driftUser";
import { Connection } from "@solana/web3.js";

export function bnToDecimal(bn: BN, decimalPlaces: number): number {
    const decimalFactor = Math.pow(10, decimalPlaces);
    return bn.toNumber() / decimalFactor;
}

export const getVault = (owner: PublicKey) => {
    const [vault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.toBuffer()],
        new PublicKey(FUNDS_PROGRAM_ID)
    )
    return vault;
}

export const getDriftUser = (user: PublicKey) => {
    const authority = getVault(user);
    const [userPda] = PublicKey.findProgramAddressSync(
        [
			Buffer.from("user"),
			authority.toBuffer(),
			new BN(0).toArrayLike(Buffer, 'le', 2),
		],
		new PublicKey(DRIFT_PROGRAM_ID)
    );
    return userPda;
}

export const getUser = async (address: string, connection: Connection, driftClient: DriftClient) => {
    const driftUser = new DriftUser(new PublicKey(address), connection, driftClient);
    await retryRPCWithBackoff(
        async () => driftUser.initialize(),
        3,
        500
    );
    return driftUser;
}

export const getQuartzHealth = (driftHealth: number): number => {
    if (driftHealth <= 0) return 0;
    if (driftHealth >= 100) return 100;

    return Math.floor(
        Math.min(
            100,
            Math.max(
                0,
                (driftHealth - QUARTZ_HEALTH_BUFFER_PERCENTAGE) / (1 - (QUARTZ_HEALTH_BUFFER_PERCENTAGE / 100))
            )
        )
    );
}

export function getDisplayWalletAddress(address: string) {
    return `(${address.slice(0, 4)}...${address.slice(-4)})` 
}

export const retryRPCWithBackoff = async <T>(
    fn: () => Promise<T>,
    retries: number,
    initialDelay: number,
    logger?: Logger
): Promise<T> => {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            if (error?.message?.includes('503')) {
                const delay = initialDelay * Math.pow(2, i);
                if (logger) logger.warn(`RPC node unavailable, retrying in ${delay}ms...`);
                
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}
