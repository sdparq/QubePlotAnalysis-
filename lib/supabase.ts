"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Read public env vars. These are inlined at build time by Next.js. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True if env vars are present. When false, the cloud UI hides itself and the
 *  app keeps working locally against localStorage. */
export const isCloudEnabled: boolean = Boolean(url && anon);

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isCloudEnabled) return null;
  if (_client) return _client;
  _client = createClient(url as string, anon as string, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
  return _client;
}
