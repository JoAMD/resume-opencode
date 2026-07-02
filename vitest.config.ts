import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['public/**/*.test.ts', 'services/**/*.test.ts', 'routes/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
});