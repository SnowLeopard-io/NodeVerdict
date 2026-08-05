import type { TracingEvent } from '../types';
import { CausalGraphBuilder } from '../engine/causal-rebuilder';
import type {
  EarlyWarning,
  StreamingFinding,
  StreamingRcaOptions,
  StreamingRcaReport,
  StreamingSignal,
} from './streaming-rca-types';

/**
 * Real-time Streaming Root Cause Analysis.
 *
 * Works on a *partial* trace: integrated with the streaming causal graph
 * (Deep-water 1) so that structure is available before the trace completes.
 * State is updated incrementally by `ingest()` and the current verdict is
 * obtained any time via `snapshot()`.
 *
 * Signals:
 *   - latency-spike: recent-window mean duration vs an all-time per-channel
 *     baseline (a fault that affects the majority still beats a median-ish
 *     baseline, mirroring the distributed RCA's percentile trick).
 *   - error-rate-spike: recent error fraction vs all-time error fraction.
 *
 * The sliding window is *temporal*: each sample carries an end timestamp, and
 * only samples within `[now - windowMs, now]` contribute to the "recent"
 * signal. The baseline is the 25th-percentile of *all* historical samples.
 *
 * Blame: a fixed-point "influence score" over the *partial* DAG, seeded by the
 * per-node anomaly and flowing child -> parent. Recomputing the few cheap
 * iterations on each snapshot is O(edges); the structural build is cached in
 * the causal builder.
 *
 * Uncertainty: every verdict carries a confidence that is penalized while the
 * suspect span is still open (no paired end) and scaled by how much closed
 * evidence has accumulated, so unevaluated state is never presented as a hard
 * diagnosis.
 */

const PERCENTILE_FOR_BASELINE = 25;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface DurationSample {
  duration: number;
  at: number; // end time
}

interface ChannelStats {
  baseline: number[]; // bounded history of durations (for baseline)
  samples: DurationSample[]; // bounded time-windowed history
  errors: number; // all-time error count
  recentErrors: number; // error count within current window
  count: number; // all-time sample count
  recentErrAt: number[]; // timestamps of recent errors (for window pruning)
}

interface NodeEvidence {
  status: 'success' | 'error' | 'incomplete' | 'virtual';
  channel: string;
  endTime?: number;
  duration?: number;
  startSeen: boolean;
  endSeen: boolean;
}

export class StreamingRCA {
  private readonly causal = new CausalGraphBuilder();
  private readonly stats = new Map<string, ChannelStats>();
  private readonly info = new Map<string, NodeEvidence>();
  private readonly windowMs: number;
  private readonly options: StreamingRcaOptions;

  constructor(options: StreamingRcaOptions = {}) {
    this.options = options;
    this.windowMs = options.windowMs ?? 10_000;
  }

  /** Accept a single event. Feed both the causal builder and window stats. */
  ingest(event: TracingEvent): void {
    if (!event.channel || !event.eventType || typeof event.timestamp !== 'number') return;
    this.causal.ingest(event);
    const key = event.operationId ?? `${event.channel}:${event.timestamp}`;
    const cap = this.options.sampleCap ?? 10_000;

    let st = this.stats.get(event.channel);
    if (!st) {
      st = { baseline: [], samples: [], errors: 0, recentErrors: 0, count: 0, recentErrAt: [] };
      this.stats.set(event.channel, st);
    }

    const ev = this.info.get(key) ?? {
      status: 'incomplete' as const,
      channel: event.channel,
      startSeen: false,
      endSeen: false,
    };

    if (event.eventType === 'start') {
      ev.startSeen = true;
    } else if (event.eventType === 'end' || event.eventType === 'error') {
      const dur = event.duration ?? 0;
      if (st.baseline.length >= cap) st.baseline.shift();
      st.baseline.push(dur);
      if (st.samples.length >= cap) st.samples.shift();
      st.samples.push({ duration: dur, at: event.timestamp });
      st.count++;
      if (event.eventType === 'error') {
        st.errors++;
        st.recentErrors++;
        if (st.recentErrAt.length >= cap) st.recentErrAt.shift();
        st.recentErrAt.push(event.timestamp);
      }
      ev.endSeen = true;
      ev.status = event.eventType === 'error' ? 'error' : 'success';
      ev.endTime = event.timestamp;
      ev.duration = dur;
    }
    this.info.set(key, ev);
  }

  /** Snapshot the current verdict. `now` anchors the sliding window. */
  snapshot(now?: number): StreamingRcaReport {
    const graph = this.causal.build();
    const ref = this.referenceTime(now);

    // Real (non-virtual) nodes only — virtual placeholders are not ops.
    const realIds = graph.nodes.filter((n) => !n.virtual).map((n) => n.id);
    const realSet = new Set(realIds);
    const openSpanCount = realIds.filter((id) => {
      const ev = this.info.get(id);
      return !ev || !ev.endSeen;
    }).length;

    // Baselines: 25th-percentile of all-time history per channel.
    const baselines = new Map<string, number>();
    for (const [channel, st] of this.stats) {
      const sorted = [...st.baseline].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((PERCENTILE_FOR_BASELINE / 100) * sorted.length) - 1));
      baselines.set(channel, sorted[idx] ?? 0);
    }

    // Windowed aggregates per channel within [ref - windowMs, ref].
    const winMeans = new Map<string, number>();
    const winErrRates = new Map<string, number>();
    for (const [channel, st] of this.stats) {
      const inWindow = st.samples.filter((s) => s.at >= ref - this.windowMs);
      const mean = inWindow.length ? inWindow.reduce((a, b) => a + b.duration, 0) / inWindow.length : 0;
      winMeans.set(channel, mean);
      const errCount = st.recentErrAt.filter((t) => t >= ref - this.windowMs).length;
      winErrRates.set(channel, inWindow.length ? errCount / inWindow.length : 0);
    }

    // Per-node anomaly (0..1). Latency is the node's own duration vs its
    // channel's baseline; error-rate spike is a channel-level signal.
    const seed = new Map<string, number>();
    for (const id of realIds) {
      const ev = this.info.get(id);
      const channel = ev?.channel ?? 'unknown';
      const st = this.stats.get(channel);
      const base = baselines.get(channel) ?? 0;
      const ownDuration = ev?.duration ?? 0;
      const winErr = winErrRates.get(channel) ?? 0;
      const baseErr = st?.count ? st.errors / st.count : 0;

      let a = 0;
      const latencyFactor = this.options.latencyFactor ?? 1.8;
      // Latency spike is per-node: own duration well above channel baseline.
      if (base > 0 && ownDuration > base * latencyFactor) {
        a = Math.max(a, clamp((ownDuration / base - 1) / (latencyFactor - 1), 0, 1));
      } else if (base === 0 && ownDuration > 0) {
        a = Math.max(a, 0.5);
      }
      if (ev?.status === 'error') a = Math.max(a, 0.85);
      if ((st?.count ?? 0) > 0 && winErr > baseErr + (this.options.errorMargin ?? 0.02)) {
        a = Math.max(a, clamp(winErr, 0, 1));
      }
      seed.set(id, a);
    }

    // Blame: influence flows child -> parent over the partial DAG (fixed point).
    const childToParents = new Map<string, string[]>();
    for (const e of graph.edges) {
      if (!childToParents.has(e.childId)) childToParents.set(e.childId, []);
      const list = childToParents.get(e.childId)!;
      if (!list.includes(e.parentId)) list.push(e.parentId);
    }
    const blame = new Map(seed);
    const damping = 0.85;
    const iters = 4;
    for (let i = 0; i < iters; i++) {
      const next = new Map(seed);
      for (const [child, parents] of childToParents) {
        if (!realSet.has(child)) continue;
        const contrib = (blame.get(child) ?? 0) * damping * (1 / Math.max(1, parents.length));
        for (const p of parents) {
          if (realSet.has(p)) next.set(p, clamp((next.get(p) ?? 0) + contrib, 0, 1));
        }
      }
      blame.clear();
      for (const [k, v] of next) blame.set(k, v);
    }

    // Overall confidence scales with closed evidence.
    const closed = realIds.length - openSpanCount;
    const minSamples = Math.max(1, this.options.minSamples ?? 3);
    const evidenceConfidence = clamp(closed / minSamples, 0, 1);
    const openPenalty = this.options.openSpanPenalty ?? 0.6;

    const findings: StreamingFinding[] = [];
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const id of realIds) {
      const ev = this.info.get(id);
      const node = nodeById.get(id);
      const channel = node?.channel ?? ev?.channel ?? 'unknown';
      const st = this.stats.get(channel);
      const base = baselines.get(channel) ?? 0;
      const mean = winMeans.get(channel) ?? 0;
      const baseErr = st?.count ? st.errors / st.count : 0;
      const winErr = winErrRates.get(channel) ?? 0;
      const own = ev?.duration ?? 0;
      const ratio = base > 0 ? own / base : own > 0 ? 999 : 0;
      const latencyFactor = this.options.latencyFactor ?? 1.8;

      const signals: StreamingSignal[] = [];
      if (!ev?.endSeen) signals.push('incomplete-open-span');
      if (ev?.status === 'error') signals.push('high-error-count');
      if (base > 0 && own > base * latencyFactor) signals.push('latency-spike');
      if (winErr > baseErr + (this.options.errorMargin ?? 0.02)) signals.push('error-rate-spike');

      const score = clamp((seed.get(id) ?? 0) + 0.6 * (blame.get(id) ?? 0), 0, 1);
      let confidence = evidenceConfidence * clamp(score, 0, 1);
      if (!ev?.endSeen) confidence *= openPenalty;

      findings.push({
        nodeId: id,
        channel,
        score,
        signals,
        open: !ev?.endSeen,
        confidence,
        latencyRatio: ratio,
        baselineMs: base,
        windowMeanMs: mean,
        windowErrorRate: winErr,
      });
    }
    findings.sort((a, b) => b.score - a.score);

    // Coarse early warnings at the channel level.
    const earlyWarnings: EarlyWarning[] = [];
    for (const [channel, st] of this.stats) {
      const base = baselines.get(channel) ?? 0;
      const mean = winMeans.get(channel) ?? 0;
      const ratio = base > 0 ? mean / base : 0;
      const baseErr = st.count ? st.errors / st.count : 0;
      const winErr = winErrRates.get(channel) ?? 0;
      const minS = this.options.minSamples ?? 3;
      if (st.count >= minS && (ratio >= (this.options.latencyFactor ?? 1.8) || winErr > baseErr + (this.options.errorMargin ?? 0.02))) {
        const severity: EarlyWarning['severity'] = ratio >= 3 || winErr > baseErr + 0.1 ? 'critical' : 'warning';
        earlyWarnings.push({
          channel,
          severity,
          message: `latency ${ratio.toFixed(1)}x baseline (${mean.toFixed(1)}ms vs ${base.toFixed(1)}ms)`,
          windowMeanMs: mean,
          baselineMs: base,
          ratio,
          confidence: evidenceConfidence * (ratio >= 3 ? 1 : 0.7),
        });
      }
    }
    earlyWarnings.sort((a, b) => (a.severity === 'critical' ? -1 : 1) - (b.severity === 'critical' ? -1 : 1));

    return {
      findings,
      earlyWarnings,
      openSpanCount,
      overallConfidence: evidenceConfidence,
      now: ref,
    };
  }

  /** Count of distinct operations fed so far. */
  get size(): number {
    return this.info.size;
  }

  private referenceTime(now?: number): number {
    if (now !== undefined && Number.isFinite(now)) return now;
    let latest = 0;
    for (const ev of this.info.values()) {
      if (ev.endTime !== undefined && ev.endTime > latest) latest = ev.endTime;
    }
    return latest;
  }
}

/** One-shot wrapper to analyze a complete, already-available event list. */
export function analyzeStreamingRca(events: TracingEvent[], options?: StreamingRcaOptions): StreamingRcaReport {
  const rca = new StreamingRCA(options);
  for (const e of events) rca.ingest(e);
  return rca.snapshot();
}