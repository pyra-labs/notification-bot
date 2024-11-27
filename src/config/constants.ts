import { PublicKey } from "@solana/web3.js";

export const LOOP_DELAY = 120_000;
export const DRIFT_MARKET_INDEX_USDC = 0;
export const DRIFT_MARKET_INDEX_SOL = 1;
export const MICRO_CENTS_PER_USDC = 1000000;
export const QUARTZ_PROGRAM_ID = new PublicKey("6JjHXLheGSNvvexgzMthEcgjkcirDrGduc3HAKB2P1v2");
export const QUARTZ_HEALTH_BUFFER_PERCENTAGE = 10;

export const FIRST_THRESHOLD = 25;
export const FIRST_THRESHOLD_WITH_BUFFER = 30;
export const SECOND_THRESHOLD = 10;
export const SECOND_THRESHOLD_WITH_BUFFER = 15;