import { defineConfig } from 'vite';

export default defineConfig({
  // es2022: main.js uses top-level await to load world.json
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
  // 127.0.0.1, not localhost: Node 18 resolves localhost to IPv6 but uvicorn listens on IPv4
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
});
