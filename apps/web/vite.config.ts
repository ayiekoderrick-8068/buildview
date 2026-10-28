import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env['VITE_API_TARGET'] ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': apiTarget },
  },
  preview: { proxy: { '/api': apiTarget } },
  build: { chunkSizeWarningLimit: 1500 },
});
