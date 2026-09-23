/** Golden-file comparison for protocol fixtures; UPDATE_GOLDENS=1 rewrites them. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect } from 'vitest';

export function expectGolden(name: string, actual: unknown): void {
  const file = new URL(`../fixtures/expected/${name}.json`, import.meta.url);
  const serialized = `${JSON.stringify(actual, null, 2)}\n`;
  if (process.env['UPDATE_GOLDENS'] === '1') {
    mkdirSync(new URL('../fixtures/expected/', import.meta.url), { recursive: true });
    writeFileSync(file, serialized);
    return;
  }
  const expected = readFileSync(file, 'utf8');
  expect(JSON.parse(expected)).toEqual(JSON.parse(serialized));
}
