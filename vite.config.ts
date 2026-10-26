import { defineConfig } from 'vitest/config';

// `npm run dev` serves dev/index.html (a simulated DeskUp Pro).
// `npm run build` emits the single file Home Assistant loads: dist/standing-desk-card.js.
// It's a regular (not library) build so the output is fully minified.
export default defineConfig({
  server: {
    open: '/dev/index.html',
  },
  build: {
    outDir: 'dist',
    target: 'es2021',
    emptyOutDir: true,
    copyPublicDir: false,
    modulePreload: false,
    minify: true,
    // three.js makes the single bundle ~650 kB (~170 kB gzipped); that's expected.
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      input: 'src/standing-desk-card.ts',
      preserveEntrySignatures: 'allow-extension',
      output: {
        format: 'es',
        entryFileNames: 'standing-desk-card.js',
      },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
