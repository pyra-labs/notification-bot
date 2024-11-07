import express from 'express';
import { json } from 'express';
import { DriftClientManager } from './api/driftClientManager.js';
import { setupRoutes } from './routes.js';
import NodeCache from 'node-cache';
import { bot } from './api/telegram.js';
import { AccountMonitoringService } from './services/AccountMonitoringService.js';
import { PORT } from './utils/config.js';
const app = express();
const port = PORT;
// Configure middleware
app.use(json());
export const cache = new NodeCache({ stdTTL: 60 });
const driftClientManager = new DriftClientManager();
export const monitoringService = new AccountMonitoringService(driftClientManager);
bot.start();
setupRoutes(app);
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
