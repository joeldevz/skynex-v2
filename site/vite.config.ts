import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Multipágina: la home (beneficios), /docs/ y /cambios/.
// SITE_BASE fija la ruta de publicación (GitHub Pages: /skynex-v2/); en local, /.
export default defineConfig({
  base: process.env.SITE_BASE ?? '/',
  plugins: [tailwindcss()],
  build: {
    rolldownOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        docs: resolve(import.meta.dirname, 'docs/index.html'),
        cambios: resolve(import.meta.dirname, 'cambios/index.html'),
      },
    },
  },
});
