import { describe, it, expect } from 'vitest';
import { createEmptyPipelineState, ingestOtelBatch, convertOtelBatch, summarizePipelineHealth } from '../src/shared/engine/otel-pipeline';
import { defaultAlertRules } from '../src/shared/engine/alert-engine';

const EPOCH_MS = 1_700_000_000_000;
const nano = (msOffset: number): string => String((EPOCH_MS + msOffset) * 1e6);

function otelSpan(name: string, offset: number, durMs: number, opts: { statusCode?: number; traceId?: string; spanId?: string } = {}) {
  return {
    name,
    startTimeUnixNano: nano(offset),
    endTimeUnixNano: nano(offset + durMs),
    traceId: opts.traceId ?? 't',
    spanId: opts.spanId ?? `s${offset}`,
    status: opts.statusCode ? { code: opts.statusCode } : undefined,
  };
}

describe('otel-pipeline', () => {
  it('converts one OTLP batch document', () => {
    const events = convertOtelBatch(JSON.stringify({ spans: [otelSpan('svc.handle', 0, 50)] }));
    expect(events).toHaveLength(2);
    expect(events[0].channel).toBe('svc.handle');
  });

  it('accumulates events across batches and rebuilds topology', () => {
    const state = createEmptyPipelineState();
    const rules = defaultAlertRules();
    const { next } = ingestOtelBatch(state, JSON.stringify({ spans: [otelSpan('svc.handle', 0, 50)] }), rules);
    expect(next.totalEvents).toBe(2);
    expect(next.batchCount).toBe(1);
    expect(next.topology).not.toBeNull();
    expect(next.topology!.services).toBeGreaterThan(0);

    const { next: next2, added } = ingestOtelBatch(next, JSON.stringify({ spans: [otelSpan('svc.handle', 10, 60)] }), rules);
    expect(added).toBe(2);
    expect(next2.totalEvents).toBe(4);
    expect(next2.batchCount).toBe(2);
  });

  it('evaluates alert rules against accumulated error rate', () => {
    const state = createEmptyPipelineState();
    const rules = defaultAlertRules(); // high-error-rate warning at >5%
    const batch: Record<string, unknown> = { spans: [] };
    for (let i = 0; i < 10; i++) {
      (batch.spans as unknown[]).push(otelSpan('svc.fail', i * 10, 5, { statusCode: 2, spanId: `f${i}` }));
    }
    const { fired } = ingestOtelBatch(state, JSON.stringify(batch), rules);
    // 100% error rate -> at least one fired alert.
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.some(a => a.metric === 'errorRate')).toBe(true);
  });

  it('summarizes topology health', () => {
    expect(summarizePipelineHealth(null)).toEqual({ healthy: 0, warning: 0, faulty: 0 });
  });
});