import { describe, it, expect } from 'vitest';
import { flattenRows } from '../src/features/trace-viewer/components/waterfall-utils';
import type { TraceSpan } from '../src/shared/types';

function span(id: string, depth = 0, children: TraceSpan[] = [], channel = id): TraceSpan {
  return {
    id,
    operationId: id,
    channel,
    label: channel,
    startTime: 0,
    endTime: 10,
    duration: 10,
    depth,
    children,
    status: 'success',
    metadata: {},
  };
}

describe('flattenRows', () => {
  it('includes every nested descendant, not just the roots', () => {
    const rows = flattenRows([
      span('root', 0, [span('child', 1, [span('grandchild', 2)])]),
      span('sibling', 0),
    ]);
    expect(rows.map(r => r.id)).toEqual(['root', 'child', 'grandchild', 'sibling']);
    expect(rows).toHaveLength(4);
  });

  it('returns an empty array for empty input', () => {
    expect(flattenRows([])).toEqual([]);
  });
});