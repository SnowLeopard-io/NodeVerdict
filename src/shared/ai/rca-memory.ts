import type { TracingEvent } from '../types';

/**
 * RCA memory: captures past root-cause analyses so a new incident can start from
 * "we saw this exact thing three weeks ago — here's what fixed it".
 *
 * Retrieval is pure + dependency-free: a TF-style token vector per entry and
 * cosine similarity, so it works fully offline (no embedding service). The
 * localStorage wrapper just persists to the browser; the core functions are
 * unit-testable in Node.
 */

export interface RcaHistoryEntry {
  id: string;
  ts: number;
  lang: 'en' | 'zh';
  /** Short human label, e.g. "mysql2 timeout — Aug 3". */
  title: string;
  /** The full generated markdown report. */
  report: string;
  /** Compact feature tokens used for similarity (refined by #rankTokens). */
  features: string[];
}

export interface RcaSimilarity {
  record: RcaHistoryEntry;
  /** 0..1 cosine similarity of TF vectors. */
  score: number;
}

const HISTORY_KEY = 'nodeverdict-rca-history';
const HISTORY_CAP = 100;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
}

/** Extract coarse feature tokens from a raw trace (channels + op names + status). */
export function fingerprintTrace(events: TracingEvent[], limit = 100_000): string[] {
  const tokens = new Set<string>();
  for (const e of events) {
    if (tokens.size > 500) break;
    tokens.add(`ch:${e.channel.toLowerCase()}`);
    tokens.add(`op:${(e.operationId ?? '').toLowerCase()}`);
    if (e.error) tokens.add('has:error');
  }
  return [...tokens].slice(0, 400);
}

/** TF term-frequency vector from tokens. */
export function vectorize(tokens: string[]): Map<string, number> {
  const v = new Map<string, number>();
  for (const t of tokens) v.set(t, (v.get(t) ?? 0) + 1);
  const length = Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1;
  for (const [k, val] of v) v.set(k, val / length);
  return v;
}

export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [k, va] of small) {
    const vb = large.get(k);
    if (vb) dot += va * vb;
  }
  return dot;
}

/** Rank history entries by cosine similarity to a query's feature tokens. */
export function recallSimilarFrom(
  history: RcaHistoryEntry[],
  queryFeatures: string[],
  k = 3,
): RcaSimilarity[] {
  if (history.length === 0 || queryFeatures.length === 0) return [];
  const q = vectorize(queryFeatures);
  return history
    .map(record => ({ record, score: cosineSimilarity(q, vectorize(record.features)) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ── persistence (browser) ──────────────────────────────────────────────────

export function loadRcaHistory(): RcaHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRcaHistory(entries: RcaHistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_CAP)));
  } catch {
    // storage unavailable — ignore
  }
}

export function clearRcaHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}

/** Persist a new entry (capped) and return the updated list. */
export function appendRcaHistory(entry: RcaHistoryEntry): RcaHistoryEntry[] {
  const history = loadRcaHistory();
  const next = [entry, ...history.filter(h => h.id !== entry.id)];
  saveRcaHistory(next);
  return next.slice(0, HISTORY_CAP);
}

/** Most similar past incidents to a trace (offline, browser storage). */
export function recallSimilarTrace(events: TracingEvent[], k = 3): RcaSimilarity[] {
  return recallSimilarFrom(loadRcaHistory(), fingerprintTrace(events), k);
}

/** Historical summary preview with a stable hash used to detect the same incident. */
export function entrySignature(features: string[]): string {
  const sorted = [...new Set(features)].sort().join('|');
  return sorted.length ? String(sorted.length > 16 ? sorted.length : sorted) : 'empty';
}