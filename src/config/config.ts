import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
    RPC_URL: z.string().url(),
    TG_API_KEY: z.string(),
    SUPABASE_URL: z.string().url(),
    SUPABASE_KEY: z.string(),
    EMAIL_TO: z.string()
        .transform((str) => {
            try {
                const emails = str.split(',').map(email => email.trim());
                if (!emails.every(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error();
                return emails;
            } catch (error) {
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
