import type { ReportData } from '../types';
import type { ChannelStats } from '../types';

/**
 * Report version diffing.
 * Compares two generated reports (baseline vs. current) and produces a compact
 * list of changes: per-channel metric deltas, new/vanished findings, and heap
 * deltas. Pure functions so they are testable in isolation.
 */

export type ChannelDelta = {
  channel: string;
  before: ChannelStats | null;
  after: ChannelStats | null;
  avgDelta: number | null;
  p95Delta: number | null;
  p99Delta: number | null;
  errorDelta: number | null;
  status: 'added' | 'removed' | 'grown' | 'shrunk' | 'unchanged' | 'regressed';
};

export interface ReportDiff {
  before: { generatedAt: number | null; keyFindings: string[] };
  after: { generatedAt: number | null; keyFindings: string[] };
  channels: ChannelDelta[];
  keyFindingsAdded: string[];
  keyFindingsRemoved: string[];
  heap: {
    beforeSizeMb: number | null;
    afterSizeMb: number | null;
    sizeDeltaMb: number | null;
    leakBefore: number | null;
    leakAfter: number | null;
    leakDelta: number | null;
  };
  errorRate: { before: number | null; after: number | null; delta: number | null };
  totalEvents: { before: number | null; after: number | null; delta: number | null };
}

function statusFor(delta: number | null, errorDelta: number | null): ChannelDelta['status'] {
  if (delta === null) return 'unchanged';
  if (delta > 10) return 'grown';
  if (delta < -10) return 'shrunk';
  if (errorDelta !== null && errorDelta > 0.5) return 'regressed';
  return 'unchanged';
}

export function diffReports(before: ReportData | null, after: ReportData | null): ReportDiff {
  const beforeChannels = new Map((before?.eventSummary?.channels ?? []).map(c => [c.channel, c]));
  const afterChannels = new Map((after?.eventSummary?.channels ?? []).map(c => [c.channel, c]));

  const channelKeys = new Set([...beforeChannels.keys(), ...afterChannels.keys()]);
  const channels: ChannelDelta[] = [];
  for (const channel of channelKeys) {
    const b = beforeChannels.get(channel) ?? null;
    const a = afterChannels.get(channel) ?? null;
    if (!b || !a) {
      channels.push({
        channel,
        before: b,
        after: a,
        avgDelta: null,
        p95Delta: null,
        p99Delta: null,
        errorDelta: null,
        status: b ? 'removed' : 'added',
      });
      continue;
    }
    const avgDelta = a.avgDuration - b.avgDuration;
    const p95Delta = a.p95Duration - b.p95Duration;
    const p99Delta = a.p99Duration - b.p99Duration;
    const errorDelta = a.errorCount - b.errorCount;
    channels.push({
      channel,
      before: b,
      after: a,
      avgDelta,
      p95Delta,
      p99Delta,
      errorDelta,
      status: statusFor(avgDelta, errorDelta),
    });
  }

  const beforeSet = new Set(before?.keyFindings ?? []);
  const afterSet = new Set(after?.keyFindings ?? []);
  const keyFindingsAdded = (after?.keyFindings ?? []).filter(f => !beforeSet.has(f));
  const keyFindingsRemoved = (before?.keyFindings ?? []).filter(f => !afterSet.has(f));

  const beforeHeapMb = before?.heapAnalysis?.totalSize != null ? before.heapAnalysis.totalSize / 1024 / 1024 : null;
  const afterHeapMb = after?.heapAnalysis?.totalSize != null ? after.heapAnalysis.totalSize / 1024 / 1024 : null;

  const beforeError = before?.eventSummary?.errorRate ?? null;
  const afterError = after?.eventSummary?.errorRate ?? null;
  const beforeEvents = before?.eventSummary?.totalEvents ?? null;
  const afterEvents = after?.eventSummary?.totalEvents ?? null;

  return {
    before: { generatedAt: before?.generatedAt ?? null, keyFindings: before?.keyFindings ?? [] },
    after: { generatedAt: after?.generatedAt ?? null, keyFindings: after?.keyFindings ?? [] },
    channels,
    keyFindingsAdded,
    keyFindingsRemoved,
    heap: {
      beforeSizeMb: beforeHeapMb,
      afterSizeMb: afterHeapMb,
      sizeDeltaMb: beforeHeapMb != null && afterHeapMb != null ? afterHeapMb - beforeHeapMb : null,
      leakBefore: before?.heapAnalysis?.leakCount ?? null,
      leakAfter: after?.heapAnalysis?.leakCount ?? null,
      leakDelta: before?.heapAnalysis?.leakCount != null && after?.heapAnalysis?.leakCount != null
        ? after.heapAnalysis.leakCount - before.heapAnalysis.leakCount
        : null,
    },
    errorRate: {
      before: beforeError,
      after: afterError,
      delta: beforeError != null && afterError != null ? afterError - beforeError : null,
    },
    totalEvents: {
      before: beforeEvents,
      after: afterEvents,
      delta: beforeEvents != null && afterEvents != null ? afterEvents - beforeEvents : null,
    },
  };
}

/** Render the diff as human-readable markdown for inline display or copy. */
export function renderDiffMarkdown(diff: ReportDiff, lang: 'en' | 'zh'): string {
  const lines: string[] = [];
  lines.push(lang === 'zh' ? '## 报告对比' : '## Report Diff');
  lines.push('');

  const evBefore = diff.totalEvents.before ?? 0;
  const evAfter = diff.totalEvents.after ?? 0;
  const evDelta = diff.totalEvents.delta ?? evAfter - evBefore;
  lines.push(lang === 'zh'
    ? `- 事件量：${evBefore} → ${evAfter}（${evDelta >= 0 ? '+' : ''}${evDelta}）`
    : `- Events: ${evBefore} → ${evAfter} (${evDelta >= 0 ? '+' : ''}${evDelta})`);

  const errBefore = diff.errorRate.before ?? 0;
  const errAfter = diff.errorRate.after ?? 0;
  const errDelta = diff.errorRate.delta ?? errAfter - errBefore;
  lines.push(lang === 'zh'
    ? `- 错误率：${errBefore.toFixed(1)}% → ${errAfter.toFixed(1)}%（${errDelta >= 0 ? '+' : ''}${errDelta.toFixed(1)}pp）`
    : `- Error rate: ${errBefore.toFixed(1)}% → ${errAfter.toFixed(1)}% (${errDelta >= 0 ? '+' : ''}${errDelta.toFixed(1)}pp)`);

  if (diff.heap.sizeDeltaMb != null) {
    lines.push(lang === 'zh'
      ? `- Heap：${diff.heap.beforeSizeMb?.toFixed(1)}MB → ${diff.heap.afterSizeMb?.toFixed(1)}MB（${diff.heap.sizeDeltaMb >= 0 ? '+' : ''}${diff.heap.sizeDeltaMb.toFixed(1)}MB）`
      : `- Heap: ${diff.heap.beforeSizeMb?.toFixed(1)}MB → ${diff.heap.afterSizeMb?.toFixed(1)}MB (${diff.heap.sizeDeltaMb >= 0 ? '+' : ''}${diff.heap.sizeDeltaMb.toFixed(1)}MB)`);
  }

  lines.push('');
  lines.push(lang === 'zh' ? '### 关键指标变化' : '### Channel metric changes');
  lines.push(lang === 'zh' ? '| channel | avg(ms) | p95(ms) | p99(ms) | errors | 状态 |' : '| channel | avg(ms) | p95(ms) | p99(ms) | errors | status |');
  lines.push('|---|---|---|---|---|---|');
  for (const c of diff.channels) {
    if (c.status === 'unchanged') continue;
    const fmt = (v: number | null) => (v == null ? '-' : (v >= 0 ? '+' : '') + v.toFixed(1));
    const statusLabel: Record<ChannelDelta['status'], string> = {
      added: lang === 'zh' ? '新增' : 'added',
      removed: lang === 'zh' ? '消失' : 'removed',
      grown: lang === 'zh' ? '变慢' : 'grown',
      shrunk: lang === 'zh' ? '变快' : 'shrunk',
      unchanged: '—',
      regressed: lang === 'zh' ? '错误上升' : 'errors up',
    };
    lines.push(`| ${c.channel} | ${fmt(c.avgDelta)} | ${fmt(c.p95Delta)} | ${fmt(c.p99Delta)} | ${fmt(c.errorDelta)} | ${statusLabel[c.status]} |`);
  }

  if (diff.keyFindingsAdded.length > 0 || diff.keyFindingsRemoved.length > 0) {
    lines.push('');
    lines.push(lang === 'zh' ? '### 结论变化' : '### Findings');
    for (const f of diff.keyFindingsAdded) lines.push(lang === 'zh' ? `- 新增：${f}` : `- added: ${f}`);
    for (const f of diff.keyFindingsRemoved) lines.push(lang === 'zh' ? `- 消失：${f}` : `- removed: ${f}`);
  }

  return lines.join('\n');
}