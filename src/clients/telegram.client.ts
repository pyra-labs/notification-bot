import { type Api, Bot, type BotError, type Context, GrammyError, HttpError } from "grammy";
import config from "../config/config.js";
import { AppLogger } from "@quartz-labs/logger";
import { retryWithBackoff } from "@quartz-labs/sdk";
import { PublicKey } from "@solana/web3.js";
import type { MonitoredAccount } from "../types/interfaces/monitoredAccount.interface.js";
import { centsToDollars, displayAddress, dollarsToCents } from "../utils/helpers.js";
import { ExistingThresholdError, NoThresholdsError, ThresholdNotFoundError, UserNotFound } from "../config/errors.js";
import { ADMIN_CHAT_ID } from "../config/constants.js";

export class Telegram extends AppLogger {
    public bot: Bot;
    public api: Api;

    constructor(
        prepareAnnouncement: (message: string) => void,
        getAndClearAnnouncement: () => string,
        getAllChatIds: () => Promise<number[]>,
        subscribe: (chatId: number, address: PublicKey, thresholds: number[]) => Promise<number>,
        unsubscribe: (chatId: number, address?: PublicKey, thresholds?: number[]) => Promise<boolean>,
        getSubscriptions: (chatId: number) => Promise<MonitoredAccount[]>,
    ) {
        super({
            name: "Notification Bot - Telegram API",
            dailyErrorCacheTimeMs: 1000 * 60 * 60 // 1 hour
        });
        this.bot = new Bot(config.TG_API_KEY);
        this.api = this.bot.api;

        this.bot.command(
            "start", 
            async (ctx) => {
                await this.reply(ctx, [
                    "Hey! Welcome to the Quartz Notification Bot! 👋\n",
                    "I can send you notifications whenever your available credit drops below a certain amount, or if an auto-repay is triggered.",
                    "Use /help to see all available commands."
                ].join("\n"));
            }
        );

        this.bot.command(
            "help", 
            async (ctx) => {
                const command = ctx.message?.text?.split(" ")[1]?.trim().replace(/^\//, "");
                if (!command) {
                    await this.reply(ctx, [
                        "💎 Quartz Notification Bot commands:\n",
                        "/start \nStart the bot",
                        "/help \nShow this message",
                        "/help <command> \nShow detailed help and examples for a command \nEg: /help /track",
                        "/track <address> <thresholds> \nSet account available credit thresholds to be notified at",
                        "/stop <address> <thresholds> \nRemove account available credit thresholds to be notified at",
                        "/stop <address> \nRemove all account available credit thresholds for a specified wallet",
                        "/stop all \nRemove all account available credit thresholds for all wallets",
                        "/list \nList all wallets currently being monitored, and their available credit notification thresholds",
                        "\nYou will also be notified if an auto\\-repay is triggered on any wallet you've set thresholds for"
                    ].join("\n\n"));
                    return;
                }

                switch (command) {
                    case "start":
                        await this.reply(ctx, [
                            "/start",
                            "Start the bot"
                        ].join("\n"));
                        break;
                    case "help":
                        await this.reply(ctx, [
                            "/help",
                            "Show all available commands",
                            "",
                            "Use /help \\<command\\> to see detailed help and examples for a specific command, eg: `/help /track`"
                        ].join("\n"), true);
                        break;
                    case "track":
                        await this.reply(ctx, [
                            "/track \\<address\\> \\<thresholds\\>",
                            "Set account available credit thresholds to be notified at, specified as a comma\\-separated list of amounts\\. If you have any thresholds set for a wallet, you will also receive notifications when an auto\\-repay is triggered\\.",
                            "",
                            "Eg: To be notified at $30 and $10\\.50, use `/track D4c8Pf2zKJpueLoj7CZXYmdgJQAT9FVXySAxURQDxa2m 30,10\\.50`",
                            "To be notified at $50, use `/track D4c8Pf2zKJpueLoj7CZXYmdgJQAT9FVXySAxURQDxa2m 50`"
                        ].join("\n"), true);
                        break;
                    case "stop":
                        await this.reply(ctx, [
                            "/stop \\<address\\> \\<thresholds\\>",
                            "Remove account available credit thresholds to be notified at",
                            "",
                            "Eg: To no longer be notified at $30 and $10\\.50, use `/stop D4c8Pf2zKJpueLoj7CZXYmdgJQAT9FVXySAxURQDxa2m 30,10\\.50`"
                        ].join("\n"), true);
                        await this.reply(ctx, [
                            "/stop \\<address\\>",
                            "Remove all account available credit thresholds for a specified wallet\\. You will no longer be notified about available credit or auto\\-repay for the account\\.",
                            "",
                            "Eg: To no longer be notified for D4c8\\.\\.\\.xa2m, use `/stop D4c8Pf2zKJpueLoj7CZXYmdgJQAT9FVXySAxURQDxa2m`"
                        ].join("\n"), true);
                        await this.reply(ctx, [
                            "/stop all",
                            "Remove all account available credit thresholds for all wallets. I will no longer send you any notifications."
                        ].join("\n"));
                        break;
                    case "list":
                        await this.reply(ctx, [
                            "/list",
                            "List all wallets currently being monitored, their available credit notification thresholds, and their current available credit"
                        ].join("\n"));
                        break;
                    default:
                        await this.reply(ctx, `"${command}" isn't a valid command, use /help to see all available commands`);
                        break;
                }
            }
        );

        this.bot.command(
            "track",
            async (ctx) => {
                const address = await this.validateAddress(ctx, "/track");
                if (!address) return;

                const thresholds = ctx.message?.text?.split(address.toBase58())[1]?.replace(/\s+/g, '');
                if (!thresholds) {
                    await this.reply(ctx, "You must specify an available credit threshold to be notified at. Use /help /track for details.");
                    return;
                }

                let thresholdsArray: number[];
                try {
                    thresholdsArray = thresholds.split(",").map(dollarsToCents);
                } catch {
                    await this.reply(ctx, "Threshold amounts must be provided as whole numbers. Use /help /track for details.");
                    return;
                }

                try {
                    const availableCredit = await subscribe(ctx.chat.id, address, thresholdsArray);
                    this.logger.info(`Subscribed to ${displayAddress(address)} with thresholds ${thresholdsArray.join(", ")}`);
                    await this.reply(ctx, `🔎 I've started monitoring ${displayAddress(address)}! Your current available credit is ${centsToDollars(availableCredit)}`);
                } catch (error) {
                    if (error instanceof UserNotFound) {
                        await this.reply(ctx, `Error: Could not find Quartz user for wallet address ${address.toBase58()}`);
                    } else if (error instanceof ExistingThresholdError) {
                        await this.reply(ctx, `Error: Threshold ${centsToDollars(error.availableCredit)} already exists for ${displayAddress(address)}`);
                    } else {
                        await this.reply(ctx, "Sorry, something went wrong. I've notified the team and we'll look into it ASAP.");
                        this.logger.error(error);
                        return;
                    }
                }
            }
        );

        this.bot.command(
            "stop", 
            async (ctx) => {
                const data = ctx.message?.text?.split(" ")[1];
                if (!data) {
                    await this.reply(ctx, "Please include what you want me to stop monitoring. Use /help /stop for details.");
                    return;
                }

                if (data === "all") {
                    try {
                        await unsubscribe(ctx.chat.id);
                        await this.reply(ctx, "🗑️ I've stopped monitoring all accounts, you won't receive any more notifications from me!");
                    } catch (error) {
                        if (error instanceof NoThresholdsError) {
                            await this.reply(ctx, "I'm not currently monitoring any accounts. Use /help /track to see how to add one.");
                        } else {
                            await this.reply(ctx, "Sorry, something went wrong. I've notified the team and we'll look into it ASAP.");
                            this.logger.error(error);
                            return;
                        }
                    }
                    return;
                }
                
                const address = await this.validateAddress(ctx, "/stop");
                if (!address) return;

                const thresholds = ctx.message?.text?.split(address.toBase58())[1]?.replace(/\s+/g, '');
                if (!thresholds) {
                    try {
                        await unsubscribe(ctx.chat.id, address);
                        await this.reply(ctx, `🗑️ I've removed all thresholds from ${displayAddress(address)}, you won't receive any more notifications for this account.`);
                    } catch (error) {
                        if (error instanceof NoThresholdsError) {
                            await this.reply(ctx, `I'm not currently monitoring any thresholds for ${displayAddress(address)}. Use /help /track to see how to add one.`);
                        } else {
                            await this.reply(ctx, "Sorry, something went wrong. I've notified the team and we'll look into it ASAP.");
                            this.logger.error(error);
                            return;
                        }
                    }
                    return;
                }

                let thresholdsArray: number[];
                try {
                    thresholdsArray = thresholds.split(",").map(dollarsToCents);
                } catch {
                    await this.reply(ctx, "Threshold amounts must be provided as whole numbers. Use /help /track for details.");
                    return;
                }

                try {
                    const noRemainingThresholds = await unsubscribe(ctx.chat.id, address, thresholdsArray);

                    if (noRemainingThresholds) {
                        await this.reply(ctx, `🗑️ I've removed all thresholds from ${displayAddress(address)}, you won't receive any more notifications for this account.`);
                    } else {
                        const plural = thresholdsArray.length > 1 ? "s" : "";
                        await this.reply(ctx, `🗑️ I've removed the threshold${plural} $${thresholdsArray.join(", $")} for ${displayAddress(address)}.`);
                    }
                } catch (error) {
                    if (error instanceof ThresholdNotFoundError) {
                        await this.reply(ctx, `Error: ${error.message} for ${displayAddress(address)}`);
                    } else {
                        await this.reply(ctx, "Sorry, something went wrong. I've notified the team and we'll look into it ASAP.");
                        this.logger.error(error);
                        return;
                    }
                }
            }
        );

        this.bot.command(
            "list",
            async (ctx) => {
                let list: MonitoredAccount[] = [];
                try {
                    list = await getSubscriptions(ctx.chat.id);
                } catch (error) {
                    await this.reply(ctx, "Sorry, something went wrong. I've notified the team and we'll look into it ASAP.");
                    this.logger.error(error);
                    return;
                }

                if (list.length === 0) {
                    await this.reply(ctx, "I'm not currently monitoring any accounts. Use /help /track to see how to add one.");
                    return;
                }

                let listDisplay = "";
                try {
                    listDisplay = list.map((account) => {
                        const subscriber = account.subscribers.find(subscriber => subscriber.chat_id === ctx.chat.id);
                        if (!subscriber) throw new Error("Subscriber not found");

                        const thresholds = subscriber.thresholds.map(
                            threshold => threshold.available_credit
                        ).sort((a, b) => a - b);

                        const availableCredits = thresholds.map(
                            availableCredit => centsToDollars(availableCredit)
                        ).join(", ");

                        const lastAvailableCredit = centsToDollars(account.last_available_credit);
                        return `${account.address.toBase58()} \nAvailable credit: ${lastAvailableCredit} \nNotification thresholds: ${availableCredits}`;
                    }).join("\n\n");
                } catch (error) {
                    await this.reply(ctx, "Sorry, something went wrong. I've notified the team and we'll look into it ASAP.");
                    this.logger.error(error);
                    return;
                }

                await this.reply(ctx, [
                    "I'm currently monitoring the following accounts. I'll send a notification if auto-repay is triggered, or if their available credit drops to the set amounts:",
                    "",
                    listDisplay
                ].join("\n"));
            }
        );

        this.bot.command(
            "admin",
            async (ctx) => {
                if (ctx.chat.id !== ADMIN_CHAT_ID) {
                    await this.reply(ctx, "I didn't get that... Use /help to see all available commands.");
                    return;
                }

                const announcement = ctx.message?.text?.split("/admin ")[1] ?? "";

                const loadedAnnouncement = getAndClearAnnouncement();
                if (loadedAnnouncement) {
                    if (announcement.toLowerCase() === "/send") {
                        await this.reply(ctx, "Sending announcements...");
                        const chatIds = await getAllChatIds();
                        for (const chatId of chatIds) {
                            await this.sendMessage(chatId, loadedAnnouncement);
                        }
                        await this.reply(ctx, "Announcements sent!");
                        return;
                    }

                    await this.reply(ctx, "Cancelled sending message.");
                    return;
                }

                if (announcement) {
                    prepareAnnouncement(announcement);
                    await this.reply(ctx, "Announcement prepared. Use /admin /send to send. Preview:");
                    await this.reply(ctx, announcement);
                } else {
                    await this.reply(ctx, "You must include a message.")
                }
            }
        );

        this.bot.on(
            "message:text", 
            async (ctx) => {
                if (ctx.message.text.toLowerCase() === "gm") {
                    await this.reply(ctx, "gm");
                    return;
                } 

                await this.reply(ctx, "I didn't get that... Use /help to see all available commands.");
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
        command: string
    ): Promise<PublicKey | null> {
        try {
            const address = ctx.message?.text?.split(" ")[1];
            if (!address) throw new Error("No address provided");
            return new PublicKey(address);
        } catch {
            await this.reply(ctx, [
                `That doesn't look like a valid Solana wallet address. Use /help ${command} for help.`,
            ].join("\n"));
            return null;
        }
    }

    private async reply(
        ctx: Context,
        text: string,
        markdown = false
    ) {
        try {
            await retryWithBackoff(
                () => ctx.reply(text, { parse_mode: markdown ? "MarkdownV2" : undefined })
            );
        } catch (error) {
            this.logger.error(`Error sending message to ${ctx.chat?.id} "${text}"... Error: ${error}`);
            return;
        }
    }

    public async sendMessage(
        chatId: number,
        text: string
    ) {
        try {
            await retryWithBackoff(
                () => this.api.sendMessage(chatId, text)
            );
        } catch (error) {
            this.logger.error(`Error sending message to ${chatId} "${text}"... Error: ${error}`);
            return;
        }
    }
}
