import { defineConfig } from 'vite';

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export default defineConfig({
  base: '/',
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'iife' },
  build: { target: 'es2022', outDir: 'dist', sourcemap: false },
});
