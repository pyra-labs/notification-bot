import { Bot, GrammyError, HttpError } from "grammy";
import { monitoringService } from "../index.js";
import { getVault } from "../utils/helpers.js";
import { PublicKey } from "@drift-labs/sdk";
import { TG_API_KEY } from "../utils/config.js";

export const bot = new Bot(TG_API_KEY || '');

bot.command("start", (ctx) => ctx.reply("Welcome! Please send me your wallet address so I can monitor your Quartz account health!"));

bot.command("stop", (ctx) => {
    const walletAddress = monitoringService.getWalletAddressByChatId(ctx.chat.id);
    
    if (walletAddress) {
        monitoringService.stopMonitoring(walletAddress);
        ctx.reply("I'll stop monitoring your account health now!");
    } else {
        ctx.reply("I'm not currently monitoring any accounts for you.");
    }
});

bot.hears(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, async (ctx) => {
    ctx.reply("Thanks! I'll start monitoring your Quartz account health, if it ever goes down I'll let you know!")

    if (ctx.message && ctx.message.text) {
        const vault = getVault(new PublicKey(ctx.message.text));
        await monitoringService.startMonitoring(vault.toBase58(), ctx.chatId);
    } else {
        ctx.reply("I couldn't find your wallet address in the message. Please try again.")
    }
});

bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
        console.error("Error in request:", e.description);
    } else if (e instanceof HttpError) {
        console.error("Could not contact Telegram:", e);
    } else {
        console.error("Unknown error:", e);
    }
});