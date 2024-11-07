import { DriftClientManager } from '../api/driftClientManager.js';
import { bot } from '../api/telegram.js';
export class AccountMonitoringService {
    private monitoredAccounts: Map<string, {
        interval: NodeJS.Timeout;
        lastHealth: number;
        chatId: number;
    }>;
    private driftClientManager: DriftClientManager;

    constructor(driftClientManager: DriftClientManager) {
        this.monitoredAccounts = new Map();
        this.driftClientManager = driftClientManager;
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
            
            // Create interval to check health periodically
            const interval = setInterval(async () => {
                try {
                    await this._checkHealth(address);
                } catch (error: any) {
                    console.error(`Error checking health for address ${address}: ${error.message}`);
                }
            }, intervalMs);

            // Store monitoring info
            this.monitoredAccounts.set(address, {
                interval,
                lastHealth: initialHealth,
                chatId: chatId
            });

            console.log(`Started monitoring address ${address} with interval ${intervalMs}ms`);
            await bot.api.sendMessage(chatId, `Monitoring started! Be sure to turn on notifications in your Telegram app to receive alerts! 🔔`);
            //this.events.emit('monitoring:started', { address, telegramUsername });
        } catch (error: any) {
            throw new Error(`Failed to start monitoring address ${address}: ${error.message}`);
        }
    }

    async stopMonitoring(address: string): Promise<void> {
        const monitoring = this.monitoredAccounts.get(address);
        if (!monitoring) {
            throw new Error(`Address ${address} is not being monitored`);
        }

        // Clear the interval
        clearInterval(monitoring.interval);
        
        // Remove from monitored accounts
        await bot.api.sendMessage(monitoring.chatId, `Stopped monitoring your Quartz account health!`);
        this.monitoredAccounts.delete(address);    }

    getMonitoredAccounts(): string[] {
        return Array.from(this.monitoredAccounts.keys());
    }

    getWalletAddressByChatId(chatId: number): string | undefined {
        for (const [walletAddress, data] of this.monitoredAccounts.entries()) {
            if (data.chatId === chatId) {
                return walletAddress;
            }
        }
        return undefined;
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

            // Update stored health
            this.monitoredAccounts.set(address, {
                ...monitoring,
                lastHealth: currentHealth
            });
        } catch (error: any) {
            throw new Error(`Failed to check health for address ${address}: ${error.message}`);
        }
    }
} 