import { describe, it, expect } from 'vitest';
import { attributeSpans, appFramesFromStack } from '../src/shared/source/source-attribution';
import type { TraceSpan, TracingEvent } from '../src/shared/types';

const STACK = [
  'Error: connect ECONNREFUSED',
  '    at query (/app/src/queries/orders.ts:42:15)',
  '    at handler (/app/src/routes/orders.ts:10:5)',
  '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
  '    at node::StreamBase::... (native)',
].join('\n');

function span(channel: string, duration: number, stack?: string, status: TraceSpan['status'] = 'error'): TraceSpan {
  return {
    id: channel + Math.random(),
    operationId: 'op',
    channel,
    label: channel,
    startTime: 0,
    endTime: duration,
    duration,
    depth: 0,
    children: [],
    status,
    metadata: stack ? { error: { message: 'boom', stack } } : {},
  };
}

describe('source-attribution', () => {
  it('parses V8 stacks into app frames, skipping runtime/native', () => {
    const frames = appFramesFromStack(STACK);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ file: '/app/src/queries/orders.ts', functionName: 'query', line: 42 });
    expect(frames.every(f => !f.file.startsWith('node:'))).toBe(true);
  });

  it('attributes spans to the outermost app frame', () => {
    const result = attributeSpans([
      span('mysql:query', 120, STACK),
      span('mysql:query', 80, STACK),
    ]);
    const top = result.sites[0];
    expect(top.functionName).toBe('query');
    expect(top.totalDuration).toBe(200);
    expect(top.count).toBe(2);
    expect(top.errorCount).toBe(2);
    expect(result.appFiles).toBeGreaterThan(0);
  });

  it('works on raw events with error.stack', () => {
    const ev: TracingEvent = {
      channel: 'http:request',
      eventType: 'error',
      timestamp: 0,
      duration: 55,
      error: { message: 'boom', stack: STACK },
      context: {},
    };
    const result = attributeSpans([ev]);
    expect(result.sites[0].file).toBe('/app/src/queries/orders.ts');
    expect(result.sites[0].totalDuration).toBe(55);
  });

  it('returns empty when no stacks present', () => {
    expect(attributeSpans([span('a', 1, undefined, 'success')]).sites).toHaveLength(0);
  });
});