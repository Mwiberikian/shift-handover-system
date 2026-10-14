import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaOptions } from './pwa.config.js';

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA(pwaOptions)],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    // Half the cores: with one jsdom fork per core, the typing-heavy tests ran
    // past their 5 s timeout on a busy machine (22 files since Part R).
    maxWorkers: '50%',
    setupFiles: ['./src/test/setup.js'],
  },
});
