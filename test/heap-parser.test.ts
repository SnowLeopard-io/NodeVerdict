import { it, expect } from 'vitest';
import { parseHeapSnapshot } from '../src/shared/engine';

/** Build a minimal .heapsnapshot JSON string from a node graph. */
function buildRaw(nodes: { id: number; name: string; self: number; to: number[] }[]): string {
  const strings = ['ROOT', ...nodes.slice(1).map(n => n.name), ...nodes.flatMap(n => n.to.map(t => `->${t}`))];
  const NODE_FIELDS = ['type', 'name', 'id', 'self_size', 'edge_count'];
  const EDGE_FIELDS = ['type', 'name_or_index', 'to_node'];
  const stride = NODE_FIELDS.length;
  const nodesRaw: number[] = [];
  const edgesRaw: number[] = [];
  let edgeNameIdx = 4;
  nodes.forEach((nd, i) => {
    nodesRaw.push(0, i, nd.id, nd.self, nd.to.length);
    for (const child of nd.to) {
      edgesRaw.push(2, edgeNameIdx++, child * stride);
    }
  });
  return JSON.stringify({
    snapshot: {
      meta: {
        node_fields: NODE_FIELDS,
        edge_fields: EDGE_FIELDS,
        node_types: [['hidden', 'object']],
        edge_types: [['context', 'element', 'property']],
      },
    },
    nodes: nodesRaw,
    edges: edgesRaw,
    strings,
  });
}

function chain(n: number): { id: number; name: string; self: number; to: number[] }[] {
  const out: { id: number; name: string; self: number; to: number[] }[] = [];
  for (let i = 0; i < n; i++) out.push({ id: i, name: `n${i}`, self: 1, to: i + 1 < n ? [i + 1] : [] });
  return out;
}

it('computes dominator-based retained sizes (shared descendants count once)', () => {
  // 0 -> {1, 2}, 1 -> 3, 2 -> 3  (C is shared between A and B)
  const snapshot = parseHeapSnapshot(buildRaw([
    { id: 0, name: 'ROOT', self: 10, to: [1, 2] },
    { id: 1, name: 'A', self: 5, to: [3] },
    { id: 2, name: 'B', self: 7, to: [3] },
    { id: 3, name: 'C', self: 3, to: [] },
  ]));
  const byId = new Map(snapshot.nodes.map(n => [n.id, n]));
  // C's retained size belongs only to the root, not to A or B.
  expect(byId.get(0)!.retainedSize).toBe(25);
  expect(byId.get(1)!.retainedSize).toBe(5);
  expect(byId.get(2)!.retainedSize).toBe(7);
  expect(byId.get(3)!.retainedSize).toBe(3);
});

it('root retained size equals total self size on a 5000-node chain, quickly', () => {
  const started = Date.now();
  const snapshot = parseHeapSnapshot(buildRaw(chain(5000)));
  expect(Date.now() - started).toBeLessThan(5000);
  expect(snapshot.nodes[0].retainedSize).toBe(5000);
});
