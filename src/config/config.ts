import { config } from "dotenv";
import * as z from "zod";

config({
	path: process.env.NODE_ENV === "development" ? ".dev.env" : ".env",
});

const envsSchema = z.object({
	NODE_ENV: z.enum(["production", "development", "test"]),
	LOG_LEVEL: z.string().default("INFO"),
	RPC_URL: z.string({
		required_error: "Rpc url required",
	}),
	TG_API_KEY: z.string({
		required_error: "	TG api key required",
	}),
	PORT: z.string().default("3000"),
	SUPABASE_URL: z.string({ required_error: "Database url required for supabase DB" }).default("vault"),
	SUPABASE_KEY: z.string({ required_error: "Auth key required for supabase DB" }).nonempty(),
	FUNDS_PUBLIC_KEY: z.string({ required_error: "funds program public key is required" }).nonempty(),
});

const envVars = {
	NODE_ENV: process.env.NODE_ENV,
	PORT: process.env.PORT,
	LOG_LEVEL: process.env.LOG_LEVEL,
	RPC_URL: process.env.RPC_URL,
	TG_API_KEY: process.env.TG_API_KEY,
	SUPABASE_URL: process.env.SUPABASE_URL,
	SUPABASE_KEY: process.env.SUPABASE_KEY,
	FUNDS_PUBLIC_KEY: process.env.FUNDS_PUBLIC_KEY,
};

try {
	const validatedEnvs = envsSchema.parse(envVars);
	console.log(validatedEnvs);
} catch (error) {
	console.error("Error validating environment variables:", error);
}

type EnvConfig = {
	env: string;
	port: string;
	logLevel: string;
	rpcUrl: string;
	tgApiKey: string;
	supaBaseUrl: string;
	supaBaseKey: string;
	fundsPublicKey: string;
};

const appConfig: EnvConfig = {
	env: envVars.NODE_ENV,
	logLevel: envVars.LOG_LEVEL,
	port: envVars.PORT,
	rpcUrl: envVars.RPC_URL,
	tgApiKey: envVars.TG_API_KEY,
	supaBaseUrl: envVars.SUPABASE_URL,
	supaBaseKey: envVars.SUPABASE_KEY,
	fundsPublicKey: envVars.FUNDS_PUBLIC_KEY,
};

export default appConfig;
