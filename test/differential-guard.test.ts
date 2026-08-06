import { it, expect } from 'vitest';
import { alignEvents } from '../src/shared/differential';
import type { TracingEvent } from '../src/shared/types';

function gen(n: number, prefix: string, start: number): TracingEvent[] {
  const out: TracingEvent[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      channel: 'http:request',
      eventType: i % 2 === 0 ? 'start' : 'end',
      timestamp: start + i * 10,
      operationId: `${prefix}-${Math.floor(i / 2)}`,
      context: { seq: i },
    });
  }
  return out;
}

it('aligns a normal trace against a much shorter fault trace without blowing up', () => {
  // 100k vs 1k -> the old banded DP would allocate ~(n * 2*diff) cells (~20 GB).
  const normal = gen(100_000, 'n', 0);
  const fault = gen(1_000, 'f', 0);
  const started = Date.now();
  const alignment = alignEvents(normal, fault, { band: 256 });
  const elapsed = Date.now() - started;
  expect(elapsed).toBeLessThan(10_000);
  // Nearly all normal events are deletions (the fault trace is 1/100th the size).
  expect(alignment.pairs.length).toBeGreaterThan(99_000);
  expect(alignment.pairs.filter(p => p.kind === 'delete').length).toBeGreaterThan(98_000);
});
