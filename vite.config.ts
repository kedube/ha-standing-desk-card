/// <reference types="node" />
import { defineConfig } from 'vitest/config';

// `npm run dev` serves dev/index.html (a simulated DeskUp Pro).
// `npm run build` emits the single file Home Assistant loads: dist/standing-desk-card.js.
// It's a regular (not library) build so the output is fully minified.
export default defineConfig({
  // The release workflow sets CARD_VERSION (0.01, 0.02 …); local builds report "dev".
  define: {
    __CARD_VERSION__: JSON.stringify(process.env.CARD_VERSION || 'dev'),
  },
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
    // The full licence text of every bundled library, attached to each release.
    license: { fileName: 'THIRD-PARTY-LICENSES.md' },
    rolldownOptions: {
      input: 'src/standing-desk-card.ts',
      preserveEntrySignatures: 'allow-extension',
      output: {
        format: 'es',
        entryFileNames: 'standing-desk-card.js',
        // Keep the @license notices of the bundled three.js (MIT) and Lit (BSD).
        comments: { legal: true },
      },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
