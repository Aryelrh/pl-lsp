/** Hover: bindings, builtins, members, bang calls, capability tokens, keywords (directive §7.4). */
import type { Range } from 'vscode-languageserver/node.js';
import {
  BANG_SIGNATURES,
  type BangCall,
  type MemberExpr,
  type NeedsDecl,
  type Token,
} from '../analysis/core-adapter.js';
import { bindingAt, nameSpanIn, typeResolver, type BindingHit } from '../analysis/binder.js';
import {
  coverageGrants,
  describeBang,
  effectiveManifestAt,
  grantTokenText,
  isTokenUsed,
  manifestTokenTexts,
  parentManifestOf,
} from '../analysis/capabilities.js';
import type { Analysis } from '../analysis/model.js';
import { spanToRange } from '../analysis/positions.js';
import { describeSignature, describeType, inferType } from '../analysis/types.js';
import { collectNodes } from '../analysis/walk.js';

export interface HoverInfo {
  value: string;
  range: Range;
}

const KEYWORD_DOCS: Record<string, string> = {
  NEEDS: '`needs` declares capabilities at the top of the program or right after a function parameter list.',
  LET: '`let` declares a new binding.',
  FN: '`fn` declares a function.',
  IF: '`if` runs its block when the condition is truthy.',
  ELSE: '`else` runs when the preceding `if` condition is falsy.',
  WHILE: '`while` repeats its block while the condition is truthy.',
  FOR: '`for` iterates over an array.',
  IN: '`in` separates the iterator from the iterable in a `for`.',
  RETURN: '`return` exits the enclosing function, optionally with a value.',
  NOT: '`not` is the logical negation operator.',
  ONLY: '`only(...)` attenuates the enclosing grants for a function.',
  TRUE: '`true` literal.',
  FALSE: '`false` literal.',
  NULL: '`null` literal.',
};

const CAPABILITY_DOCS: Record<string, string> = {
  FsReadCapability: '`fs.read(glob)` grants reading files matching the glob. Paths are canonicalized (symlinks and `..`) before matching.',
  FsWriteCapability: '`fs.write(glob)` grants writing files matching the glob.',
  NetCapability: '`net(host)` grants network access to an exact host or a single-label wildcard like `*.example.com`.',
  ExecCapability: '`exec(glob)` grants executing programs matching the glob.',
  EnvCapability: '`env(NAME)` grants reading the environment variable `NAME`; `?` marks it optional.',
  OnlyCapability: '`only(...)` restricts a function to a subset of the enclosing grants (attenuation).',
};

function rangeOf(analysis: Analysis, span: readonly [number, number]): Range {
  return spanToRange(analysis.document, span);
}

function lineText(analysis: Analysis, offset: number): string {
  const line = analysis.document.positionAt(offset).line;
  return (analysis.document.getText().split('\n')[line] ?? '').trimEnd();
}

function tokenAt(analysis: Analysis, offset: number): Token | null {
  for (const token of analysis.core.tokens) {
    if (token.kind === 'EOF' || token.kind === 'NEWLINE') continue;
    if (offset >= token.span[0] && offset <= token.span[1]) return token;
  }
  return null;
}

function bindingHover(analysis: Analysis, hit: BindingHit): HoverInfo {
  const { binding } = hit;
  const range = rangeOf(analysis, hit.span);
  if (binding.kind === 'builtin') {
    return { value: '`json` namespace\n\n```placitum\njson.parse(string) -> unknown\n```', range };
  }
  const lines: string[] = [];
  if (binding.kind === 'fn') {
    const signature = describeSignature(binding.type);
    lines.push(`**fn** \`${binding.name}\`${signature === null ? '' : ` — \`${signature}\``}`);
    if (analysis.capabilities !== null) {
      const grants = effectiveManifestAt(analysis.capabilities, binding.declSpan[0]);
      if (grants !== null) {
        const tokens = manifestTokenTexts(grants);
        lines.push(`\nneeds: ${tokens.length === 0 ? '(none)' : tokens.join(', ')}`);
      }
    }
  } else {
    lines.push(`**${binding.kind}** \`${binding.name}\`: \`${describeType(binding.type)}\``);
  }
  lines.push(`\n\`\`\`placitum\n${lineText(analysis, binding.declSpan[0])}\n\`\`\``);
  return { value: lines.join('\n'), range };
}

function memberHover(analysis: Analysis, offset: number): HoverInfo | null {
  const binder = analysis.binder;
  const program = analysis.core.program;
  if (binder === null || program === null) return null;
  const resolve = typeResolver(binder);
  for (const member of collectNodes<MemberExpr>(program.body, 'MemberExpr')) {
    const propertyStart = member.span[1] - member.property.length;
    if (offset < propertyStart || offset > member.span[1]) continue;
    const objectType = inferType(member.object, resolve);
    const range = rangeOf(analysis, [propertyStart, member.span[1]]);
    if (objectType.kind === 'namespace') {
      const memberType = objectType.members.get(member.property);
      if (memberType?.kind !== 'function') return null;
      const prefix = member.object.kind === 'Identifier' ? `${member.object.name}.` : '';
      return { value: `\`${prefix}${member.property}${describeSignature(memberType) ?? '(...)'}\``, range };
    }
    if (objectType.kind === 'object') {
      const propertyType = objectType.properties.get(member.property);
      if (propertyType !== undefined) return { value: `\`${member.property}\`: \`${describeType(propertyType)}\``, range };
    }
    return null;
  }
  return null;
}

function deferredReason(analysis: Analysis, bang: BangCall): string | null {
  const manifest = analysis.capabilities === null ? null : effectiveManifestAt(analysis.capabilities, bang.span[0]);
  const check = manifest?.deferredToRuntime.find((candidate) => candidate.nodeSpan[0] === bang.span[0]);
  return check?.reason ?? null;
}

function bangHover(analysis: Analysis, offset: number): HoverInfo | null {
  const program = analysis.core.program;
  if (analysis.capabilities === null || program === null) return null;
  for (const bang of collectNodes<BangCall>(program.body, 'BangCall')) {
    const targetEnd = bang.span[0] + bang.target.length;
    if (offset < bang.span[0] || offset > targetEnd) continue;
    const info = describeBang(analysis.capabilities, bang);
    const signature = BANG_SIGNATURES[bang.target];
    const lines = [`**${bang.target}!**${signature === undefined ? '' : ` \`${bang.target}(${signature.params.join(', ')}) -> ${signature.ret}\``}`];
    if (info.status === 'ambient') {
      lines.push('ambient — no `needs` required');
    } else if (info.status === 'deferred') {
      const reason = deferredReason(analysis, bang);
      lines.push(`deferred to runtime${reason === null ? '' : `: ${reason}`}`);
    } else if (info.status === 'statically-covered' && info.category !== null) {
      const category = info.category;
      const manifest = effectiveManifestAt(analysis.capabilities, bang.span[0]);
      const grants = manifest === null ? [] : coverageGrants(manifest, category);
      lines.push(
        grants.length === 0
          ? 'statically covered'
          : `statically covered by ${grants.map((grant) => `\`${grantTokenText(category, grant)}\``).join(', ')}`,
      );
    } else {
      lines.push('not a registered effectful name');
    }
    return { value: lines.join('\n'), range: rangeOf(analysis, [bang.span[0], targetEnd]) };
  }
  return null;
}

function capabilityTokenHover(analysis: Analysis, offset: number): HoverInfo | null {
  const program = analysis.core.program;
  if (program === null || analysis.capabilities === null) return null;
  for (const needs of collectNodes<NeedsDecl>(program, 'NeedsDecl')) {
    for (const token of needs.tokens) {
      if (offset < token.span[0] || offset > token.span[1]) continue;
      const doc = CAPABILITY_DOCS[token.kind] ?? 'Capability token.';
      const usage = isTokenUsed(program, token) ? 'used by a literal bang call in this file' : 'not used by any literal bang call';
      const lines = [doc, usage];
      if (token.kind === 'OnlyCapability') {
        const fn = analysis.capabilities.fns.find((candidate) => candidate.needs === needs);
        if (fn !== undefined) {
          const parent = parentManifestOf(analysis.capabilities, fn);
          const parentTokens = parent === null ? [] : manifestTokenTexts(parent);
          if (parentTokens.length > 0) lines.push(`parent grants: ${parentTokens.map((text) => `\`${text}\``).join(', ')}`);
        }
      }
      return { value: lines.join('\n\n'), range: rangeOf(analysis, token.span) };
    }
  }
  return null;
}

/** Recovered parses have no binder; hover the declarations the AST still holds. */
function recoveredHover(analysis: Analysis, offset: number): HoverInfo | null {
  const program = analysis.core.program;
  if (program === null) return null;
  const source = analysis.document.getText();
  for (const statement of program.body) {
    if (statement.kind === 'LetStmt') {
      const span = nameSpanIn(source, statement.span[0], statement.id);
      if (offset < span[0] || offset >= span[1]) continue;
      const type = describeType(inferType(statement.init, () => undefined));
      return {
        value: `**let** \`${statement.id}\`: \`${type}\`\n\n\`\`\`placitum\n${lineText(analysis, statement.span[0])}\n\`\`\``,
        range: rangeOf(analysis, span),
      };
    }
    if (statement.kind === 'FnDecl') {
      const span = nameSpanIn(source, statement.span[0], statement.id);
      if (offset < span[0] || offset >= span[1]) continue;
      const params = statement.params.map((param) => param.id).join(', ');
      return {
        value: `**fn** \`${statement.id}\` — \`fn ${statement.id}(${params})\`\n\n\`\`\`placitum\n${lineText(analysis, statement.span[0])}\n\`\`\``,
        range: rangeOf(analysis, span),
      };
    }
  }
  return null;
}

export function hoverAt(analysis: Analysis, offset: number): HoverInfo | null {
  const binder = analysis.binder;
  if (binder !== null) {
    const hit = bindingAt(binder, offset);
    if (hit !== null) return bindingHover(analysis, hit);
  } else {
    const recovered = recoveredHover(analysis, offset);
    if (recovered !== null) return recovered;
  }
  const capability = capabilityTokenHover(analysis, offset);
  if (capability !== null) return capability;
  const bang = bangHover(analysis, offset);
  if (bang !== null) return bang;
  const member = memberHover(analysis, offset);
  if (member !== null) return member;
  const token = tokenAt(analysis, offset);
  if (token !== null) {
    const keyword = KEYWORD_DOCS[token.kind];
    if (keyword !== undefined) return { value: keyword, range: rangeOf(analysis, token.span) };
    if (token.kind === 'PRAGMA') {
      return { value: '`#!strict` enables the strict pipe-chain type pre-pass (`E505`).', range: rangeOf(analysis, token.span) };
    }
  }
  return null;
}
