import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const packageExternal = (id: string) =>
  id === 'electron' ||
  id === '@sovea/electron-ipc-service' ||
  id.startsWith('@sovea/electron-ipc-service/');

export default defineConfig({
  root: rootDir,
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
  },
  plugins: [
    electron({
      main: {
        entry: 'src/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            emptyOutDir: true,
            minify: false,
            target: 'node18',
            rolldownOptions: {
              external: packageExternal,
              output: {
                format: 'es',
                codeSplitting: false,
                entryFileNames: 'index.js',
              },
            },
          },
        },
      },
      preload: {
        input: 'src/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            emptyOutDir: true,
            minify: false,
            target: 'node18',
            rolldownOptions: {
              external: packageExternal,
              output: {
                format: 'es',
                codeSplitting: false,
                entryFileNames: 'index.mjs',
                chunkFileNames: '[name].mjs',
              },
            },
          },
        },
      },
    }),
  ],
});
