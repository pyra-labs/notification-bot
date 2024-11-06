import { Express, Request, Response } from 'express';
import { DriftClientManager, getDriftHealth, getDriftRates, getDriftWithdrawalLimit } from './api/driftClientManager.js';
import { AccountMonitoringService } from './services/AccountMonitoringService.js';

// Initialize cache with a default TTL of 60 seconds
export function setupRoutes(app: Express, driftClientManager: DriftClientManager) {
  // Create AccountMonitoringService instance
  const monitoringService = new AccountMonitoringService(driftClientManager);

  // Health check route
  app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'OK' });
  });

  // POST /monitor-account
  //@ts-ignore
  app.post('/monitor-account', async (req: Request, res: Response) => {
    const { address, telegramUsername, intervalMs } = req.body;

    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    if (!telegramUsername) {
        return res.status(400).json({ error: 'Telegram username is required' });
      }

    try {
      await monitoringService.startMonitoring(address, telegramUsername, intervalMs);
      res.status(200).json({ 
        status: 'success', 
        message: `Started monitoring address ${address}`,
        intervalMs: intervalMs || 60000 // Default interval if not specified
      });
    } catch (error: any) {
      console.error('Error starting monitoring:', error);
      res.status(500).json({ 
        error: 'Failed to start monitoring',
        message: error.message 
      });
    }
  });

  // DELETE /monitor-account
  //@ts-ignore
  app.delete('/monitor-account', (req: Request, res: Response) => {
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
    } catch (error: any) {
      console.error('Error stopping monitoring:', error);
      res.status(500).json({ 
        error: 'Failed to stop monitoring',
        message: error.message 
      });
    }
  });

  // GET /monitored-accounts
  app.get('/monitored-accounts', (req: Request, res: Response) => {
    try {
      const accounts = monitoringService.getMonitoredAccounts();
      res.status(200).json({ accounts });
    } catch (error: any) {
      console.error('Error fetching monitored accounts:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve monitored accounts',
        message: error.message 
      });
    }
  });
}