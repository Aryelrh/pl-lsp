/**
 * `npm pack --dry-run` contents snapshot (directive §10, Phase 7): the tarball
 * ships dist + editors + docs and never leaks src/tests/scripts.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PackResult {
  name: string;
  version: string;
  filename: string;
  files: { path: string }[];
}

const root = fileURLToPath(new URL('../../', import.meta.url));
const hasDist = existsSync(new URL('../../dist/bin.js', import.meta.url));

function pack(): PackResult {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' });
  const results = JSON.parse(output) as PackResult[];
  const result = results[0];
  if (result === undefined) throw new Error('npm pack returned no result');
  return result;
}

describe.skipIf(!hasDist)('npm pack contents', () => {
  it('ships the built server, recipes and docs', () => {
    const result = pack();
    const paths = result.files.map((file) => file.path);
    expect(result.name).toBe('placitum-lsp');
    expect(result.version).toBe('0.1.0');
    for (const required of [
      'package.json',
      'README.md',
      'CHANGELOG.md',
      'LICENSE',
      'AUTHORS',
      'dist/bin.js',
      'dist/server.js',
      'dist/features/code-actions.js',
      'dist/analysis/core-adapter.js',
      'editors/README.md',
      'editors/neovim/init.lua',
      'editors/checks/helix.sh',
    ]) {
      expect(paths).toContain(required);
    }
  });

  it('never leaks sources, tests, scripts or config', () => {
    const paths = pack().files.map((file) => file.path);
    for (const path of paths) {
      expect(path.startsWith('src/')).toBe(false);
      expect(path.startsWith('tests/')).toBe(false);
      expect(path.startsWith('scripts/')).toBe(false);
      expect(path.startsWith('node_modules/')).toBe(false);
      expect(path).not.toBe('.eslintrc.json');
      expect(path).not.toBe('tsconfig.json');
    }
  });
});
