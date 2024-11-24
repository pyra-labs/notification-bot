import express, { json } from "express";
import appConfig from "./src/config/config";

// globalSetup.ts
// use this to properly spaw a simulation app for use in tests
export default async () => {
	const app = express();
	const port = appConfig.port;

	app.use(json());

	app.listen(port, () => {
		console.log(`Server is running on port ${port}`);
	});
};
