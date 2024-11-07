var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { bot } from '../api/telegram.js';
export class AccountMonitoringService {
    constructor(driftClientManager) {
        this.monitoredAccounts = new Map();
        this.driftClientManager = driftClientManager;
    }
    startMonitoring(address_1, chatId_1) {
        return __awaiter(this, arguments, void 0, function* (address, chatId, intervalMs = 60000) {
            if (this.monitoredAccounts.has(address)) {
                throw new Error(`Address ${address} is already being monitored`);
            }
            try {
                // Get initial health
                const initialHealth = yield this.driftClientManager.getUserHealth(address);
                // Create interval to check health periodically
                const interval = setInterval(() => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield this._checkHealth(address);
                    }
                    catch (error) {
                        console.error(`Error checking health for address ${address}: ${error.message}`);
                    }
                }), intervalMs);
                // Store monitoring info
                this.monitoredAccounts.set(address, {
                    interval,
                    lastHealth: initialHealth,
                    chatId: chatId
                });
                console.log(`Started monitoring address ${address} with interval ${intervalMs}ms`);
                yield bot.api.sendMessage(chatId, `Monitoring started! Be sure to turn on notifications in your Telegram app to receive alerts! 🔔`);
                //this.events.emit('monitoring:started', { address, telegramUsername });
            }
            catch (error) {
                throw new Error(`Failed to start monitoring address ${address}: ${error.message}`);
            }
        });
    }
    stopMonitoring(address) {
        return __awaiter(this, void 0, void 0, function* () {
            const monitoring = this.monitoredAccounts.get(address);
            if (!monitoring) {
                throw new Error(`Address ${address} is not being monitored`);
            }
            // Clear the interval
            clearInterval(monitoring.interval);
            // Remove from monitored accounts
            yield bot.api.sendMessage(monitoring.chatId, `Stopped monitoring your Quartz account health!`);
            this.monitoredAccounts.delete(address);
        });
    }
    getMonitoredAccounts() {
        return Array.from(this.monitoredAccounts.keys());
    }
    getWalletAddressByChatId(chatId) {
        for (const [walletAddress, data] of this.monitoredAccounts.entries()) {
            if (data.chatId === chatId) {
                return walletAddress;
            }
        }
        return undefined;
    }
    _checkHealth(address) {
        return __awaiter(this, void 0, void 0, function* () {
            const monitoring = this.monitoredAccounts.get(address);
            if (!monitoring) {
                throw new Error(`Address ${address} is not being monitored`);
            }
            try {
                const currentHealth = yield this.driftClientManager.getUserHealth(address);
                if (monitoring.lastHealth > 25 && currentHealth <= 25) {
                    console.log(`Health warning for address ${address}: ${currentHealth}%`);
                    yield bot.api.sendMessage(monitoring.chatId, `Your account health has dropped to ${currentHealth}%. Please add more collateral to your account to avoid liquidation!`);
                }
                if (monitoring.lastHealth > 10 && currentHealth <= 10) {
                    console.log(`Health warning for address ${address}: ${currentHealth}%`);
                    yield bot.api.sendMessage(monitoring.chatId, `🚨 Your account health has dropped to ${currentHealth}%. Add more collateral to your account now to avoid liquidation!`);
                }
                // Update stored health
                this.monitoredAccounts.set(address, Object.assign(Object.assign({}, monitoring), { lastHealth: currentHealth }));
            }
            catch (error) {
                throw new Error(`Failed to check health for address ${address}: ${error.message}`);
            }
        });
    }
}
