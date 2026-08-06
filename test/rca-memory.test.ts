import { describe, it, expect, beforeEach } from 'vitest';
import type { TracingEvent } from '../src/shared/types';
import {
  fingerprintTrace,
  vectorize,
  cosineSimilarity,
  recallSimilarFrom,
  recallSimilarTrace,
  appendRcaHistory,
  loadRcaHistory,
  clearRcaHistory,
} from '../src/shared/ai/rca-memory';
import type { RcaHistoryEntry } from '../src/shared/ai/rca-memory';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
});

function event(channel: string, op: string): TracingEvent {
  return { channel, eventType: 'end', context: {}, timestamp: 0, operationId: op };
}

const rec = (id: string, title: string, features: string[]): RcaHistoryEntry =>
  ({ id, ts: 1, lang: 'en', title, report: `# ${title}`, features });

describe('rca-memory vector clustering', () => {
  it('fingerprints channels and op ids', () => {
    const f = fingerprintTrace([event('mysql2:query', 'a'), event('http:req', 'b')]);
    expect(f).toContain('ch:mysql2:query');
    expect(f).toContain('op:a');
  });

  it('cosine similarity is higher for overlapping tokens', () => {
    const a = vectorize(['ch:mysql', 'op:a']);
    const b = vectorize(['ch:mysql', 'op:b']);
    const c = vectorize(['ch:redis', 'op:c']);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });

  it('recalls the most similar past incident first', () => {
    const history = [
      rec('1', 'mysql', ['ch:mysql:query', 'op:find']),
      rec('2', 'redis', ['ch:redis:command', 'op:get']),
    ];
    const similar = recallSimilarFrom(history, ['ch:mysql:query']);
    expect(similar[0].record.id).toBe('1');
    expect(similar[0].score).toBeGreaterThan(0);
    expect(similar).toHaveLength(1); // redis has no overlap
  });

  it('returns empty when no historical overlap', () => {
    expect(recallSimilarFrom([rec('x', 'a', ['kafka'])], ['mysql'])).toHaveLength(0);
  });

  it('persists and dedupes by id via localStorage', () => {
    appendRcaHistory(rec('1', 'a', ['mysql']));
    appendRcaHistory(rec('2', 'b', ['redis']));
    appendRcaHistory(rec('1', 'a-updated', ['mysql'])); // dedupe
    const all = loadRcaHistory();
    expect(all).toHaveLength(2);
  });

  it('recallSimilarTrace uses storage memory', () => {
    appendRcaHistory(rec('1', 'mysql', ['ch:mysql:query']));
    const hits = recallSimilarTrace([event('mysql:query', 'x')]);
    expect(hits.length).toBeGreaterThan(0);
    clearRcaHistory();
    expect(loadRcaHistory()).toHaveLength(0);
  });
});