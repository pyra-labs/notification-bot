var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { monitoringService } from './index.js';
import { PublicKey } from '@drift-labs/sdk';
import { getVault } from './utils/helpers.js';
// Initialize cache with a default TTL of 60 seconds
export function setupRoutes(app) {
    // Health check route
    app.get('/health', (req, res) => {
        res.status(200).json({ status: 'OK' });
    });
    // POST /monitor-account
    //@ts-ignore
    app.post('/monitor-account', (req, res) => __awaiter(this, void 0, void 0, function* () {
        const { address, chatId, intervalMs } = req.body;
        if (!address) {
            return res.status(400).json({ error: 'Address is required' });
        }
        if (!chatId) {
            return res.status(400).json({ error: 'Chat ID is required' });
        }
        const vault = getVault(new PublicKey(address));
        try {
            yield monitoringService.startMonitoring(vault.toBase58(), chatId, intervalMs);
            res.status(200).json({
                status: 'success',
                message: `Started monitoring address ${address}`,
                intervalMs: intervalMs || 60000 // Default interval if not specified
            });
        }
        catch (error) {
            console.error('Error starting monitoring:', error);
            res.status(500).json({
                error: 'Failed to start monitoring',
                message: error.message
            });
        }
    }));
    // DELETE /monitor-account
    //@ts-ignore
    app.delete('/monitor-account', (req, res) => {
        const { address } = req.body;
        if (!address) {
            return res.status(400).json({ error: 'Address is required' });
        }
        try {
            monitoringService.stopMonitoring(address);
            res.status(200).json({
                status: 'success',
                message: `Stopped monitoring address ${address}`
            });
        }
        catch (error) {
            console.error('Error stopping monitoring:', error);
            res.status(500).json({
                error: 'Failed to stop monitoring',
                message: error.message
            });
        }
    });
    // GET /monitored-accounts
    app.get('/monitored-accounts', (req, res) => {
        try {
            const accounts = monitoringService.getMonitoredAccounts();
            res.status(200).json({ accounts });
        }
        catch (error) {
            console.error('Error fetching monitored accounts:', error);
            res.status(500).json({
                error: 'Failed to retrieve monitored accounts',
                message: error.message
            });
        }
    });
}
