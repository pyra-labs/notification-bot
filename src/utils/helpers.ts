import type { BN, } from "@drift-labs/sdk";
import type { Logger } from "winston";

export function bnToDecimal(bn: BN, decimalPlaces: number): number {
    const decimalFactor = 10 ** decimalPlaces;
    return bn.toNumber() / decimalFactor;
}

export function getAddressDisplay(address: string) {
    return `${address.slice(0, 4)}...${address.slice(-4)}` 
}

export const retryRPCWithBackoff = async <T>(
    fn: () => Promise<T>,
    retries: number,
    initialDelay: number,
    logger?: Logger
): Promise<T> => {
    return retryWithBackoff(
        fn,
        "503",
        "RPC node unavailable",
        retries,
        initialDelay,
        logger
    );
}

export const retryHTTPWithBackoff = async <T>(
    fn: () => Promise<T>,
    retries = 3,
    initialDelay = 1_000,
    logger?: Logger
): Promise<T> => {
    return retryWithBackoff(
        fn,
        "HttpError",
        "HTTP network request failed",
        retries,
        initialDelay,
        logger
    );
}

export const retryWithBackoff = async <T>(
    fn: () => Promise<T>,
    errorContains: string,
    warnString: string,
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
            if (error?.message?.includes(errorContains)) {
                const delay = initialDelay * (2 ** i);
                if (logger) logger.warn(`${warnString}, retrying in ${delay}ms...`);
                
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}