import { describe, it, expect } from 'vitest';
import { diffReports, renderDiffMarkdown } from '../src/shared/engine/report-diff';
import type { ReportData } from '../src/shared/types';

function report(over: Partial<ReportData>): ReportData {
  return { version: 1, generatedAt: 0, keyFindings: [], ...over };
}

const base: ReportData = report({
  generatedAt: 10,
  keyFindings: ['"db" slow'],
  eventSummary: {
    channels: [
      { channel: 'db', totalOperations: 1, successCount: 1, errorCount: 0, incompleteCount: 0, avgDuration: 50, p50Duration: 50, p95Duration: 60, p99Duration: 70, minDuration: 50, maxDuration: 50 },
    ],
    totalEvents: 100,
    totalOperations: 1,
    errorRate: 0.01,
  },
  heapAnalysis: { totalSize: 20 * 1024 * 1024, topObjects: [], leakCount: 1, leakSuspects: [] },
});

const after: ReportData = report({
  generatedAt: 20,
  keyFindings: ['"db" slow', '"db" has 2 errors'],
  eventSummary: {
    channels: [
      { channel: 'db', totalOperations: 2, successCount: 0, errorCount: 2, incompleteCount: 0, avgDuration: 120, p50Duration: 120, p95Duration: 130, p99Duration: 150, minDuration: 100, maxDuration: 130 },
    ],
    totalEvents: 200,
    totalOperations: 2,
    errorRate: 0.5,
  },
  heapAnalysis: { totalSize: 30 * 1024 * 1024, topObjects: [], leakCount: 2, leakSuspects: [] },
});

describe('diffReports', () => {
  it('computes channel metric deltas', () => {
    const diff = diffReports(base, after);
    const db = diff.channels.find(c => c.channel === 'db')!;
    expect(db.avgDelta).toBe(70);
    expect(db.p95Delta).toBe(70);
    expect(db.errorDelta).toBe(2);
  });

  it('flags added/removed channels', () => {
    const onlyAfter = report({ eventSummary: { channels: [{ channel: 'new', totalOperations: 1, successCount: 1, errorCount: 0, incompleteCount: 0, avgDuration: 5, p50Duration: 5, p95Duration: 5, p99Duration: 5, minDuration: 5, maxDuration: 5 }], totalEvents: 1, totalOperations: 1, errorRate: 0 } });
    const diff = diffReports(null, onlyAfter);
    expect(diff.channels.find(c => c.channel === 'new')?.status).toBe('added');
  });

  it('reports overall metric deltas', () => {
    const diff = diffReports(base, after);
    expect(diff.totalEvents.delta).toBe(100);
    expect(diff.errorRate.delta).toBeCloseTo(0.49, 2);
    expect(diff.heap.sizeDeltaMb).toBeCloseTo(10, 1);
    expect(diff.keyFindingsAdded).toContain('"db" has 2 errors');
  });

  it('survives null base', () => {
    const diff = diffReports(null, base);
    expect(diff.totalEvents.before).toBeNull();
    expect(diff.totalEvents.after).toBe(100);
  });
});

describe('renderDiffMarkdown', () => {
  it('produces markdown with deltas', () => {
    const md = renderDiffMarkdown(diffReports(base, after), 'en');
    expect(md).toMatch(/Report Diff/);
    expect(md).toMatch(/db \| \+70\.0 \| \+70\.0/);
  });
});