import type { CpuProfileAnalysis, CpuProfileDiff, CpuProfileDiffEntry, HotFunction } from '../types';

/**
 * Differential CPU profiling: commit A vs commit B.
 *
 * Answers "why did this release get slower?". Each function is compared by its
 * self/time totals; added/removed/grown/shrunk functions are surfaced with a
 * relative change so a 5% function that grew to 40% ranks above noise.
 *
 * Pure function over two already-parsed analyses, so it is unit-testable and
 * cheap enough to run on the main thread (the expensive parse happens in the
 * worker).
 */

function keyOf(fn: HotFunction): string {
  return `${fn.functionName}@${fn.url ?? ''}:${fn.line ?? 0}`;
}

function meanSafe(a: number, b: number): number {
  return Math.max(a, b, 0.001);
}

export function diffCpuProfiles(before: CpuProfileAnalysis, after: CpuProfileAnalysis): CpuProfileDiff {
  const beforeByKey = new Map<string, HotFunction>();
  for (const fn of before.hotFunctions) beforeByKey.set(keyOf(fn), fn);
  const afterByKey = new Map<string, HotFunction>();
  for (const fn of after.hotFunctions) afterByKey.set(keyOf(fn), fn);

  const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  const entries: CpuProfileDiffEntry[] = [];

  for (const key of keys) {
    const b = beforeByKey.get(key);
    const a = afterByKey.get(key);
    const beforeTotal = b?.totalTime ?? 0;
    const afterTotal = a?.totalTime ?? 0;
    const denominator = Math.max(beforeTotal, afterTotal);
    let kind: CpuProfileDiffEntry['kind'];
    if (afterTotal > 0 && beforeTotal === 0) {
      kind = 'added';
    } else if (beforeTotal > 0 && afterTotal === 0) {
      kind = 'removed';
    } else if (afterTotal > beforeTotal) {
      kind = 'grown';
    } else if (afterTotal < beforeTotal) {
      kind = 'shrunk';
    } else {
      kind = 'unchanged';
    }

    const reference = (b ?? a)!;
    const entry: CpuProfileDiffEntry = {
      key,
      functionName: reference.functionName,
      url: reference.url ?? '',
      line: reference.line ?? 0,
      beforeSelfTime: b?.selfTime ?? 0,
      afterSelfTime: a?.selfTime ?? 0,
      beforeTotalTime: beforeTotal,
      afterTotalTime: afterTotal,
      totalDelta: afterTotal - beforeTotal,
      // Percentage of the larger of the two samples; keeps noise near zero flat
      // and makes genuinely-moved costs stand out regardless of denominator.
      changePct: denominator > 0 ? ((afterTotal - beforeTotal) / denominator) * 100 : 0,
      kind,
    };
    entries.push(entry);
  }

  // Only meaningful changes (skip exact-equal zero rows) and sort by magnitude.
  const active = entries
    .filter(e => e.beforeTotalTime > 0 || e.afterTotalTime > 0)
    .sort((x, y) => Math.abs(y.totalDelta) - Math.abs(x.totalDelta));

  return {
    entries: active,
    totalBeforeMs: before.totalTime,
    totalAfterMs: after.totalTime,
    totalDeltaMs: after.totalTime - before.totalTime,
    grownCount: active.filter(e => e.kind === 'grown').length,
    shrunkCount: active.filter(e => e.kind === 'shrunk').length,
    addedCount: active.filter(e => e.kind === 'added').length,
    removedCount: active.filter(e => e.kind === 'removed').length,
  };
}

export function summarizeCpuDiff(diff: CpuProfileDiff): string {
  const pct = Math.abs(diff.totalBeforeMs) > 0
    ? ((diff.totalDeltaMs / meanSafe(Math.abs(diff.totalBeforeMs), 1)) * 100)
    : 0;
  return `${diff.totalDeltaMs >= 0 ? '+' : ''}${diff.totalDeltaMs.toFixed(1)}ms (${pct.toFixed(1)}%) across ${diff.entries.length} functions · ${diff.grownCount} grew, ${diff.addedCount} appeared, ${diff.removedCount} gone.`;
}