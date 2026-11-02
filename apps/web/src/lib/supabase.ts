"use client";

import { createSupabaseClient } from "@essentials/auth";

export const supabase = createSupabaseClient({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
});
