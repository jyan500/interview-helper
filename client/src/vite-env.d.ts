/// <reference types="vite/client" />

// Type the custom env vars so import.meta.env.VITE_API_BASE_URL is a string, not `any`.
interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string;
    // Phase B — Supabase. Both are public by design (they ship in the bundle); see
    // constants.ts for why that's safe and what must NEVER go here (the service_role key).
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
