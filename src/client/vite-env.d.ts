/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRODUCT_NAME?: string;
  readonly VITE_PRODUCT_DESCRIPTION?: string;
  readonly VITE_CF_WEB_ANALYTICS_TOKEN?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
