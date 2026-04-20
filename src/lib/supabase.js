import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigError =
  !supabaseUrl || !supabaseAnonKey
    ? "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY."
    : "";

export const supabase = supabaseConfigError
  ? null
  : createClient(supabaseUrl, supabaseAnonKey);
