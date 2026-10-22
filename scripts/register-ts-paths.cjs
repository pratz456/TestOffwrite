/**
 * Lets ts-node resolve the app's `@/` imports when this migration runs under
 * CommonJS. The root tsconfig has `paths` and no `baseUrl`, which the default
 * tsconfig-paths register skips.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CJS loader hook, required before the script loads. */
const path = require('node:path');
require('tsconfig-paths').register({
  baseUrl: path.resolve(__dirname, '..'),
  paths: { '@/*': ['./*'] },
});
