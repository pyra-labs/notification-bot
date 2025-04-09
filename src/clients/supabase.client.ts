import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types.js";
import config from "../config/config.js";
import { PublicKey } from "@solana/web3.js";
import { retryWithBackoff } from "@quartz-labs/sdk";
import type { MonitoredAccount } from "../types/interfaces/monitoredAccount.interface.js";
import type { Threshold } from "../types/interfaces/threshold.interface.js";
import type { Subscriber } from "../types/interfaces/subscriber.interface.js";

export class Supabase {
    public supabase: SupabaseClient<Database>;

    constructor() {
        this.supabase = createClient<Database>(
            config.SUPABASE_URL,
            config.SUPABASE_KEY_CARD
        );
    }

    public async getAllAccounts(): Promise<MonitoredAccount[]> {
        return await retryWithBackoff(
            async () => {
                const { data: accounts, error } = await this.supabase
                    .from('accounts')
                    .select(`
                        address,
                        last_available_credit,
                        subscribers (
                            chat_id,
                            thresholds (
                                available_credit,
                                notify
                            )
                        )
                    `);

                if (error) throw error;
                
                return accounts.map(account => ({
                    address: new PublicKey(account.address),
                    last_available_credit: account.last_available_credit,
                    subscribers: account.subscribers.map(subscriber => subscriber as Subscriber)
                }));
            }
        );
    }

    public async getMonitoredAccount(
        address: PublicKey
    ): Promise<MonitoredAccount | null> {
        return await retryWithBackoff(
            async () => {
                const { data: account, error } = await this.supabase
                    .from('accounts')
                    .select(`
                        address,
                        last_available_credit,
                        subscribers (
                            chat_id,
                            thresholds (
                                available_credit,
                                notify
                            )
                        )
                    `)
                    .eq('address', address.toBase58())
                    .single();

                if (error) {
                    if (error.code === "PGRST116") {
                        return null; // No rows returned
                    }
                    throw error;
                }

                return {
                    address: new PublicKey(account.address),
                    last_available_credit: account.last_available_credit,
                    subscribers: account.subscribers.map(subscriber => subscriber as Subscriber)
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
                        last_available_credit,
                        subscribers!inner (
                            chat_id,
                            thresholds (
                                available_credit,
                                notify
                            )
                        )
                    `)
                    .eq('subscribers.chat_id', chatId);
                if (error) throw error;
                
                return accounts.map(account => ({
                    address: new PublicKey(account.address),
                    last_available_credit: account.last_available_credit,
                    subscribers: account.subscribers.map(subscriber => subscriber as Subscriber)
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
                            available_credit, 
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
        chat_id: number, 
        threshold: number, 
        available_credit: number
    ) {
        await retryWithBackoff(
            async () => {
                const { error } = await this.supabase.rpc('subscribe_to_wallet', {
                    p_address: address.toBase58(),
                    p_chat_id: chat_id,
                    p_threshold: threshold,
                    p_last_available_credit: available_credit
                });    
                if (error) throw error;
            }
        )
    }

    public async removeThreshold(thresholdId: number) {
        await retryWithBackoff(
            async () => {
                const { error } = await this.supabase.rpc('remove_threshold', {
                    p_threshold_id: thresholdId
                });
                if (error) throw error;
            }
        )
    }

    public async updateThreshold(
        thresholdId: number, 
        available_credit: number, 
        notify: boolean
    ) {
        await retryWithBackoff(
            async () => {
                const { error } = await this.supabase
                    .from('thresholds')
                    .update({ 
                        available_credit,
                        notify
                    })
                    .eq('id', thresholdId)
                    .select()
                    .single();
                if (error) throw error;
            }
        )
    }

    public async updateAvailableCredit(
        address: PublicKey, 
        available_credit: number
    ): Promise<MonitoredAccount> {
        return await retryWithBackoff(
            async () => {
                const { data: account, error } = await this.supabase
                    .from('accounts')
                    .update({ last_available_credit: available_credit })
                    .eq('address', address.toBase58())
                    .select(`
                        address,
                        last_available_credit,
                        subscribers (
                            chat_id,
                            thresholds (
                                available_credit,
                                notify
                            )
                        )
                    `)
                    .single();
                if (error) throw error;

                return {
                    address: new PublicKey(account.address),
                    last_available_credit: account.last_available_credit,
                    subscribers: account.subscribers.map(subscriber => subscriber as Subscriber)
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
        available_credit: number
    ): Promise<number> {
        return await retryWithBackoff(
            async () => {
                const { data, error } = await this.supabase
                    .from('thresholds')
                    .select('id')
                    .eq('subscriber_id', subscriberId)
                    .eq('available_credit', available_credit)
                    .single();

                if (error) throw error;
                return data.id;
            }
        )
    }
}