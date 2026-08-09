import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Rollup-commonjs only runs its named-export static analysis on files that
    // match `include`; the workspace package resolves outside node_modules, so
    // without this it is treated as a black box and `import { APP }` fails.
    commonjsOptions: {
      include: [/node_modules/, /packages\/shared/],
    },
  },
});
