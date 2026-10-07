import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'prelude/test/**/*.test.js',
      'packages/*/test/**/*.test.{ts,tsx}',
      'typegen/test/**/*.test.mjs',
      'examples/*/test/**/*.test.ts',
    ],
  },
});
