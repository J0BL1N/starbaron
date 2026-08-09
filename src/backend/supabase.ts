import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Anon client wiring (P3-T02-B, B7). Env names are placeholders — no real
// project URL/anon key is committed; the client is created lazily only when
// both vars are present so the app degrades gracefully to the
// localStorage-only build when Supabase is not configured.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
export const SUPABASE_ANON_KEY = import.meta.env
  .VITE_SUPABASE_ANON_KEY as string | undefined

let cachedClient: SupabaseClient | null = null

export function isSupabaseConfigured(): boolean {
  return (
    SUPABASE_URL !== undefined &&
    SUPABASE_URL !== '' &&
    SUPABASE_ANON_KEY !== undefined &&
    SUPABASE_ANON_KEY !== ''
  )
}

export function supabaseClient(
  url: string | undefined = SUPABASE_URL,
  anonKey: string | undefined = SUPABASE_ANON_KEY,
): SupabaseClient | null {
  if (url === undefined || url === '' || anonKey === undefined || anonKey === '') {
    return null
  }
  if (cachedClient === null) {
    cachedClient = createClient(url, anonKey)
  }
  return cachedClient
}

export function getSupabase(): SupabaseClient | null {
  return supabaseClient()
}

export type AnonAuthResult = { ok: true; userId: string | null } | { ok: false; error: string }

// B7: anonymous sign-in (D2). uid is preserved across anonymous -> registered
// upgrade; pre-P3 localStorage saves do not carry (D8 adopt-on-first-connect).
export async function signInAnonymously(
  client: SupabaseClient | null = getSupabase(),
): Promise<AnonAuthResult> {
  if (client === null) {
    return { ok: false, error: 'Supabase not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY' }
  }
  const { data, error } = await client.auth.signInAnonymously()
  if (error !== null) {
    return { ok: false, error: error.message }
  }
  return { ok: true, userId: data.user?.id ?? null }
}
