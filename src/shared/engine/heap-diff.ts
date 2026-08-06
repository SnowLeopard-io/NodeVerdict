import type { HeapSnapshot, HeapNode } from '../types';

export interface HeapDiffNode {
  name: string;
  type: string;
  beforeCount: number;
  afterCount: number;
  countDelta: number;
  beforeSize: number;
  afterSize: number;
  sizeDelta: number;
}

export interface HeapDiffResult {
  snapshotA: HeapSnapshot;
  snapshotB: HeapSnapshot;
  nodes: HeapDiffNode[];
  totalSizeBefore: number;
  totalSizeAfter: number;
  totalSizeDelta: number;
  totalCountBefore: number;
  totalCountAfter: number;
  totalCountDelta: number;
  newNodes: HeapDiffNode[];
  growingNodes: HeapDiffNode[];
  removedNodes: HeapDiffNode[];
}

/** Compare two heap snapshots and produce a diff */
export function diffHeapSnapshots(
  snapshotA: HeapSnapshot,
  snapshotB: HeapSnapshot,
): HeapDiffResult {
  // Group nodes by name+type
  function groupNodes(snapshot: HeapSnapshot): Map<string, { count: number; size: number }> {
    const map = new Map<string, { count: number; size: number }>();
    for (const node of snapshot.nodes) {
      const key = `${node.name}::${node.type}`;
      const existing = map.get(key) ?? { count: 0, size: 0 };
      existing.count++;
      existing.size += node.retainedSize;
      map.set(key, existing);
    }
    return map;
  }

  const groupA = groupNodes(snapshotA);
  const groupB = groupNodes(snapshotB);

  const allKeys = new Set([...groupA.keys(), ...groupB.keys()]);
  const nodes: HeapDiffNode[] = [];

  for (const key of allKeys) {
    const [name, type] = key.split('::');
    const a = groupA.get(key) ?? { count: 0, size: 0 };
    const b = groupB.get(key) ?? { count: 0, size: 0 };

    nodes.push({
      name,
      type,
      beforeCount: a.count,
      afterCount: b.count,
      countDelta: b.count - a.count,
      beforeSize: a.size,
      afterSize: b.size,
      sizeDelta: b.size - a.size,
    });
  }

  // Sort by absolute size delta descending
  nodes.sort((a, b) => Math.abs(b.sizeDelta) - Math.abs(a.sizeDelta));

  // Use retained size for both the summary totals and the per-group rows so the
  // sizes are on the same basis. Using snapshot.totalSize (sum of self size)
  // here while grouping by retainedSize would mix on-heap self sizes with
  // retained (subtree) sizes, making the "before/after/delta" cards disagree
  // with the type-comparison table.
  const totalSizeBefore = snapshotA.totalRetainedSize;
  const totalSizeAfter = snapshotB.totalRetainedSize;
  const totalCountBefore = snapshotA.nodeCount;
  const totalCountAfter = snapshotB.nodeCount;

  return {
    snapshotA,
    snapshotB,
    nodes,
    totalSizeBefore,
    totalSizeAfter,
    totalSizeDelta: totalSizeAfter - totalSizeBefore,
    totalCountBefore,
    totalCountAfter,
    totalCountDelta: totalCountAfter - totalCountBefore,
    newNodes: nodes.filter(n => n.beforeCount === 0 && n.afterCount > 0),
    growingNodes: nodes.filter(n => n.countDelta > 0 && n.beforeCount > 0).sort((a, b) => b.sizeDelta - a.sizeDelta),
    removedNodes: nodes.filter(n => n.afterCount === 0 && n.beforeCount > 0),
  };
}