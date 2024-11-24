import express, { json } from "express";
import NodeCache from "node-cache";
import { DriftClientManager } from "./api/driftClientManager.js";
import { bot } from "./api/telegram.js";
import appConfig from "./config/config.js";
import { setupRoutes } from "./routes.js";
import { AccountMonitoringService } from "./services/AccountMonitoringService.js";

const app = express();
const port = appConfig.port;

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
