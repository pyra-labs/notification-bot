import config from "./config/config.js";
import { AppLogger } from "./utils/logger.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Telegram } from "./clients/telegramClient.js";
import { getAddressDisplay, retryHTTPWithBackoff } from "./utils/helpers.js";
import { retryRPCWithBackoff } from "./utils/helpers.js";
import { Supabase } from "./clients/supabaseClient.js";
import { LOOP_DELAY, FIRST_THRESHOLD_WITH_BUFFER, SECOND_THRESHOLD_WITH_BUFFER, FIRST_THRESHOLD, SECOND_THRESHOLD, } from "./config/constants.js";
import type { MonitoredAccount } from "./interfaces/monitoredAccount.interface.js";
import type { MessageCompiledInstruction } from "@solana/web3.js";
import { QuartzClient, type QuartzUser, Wallet } from "@quartz-labs/sdk";

export class HealthMonitorBot extends AppLogger {
    private quartzClientPromise: Promise<QuartzClient>;

    private telegram: Telegram;
    private supabase: Supabase;
    private monitoredAccounts: Map<string, MonitoredAccount>;
    private loadedAccountsPromise: Promise<void>;

    constructor() {
        super("Health Monitor Bot");

        const connection = new Connection(config.RPC_URL);
        const wallet = new Wallet(Keypair.generate());
        this.quartzClientPromise = QuartzClient.fetchClient(connection, wallet);

        this.telegram = new Telegram(
            this.startMonitoring.bind(this),
            this.stopMonitoring.bind(this)
        );
        this.supabase = new Supabase();
        this.monitoredAccounts = new Map();
        this.loadedAccountsPromise = this.loadStoredAccounts();
    }

    private async loadStoredAccounts(): Promise<void> {
        const accounts = await this.supabase.getAccounts();

        for (const account of accounts) {
            this.monitoredAccounts.set(account.address, {
                address: account.address,
                chatId: account.chatId,
                lastHealth: account.lastHealth,
                notifyAtFirstThreshold: account.notifyAtFirstThreshold,
                notifyAtSecondThreshold: account.notifyAtSecondThreshold
            });
        }
    }

    private async startMonitoring(address: string, chatId: number) {
        const quartzClient = await this.quartzClientPromise;

        let user: QuartzUser;
        try {
            user = await retryRPCWithBackoff(
                async () => quartzClient.getQuartzAccount(new PublicKey(address)),
                3,
                1_000,
                this.logger
            );
        } catch {
            await retryHTTPWithBackoff(
                async () => await this.telegram.api.sendMessage(
                    chatId, 
                    "I couldn't find a Quartz account with this wallet address. Please send the address of a wallet that's been used to create a Quartz account."
                ),
                3,
                1_000,
                this.logger
            );
            return;
        }

        try {
            const health = user.getHealth();
            
            if (this.monitoredAccounts.has(address)) {
                await retryHTTPWithBackoff(
                    async () => await this.telegram.api.sendMessage(
                        chatId, 
                        `That account is already being monitored, it's current health is ${health}%`
                    ),
                    3,
                    1_000,
                    this.logger
                );
                return;
            }

            await this.supabase.addAccount(address, chatId, health);
            this.monitoredAccounts.set(address, {
                address: address,
                chatId: chatId,
                lastHealth: health,
                notifyAtFirstThreshold: (health >= FIRST_THRESHOLD_WITH_BUFFER),
                notifyAtSecondThreshold: (health >= SECOND_THRESHOLD_WITH_BUFFER)
            });

            await retryHTTPWithBackoff(
                async () => {
                    await this.telegram.api.sendMessage(
                        chatId, 
                        `I've started monitoring your Quartz account health! I'll send you a message if:\n
                        - Your health drops below 25%\n
                        - Your health drops below 10%\n
                        - Your loan is auto-repaid using your collateral (at 0%)\n\n
                        Your current account health is ${health}%`
                    );
                    await this.telegram.api.sendMessage(
                        chatId, 
                        "Be sure to turn on notifications in your Telegram app to receive alerts! 🔔"
                    );
                    await this.telegram.api.sendMessage(
                        chatId, 
                        "Send /stop to stop receiving messages."
                    );
                },
                3,
                1_000,
                this.logger
            );
            this.logger.info(`Started monitoring account ${address}`);

        } catch (error) {
            this.logger.error(`Error starting monitoring for account ${address}: ${error}`);
            await retryHTTPWithBackoff(
                async () => await this.telegram.api.sendMessage(
                    chatId, 
                    `Sorry, something went wrong. I've notified the team and we'll look into it ASAP.`
                ),
                3,
                1_000,
                this.logger
            );
        }
    }

    private async stopMonitoring(chatId: number) {
        try {
            const addresses: string[] = [];
            for (const [address, data] of this.monitoredAccounts.entries()) {
                if (data.chatId === chatId) addresses.push(address);
            }

            if (addresses.length === 0) {
                await retryHTTPWithBackoff(
                    async () => await this.telegram.api.sendMessage(
                        chatId,
                        "You don't have any accounts being monitored."
                    ),
                    3,
                    1_000,
                    this.logger
                );
                return;
            }

            await this.supabase.removeAccounts(addresses);
            for (const address of addresses) {
                this.monitoredAccounts.delete(address);
            }

            await retryHTTPWithBackoff(
                async () => await this.telegram.api.sendMessage(
                    chatId,
                    `I've stopped monitoring your Quartz accounts. Just send another address if you want me to start monitoring again!`
                ),
                3,
                1_000,
                this.logger
            );
            this.logger.info(`Stopped monitoring accounts: ${addresses.join(", ")}`);

        } catch (error) {
            this.logger.error(`Error stopping monitoring for chat ${chatId}: ${error}`);
            await retryHTTPWithBackoff(
                async () => await this.telegram.api.sendMessage(
                    chatId, 
                    `Sorry, something went wrong. I've notified the team and we'll look into it ASAP.`
                ),
                3,
                1_000,
                this.logger
            );
        }
    }

    public async start() {
        const quartzClient = await this.quartzClientPromise;
        await this.loadedAccountsPromise;
        await this.setupAutoRepayListener();
        this.logger.info(`Health Monitor Bot initialized with ${this.monitoredAccounts.size} accounts`);

        setInterval(() => {
            this.logger.info(`[${new Date().toISOString()}] Heartbeat | Monitored accounts: ${this.monitoredAccounts.size}`);
        }, 1000 * 60 * 60 * 24); // Every 24 hours

        while (true) {
            const entries = [...this.monitoredAccounts]
            const owners = entries.map(entry => new PublicKey(entry[0]));

            let users: (QuartzUser | null)[];
            try {
                users = await retryRPCWithBackoff(
                    async () => quartzClient.getMultipleQuartzAccounts(owners),
                    3,
                    1_000,
                    this.logger
                );
            } catch (error) {
                this.logger.error(`Error fetching users: ${error}`);
                continue;
            }

            for (let i = 0; i < entries.length; i++) { 
                const entry = entries[i];
                if (!entry) continue;

                const user = users[i];
                const [address, accountData] = entry;
                const displayAddress = getAddressDisplay(address);

                if (!user) {
                    this.logger.warn(`User not found for account ${address}`);
                    continue;
                }

                let currentHealth: number;
                let notifyAtFirstThreshold = accountData.notifyAtFirstThreshold;
                let notifyAtSecondThreshold = accountData.notifyAtSecondThreshold;

                try {
                    currentHealth = user.getHealth();
                    if (currentHealth === accountData.lastHealth) continue;

                    if (notifyAtSecondThreshold && accountData.lastHealth > SECOND_THRESHOLD && currentHealth <= SECOND_THRESHOLD) {
                        notifyAtSecondThreshold = false;
                        await retryHTTPWithBackoff(
                            async () => this.telegram.api.sendMessage(
                                accountData.chatId,
                                `🚨 Your account health (${displayAddress}) has dropped to ${currentHealth}%. If you don't add more collateral, your loans will be auto-repaid at market rate!`
                            ),
                            3,
                            1_000,
                            this.logger
                        );
                        this.logger.info(`Sending health warning to ${address} (was ${accountData.lastHealth}%, now ${currentHealth}%)`);
                    } else if (notifyAtFirstThreshold && accountData.lastHealth > FIRST_THRESHOLD && currentHealth <= FIRST_THRESHOLD) {
                        notifyAtFirstThreshold = false;
                        await retryHTTPWithBackoff(
                            async () => this.telegram.api.sendMessage(
                                accountData.chatId,
                                `Your account health (${displayAddress}) has dropped to ${currentHealth}%. Please add more collateral to your account to avoid your loans being auto-repaid.`
                            ),
                            3,
                            1_000,
                            this.logger
                        );
                        this.logger.info(`Sending health warning to ${address} (was ${accountData.lastHealth}%, now ${currentHealth}%)`);
                    }
                } catch (error) {
                    this.logger.error(`Error sending notification for ${address}: ${error}`);
                    continue;
                }

                if (currentHealth >= FIRST_THRESHOLD_WITH_BUFFER) notifyAtFirstThreshold = true;
                if (currentHealth >= SECOND_THRESHOLD_WITH_BUFFER) notifyAtSecondThreshold = true;

                try {
                    this.monitoredAccounts.set(address, {
                        address: address,
                        chatId: accountData.chatId,
                        lastHealth: currentHealth,
                        notifyAtFirstThreshold: notifyAtFirstThreshold,
                        notifyAtSecondThreshold: notifyAtSecondThreshold
                    });
                    this.supabase.updateAccount(address, currentHealth, notifyAtFirstThreshold, notifyAtSecondThreshold);
                } catch (error) {
                    this.logger.error(`Error updating account ${address} in database: ${error}`);
                }
            }

            await new Promise(resolve => setTimeout(resolve, LOOP_DELAY));
        }
    }

    private async setupAutoRepayListener() {
        const quartzClient = await this.quartzClientPromise;

        const INSRTUCTION_NAME = "AutoRepayStart";
        const ACCOUNT_INDEX_OWNER = 5;
        const ACCOUNT_INDEX_CALLER = 0;

        quartzClient.listenForInstruction(
            INSRTUCTION_NAME,
            async (instruction: MessageCompiledInstruction, accountKeys: PublicKey[]) => {
                const callerIndex = instruction.accountKeyIndexes?.[ACCOUNT_INDEX_CALLER];
                if (!callerIndex || !accountKeys[callerIndex]) return;
                const caller = accountKeys[callerIndex].toString();

                const ownerIndex = instruction.accountKeyIndexes?.[ACCOUNT_INDEX_OWNER];
                if (!ownerIndex || !accountKeys[ownerIndex]) return;
                const owner = accountKeys[ownerIndex].toString();

                const monitoredAccount = this.monitoredAccounts.get(owner);

                if (monitoredAccount) {
                    if (caller === owner) {
                        this.logger.info(`Detected manual repay for account ${owner}`);
                        return;
                    }

                    await this.telegram.api.sendMessage(
                        monitoredAccount.chatId,
                        `💰 Your loans for account ${getAddressDisplay(owner)} have automatically been repaid by selling your collateral at market rate.`
                    );
                    this.logger.info(`Sending auto-repay notification for account ${owner}`);
                } else if (caller !== owner) {
                    this.logger.info(`Detected auto-repay for unmonitored account ${owner}`);
                }
            }
        )
    }
}
