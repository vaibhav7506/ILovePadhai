import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, '.', 'VITE_');
  const productName = environment.VITE_PRODUCT_NAME ?? 'ExamForge';
  const productDescription =
    environment.VITE_PRODUCT_DESCRIPTION ?? 'Verified exam practice. No account required.';

  return {
    plugins: [
      {
        name: 'examforge-metadata',
        transformIndexHtml: {
          order: 'pre',
          handler(html) {
            return html
              .replaceAll('%VITE_PRODUCT_NAME%', productName)
              .replaceAll('%VITE_PRODUCT_DESCRIPTION%', productDescription);
          },
        },
      },
      react(),
      tailwindcss(),
      cloudflare(),
    ],
    resolve: {
      alias: {
        '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
        '@server': fileURLToPath(new URL('./src/server', import.meta.url)),
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      },
    },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  };
});
