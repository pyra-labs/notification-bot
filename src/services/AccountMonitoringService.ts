import { DriftClientManager } from '../api/driftClientManager.js';
import { bot } from '../api/telegram.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../utils/database.types.js';
import { SUPABASE_KEY } from '../utils/config.js';
import { SUPABASE_URL } from '../utils/config.js';

export class AccountMonitoringService {
    private monitoredAccounts: Map<string, {
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
            const { data: accounts, error } = await this.supabase
                .from('monitored_accounts')
                .select('*');

            if (error) throw error;

            // Restart monitoring for each stored account
            for (const account of accounts) {
                await this.startMonitoring(account.address, account.chat_id);
            }
        } catch (error) {
            console.error('Failed to load stored accounts:', error);
        }
    }

    async startMonitoring(
        address: string,
        chatId: number,
        intervalMs: number = 60000
    ): Promise<void> {
        if (this.monitoredAccounts.has(address)) {
            throw new Error(`Address ${address} is already being monitored`);
        }

        try {
            // Get initial health
            const initialHealth = await this.driftClientManager.getUserHealth(address);
            
            // Store in database first
            const { error } = await this.supabase
                .from('monitored_accounts')
                .insert({
                    address: address,
                    chat_id: chatId,
                    last_health: initialHealth
                });

            if (error) throw error;

            // Create interval to check health periodically
            const interval = setInterval(async () => {
                try {
                    await this._checkHealth(address);
                } catch (error: any) {
                    console.error(`Error checking health for address ${address}: ${error.message}`);
                }
            }, intervalMs);

            // Store monitoring info in memory
            this.monitoredAccounts.set(address, {
                interval,
                lastHealth: initialHealth,
                chatId: chatId
            });

            console.log(`Started monitoring address ${address} with interval ${intervalMs}ms`);
            await bot.api.sendMessage(chatId, `Monitoring started! Be sure to turn on notifications in your Telegram app to receive alerts! 🔔`);
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

    private async _checkHealth(address: string): Promise<void> {
        const monitoring = this.monitoredAccounts.get(address);
        if (!monitoring) {
            throw new Error(`Address ${address} is not being monitored`);
        }

        try {
            const currentHealth = await this.driftClientManager.getUserHealth(address);
            
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
        return data.map(account => account.address);
    }
} 