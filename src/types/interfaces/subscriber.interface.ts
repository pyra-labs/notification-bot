import type { Threshold } from "./threshold.interface.js";

export interface Subscriber {
    chat_id: number;
    thresholds: Threshold[];
}