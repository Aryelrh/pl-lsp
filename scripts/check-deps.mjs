#!/usr/bin/env node
// Dependency allow-list gate (directive §4.3). Fails when an unlisted package
// sneaks in, or when the core `placitum` pin is not a full commit SHA.
import { readFileSync } from 'node:fs';

const ALLOWED = new Set([
  // runtime (directive §4.3)
  'placitum',
  'vscode-languageserver',
  'vscode-languageserver-textdocument',
  // dev
  '@types/node',
  '@typescript-eslint/eslint-plugin',
  '@typescript-eslint/parser',
  'eslint',
  'tsx',
  'typescript',
  'vitest',
]);

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const names = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
];
const offenders = names.filter((name) => !ALLOWED.has(name));
if (offenders.length > 0) {
  console.error(`check-deps: unlisted dependencies: ${offenders.join(', ')}`);
  process.exit(1);
}

const pin = pkg.dependencies?.placitum ?? '';
if (!/#[0-9a-f]{40}$/.test(pin)) {
  console.error(`check-deps: placitum must be pinned to a full commit SHA, got: ${pin}`);
  process.exit(1);
}

console.log('check-deps: ok');
