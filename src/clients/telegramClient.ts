import { Api, Bot, GrammyError, HttpError } from "grammy";
import { AppLogger } from "../utils/logger.js";
import config from "../config/config.js";

export class Telegram extends AppLogger {
    public bot: Bot;
    public api: Api;

    constructor(
        startMonitoring: (address: string, chatId: number) => Promise<void>,
        stopMonitoring: (chatId: number) => Promise<void>
    ) {
        super("Health Monitor Bot - Telegram API");
        this.bot = new Bot(config.TG_API_KEY);
        this.api = this.bot.api;

        this.bot.command(
            "start", 
            (ctx) => ctx.reply("Hey! Please send me your wallet address so I can monitor your Quartz account health!")
        );

        this.bot.command(
            "stop", 
            async (ctx) => {
                await stopMonitoring(ctx.chat.id);
            }
        );

        this.bot.on(
            "message:text", 
            async (ctx) => {
                const walletRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
                
                if (!walletRegex.test(ctx.message.text)) {
                    ctx.reply("That doesn't look like a valid wallet address... Please send me a valid Solana wallet address for me to start monitoring your account health.");
                    return;
                }
            
                await startMonitoring(ctx.message.text, ctx.chat.id);
            }
        );

        this.bot.catch((err) => {
            const chatId = err.ctx?.chat?.id;
            const updateId = err.ctx?.update?.update_id;
            
            if (err.error instanceof GrammyError) {
                this.logger.error(`[${chatId}] ${updateId} >> Error in request: ${err.error.description}:`);
            } else if (err.error instanceof HttpError) {
                this.logger.error(`[${chatId}] ${updateId} >> Could not contact Telegram: ${err.error}:`);
            } else {
                this.logger.error(`[${chatId}] ${updateId} >> Unknown error: ${err.error}:`);
            }
        });

        this.bot.start();
    }
}
