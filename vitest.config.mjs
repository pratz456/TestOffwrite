import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sharedExclude = [
  '**/node_modules/**',
  '**/dist/**',
  '**/tests/transaction-update.test.ts', // Integration test: requires getTransaction + real DB
];

// The boundary file is started in three workers. Each worker gets TZ before
// the process boots, so Date.getTimezoneOffset is the zone under test.
const processZones = ['America/Los_Angeles', 'UTC', 'Asia/Tokyo'];

export default defineConfig({
  test: {
    environment: 'node',
    exclude: sharedExclude,
    projects: [
      {
        extends: true,
        test: {
          name: 'main',
          exclude: [...sharedExclude, '**/tests/tax-year-boundary.test.ts'],
        },
      },
      ...processZones.map(timeZone => ({
        extends: true,
        test: {
          name: `process-${timeZone.replaceAll('/', '-')}`,
          include: ['tests/tax-year-boundary.test.ts'],
          env: { TZ: timeZone },
        },
      })),
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
