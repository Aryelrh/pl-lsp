import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { VERSION } from '../../src/version.js';

it('keeps VERSION in sync with package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: unknown };
  expect(VERSION).toBe(pkg.version);
});
