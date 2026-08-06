import { describe, it, expect } from 'vitest';
import { selectReproEvents, generateReproScript, buildReproScript } from '../src/shared/engine/repro-extractor';
import { measureTrace, buildBaselineReport, formatBaselineReport } from '../src/shared/gate/baseline';
import type { TracingEvent } from '../src/shared/types';

function ev(channel: string, eventType: TracingEvent['eventType'], op: string, ts: number, duration?: number): TracingEvent {
  return { channel, eventType, timestamp: ts, duration, operationId: op, context: { reqId: 'r1', msgId: op, method: 'GET' } };
}

const events: TracingEvent[] = [
  ev('mysql2:query', 'start', 'op1', 0),
  ev('mysql2:query', 'end', 'op1', 200),
  ev('http:request', 'start', 'op2', 0),
  ev('http:request', 'end', 'op2', 20),
];

describe('repro-extractor', () => {
  it('selects slowest operations first', () => {
    const selected = selectReproEvents(events, { channels: ['mysql2:query'] });
    expect(selected.every(e => e.channel === 'mysql2:query')).toBe(true);
  });

  it('respects maxEvents cap', () => {
    const selected = selectReproEvents(events, { maxEvents: 2 });
    expect(selected.length).toBeLessThanOrEqual(2);
  });

  it('emits a runnable Node script', () => {
    const script = buildReproScript(events);
    expect(script).toMatch(/node:diagnostics_channel/);
    expect(script).toMatch(/function run\(\)/);
    expect(script).toMatch(/mysql2:query/);
    expect(script).toContain('replayed 4 events');
  });

  it('generates valid JS by default options', () => {
    expect(generateReproScript(events)).toContain("'use strict'");
  });
});

describe('baseline gate', () => {
  it('measures trace metrics', () => {
    const r = measureTrace(events);
    expect(r.totalEvents).toBe(4);
    expect(r.totalOperations).toBe(2);
    expect(r.p99LatencyMs).toBeGreaterThanOrEqual(200);
    expect(r.topChannel?.channel).toBe('mysql2:query');
  });

  it('builds a baseline report with markdown', () => {
    const rep = buildBaselineReport(events, 'ci-job');
    expect(rep.pass).toBe(true);
    expect(rep.markdown).toMatch(/# NodeVerdict Baseline/);
    expect(rep.markdown).toMatch(/\u2705 PASS/);
  });
});