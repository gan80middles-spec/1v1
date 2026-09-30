import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'], environment: 'node', maxWorkers: 4,
    reporters: ['default','json'], outputFile: { json: 'artifacts/phase-0/unit-tests.json' },
  },
});
