import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Server components: a fresh, session-less client per request (public reads only).
export function serverClient(): SupabaseClient {
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

// Server only: bypasses row-level security. Used to store AI verdicts.
// Never import this from a "use client" file.
export function adminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

// Browser: one shared client that holds the signed-in user's session.
let browser: SupabaseClient | null = null;
export function browserClient(): SupabaseClient {
  if (!browser) browser = createClient(url, anonKey);
  return browser;
}
