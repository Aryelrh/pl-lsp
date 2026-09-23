import { TextDocument } from 'vscode-languageserver-textdocument';
import { describe, expect, it } from 'vitest';
import type { CodeAction, Command, Diagnostic, TextEdit } from 'vscode-languageserver/node.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import { createAnalysis, type Analysis } from '../../src/analysis/model.js';
import { codeActionsAt, type CodeActionResult } from '../../src/features/code-actions.js';
import { computeDiagnostics } from '../../src/features/diagnostics.js';

const URI = 'file:///test.placitum';

function analysisOf(source: string): Analysis {
  return createAnalysis(TextDocument.create(URI, 'placitum', 1, source));
}

function actionsFor(source: string, code: string): { analysis: Analysis; actions: CodeActionResult[] } {
  const analysis = analysisOf(source);
  const diagnostics = computeDiagnostics(analysis, DEFAULT_CONFIG);
  const diagnostic = diagnostics.find((candidate) => candidate.code === code);
  if (diagnostic === undefined) {
    throw new Error(`no ${code} in ${JSON.stringify(diagnostics.map((candidate) => candidate.code))}`);
  }
  return { analysis, actions: codeActionsAt(analysis, diagnostic.range, diagnostics) };
}

function quickFix(actions: readonly CodeActionResult[]): CodeAction {
  const action = actions.find((candidate): candidate is CodeAction => 'edit' in candidate);
  if (action === undefined) throw new Error('no quick fix offered');
  return action;
}

function apply(analysis: Analysis, action: CodeAction): string {
  const edits = Object.values(action.edit?.changes ?? {})[0] ?? [];
  let text = analysis.document.getText();
  const sorted = [...edits].sort(
    (a, b) => analysis.document.offsetAt(b.range.start) - analysis.document.offsetAt(a.range.start),
  );
  for (const change of sorted) {
    text = text.slice(0, analysis.document.offsetAt(change.range.start)) + change.newText + text.slice(analysis.document.offsetAt(change.range.end));
  }
  return text;
}

function firstEdit(action: CodeAction): TextEdit {
  const edits = Object.values(action.edit?.changes ?? {})[0] ?? [];
  const edit = edits[0];
  if (edit === undefined) throw new Error('no edit');
  return edit;
}

describe('add-needs quick fix (E301)', () => {
  it('inserts a needs line at offset 0 when none exists', () => {
    const source = 'let config = fs.readFile!("/etc/app.json")\n';
    const { analysis, actions } = actionsFor(source, 'E301_EXTRACT_UNCOVERED_CAPABILITY');
    const fix = quickFix(actions);
    expect(fix.title).toBe('Add needs fs.read("/etc/app.json")');
    expect(fix.kind).toBe('quickfix');
    expect(fix.isPreferred).toBe(true);
    expect(firstEdit(fix)).toEqual({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      newText: 'needs fs.read("/etc/app.json")\n',
    });
    expect(apply(analysis, fix)).toBe(`needs fs.read("/etc/app.json")\n${source}`);
  });

  it('inserts after the pragma line when the file starts with #!strict', () => {
    const source = '#!strict\nlet config = fs.readFile!("/etc/app.json")\n';
    const { analysis, actions } = actionsFor(source, 'E301_EXTRACT_UNCOVERED_CAPABILITY');
    const fix = quickFix(actions);
    expect(firstEdit(fix).range.start).toEqual({ line: 1, character: 0 });
    expect(apply(analysis, fix)).toBe('#!strict\nneeds fs.read("/etc/app.json")\nlet config = fs.readFile!("/etc/app.json")\n');
  });

  it('appends to the existing top-level needs declaration', () => {
    const source = 'needs fs.read("/var/**")\nlet config = fs.readFile!("/etc/app.json")\n';
    const { analysis, actions } = actionsFor(source, 'E301_EXTRACT_UNCOVERED_CAPABILITY');
    const fix = quickFix(actions);
    expect(fix.title).toBe('Add needs fs.read("/etc/app.json")');
    expect(firstEdit(fix).newText).toBe(', fs.read("/etc/app.json")');
    expect(apply(analysis, fix)).toBe('needs fs.read("/var/**"), fs.read("/etc/app.json")\nlet config = fs.readFile!("/etc/app.json")\n');
  });

  it('uses the URL hostname lowercased for net grants', () => {
    const source = 'let r = curl!("HTTPS://API.Example.COM/v1")\n';
    const { actions } = actionsFor(source, 'E301_EXTRACT_UNCOVERED_CAPABILITY');
    expect(quickFix(actions).title).toBe('Add needs net("api.example.com")');
  });

  it('re-escapes backslashes and quotes for path grants', () => {
    const source = 'let x = fs.writeFile!("/tmp/a\\"b")\n';
    const { actions } = actionsFor(source, 'E301_EXTRACT_UNCOVERED_CAPABILITY');
    expect(quickFix(actions).title).toBe('Add needs fs.write("/tmp/a\\"b")');
  });

  it('skips the fix when the token already exists at the top level', () => {
    const source = [
      'needs fs.read("/etc/app.json"), net("api.example.com")',
      'fn f() needs only(net("api.example.com")) {',
      '  fs.readFile!("/etc/app.json")',
      '}',
      '',
    ].join('\n');
    const { actions } = actionsFor(source, 'E301_EXTRACT_UNCOVERED_CAPABILITY');
    expect(actions.some((candidate) => 'edit' in candidate)).toBe(false);
  });

  it('does not offer a fix for deferred (non-literal) bang calls', () => {
    const source = 'needs fs.read("/etc/**")\nlet path = "/etc/app.json"\nlet x = fs.readFile!(path)\n';
    const analysis = analysisOf(source);
    const diagnostics = computeDiagnostics(analysis, DEFAULT_CONFIG);
    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'E301_EXTRACT_UNCOVERED_CAPABILITY')).toEqual([]);
  });
});

describe('syntax quick fixes', () => {
  it('inserts the closing quote for E101', () => {
    const source = 'let x = "abc\n';
    const { analysis, actions } = actionsFor(source, 'E101_LEX_UNTERMINATED_STRING');
    const fix = quickFix(actions);
    expect(fix.title).toBe('Insert closing `"`');
    expect(apply(analysis, fix)).toBe('let x = "abc"\n');
  });

  it('removes whitespace before the bang for E104', () => {
    const source = 'let x = 1\nfs.readFile !("/etc/a")\n';
    const { analysis, actions } = actionsFor(source, 'E104_LEX_UNEXPECTED_CHARACTER');
    const fix = quickFix(actions);
    expect(fix.title).toBe('Remove whitespace before `!`');
    expect(apply(analysis, fix)).toBe('let x = 1\nfs.readFile!("/etc/a")\n');
  });

  it('appends the closing brace for E203', () => {
    const source = 'fn f() {\n  let x = 1\n';
    const { analysis, actions } = actionsFor(source, 'E203_PARSE_UNTERMINATED_BLOCK');
    const fix = quickFix(actions);
    expect(fix.title).toBe('Insert `}` at end of file');
    expect(apply(analysis, fix)).toBe(`${source}}`);
  });
});

describe('binder quick fixes', () => {
  it('declares an unbound read with a null initializer', () => {
    const source = 'let y = missing + 1\n';
    const { analysis, actions } = actionsFor(source, 'E500_EVAL_UNBOUND_VAR');
    const fix = quickFix(actions);
    expect(fix.title).toBe('Declare `missing` with `let`');
    expect(apply(analysis, fix)).toBe('let missing = null\nlet y = missing + 1\n');
  });

  it('turns an unbound assignment into a let declaration', () => {
    const source = 'x = 1\n';
    const { analysis, actions } = actionsFor(source, 'E500_EVAL_UNBOUND_VAR');
    const fix = quickFix(actions);
    expect(apply(analysis, fix)).toBe('let x = 1\n');
  });

  it('defines a function when the unresolved name is a call target', () => {
    const source = 'foo(1)\n';
    const { analysis, actions } = actionsFor(source, 'E500_EVAL_UNBOUND_VAR');
    const fix = quickFix(actions);
    expect(fix.title).toBe('Define function `fn foo() { }`');
    expect(apply(analysis, fix)).toBe('foo(1)\nfn foo() {\n}\n');
  });

  it('renames a redeclaration to the first free name_2', () => {
    const source = 'let x = 1\nlet x = 2\n';
    const { analysis, actions } = actionsFor(source, 'E506_EVAL_REDECLARATION');
    const fix = quickFix(actions);
    expect(fix.title).toBe('Rename to `x_2`');
    expect(apply(analysis, fix)).toBe('let x = 1\nlet x_2 = 2\n');
  });

  it('skips taken rename candidates', () => {
    const source = 'let x = 1\nlet x = 2\nlet x_2 = 3\n';
    const { actions } = actionsFor(source, 'E506_EVAL_REDECLARATION');
    expect(quickFix(actions).title).toBe('Rename to `x_3`');
  });
});

describe('command actions', () => {
  it('attaches the manifest command to a diagnostic range', () => {
    const { actions } = actionsFor('let x = "abc\n', 'E101_LEX_UNTERMINATED_STRING');
    const command = actions.find((candidate): candidate is Command => 'command' in candidate);
    expect(command?.command).toBe('placitum.showManifest');
    expect(command?.arguments).toEqual([URI]);
  });

  it('returns nothing for a range without diagnostics', () => {
    const analysis = analysisOf('let x = 1\n');
    const diagnostics: Diagnostic[] = computeDiagnostics(analysis, DEFAULT_CONFIG);
    expect(codeActionsAt(analysis, { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, diagnostics)).toEqual([]);
  });
});
