import { Express, Request, Response } from "express";
import { monitoringService } from "./index.js";
import { PublicKey } from "@drift-labs/sdk";
import { getVault } from "./utils/helpers.js";

// Initialize cache with a default TTL of 60 seconds
export function setupRoutes(app: Express) {
	// Health check route
	app.get("/health", (req: Request, res: Response) => {
		res.status(200).json({ status: "OK" });
	});

	// POST /monitor-account
	//@ts-ignore
	app.post("/monitor-account", async (req: Request, res: Response) => {
		const { address, chatId, intervalMs } = req.body;

		if (!address) {
			return res.status(400).json({ error: "Address is required" });
		}

		if (!chatId) {
			return res.status(400).json({ error: "Chat ID is required" });
		}

		const vault = getVault(new PublicKey(address));
		try {
			await monitoringService.startMonitoring(vault.toBase58(), chatId, intervalMs);
			res.status(200).json({
				status: "success",
				message: `Started monitoring address ${address}`,
				intervalMs: intervalMs || 60000, // Default interval if not specified
			});
		} catch (error: any) {
			console.error("Error starting monitoring:", error);
			res.status(500).json({
				error: "Failed to start monitoring",
				message: error.message,
			});
		}
	});

	// DELETE /monitor-account
	//@ts-ignore
	app.delete("/monitor-account", (req: Request, res: Response) => {
		const { address } = req.body;

		if (!address) {
			return res.status(400).json({ error: "Address is required" });
		}

		try {
			monitoringService.stopMonitoring(address);
			res.status(200).json({
				status: "success",
				message: `Stopped monitoring address ${address}`,
			});
		} catch (error: any) {
			console.error("Error stopping monitoring:", error);
			res.status(500).json({
				error: "Failed to stop monitoring",
				message: error.message,
			});
		}
	});

	// GET /monitored-accounts
	app.get("/monitored-accounts", async (req: Request, res: Response) => {
		try {
			const accounts = await monitoringService.getMonitoredAccounts();
			res.status(200).json({ accounts });
		} catch (error: any) {
			console.error("Error fetching monitored accounts:", error);
			res.status(500).json({
				error: "Failed to retrieve monitored accounts",
				message: error.message,
			});
		}
	});
}
