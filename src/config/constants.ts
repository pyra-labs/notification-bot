import { PublicKey } from "@drift-labs/sdk";
import appConfig from "./config";

export const DRIFT_MARKET_INDEX_USDC = 0;
export const DRIFT_MARKET_INDEX_SOL = 1;
export const MICRO_CENTS_PER_USDC = 1000000;
export const FUNDS_PROGRAM_ID = new PublicKey(appConfig.fundsPublicKey);
