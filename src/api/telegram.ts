import { TG_API_KEY } from "../config.js";

export async function sendTelegramMessage(chatId: string, message: string) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${TG_API_KEY}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Telegram API error: ${JSON.stringify(errorData)}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error sending telegram message:', error);
        throw error;
    }
}