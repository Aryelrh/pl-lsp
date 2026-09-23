import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Analysis } from '../../src/analysis/model.js';
import { createAnalysis } from '../../src/analysis/model.js';
import { definitionAt, typeDefinitionAt } from '../../src/features/definition.js';

const rosetta = readFileSync(new URL('../fixtures/rosetta.placitum', import.meta.url), 'utf8');

function analysisOf(source: string): Analysis {
  return createAnalysis(TextDocument.create('file:///test.placitum', 'placitum', 1, source));
}

describe('definitionAt', () => {
  it('jumps from a reference to the let declaration', () => {
    const source = 'let config = 1\nprint!(config)\n';
    const analysis = analysisOf(source);
    const target = definitionAt(analysis, source.lastIndexOf('config'));
    expect(target?.uri).toBe('file:///test.placitum');
    expect(target?.selectionRange).toEqual({ start: { line: 0, character: 4 }, end: { line: 0, character: 10 } });
    expect(target?.range.start).toEqual({ line: 0, character: 0 });
  });

  it('jumps from a call to the fn declaration, including recursion', () => {
    const source = 'fn f(n) { return f(n) }\n';
    const analysis = analysisOf(source);
    const target = definitionAt(analysis, source.indexOf('return ') + 'return '.length);
    expect(target?.selectionRange).toEqual({ start: { line: 0, character: 3 }, end: { line: 0, character: 4 } });
  });

  it('resolves rosetta bindings: params, body lets, and uses', () => {
    const analysis = analysisOf(rosetta);
    const param = definitionAt(analysis, rosetta.indexOf('fs.readFile!(path)') + 'fs.readFile!('.length);
    expect(param?.selectionRange.start.character).toBe('fn load('.length);
    const dataUse = definitionAt(analysis, rosetta.indexOf('return data') + 'return '.length);
    expect(dataUse?.selectionRange.start.line).toBe(5);
    const fnCall = definitionAt(analysis, rosetta.indexOf('load("/etc/app.json")'));
    expect(fnCall?.selectionRange.start.line).toBe(4);
  });

  it('resolves user bang targets and returns null for stdlib/builtins', () => {
    const source = 'fn save(x) { return x }\nsave!(1)\n';
    const analysis = analysisOf(source);
    expect(definitionAt(analysis, source.lastIndexOf('save'))?.selectionRange.start.character).toBe(3);
    const stdlib = analysisOf('needs net("a.com")\nlet r = curl!("https://a.com")\n');
    expect(definitionAt(stdlib, stdlib.document.getText().indexOf('curl!'))).toBeNull();
    const builtin = analysisOf('let x = 1\nprint!(json)\n');
    expect(definitionAt(builtin, builtin.document.getText().lastIndexOf('json'))).toBeNull();
  });

  it('resolves object literal properties to their key', () => {
    const source = 'let obj = { key: 1 }\nlet v = obj.key\n';
    const analysis = analysisOf(source);
    const target = definitionAt(analysis, source.lastIndexOf('key'));
    expect(target?.selectionRange).toEqual({
      start: { line: 0, character: source.indexOf('key') },
      end: { line: 0, character: source.indexOf('key') + 3 },
    });
    expect(target?.range.start.character).toBe(source.indexOf('key'));
  });

  it('resolves assignment targets and returns null without a binding', () => {
    const source = 'let x = 1\nx = 2\n';
    const analysis = analysisOf(source);
    expect(definitionAt(analysis, source.lastIndexOf('x'))?.selectionRange.start.line).toBe(0);
    const broken = analysisOf('let x = "abc\n');
    expect(definitionAt(broken, 5)).toBeNull();
  });
});

describe('typeDefinitionAt', () => {
  it('matches definition for user bindings and is null for builtins', () => {
    const source = 'let x = 1\nlet y = x\n';
    const analysis = analysisOf(source);
    const offset = source.lastIndexOf('x');
    expect(typeDefinitionAt(analysis, offset)).toEqual(definitionAt(analysis, offset));
    const builtin = analysisOf('let y = json\n');
    expect(typeDefinitionAt(builtin, builtin.document.getText().lastIndexOf('json'))).toBeNull();
  });
});
