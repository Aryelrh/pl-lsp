/** Minimal AST traversal: collect every node of a given `kind`, in source order. */
export function collectNodes<T>(root: unknown, kind: string): T[] {
  const out: T[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      if ((value as { kind?: unknown }).kind === kind) out.push(value as T);
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(root);
  return out;
}
