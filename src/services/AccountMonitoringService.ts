import { DriftClientManager } from '../api/driftClientManager.js';
import { bot } from '../api/telegram.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY } from '../utils/config.js';
import { SUPABASE_URL } from '../utils/config.js';
import { Database } from '../utils/database.types.js';

export class AccountMonitoringService {
    private monitoredAccounts: Map<string, {
        vaultAddress: string;
        interval: NodeJS.Timeout;
        lastHealth: number;
        chatId: number;
    }>;
    private driftClientManager: DriftClientManager;
    private supabase: SupabaseClient<Database>;

    constructor(driftClientManager: DriftClientManager) {
        this.monitoredAccounts = new Map();
        this.driftClientManager = driftClientManager;
        this.supabase = createClient(
            SUPABASE_URL,
            SUPABASE_KEY
        );
        this.loadStoredAccounts();
    }

    private async loadStoredAccounts(): Promise<void> {
        try {
            await this.driftClientManager.waitForInitialization();

            const { data: accounts, error } = await this.supabase
                .from('monitored_accounts')
                .select('*');

            if (error) throw error;

            // Restart monitoring for each stored account
            for (const account of accounts) {
                await this.startMonitoring(account.address, account.vault_address, account.chat_id);
            }
        } catch (error) {
            console.error('Failed to load stored accounts:', error);
        }
    }

    async startMonitoring(
        address: string,
        vaultAddress: string,
        chatId: number,
        intervalMs: number = 60000
    ): Promise<void> {
        if (this.monitoredAccounts.has(address)) {
            throw new Error(`Address ${address} is already being monitored`);
        }

        try {
            // Get initial health
            const initialHealth = await this.driftClientManager.getUserHealth(vaultAddress);
            if (initialHealth instanceof Error || typeof initialHealth !== 'number') {
                await bot.api.sendMessage(chatId, `This public key is not a valid Quartz account! Please send a valid Quartz account address to monitor.`);
                return;
            };

            console.log(`Initial health for user address ${address}, vault address: ${vaultAddress}: ${initialHealth}`);

            const result = await this.updateMonitoredAccount(address, vaultAddress, chatId, initialHealth);
            if (result != 'new' && result != 'existing') throw result;

            // Create interval to check health periodically
            const interval = setInterval(async () => {
                try {
                    await this._checkHealth(address, vaultAddress);
                } catch (error: any) {
                    console.error(`Error checking health for address ${address}: ${error.message}`);
                }
            }, intervalMs);

            // Store monitoring info in memory
            this.monitoredAccounts.set(address, {
                interval,
                lastHealth: initialHealth,
                chatId: chatId,
                vaultAddress: vaultAddress
            });

            console.log(`Started monitoring address ${address} with interval ${intervalMs}ms`);
            if (result == 'new') {
                await bot.api.sendMessage(chatId, `Monitoring started! Be sure to turn on notifications in your Telegram app to receive alerts! 🔔`);
            }
        } catch (error: any) {
            throw new Error(`Failed to start monitoring address ${address}: ${error.message}`);
        }
    }

    async stopMonitoring(address: string): Promise<void> {
        const monitoring = this.monitoredAccounts.get(address);
        if (!monitoring) {
            throw new Error(`Address ${address} is not being monitored`);
        }

        try {
            // Remove from database
            const { error } = await this.supabase
                .from('monitored_accounts')
                .delete()
                .eq('address', address);

            if (error) throw error;

            // Clear the interval
            clearInterval(monitoring.interval);

            // Remove from monitored accounts
            await bot.api.sendMessage(monitoring.chatId, `Stopped monitoring your Quartz account health!`);
            this.monitoredAccounts.delete(address);
        } catch (error: any) {
            throw new Error(`Failed to stop monitoring address ${address}: ${error.message}`);
        }
    }

    private async _checkHealth(address: string, vaultAddress: string): Promise<void> {
        const monitoring = this.monitoredAccounts.get(address);
        if (!monitoring) {
            throw new Error(`Address ${address} is not being monitored`);
        }

        try {
            const currentHealth = await this.driftClientManager.getUserHealth(vaultAddress);

            if (monitoring.lastHealth > 25 && currentHealth <= 25) {
                console.log(`Health warning for address ${address}: ${currentHealth}%`);
                await bot.api.sendMessage(monitoring.chatId, `Your account health has dropped to ${currentHealth}%. Please add more collateral to your account to avoid liquidation!`);
            }

            if (monitoring.lastHealth > 10 && currentHealth <= 10) {
                console.log(`Health warning for address ${address}: ${currentHealth}%`);
                await bot.api.sendMessage(monitoring.chatId, `🚨 Your account health has dropped to ${currentHealth}%. Add more collateral to your account now to avoid liquidation!`);
            }

            // Update stored health in both memory and database
            this.monitoredAccounts.set(address, {
                ...monitoring,
                lastHealth: currentHealth
            });

            console.log(`Updating health for address ${address} to ${currentHealth}`);
            const { error } = await this.supabase
                .from('monitored_accounts')
                .update({ last_health: currentHealth })
                .eq('address', address);

            if (error) throw error;
        } catch (error: any) {
            throw new Error(`Failed to check health for address ${address}: ${error.message}`);
        }
    }

    async getWalletAddressByChatId(chatId: number): Promise<string | undefined> {
        const { data, error } = await this.supabase
            .from('monitored_accounts')
            .select('address')
            .eq('chat_id', chatId)
            .single();

        if (error || !data) {
            for (const [walletAddress, data] of this.monitoredAccounts.entries()) {
                if (data.chatId === chatId) {
                    return walletAddress;
                }
            }
            return undefined;
        };
        return data.address;
    }

    async getMonitoredAccounts(): Promise<string[]> {
        const { data, error } = await this.supabase
            .from('monitored_accounts')
            .select('address');

        if (error || !data) return [];
        return data.map((account: any) => account.address);
    }


    private async updateMonitoredAccount(address: string,
        vaultAddress: string,
        chatId: number,
        initialHealth: number
    ): Promise<"existing" | "new" | any> {
        const { data: existingEntry } = await this.supabase
            .from('monitored_accounts')
            .select()
            .eq('address', address)
            .single();

        try {
            if (existingEntry) {
                await this.supabase
                    .from('monitored_accounts')
                    .update({
                        vault_address: vaultAddress,
                        chat_id: chatId,
                        last_health: initialHealth
                    })
                    .eq('address', address);
                return "existing";
            }

            await this.supabase
                .from('monitored_accounts')
                .insert({
                    address: address,
                    vault_address: vaultAddress,
                    chat_id: chatId,
                    last_health: initialHealth
                });
            return "new";

        } catch (error: any) {
            return error;
        }
    }
} 