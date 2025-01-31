import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types.js";
import config from "../config/config.js";
import { PublicKey } from "@solana/web3.js";
import { retryWithBackoff } from "@quartz-labs/sdk";
import type { MonitoredAccount } from "../types/interfaces/monitoredAccount.interface.js";
import type { Threshold } from "../types/interfaces/threshold.interface.js";

export class Supabase {
    public supabase: SupabaseClient<Database>;

    constructor() {
        this.supabase = createClient<Database>(
            config.SUPABASE_URL,
            config.SUPABASE_KEY
        );
    }

    public async getAllAccounts(): Promise<MonitoredAccount[]> {
        return await retryWithBackoff(
            async () => {
                const { data: accounts, error } = await this.supabase
                    .from('accounts')
                    .select(`
                        address,
                        last_health,
                        subscribers (
                            chat_id,
                            thresholds (
                                percentage,
                                notify
                            )
                        )
                    `);

                if (error) throw error;
                
                return accounts.map(account => ({
                    address: new PublicKey(account.address),
                    lastHealth: account.last_health,
                    subscribers: account.subscribers.map(sub => ({
                        chatId: sub.chat_id,
                        thresholds: sub.thresholds.map(threshold => threshold as Threshold)
                    }))
                }));
            }
        );
    }

    public async getMonitoredAccount(
        address: PublicKey
    ): Promise<MonitoredAccount> {
        return await retryWithBackoff(
            async () => {
                const { data: account, error } = await this.supabase
                    .from('accounts')
                    .select(`
                        address,
                        last_health,
                        subscribers (
                            chat_id,
                            thresholds (
                                percentage,
                                notify
                            )
                        )
                    `)
                    .eq('address', address.toBase58())
                    .single();

                if (error) throw error;

                return {
                    address: new PublicKey(account.address),
                    lastHealth: account.last_health,
                    subscribers: account.subscribers.map(sub => ({
                        chatId: sub.chat_id,
                        thresholds: sub.thresholds.map(threshold => threshold as Threshold)
                    }))
                };
            }
        );
    }

    public async getSubscriptions(
        chatId: number
    ): Promise<MonitoredAccount[]> {
        return await retryWithBackoff(
            async () => {
                const { data: accounts, error } = await this.supabase
                    .from('accounts')
                    .select(`
                        address,
                        last_health,
                        subscribers!inner (
                            chat_id,
                            thresholds (
                                percentage,
                                notify
                            )
                        )
                    `)
                    .eq('subscribers.chat_id', chatId);
                if (error) throw error;
                
                return accounts.map(account => ({
                    address: new PublicKey(account.address),
                    lastHealth: account.last_health,
                    subscribers: account.subscribers.map(sub => ({
                        chatId: sub.chat_id,
                        thresholds: sub.thresholds.map(threshold => threshold as Threshold)
                    }))
                }));
            }
        );
    }

    public async getThresholds(
        address: PublicKey, 
        chatId: number
    ): Promise<Threshold[]> {
        return await retryWithBackoff(
            async () => {
                const { data, error } = await this.supabase
                    .from('subscribers')
                    .select(`
                        thresholds (
                            percentage, 
                            notify
                        )
                    `)
                    .eq('address', address.toBase58())
                    .eq('chat_id', chatId)
                    .single();
                
                if (error) throw error;
                return data.thresholds;
            }
        );
    }

    public async subscribeToWallet(
        address: PublicKey, 
        chatId: number, 
        threshold: number, 
        health: number
    ) {
        if (threshold < 0 || threshold > 100) throw new Error("Threshold must be between 0 and 100");

        await retryWithBackoff(
            async () => {
                const { error } = await this.supabase.rpc('subscribe_to_wallet', {
                    p_address: address.toBase58(),
                    p_chat_id: chatId,
                    p_threshold: threshold,
                    p_last_health: health
                });    
                if (error) throw new Error(error.message);
            }
        )
    }

    public async removeThreshold(thresholdId: number) {
        await retryWithBackoff(
            async () => {
                const { error } = await this.supabase.rpc('remove_threshold', {
                    p_threshold_id: thresholdId
                });
                if (error) throw new Error(error.message);
            }
        )
    }

    public async updateThreshold(
        thresholdId: number, 
        percentage: number, 
        notify: boolean
    ) {
        if (percentage < 0 || percentage > 100) throw new Error("Threshold must be between 0 and 100");

        await retryWithBackoff(
            async () => {
                const { error } = await this.supabase
                    .from('thresholds')
                    .update({ 
                        percentage,
                        notify
                    })
                    .eq('id', thresholdId)
                    .select()
                    .single();
                if (error) throw error;
            }
        )
    }

    public async updateHealth(
        address: PublicKey, 
        health: number
    ): Promise<MonitoredAccount> {
        return await retryWithBackoff(
            async () => {
                const { data: account, error } = await this.supabase
                    .from('accounts')
                    .update({ last_health: health })
                    .eq('address', address.toBase58())
                    .select(`
                        address,
                        last_health,
                        subscribers (
                            chat_id,
                            thresholds (
                                percentage,
                                notify
                            )
                        )
                    `)
                    .single();
                if (error) throw error;

                return {
                    address: new PublicKey(account.address),
                    lastHealth: account.last_health,
                    subscribers: account.subscribers.map(sub => ({
                        chatId: sub.chat_id,
                        thresholds: sub.thresholds.map(threshold => threshold as Threshold)
                    }))
                };
            }
        )
    }

    public async getSubscriberId(
        address: PublicKey, 
        chatId: number
    ): Promise<number> {
        return await retryWithBackoff(  
            async () => {
                const { data, error } = await this.supabase
                    .from('subscribers')
                    .select('id')
                    .eq('address', address.toBase58())
                    .eq('chat_id', chatId)
                    .single();

                if (error) throw error;
                return data.id;
            }
        )
    }

    public async getThresholdId(
        subscriberId: number, 
        percentage: number
    ): Promise<number> {
        if (percentage < 0 || percentage > 100) throw new Error("Threshold must be between 0 and 100");

        return await retryWithBackoff(
            async () => {
                const { data, error } = await this.supabase
                    .from('thresholds')
                    .select('id')
                    .eq('subscriber_id', subscriberId)
                    .eq('percentage', percentage)
                    .single();

                if (error) throw error;
                return data.id;
            }
        )
    }
}