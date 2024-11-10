import { Bot, GrammyError, HttpError } from "grammy";
import { monitoringService } from "../index.js";
import { getVault } from "../utils/helpers.js";
import { PublicKey } from "@drift-labs/sdk";
import { TG_API_KEY } from "../utils/config.js";

export const bot = new Bot(TG_API_KEY || '');

bot.command("start", (ctx) => ctx.reply("Hey! Please send me your wallet address so I can monitor your Quartz account health!"));

bot.command("stop", async (ctx) => {
    const walletAddress = await monitoringService.getWalletAddressByChatId(ctx.chat.id);
    
    if (walletAddress) {
        monitoringService.stopMonitoring(walletAddress);
    } else {
        ctx.reply("I'm not currently monitoring any accounts for you.");
    }
});

bot.hears(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, async (ctx) => {
    ctx.reply("Checking wallet address...")

    if (ctx.message && ctx.message.text) {
        const vault = getVault(new PublicKey(ctx.message.text));
        await monitoringService.startMonitoring(ctx.message.text, vault.toBase58(), ctx.chatId);
    } else {
        ctx.reply("I couldn't find your wallet address in the message. Please try again.")
    }
});

bot.on("message:text", async (ctx) => {
    const walletRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    
    if (!walletRegex.test(ctx.message.text)) {
        ctx.reply("That doesn't look like a valid wallet address... Please send me a valid Solana wallet address for me to start monitoring your account health.");
        return;
    }
    
    ctx.reply("Checking wallet address...");

    const vault = getVault(new PublicKey(ctx.message.text));
    await monitoringService.startMonitoring(ctx.message.text, vault.toBase58(), ctx.chat.id);
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