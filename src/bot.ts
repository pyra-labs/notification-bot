import config from "./config/config.js";
import { AppLogger } from "./utils/logger.js";
import express from "express";
import cors from "cors";
import hpp from "hpp";
import helmet from "helmet";
import { DriftClient, Wallet } from "@drift-labs/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Telegram } from "./clients/telegramClient.js";
import { getAddressDisplay, getQuartzHealth, getUser, getVault } from "./utils/helpers.js";
import { DriftUser } from "./model/driftUser.js";
import { retryRPCWithBackoff } from "./utils/helpers.js";
import { Supabase } from "./clients/supabaseClient.js";
import { LOOP_DELAY, FIRST_THRESHOLD_WITH_BUFFER, SECOND_THRESHOLD_WITH_BUFFER, FIRST_THRESHOLD, SECOND_THRESHOLD, QUARTZ_PROGRAM_ID } from "./config/constants.js";
import { MonitoredAccount } from "./interfaces/monitoredAccount.interface.js";
import { BorshInstructionCoder, Idl, Instruction } from "@coral-xyz/anchor";
import idl from "./idl/quartz.json";

export class HealthMonitorBot extends AppLogger {
    private connection: Connection;
    private driftClient: DriftClient; 
    private driftInitPromise: Promise<boolean>;

    private telegram: Telegram;
    private supabase: Supabase;
    private monitoredAccounts: Map<string, MonitoredAccount>;
    private loadedAccountsPromise: Promise<void>;

    constructor() {
        super("Health Monitor Bot");

        this.connection = new Connection(config.RPC_URL);
        const wallet = new Wallet(Keypair.generate());
        this.driftClient = new DriftClient({
            connection: this.connection,
            wallet: wallet,
            env: 'mainnet-beta',
        });
        this.driftInitPromise = this.driftClient.subscribe();

        this.telegram = new Telegram(
            this.startMonitoring.bind(this),
            this.stopMonitoring.bind(this)
        );
        this.supabase = new Supabase();
        this.monitoredAccounts = new Map();
        this.loadedAccountsPromise = this.loadStoredAccounts();
    }

    private async loadStoredAccounts(): Promise<void> {
        await this.driftInitPromise;

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
        try {
            let driftUser: DriftUser;
            try {
                driftUser = await getUser(address, this.connection, this.driftClient);
            } catch (error) {
                await this.telegram.api.sendMessage(
                    chatId, 
                    "I couldn't find a Quartz account with this wallet address. Please send the address of a wallet that's been used to create a Quartz account."
                );
                return;
            }

            const driftHealth = driftUser.getHealth();
            const quartzHealth = getQuartzHealth(driftHealth);

            if (this.monitoredAccounts.has(address)) {
                await this.telegram.api.sendMessage(
                    chatId, 
                    `That account is already being monitored, it's current health is ${quartzHealth}%`
                );
                return;
            }

            await this.supabase.addAccount(address, chatId, quartzHealth);
            this.monitoredAccounts.set(address, {
                address: address,
                chatId: chatId,
                lastHealth: quartzHealth,
                notifyAtFirstThreshold: (quartzHealth >= FIRST_THRESHOLD_WITH_BUFFER),
                notifyAtSecondThreshold: (quartzHealth >= SECOND_THRESHOLD_WITH_BUFFER)
            });

            await this.telegram.api.sendMessage(
                chatId, 
                `I've started monitoring your Quartz account health! I'll send you a message if:\n` +
                `- Your health drops below 25%\n` +
                `- Your health drops below 10%\n` +
                `- Your loan is auto-repaid using your collateral (at 0%)\n\n` +
                `Your current account health is ${quartzHealth}%`
            );
            await this.telegram.api.sendMessage(
                chatId, 
                `Be sure to turn on notifications in your Telegram app to receive alerts! 🔔`
            );
            await this.telegram.api.sendMessage(
                chatId, 
                `Send /stop to stop receiving messages.`
            );
            this.logger.info(`Started monitoring account ${address}`);
        } catch (error) {
            this.logger.error(`Error starting monitoring for account ${address}: ${error}`);
            await this.telegram.api.sendMessage(
                chatId, 
                `Sorry, something went wrong. I've notified the team and we'll look into it ASAP.`
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
                await this.telegram.api.sendMessage(
                    chatId,
                    "You don't have any accounts being monitored."
                );
                return;
            }

            await this.supabase.removeAccounts(addresses);
            for (const address of addresses) {
                this.monitoredAccounts.delete(address);
            }

            await this.telegram.api.sendMessage(
                chatId,
                `I've stopped monitoring your Quartz accounts. Just send another address if you want me to start monitoring again!`
            );
            this.logger.info(`Stopped monitoring accounts: ${addresses.join(", ")}`);
        } catch (error) {
            this.logger.error(`Error stopping monitoring for chat ${chatId}: ${error}`);
            await this.telegram.api.sendMessage(
                chatId, 
                `Sorry, something went wrong. I've notified the team and we'll look into it ASAP.`
            );
        }
    }

    public async start() {
        await this.loadedAccountsPromise;
        await this.setupAutoRepayListener();
        this.logger.info(`Health Monitor Bot initialized`);

        while (true) {
            const now = new Date();
            this.logger.info(`[${now.toISOString()}] Checking ${this.monitoredAccounts.size} accounts...`);

            for (const [address, account] of this.monitoredAccounts.entries()) {
                const displayAddress = getAddressDisplay(address);
                const vaultAddress = getVault(new PublicKey(address));
                try {
                    const driftUser = new DriftUser(vaultAddress, this.connection, this.driftClient!);
                    await retryRPCWithBackoff(
                        async () => driftUser.initialize(),
                        3,
                        1_000,
                        this.logger
                    );

                    const driftHealth = driftUser.getHealth();
                    const currentHealth = getQuartzHealth(driftHealth);
                    if (currentHealth === account.lastHealth) continue;

                    let notifyAtFirstThreshold = account.notifyAtFirstThreshold;
                    let notifyAtSecondThreshold = account.notifyAtSecondThreshold;

                    if (notifyAtFirstThreshold && account.lastHealth > FIRST_THRESHOLD && currentHealth <= FIRST_THRESHOLD) {
                        notifyAtFirstThreshold = false;
                        await this.telegram.api.sendMessage(
                            account.chatId,
                            `Your account health (${displayAddress}) has dropped to ${currentHealth}%. Please add more collateral to your account to avoid your loans being auto-repaid.`
                        );
                        this.logger.info(`Sending health warning to ${address} (was ${account.lastHealth}%, now ${currentHealth}%)`);
                    } else if (notifyAtSecondThreshold && account.lastHealth > SECOND_THRESHOLD && currentHealth <= SECOND_THRESHOLD) {
                        notifyAtSecondThreshold = false;
                        await this.telegram.api.sendMessage(
                            account.chatId,
                            `🚨 Your account health (${displayAddress}) has dropped to ${currentHealth}%. If you don't add more collateral, your loans will be auto-repaid at market rate!`
                        );
                        this.logger.info(`Sending health warning to ${address} (was ${account.lastHealth}%, now ${currentHealth}%)`);
                    }

                    if (currentHealth >= FIRST_THRESHOLD_WITH_BUFFER) notifyAtFirstThreshold = true;
                    if (currentHealth >= SECOND_THRESHOLD_WITH_BUFFER) notifyAtSecondThreshold = true;

                    this.monitoredAccounts.set(address, {
                        address: address,
                        chatId: account.chatId,
                        lastHealth: currentHealth,
                        notifyAtFirstThreshold: notifyAtFirstThreshold,
                        notifyAtSecondThreshold: notifyAtSecondThreshold
                    });
                    this.supabase.updateAccount(address, currentHealth, notifyAtFirstThreshold, notifyAtSecondThreshold);
                } catch (error) {
                    this.logger.error(`Error finding Drift User for ${address}: ${error}`);
                }
            }

            await new Promise(resolve => setTimeout(resolve, LOOP_DELAY));
        }
    }

    private async setupAutoRepayListener() {
        const INSRTUCTION_NAME = "AutoRepayStart";
        const ACCOUNT_INDEX = 5;

        this.connection.onLogs(
            QUARTZ_PROGRAM_ID,
            async (logs) => {
                if (!logs.logs.some(log => log.includes(INSRTUCTION_NAME))) return;

                try {
                    const tx = await this.connection.getTransaction(logs.signature, {
                        maxSupportedTransactionVersion: 0,
                        commitment: 'confirmed'
                    });
                    if (!tx) throw new Error(`Transaction not found`);

                    const encodedIxs = tx.transaction.message.compiledInstructions;
                    const accountKeys = tx.transaction.message.staticAccountKeys;

                    const coder = new BorshInstructionCoder(idl as Idl);
                    for (const ix of encodedIxs) {
                        try {
                            const quartzIx = coder.decode(Buffer.from(ix.data), "base58");
                            if (quartzIx?.name.toLowerCase() === INSRTUCTION_NAME.toLowerCase()) {
                                const index = ix.accountKeyIndexes[ACCOUNT_INDEX];
                                const accountKey = accountKeys[index].toString();

                                const monitoredAccount = this.monitoredAccounts.get(accountKey);

                                if (monitoredAccount) {
                                    await this.telegram.api.sendMessage(
                                        monitoredAccount.chatId,
                                        `💰 Your loans for account ${getAddressDisplay(accountKey)} have automatically been repaid by selling your collateral at market rate.`
                                    );
                                    this.logger.info(`Sending auto-repay notification for account ${accountKey}`);
                                }

                                return;
                            }
                        } catch (e) { continue; }
                    }
                    
                    throw new Error(`Could not decode instruction`);
                } catch (error) {
                    this.logger.error(`Error processing ${INSRTUCTION_NAME} instruction for ${logs.signature}: ${error}`);
                }
            }
        );
    }
}
