import type { Threshold } from "./threshold.interface.js";

export interface Subscriber {
    chatId: number;
    thresholds: Threshold[];
}