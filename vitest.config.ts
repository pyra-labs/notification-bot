// vitest.config.js
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		poolOptions: {
			forks: {
				singleFork: true,
			},
		},
		globalSetup: ["./globalSetup.ts"],
		testTimeout: 300000,
	},
});
