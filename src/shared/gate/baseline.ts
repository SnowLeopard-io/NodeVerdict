import { analyzeTracingEvents, buildWaterfall } from '../engine';
import { computeGateMetrics } from '../gate/performance-gate';
import type { TracingEvent } from '../types';

/**
 * Baseline performance measurements (CI-integration feature).
 * Runs a trace through a one-call harness and returns: a lightweight metric
 * snapshot, a markdown report, and an overall pass/fail verdict. Pure functions
 * (no fs / process), so the same code works in the browser UI and in the CLI.
 */

export interface BaselineResult {
  totalEvents: number;
  totalOperations: number;
  errorRate: number;
  p99LatencyMs: number;
  p95LatencyMs: number;
  topChannel: { channel: string; avgDuration: number } | null;
  n1SqlInstances: number;
  eventLoopDelayP99Ms: number | null;
  passed: boolean;
}

export interface BaselineReport {
  name: string;
  generatedAt: number;
  result: BaselineResult;
  markdown: string;
  pass: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/** One-call metric computation for a trace, reusing the gate metrics engine. */
export function measureTrace(events: TracingEvent[]): BaselineResult {
  const gate = computeGateMetrics(events);
  const analysis = analyzeTracingEvents(events);
  const spans = buildWaterfall(analysis.operations, analysis.events);

  const durations = analysis.operations
    .filter(o => o.duration > 0)
    .map(o => o.duration)
    .sort((a, b) => a - b);

  let topChannel: BaselineResult['topChannel'] = null;
  if (analysis.channelStats.length > 0) {
    const worst = [...analysis.channelStats].sort((a, b) => b.avgDuration - a.avgDuration)[0];
    topChannel = { channel: worst.channel, avgDuration: worst.avgDuration };
  }

  return {
    totalEvents: analysis.totalEvents,
    totalOperations: analysis.totalOperations,
    errorRate: analysis.errorRate,
    p99LatencyMs: percentile(durations, 99),
    p95LatencyMs: percentile(durations, 95),
    topChannel,
    n1SqlInstances: gate.n1SqlInstances.length,
    eventLoopDelayP99Ms: gate.eventLoopDelayP99Ms,
    passed: spans.length === 0 ? false : gate.p99LatencyMs <= 500 && gate.n1SqlInstances.length === 0,
  };
}

/** Renders a markdown baseline report for CI logs or inline display. */
export function formatBaselineReport(result: BaselineResult, name: string): string {
  const lines: string[] = [];
  lines.push(`# NodeVerdict Baseline — ${name}`);
  lines.push('');
  lines.push(`- **Verdict:** ${result.passed ? '✅ PASS' : '❌ FAIL'}`);
  lines.push(`- Events: ${result.totalEvents}`);
  lines.push(`- Operations: ${result.totalOperations}`);
  lines.push(`- Error rate: ${(result.errorRate * 100).toFixed(2)}%`);
  lines.push(`- P99 latency: ${result.p99LatencyMs.toFixed(1)} ms`);
  lines.push(`- P95 latency: ${result.p95LatencyMs.toFixed(1)} ms`);
  if (result.topChannel) lines.push(`- Slowest channel: ${result.topChannel.channel} (avg ${result.topChannel.avgDuration.toFixed(1)} ms)`);
  lines.push(`- N+1 SQL instances: ${result.n1SqlInstances}`);
  lines.push(`- Event-loop delay P99: ${result.eventLoopDelayP99Ms?.toFixed(1) ?? 'n/a'} ms`);
  return lines.join('\n');
}

/** Build a full baseline report (measure + render). */
export function buildBaselineReport(events: TracingEvent[], name: string): BaselineReport {
  const result = measureTrace(events);
  return {
    name,
    generatedAt: Date.now(),
    result,
    markdown: formatBaselineReport(result, name),
    pass: result.passed,
  };
}