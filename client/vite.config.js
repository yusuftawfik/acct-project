import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: the page runs on http://localhost:5173 and forwards API calls to the Node server on port 5000.
// Build: the finished page is written to server/public, which the Node server serves at http://127.0.0.1:5000/.
// On Vercel the client is its own service, so it builds to its own dist/ folder instead.
const api = 'http://127.0.0.1:5000';
const outDir = process.env.VERCEL ? 'dist' : '../server/public';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/journal.csv': api,
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
  },
});
