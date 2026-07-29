import { createClient } from "@supabase/supabase-js";

// These are deliberately Vite's public variables. The configured `define`
// values ensure Vinext includes only this safe client configuration in the PWA.
const url = import.meta.env.VITE_NAVI_SUPABASE_URL;
const anonKey = import.meta.env.VITE_NAVI_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
