import type { PublicKey } from "@solana/web3.js";
import { centsToDollars } from "../utils/helpers.js";

export class ExistingThresholdError extends Error {
    public availableCredit: number;

    constructor(availableCredit: number) {
          super(`Threshold ${centsToDollars(availableCredit)} already exists`);
          this.availableCredit = availableCredit;
    }
}

export class NoThresholdsError extends Error {
    constructor(address: PublicKey) {
        super(`No thresholds found for ${address.toBase58()}`);
    }
}

export class ThresholdNotFoundError extends Error {
    constructor(percentage: number) {
        super(`Threshold ${percentage}% not found`);
    }
}

export class UserNotFound extends Error {
    constructor(address: PublicKey) {
        super(`Could not find Quartz user for ${address.toBase58()}`)
    }
}