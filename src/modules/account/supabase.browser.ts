import { createClient } from '@supabase/supabase-js'
import type { CloudDatabase } from './cloud-types'

let client: ReturnType<typeof createClient<CloudDatabase>> | null = null

export function getBrowserSupabase() {
  if (typeof window === 'undefined') return null
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null
  return (client ??= createClient<CloudDatabase>(url, key))
}
