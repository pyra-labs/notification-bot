import { DriftClientManager, getDriftHealth } from '../api/driftClientManager.js';
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
            const initialHealth = await getDriftHealth(address, this.driftClientManager);
            
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
            await bot.api.sendMessage(chatId, `Started monitoring address ${address} for health changes`);
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
        await bot.api.sendMessage(monitoring.chatId, `Stopped monitoring address ${address}`);
        this.monitoredAccounts.delete(address);    }

    getMonitoredAccounts(): string[] {
        return Array.from(this.monitoredAccounts.keys());
    }

    private async _checkHealth(address: string): Promise<void> {
        const monitoring = this.monitoredAccounts.get(address);
        if (!monitoring) {
            throw new Error(`Address ${address} is not being monitored`);
        }

        try {
            const currentHealth = await getDriftHealth(address, this.driftClientManager);
            const healthChange = currentHealth - monitoring.lastHealth;

            console.log(`Health changed for address ${address}: ${healthChange}`);
            
            // Emit events based on health changes
            if (Math.abs(healthChange) >= 10) { // 10% change threshold
                console.log(`Health changed for address ${address}: ${healthChange}`);
                await bot.api.sendMessage(monitoring.chatId, `Your account health changed by ${healthChange > 0 ? '+' : ''}${healthChange}% ${healthChange > 0 ? '💫' : '😬'}`);

                if (currentHealth < 50) { // Critical health threshold
                    console.log(`Health critical for address ${address}: ${currentHealth}`);
                    await bot.api.sendMessage(monitoring.chatId, `Your account health is critical: ${currentHealth}% Please add more collateral to your account to avoid liquidation!`);
                }
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