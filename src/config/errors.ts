import type { PublicKey } from "@solana/web3.js";
import { displayAddress } from "../utils/helpers.js";

export class ExistingThresholdError extends Error {
    public percentage: number;

    constructor(percentage: number) {
          super(`Threshold ${percentage}% already exists`);
          this.percentage = percentage;
    }
}

export class NoThresholdsError extends Error {
    constructor(address: PublicKey) {
        super(`No thresholds found for ${displayAddress(address)}`);
    }
}

export class ThresholdNotFoundError extends Error {
    constructor(percentage: number) {
        super(`Threshold ${percentage}% not found`);
    }
}