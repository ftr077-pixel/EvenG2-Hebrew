import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  server: {
    port: 5173,
    proxy: {
      // OpenRouter — used for both Hebrew→Russian translation and the
      // post-session AI summary. Proxied in dev to sidestep CORS; in the
      // Even Hub WebView we call openrouter.ai directly.
      '/api/openrouter': {
        target: 'https://openrouter.ai',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/openrouter/, ''),
        secure: true,
      },
    },
  },
});
