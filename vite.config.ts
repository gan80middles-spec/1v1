import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: { outDir: 'dist/web', emptyOutDir: true,rollupOptions:{input:{main:'index.html',phase0:'phase0.html',h2:'h2.html'}} },
});
