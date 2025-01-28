import type { BN } from "@quartz-labs/sdk";

export function bnToDecimal(bn: BN, decimalPlaces: number): number {
    const decimalFactor = 10 ** decimalPlaces;
    return bn.toNumber() / decimalFactor;
}

export function getAddressDisplay(address: string) {
    return `${address.slice(0, 4)}...${address.slice(-4)}` 
}