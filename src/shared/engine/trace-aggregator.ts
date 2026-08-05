import type { TracingEvent, TraceSpan, DependencyLink, PairedOperation } from '../types';
import { buildCausalGraph } from './causal-rebuilder';
import type { CausalEdge, CausalGraph } from './causal-types';

/**
 * Build a waterfall tree from paired operations.
 *
 * Parent-child relationships are derived from the **causal graph** (Deep-water 1)
 * so there is a single source of truth for topology: the DAG edges. The causal
 * rebuild is strictly richer than the old containment scan — it also recovers
 * explicit-parent, async-context and gap-healed links, with a confidence label
 * on every edge. See `causalGraphToSpans` for the mapping rules.
 *
 * Backward compatible: callers that pass `(operations, events)` get the same
 * `TraceSpan[]` shape; `operations` is still used to attach error payloads.
 */
export function buildWaterfall(operations: PairedOperation[], events: TracingEvent[], graph?: CausalGraph): TraceSpan[] {
  const g = graph ?? buildCausalGraph(events);
  return causalGraphToSpans(g, operations);
}

/**
 * Map a causal DAG to a waterfall `TraceSpan[]` tree.
 *
 * - A node is a root iff it is a non-virtual node in `graph.rootIds`.
 * - Children of a node are its non-virtual successors (DAG edges), ordered by
 *   start time.
 * - Virtual (gap-healed) nodes are placeholders and never emitted as spans;
 *   their concrete consumers become roots instead.
 * - The `operations` list is optional and only used to attach real error
 *   payloads (status 'error' → `metadata.error`) when available.
 * - Every span carries `edgeKind` / `edgeConfidence` from the causal edge that
 *   linked it to its parent — this is what lets the UI show "why" a child sits
 *   under its parent.
 */
export function causalGraphToSpans(graph: CausalGraph, operations?: PairedOperation[]): TraceSpan[] {
  const opsById = new Map<string, PairedOperation>();
  for (const op of operations ?? []) opsById.set(op.operationId, op);

  // Attach error payloads from operations where available.
  const opError = new Map<string, unknown>();
  for (const op of operations ?? []) {
    if (op.status === 'error' && op.error?.error) opError.set(op.operationId, op.error.error);
  }

  // childrenByParent from DAG edges (skip virtual targets; skip self-loops).
  const childrenByParent = new Map<string, string[]>();
  const childEdge = new Map<string, CausalEdge>();
  for (const edge of graph.edges) {
    if (edge.childId === edge.parentId) continue;
    if (!childrenByParent.has(edge.parentId)) childrenByParent.set(edge.parentId, []);
    childrenByParent.get(edge.parentId)!.push(edge.childId);
    if (!childEdge.has(edge.childId)) childEdge.set(edge.childId, edge);
  }

  const byId = new Map<string, CausalNodeLike>();
  for (const n of graph.nodes) {
    if (n.virtual) continue;
    byId.set(n.id, n);
  }

  // Break causal cycles before building the tree: if both a node and its parent
  // lie on the same detected cycle, the cycle edge must not create a tree loop
  // (it would either drop the node entirely or recurse forever). The node is
  // demoted to a root instead; its real operation is still rendered.
  const cyclicIds = new Set(graph.nodes.filter((n) => n.cyclic).map((n) => n.id));

  const buildSpan = (id: string): TraceSpan | undefined => {
    const node = byId.get(id);
    if (!node) return undefined;
    const edge = childEdge.get(id);
    let parentId = edge ? edge.parentId : undefined;
    if (parentId !== undefined && cyclicIds.has(id) && cyclicIds.has(parentId)) {
      parentId = undefined; // cycle edge — demote to root so nothing is dropped
    }
    const op = opsById.get(id);
    const metadata: Record<string, unknown> = { ...node.metadata };
    const opErr = opError.get(id);
    if (opErr !== undefined) metadata.error = opErr;
    return {
      id,
      operationId: node.opId ?? id,
      channel: node.channel ?? 'unknown',
      label: node.channel ?? 'unknown',
      startTime: node.startTime,
      endTime: node.endTime ?? node.startTime,
      duration: node.duration ?? 0,
      depth: 0,
      parentId,
      children: [],
      status: node.status === 'virtual' ? 'incomplete' : node.status,
      metadata,
      edgeKind: edge?.kind,
      edgeConfidence: edge?.confidence,
    };
  };

  // Materialize spans, then attach children via DAG edges.
  const spanById = new Map<string, TraceSpan>();
  for (const id of byId.keys()) {
    const span = buildSpan(id);
    if (span) spanById.set(id, span);
  }
  const hasParent = new Set<string>();
  for (const span of spanById.values()) {
    if (!span.parentId) continue;
    const parent = spanById.get(span.parentId);
    if (parent) {
      parent.children.push(span);
      hasParent.add(span.id);
    } else {
      // Parent is virtual or missing → this span is effectively a root.
      span.parentId = undefined;
    }
  }

  // Order children by start time, assign depths, return roots.
  const roots: TraceSpan[] = [];
  const assignDepth = (span: TraceSpan, depth: number): void => {
    span.depth = depth;
    span.children.sort((a, b) => a.startTime - b.startTime);
    for (const c of span.children) assignDepth(c, depth + 1);
  };
  for (const span of spanById.values()) {
    if (!hasParent.has(span.id)) {
      assignDepth(span, 0);
      roots.push(span);
    }
  }
  roots.sort((a, b) => a.startTime - b.startTime);
  return roots;
}

/** Lightweight structural view of a causal node used internally above. */
interface CausalNodeLike {
  id: string;
  channel?: string;
  opId?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'success' | 'error' | 'incomplete' | 'virtual';
  metadata: Record<string, unknown>;
}

/**
 * Build dependency links between operations (O(n log n) sweep-line algorithm).
 *
 * Parent-child links come from the **causal graph** (single source of topology),
 * derived from the DAG edges; sequential links remain a temporal heuristic
 * (gap of 0–5ms between adjacent ops), which the causal graph intentionally does
 * not model. When `graph` is omitted, the graph is rebuilt from `events` for
 * backward compatibility.
 */
export function buildDependencies(operations: PairedOperation[], graph?: CausalGraph): DependencyLink[] {
  const links: DependencyLink[] = [];
  if (operations.length === 0) return links;

  // Parent-child links from the causal DAG edges (skip virtual targets).
  if (graph) {
    const virtualIds = new Set(graph.nodes.filter((n) => n.virtual).map((n) => n.id));
    for (const edge of graph.edges) {
      if (edge.childId === edge.parentId) continue;
      if (virtualIds.has(edge.parentId)) continue; // virtual placeholders are not real ops
      links.push({ source: edge.parentId, target: edge.childId, type: 'parent-child' });
    }
  } else {
    // Backward-compatible fallback: containment sweep.
    const sorted = [...operations].sort((a, b) => a.start.timestamp - b.start.timestamp);
    const active: { op: PairedOperation; endTime: number }[] = [];
    for (const op of sorted) {
      const opEnd = op.end?.timestamp ?? Infinity;
      while (active.length > 0 && active[active.length - 1].endTime < op.start.timestamp) {
        active.pop();
      }
      if (active.length > 0) {
        links.push({
          source: active[active.length - 1].op.operationId,
          target: op.operationId,
          type: 'parent-child',
        });
      }
      active.push({ op, endTime: opEnd });
    }
  }

  // Sequential detection: only adjacent in sorted order.
  const sorted = [...operations].sort((a, b) => a.start.timestamp - b.start.timestamp);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevEnd = prev.end?.timestamp ?? prev.start.timestamp;
    const gap = curr.start.timestamp - prevEnd;

    // Gap of 0-5ms suggests sequential dependency
    if (gap >= 0 && gap <= 5) {
      links.push({
        source: prev.operationId,
        target: curr.operationId,
        type: 'sequential',
      });
    }
  }

  return links;
}

/** Identify bottleneck nodes in the trace */
export function findBottlenecks(spans: TraceSpan[], thresholdPercentile = 95): TraceSpan[] {
  const durations = spans.map(s => s.duration).sort((a, b) => a - b);
  const threshold = durations.length
    ? durations[Math.ceil((thresholdPercentile / 100) * durations.length) - 1]
    : 0;

  return spans.filter(s => s.duration >= threshold && s.duration > 0);
}