import { describe, it, expect } from 'vitest';
import { buildWaterfall, buildDependencies, buildCausalGraph, causalGraphToSpans, hasCycle } from '../src/shared/engine';
import { analyzeTracingEvents } from '../src/shared/engine/tracing-parser';
import type { TracingEvent } from '../src/shared/types';

function ev(
  channel: string,
  eventType: TracingEvent['eventType'],
  timestamp: number,
  operationId: string,
  context: Record<string, unknown> = {},
  extra: Partial<TracingEvent> = {},
): TracingEvent {
  return { channel, eventType, context, timestamp, operationId, ...extra };
}

describe('audit: cyclic traces through the unified IR', () => {
  it('does not lose cyclic nodes when building the waterfall', () => {
    // A and B declare each other as parents → the causal graph detects a cycle.
    const events: TracingEvent[] = [
      ev('a:op', 'start', 0, 'A', { parentOperationId: 'B' }),
      ev('a:op', 'end', 10, 'A', { parentOperationId: 'B' }),
      ev('b:op', 'start', 5, 'B', { parentOperationId: 'A' }),
      ev('b:op', 'end', 15, 'B', { parentOperationId: 'A' }),
    ];
    const graph = buildCausalGraph(events);
    expect(hasCycle(graph)).toBe(true);

    const analysis = analyzeTracingEvents(events);
    const spans = buildWaterfall(analysis.operations, analysis.events);

    // Every concrete operation must still appear in the waterfall.
    const all = spans.flatMap(s => [s, ...s.children]);
    const ids = all.map(s => s.id);
    expect(ids).toContain('A');
    expect(ids).toContain('B');
    // And building it must not blow the stack or throw.
    expect(spans.length).toBeGreaterThan(0);
  });

  it('emits parent-child links even when the graph has a cycle', () => {
    const events: TracingEvent[] = [
      ev('a:op', 'start', 0, 'A', { parentOperationId: 'B' }),
      ev('a:op', 'end', 10, 'A', { parentOperationId: 'B' }),
      ev('b:op', 'start', 5, 'B', { parentOperationId: 'A' }),
      ev('b:op', 'end', 15, 'B', { parentOperationId: 'A' }),
    ];
    const graph = buildCausalGraph(events);
    const analysis = analyzeTracingEvents(events);
    const links = buildDependencies(analysis.operations, graph);
    // Cyclic nodes are still linked (they are real ops), and building never throws.
    expect(links.filter(l => l.type === 'parent-child').length).toBeGreaterThan(0);
    expect(links.some(l => l.target === 'A')).toBe(true);
    expect(links.some(l => l.target === 'B')).toBe(true);
  });
});
