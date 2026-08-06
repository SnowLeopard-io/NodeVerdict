import { describe, it, expect } from 'vitest';
import { diffCpuProfiles, summarizeCpuDiff } from '../src/shared/engine/cpu-profile-diff';
import type { CpuProfileAnalysis, HotFunction } from '../src/shared/types';

function analysis(totalTime: number, hot: HotFunction[]): CpuProfileAnalysis {
  return {
    profile: { nodes: [], startTime: 0, endTime: totalTime, samples: [], timeDeltas: [] },
    flameTree: { name: 'root', url: '', line: 0, col: 0, value: totalTime, children: [], nodeId: 0, depth: 0 },
    hotFunctions: hot,
    totalTime,
    sampleCount: 0,
    topFunctions: [],
  };
}

function fn(name: string, url: string, line: number, totalTime: number, selfTime: number): HotFunction {
  return { functionName: name, url, selfTime, totalTime, selfPercent: 0, totalPercent: 0, hitCount: 1, line };
}

describe('diffCpuProfiles', () => {
  it('flags grown / shrunk / added / removed functions', () => {
    const before = analysis(100, [fn('fnA', 'a.js', 1, 40, 10), fn('fnB', 'b.js', 2, 30, 5)]);
    const after = analysis(130, [fn('fnA', 'a.js', 1, 70, 20), fn('fnB', 'b.js', 2, 10, 5), fn('fnC', 'c.js', 3, 30, 30)]);

    const diff = diffCpuProfiles(before, after);

    expect(diff.grownCount).toBe(1);
    expect(diff.addedCount).toBe(1);
    expect(diff.shrunkCount).toBe(1);
    expect(diff.totalDeltaMs).toBe(30);

    const grown = diff.entries.find(e => e.functionName === 'fnA');
    expect(grown?.kind).toBe('grown');
    expect(grown?.totalDelta).toBe(30);
    expect(grown?.changePct).toBeGreaterThan(0);
  });

  it('distinguishes function location via url:line key', () => {
    const before = analysis(10, [fn('foo', 'x.js', 1, 5, 5)]);
    const after = analysis(10, [fn('foo', 'x.js', 2, 5, 5)]); // different line
    const { entries } = diffCpuProfiles(before, after);
    // Same name, different line -> treated as removed + added, not grown/shrunk.
    expect(entries.find(e => e.kind === 'removed' && e.functionName === 'foo')).toBeTruthy();
    expect(entries.find(e => e.kind === 'added' && e.functionName === 'foo')).toBeTruthy();
  });

  it('keeps meaningful entries only', () => {
    const before = analysis(5, []);
    const after = analysis(5, []);
    const { entries } = diffCpuProfiles(before, after);
    expect(entries).toHaveLength(0);
  });
});

describe('summarizeCpuDiff', () => {
  it('produces a compact summary', () => {
    const before = analysis(100, [fn('a', 'a.js', 1, 50, 50)]);
    const after = analysis(150, [fn('a', 'a.js', 1, 120, 120)]);
    const diff = diffCpuProfiles(before, after);
    expect(summarizeCpuDiff(diff)).toMatch(/\+?50\.0ms/);
  });
});