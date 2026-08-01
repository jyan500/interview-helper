/// <reference types="vite/client" />

// Type the custom env vars so import.meta.env.VITE_API_BASE_URL is a string, not `any`.
interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
