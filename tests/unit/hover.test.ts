import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createAnalysis, type Analysis } from '../../src/analysis/model.js';
import { hoverAt, type HoverInfo } from '../../src/features/hover.js';

function analysisOf(source: string): Analysis {
  return createAnalysis(TextDocument.create('file:///test.placitum', 'placitum', 1, source));
}

function hover(source: string, needle: string, after = 0): HoverInfo | null {
  const analysis = analysisOf(source);
  return hoverAt(analysis, source.indexOf(needle) + needle.length + after);
}

const PROGRAM = `needs net("api.example.com"), fs.read("/etc/**")
fn load(path) needs only(fs.read("/etc/**")) {
  let data = fs.readFile!(path)
  return data
}
let cfg = load("/etc/app.json")
let r = curl!("https://api.example.com/v1")
print!(r.status)
`;

describe('hoverAt', () => {
  it('describes let, fn and param bindings with their declaration', () => {
    const letHover = hover(PROGRAM, 'cfg', -1);
    expect(letHover?.value).toContain('**let** `cfg`');
    expect(letHover?.value).toContain('let cfg = load("/etc/app.json")');

    const fnHover = hover(PROGRAM, 'load', -1);
    expect(fnHover?.value).toContain('**fn** `load` — `fn load(path)`');
    expect(fnHover?.value).toContain('needs: fs.read("/etc/**")');

    const paramHover = hover(PROGRAM, 'path', -1);
    expect(paramHover?.value).toContain('**param** `path`');
  });

  it('documents the json namespace and its member', () => {
    const source = 'let x = json.parse("{}")\n';
    expect(hover(source, 'json', -1)?.value).toContain('`json` namespace');
    expect(hover(source, 'json.parse', -2)?.value).toBe('`json.parse(string) -> unknown`');
  });

  it('reports bang coverage, deferral and ambient status', () => {
    const deferred = hover(PROGRAM, 'fs.readFile', 0);
    expect(deferred?.value).toContain('deferred to runtime');
    expect(deferred?.value).toContain('not a compile-time string literal');

    const covered = hover(PROGRAM, 'curl', 0);
    expect(covered?.value).toContain('statically covered by');
    expect(covered?.value).toContain('net("api.example.com")');

    const ambient = hover(PROGRAM, 'print', 0);
    expect(ambient?.value).toContain('ambient');
  });

  it('explains capability tokens, usage and only() parents', () => {
    const used = hover(PROGRAM, 'net("api.example.com")');
    expect(used?.value).toContain('used by a literal bang call');
    const only = hover(PROGRAM, 'only(fs.read');
    expect(only?.value).toContain('attenuation');
    expect(only?.value).toContain('parent grants:');
    expect(only?.value).toContain('fs.read("/etc/**")');
  });

  it('documents keywords, the pragma and object members', () => {
    expect(hover('while true {\n}\n', 'while')?.value).toContain('repeats its block');
    expect(hover('#!strict\nlet x = 1\n', '#!strict')?.value).toContain('strict pipe-chain');
    expect(hover(PROGRAM, 'r.status')?.value).toBe('`status`: `number`');
  });

  it('returns null when there is nothing to explain and keeps ranges on one line', () => {
    expect(hover('let x = 1\n', '=', -1)).toBeNull();
    const info = hover(PROGRAM, 'cfg', -1);
    expect(info?.range.start.line).toBe(info?.range.end.line);
  });

  it('still explains declarations while the file does not parse', () => {
    const source = 'let config = 1\nlet c\n';
    expect(hover(source, 'config', -1)?.value).toContain('**let** `config`');
    expect(hover('fn helper(a) { return a }\nlet c\n', 'helper', -1)?.value).toContain('**fn** `helper`');
  });
});
