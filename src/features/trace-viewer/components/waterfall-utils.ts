import type { TraceSpan } from '../../../shared/types';

/**
 * Depth-first flatten of the nested span tree into an ordered row list for the
 * virtualized waterfall. Kept in a pure module (no React/D3) so it is
 * trivially unit-testable in a Node environment.
 */
export function flattenRows(spans: TraceSpan[]): TraceSpan[] {
  const rows: TraceSpan[] = [];
  const walk = (sp: TraceSpan) => {
    rows.push(sp);
    for (const child of sp.children) walk(child);
  };
  for (const root of spans) walk(root);
  return rows;
}

