import { type Api, Bot, type BotError, type Context, GrammyError, HttpError } from "grammy";
import config from "../config/config.js";
import { AppLogger } from "@quartz-labs/logger";
import { retryWithBackoff } from "@quartz-labs/sdk";
import { PublicKey } from "@solana/web3.js";
import type { MonitoredAccount } from "../interfaces/monitoredAccount.interface.js";

export class Telegram extends AppLogger {
    public bot: Bot;
    public api: Api;

    constructor(
        subscribe: (chatId: number, address: PublicKey, thresholds: number[]) => Promise<void>,
        unsubscribe: (chatId: number, address?: PublicKey, thresholds?: number[]) => Promise<void>,
        getSubscriptions: (chatId: number) => Promise<MonitoredAccount[]>
    ) {
        super({
            name: "Health Monitor Bot - Telegram API",
            dailyErrorCacheTimeMs: 1000 * 60 * 60 // 1 hour
        });
        this.bot = new Bot(config.TG_API_KEY);
        this.api = this.bot.api;

        this.bot.command(
            "start", 
            (ctx) => {
                ctx.reply([
                    "Hey! Welcome to the Quartz Health Monitor Bot! 👋\n",
                    "Use /track followed by your wallet address and a health percentage and I'll start monitoring your Quartz account health.",
                    "Use /help to see all available commands."
                ].join("\n\n"));
            }
        );

        this.bot.command(
            "help", 
            (ctx) => {
                ctx.reply([
                    "💎 Quartz Health Monitor Bot commands:\n",
                    "/start \nStart the bot",
                    "/help \nShow this message",
                    "/track <address> <thresholds> \nSet account health percentage thresholds to be notified at. Eg: To be notified at 20% and 10%, use /track D4c8Pf2zKJpueLoj7CZXYmdgJQAT9FVXySAxURQDxa2m 20,10",
                    "/stop <address> <thresholds> \nRemove account health percentage thresholds to be notified at. Eg: To no longer be notified at 20%, use /stop D4c8Pf2zKJpueLoj7CZXYmdgJQAT9FVXySAxURQDxa2m 20",
                    "/stop <address> \nRemove all account health percentage thresholds for a specified wallet",
                    "/stop all \nRemove all account health percentage thresholds for all wallets",
                    "/list \nList all wallets currently being monitored, and their health notification thresholds",
                    "\nYou will also be notified if an auto-repay is triggered on any wallet you've set thresholds for"
                ].join("\n\n"));
            }
        );

        this.bot.command(
            "track",
            async (ctx) => {
                const address = await this.validateAddress(ctx, "/track D4c8Pf2zKJpueLoj7CZXYmdgJQAT9FVXySAxURQDxa2m");
                if (!address) return;

                const thresholds = ctx.message?.text?.split(address.toBase58())[1]?.replace(/\s+/g, '');
                if (!thresholds) {
                    ctx.reply("You must specify an account health percentage threshold to be notified at. Eg, to be notified at 20% and 10%: /track D4c8Pf2zKJpueLoj7CZXYmdgJQAT9FVXySAxURQDxa2m 20,10");
                    return;
                }
                const thresholdsArray = thresholds.split(",").map(Number);

                if (thresholdsArray.some(threshold => threshold < 0 || threshold > 100)) {
                    ctx.reply("Threshold percentages must be between 0 and 100");
                    return;
                }

                await subscribe(ctx.chat.id, address, thresholdsArray);
            }
        );

        this.bot.command(
            "stop", 
            async (ctx) => {
                const data = ctx.message?.text?.split(" ")[1];
                if (!data) {
                    ctx.reply([
                        "Please include what you want me to stop monitoring:",
                        "/stop D4c8Pf2zKJpueLoj7CZXYmdgJQAT9FVXySAxURQDxa2m 20,10 will remove the 20% and 10% notification thresholds for D4c8...xa2m",
                        "/stop D4c8Pf2zKJpueLoj7CZXYmdgJQAT9FVXySAxURQDxa2m will remove all notification thresholds for D4c8...xa2m",
                        "/stop all will stop monitoring all wallets"
                    ].join("\n"));
                    return;
                }

                if (data === "all") {
                    await unsubscribe(ctx.chat.id);
                    return;
                }
                
                const address = await this.validateAddress(ctx, "/stop D4c8Pf2zKJpueLoj7CZXYmdgJQAT9FVXySAxURQDxa2m or /stop all");
                if (!address) return;

                const thresholds = ctx.message?.text?.split(address.toBase58())[1]?.replace(/\s+/g, '');
                if (!thresholds) {
                    await unsubscribe(ctx.chat.id, address);
                    return;
                }

                const thresholdsArray = thresholds.split(",").map(Number);
                await unsubscribe(ctx.chat.id, address, thresholdsArray);
            }
        );

        this.bot.command(
            "list",
            async (ctx) => {
                const list = await getSubscriptions(ctx.chat.id);

                if (list.length === 0) {
                    ctx.reply("I'm not currently monitoring any accounts. Use /help to see how to add one.");
                    return;
                }

                const listDisplay = list.map((account) => {
                    const subscriber = account.subscribers.find(subscriber => subscriber.chatId === ctx.chat.id);
                    if (!subscriber) throw new Error("Subscriber not found");

                    const thresholds = subscriber.thresholds.map(
                        threshold => `${threshold.percentage}%`
                    ).join(", ");

                    return `${account.address.toBase58()} - ${thresholds}`;
                }).join("\n");

                ctx.reply([
                    "I'm currently monitoring the following accounts. I'll send a notification if auto-repay is triggered, or if their account health drops to the set percentages:",
                    "",
                    listDisplay
                ].join("\n"));
            }
        );

        this.bot.on(
            "message:text", 
            async (ctx) => {
                ctx.reply("I didn't get that... Use /help to see all available commands.");
            }
        );

        this.bot.catch(((err: BotError) => {
            const chatId = err.ctx?.chat?.id;
            const updateId = err.ctx?.update?.update_id;
            
            if (err.error instanceof GrammyError) {
                this.logger.error(`[${chatId}] ${updateId} >> Error in request: ${err.error.description}:`);
            } else if (err.error instanceof HttpError) {
                this.logger.error(`[${chatId}] ${updateId} >> Could not contact Telegram: ${err.error}:`);
            } else {
                this.logger.error(`[${chatId}] ${updateId} >> Unknown error: ${err.error}:`);
            }
        }).bind(this));

        this.bot.start();
    }

    private async validateAddress(
        ctx: Context,
        correctUsage: string
    ): Promise<PublicKey | null> {
        try {
            const address = ctx.message?.text?.split(" ")[1];
            if (!address) throw new Error("No address provided");
            return new PublicKey(address);
        } catch {
            await ctx.reply([
                "That doesn't look like a valid Solana wallet address...",
                `Please use the command like this: ${correctUsage}`
            ].join("\n"));
            return null;
        }
    }

    public async sendMessage(
        chatId: number,
        text: string
    ) {
        await retryWithBackoff(
            () => this.api.sendMessage(chatId, text)
        );
    }
}
