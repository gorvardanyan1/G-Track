import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [vue(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
      // Same-origin in dev: the browser talks to Vite, Vite forwards /api to the api.
      proxy: {
        // ws: Socket.io lives under /api/v1/socket.io.
        '/api': {
          target: env['API_PROXY_TARGET'] ?? 'http://localhost:3000',
          changeOrigin: false,
          ws: true,
        },
      },
    },
  };
});
