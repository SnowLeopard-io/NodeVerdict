import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeDifferential } from '../src/shared/differential';
import { buildDistributedTraces } from '../src/shared/distributed/span-tree';
import { buildTopology } from '../src/shared/distributed/topology';
import { loadTracingData, analyzeTracingEvents, parseGcLog, parseMemoryTimeline, calculateGrowthRate, buildWaterfall } from '../src/shared/engine';
import { diffCpuProfiles } from '../src/shared/engine/cpu-profile-diff';
import { analyzeCpuProfile } from '../src/shared/engine/cpu-profile-parser';
import { attributeSpans } from '../src/shared/source/source-attribution';
import type { TracingEvent } from '../src/shared/types';

describe('differential debug sample pairs', () => {
  const cases: Array<[string, string, string[], number, boolean]> = [
    ['differential-timeout-normal', 'differential-timeout-fault', ['event-missing', 'error-introduced'], 2, true],
    ['differential-pool-normal', 'differential-pool-fault', ['event-missing', 'error-introduced'], 2, true],
    ['differential-cache-normal', 'differential-cache-fault', ['event-missing', 'event-value-change'], 5, false],
  ];

  for (const [normal, fault, kinds, minDivergences, hasError] of cases) {
    it(`analyzes ${normal} vs ${fault}`, () => {
      const n = JSON.parse(readFileSync(`examples/${normal}.json`, 'utf8')) as TracingEvent[];
      const f = JSON.parse(readFileSync(`examples/${fault}.json`, 'utf8')) as TracingEvent[];
      const a = analyzeDifferential(n, f);
      expect(a.divergences.length).toBeGreaterThanOrEqual(minDivergences);
      expect(a.divergences[0].cause.role).toBe('cause');
      const foundKinds = new Set(a.divergences.map(d => d.eventDiff.kind));
      for (const k of kinds) expect(foundKinds.has(k)).toBe(true);
      if (hasError) {
        expect(a.divergences.some(d => d.eventDiff.fault?.error)).toBe(true);
      }
    });
  }
});

describe('otel cascade-failure sample', () => {
  it('flags the payment-gateway as the faulty service', () => {
    const content = readFileSync('examples/otel-cascade-failure.json', 'utf8');
    const events = loadTracingData(content);
    const graph = buildTopology(buildDistributedTraces(events));
    expect(graph.traces).toBe(2);
    expect(graph.nodes).toHaveLength(12);
    const payment = graph.nodes.find(n => n.serviceName === 'payment-gateway')!;
    expect(payment.errorCount).toBe(1);
    expect(payment.health).toBe('faulty');
    expect(graph.nodes.find(n => n.serviceName === 'recommendation')!.health).toBe('warning');
  });
});

describe('gc memory-leak sample', () => {
  it('shows escalating major GCs and unmanaged growth', () => {
    const a = parseGcLog(readFileSync('examples/gc-memory-leak.log', 'utf8'));
    expect(a.totalGcs).toBeGreaterThan(100);
    expect(a.majorGcCount).toBeGreaterThanOrEqual(6);
    expect(a.externalUnmanaged).toBe(true);
    expect(a.avgMajorPauseMs).toBeGreaterThan(a.avgMinorPauseMs);
  });
});

describe('memory timeline leak sample', () => {
  it('flags abnormal growth', () => {
    const timeline = parseMemoryTimeline(readFileSync('examples/memory-timeline-leak.json', 'utf8'));
    const rate = calculateGrowthRate(timeline);
    expect(timeline.snapshots.length).toBeGreaterThan(40);
    expect(rate.flagged).toBe(true);
    expect(rate.rssGrowthRateMs).toBeGreaterThan(2);
  });
});

describe('cpu profile diff sample pair', () => {
  it('shows grown / added / removed hotspots between baseline and regressed profile', () => {
    const before = analyzeCpuProfile(readFileSync('examples/cpu-profile-sample.cpuprofile', 'utf8'));
    const after = analyzeCpuProfile(readFileSync('examples/cpu-profile-diff-after.cpuprofile', 'utf8'));
    const diff = diffCpuProfiles(before, after);

    expect(diff.entries.length).toBeGreaterThan(0);
    expect(diff.grownCount + diff.addedCount).toBeGreaterThan(0);

    const added = diff.entries.find(e => e.functionName === 'queryBuilder' && e.kind === 'added');
    expect(added).toBeTruthy();

    const removed = diff.entries.find(e => e.functionName === 'serialize' && e.kind === 'removed');
    expect(removed).toBeTruthy();
  });
});

describe('source-attribution sample', () => {
  it('attributes error stacks in the sample to app source sites', () => {
    const content = readFileSync('examples/source-attribution.json', 'utf8');
    const events = analyzeTracingEvents(loadTracingData(content));
    const roots = buildWaterfall(events.operations, events.events);
    const flatten = (ss: typeof roots): typeof roots => ss.flatMap(s => [s, ...flatten(s.children)]);
    const spans = flatten(roots);

    const attribution = attributeSpans(spans);
    expect(attribution.sites.length).toBeGreaterThan(0);
    expect(attribution.appFiles).toBeGreaterThan(0);
    expect(attribution.filteredFrames).toBeGreaterThan(attribution.totalFrames > 0 ? 0 : -1);

    const files = new Set(attribution.sites.map(s => s.file));
    expect([...files].every(f => !f.startsWith('node:'))).toBe(true);

    // The pool connect timeout (5000ms) should be the top hot site.
    const top = attribution.sites[0];
    expect(top.totalDuration).toBeGreaterThan(0);
    expect(top.errorCount).toBeGreaterThan(0);

    // Query spans attach error stacks via span.metadata.error.
    const hasAppRepositorySite = attribution.sites.some(s => s.file.includes('Repository.ts'));
    expect(hasAppRepositorySite).toBe(true);

    // "lost" source coordinates survive end-to-end into the attributed rows.
    const csv = attribution.sites.find(s => s.functionName === 'generateReport');
    expect(csv).toBeTruthy();
    expect(csv?.file).toContain('reporters/csv.ts');
    expect(csv?.line).toBe(12);
  });
});
