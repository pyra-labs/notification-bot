import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
    RPC_URLS: z.string()
        .transform((str) => {
            try {
                const urls = str.split(',').map(url => url.trim());
                if (urls.length === 0) throw new Error("No URLs found");

                const nonEmptyUrls = urls.filter(url => url.length > 0);
                if (nonEmptyUrls.length === 0) throw new Error("No URLs found after filtering empty strings");

                const invalidUrls = nonEmptyUrls.filter(url => !url.startsWith("https"));
                if (invalidUrls.length > 0) {
                    throw new Error(`Invalid URLs found: ${invalidUrls.join(',')}`);
                }
                return nonEmptyUrls;
            } catch (error) {
                throw new Error(`RPC_URLS must be comma-separated URLs starting with https - ${error}`);
            }
        }),
    TG_API_KEY: z.string(),
    SUPABASE_URL: z.string().url(),
    SUPABASE_KEY_TG: z.string(),
    EMAIL_TO: z.string()
        .transform((str) => {
            try {
                const emails = str.split(',').map(email => email.trim());
                if (!emails.every(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error();
                return emails;
            } catch {
                throw new Error("Invalid email list format: must be comma-separated email addresses");
            }
        }),
    EMAIL_FROM: z.string().email(),
    EMAIL_HOST: z.string(),
    EMAIL_PORT: z.coerce.number().min(0),
    EMAIL_USER: z.string().email(),
    EMAIL_PASSWORD: z.string(),
});

const config = envSchema.parse(process.env);
export default config;
