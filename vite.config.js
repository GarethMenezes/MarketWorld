import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 }, // main.js uses top-level await to load world.json
  server: { proxy: { '/api': 'http://localhost:8000' } },
});
