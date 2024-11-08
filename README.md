<div align="center">
  <img width="2500" alt="Quartz" src="https://cdn.prod.website-files.com/65707af0f4af991289bbd432/670e37661cdb2314fe8ba469_logo-glow-banner.jpg" />

  <h1 style="margin-top:20px;">Quartz Health Monitor</h1>
</div>

This is a simple bot that monitors the health of a Quartz account and sends alerts to a Telegram chat.

Feel free to contribute or run your own instance!

## How to run your own version

1. Clone this repository

2. Open Telegram on any device, and open a chat with @BotFather
  
3. Start the service using the `START` button and select `/newbot` from the list that appears

4. Enter a name and a username, and you'll receive an API key

5. Create a .env file in the root folder and add your API key in the following format:

```
# Replace with your actual API key
TG_API_KEY=0000000000:AAAAAAAAA_AAAAAAA-aaaaaaaaaaaaaaaaa 
```

6. Create a [Supabase](https://supabase.com/) project with a Postgres database

7. In the SQL editor, add:

```SQL
-- Create the monitored_accounts table
CREATE TABLE monitored_accounts (
    address TEXT PRIMARY KEY,
    vault_address TEXT NOT NULL,
    chat_id BIGINT NOT NULL,
    last_health DECIMAL(5,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create an index on chat_id for faster lookups
CREATE INDEX idx_monitored_accounts_chat_id ON monitored_accounts(chat_id);

-- Create an update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_monitored_accounts_updated_at
    BEFORE UPDATE ON monitored_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

8. Click run

10. Go to Home, find the project URL and API key, add them into the .env file:

```
# Replace the values with your actual URL and API key
SUPABASE_URL=https://aaaaaaaaaa.supabase.co
SUPABASE_KEY=000000000000000000000000000000
```

10. (Optional) You can also add a private Solana RPC url but adding it to the .env file:
```
# Replace with your actual URL
RPC_URL=https://api.mainnet-beta.solana.com 
```

11. A full .env file might look like this:
```
TG_API_KEY=0000000000:AAAAAAAAA_AAAAAAA-aaaaaaaaaaaaaaaaa
SUPABASE_URL=https://aaaaaaaaaa.supabase.co
SUPABASE_KEY=000000000000000000000000000000
RPC_URL=https://api.mainnet-beta.solana.com 
```

12. Run the server with `npm run start`
