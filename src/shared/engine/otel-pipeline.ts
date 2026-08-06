import { convertOtelToTracingEvents } from './otel-adapter';
import { evaluateAlerts, buildMetricSnapshot } from './alert-engine';
import { analyzeDistributed } from '../distributed';
import type { TopologyGraph, RootCauseReport, ServiceHealth } from '../distributed';
import type { TracingEvent } from '../types';
import type { AlertRule, FiredAlert } from '../types/alert';

/**
 * Continuous OTEL ingestion pipeline.
 *
 * Feed it batches of OTLP/JSON exports (as they arrive, e.g. polled from an
 * endpoint or streamed by the live agent); it accumulates converted TracingEvents
 * and re-computes the distributed topology + health alerts for the latest view.
 *
 * Pure functions so the pipeline logic is testable without a backend; the page
 * layer only decides *when* a batch arrives.
 */

export interface OtelPipelineState {
  events: TracingEvent[];
  topology: TopologyGraph | null;
  report: RootCauseReport | null;
  serviceHealth: Record<string, ServiceHealth>;
  totalEvents: number;
  batchCount: number;
}

export function createEmptyPipelineState(): OtelPipelineState {
  return { events: [], topology: null, report: null, serviceHealth: {}, totalEvents: 0, batchCount: 0 };
}

/** Convert one OTLP/JSON document (standard shape) into internal events. */
export function convertOtelBatch(batchJson: string): TracingEvent[] {
  return convertOtelToTracingEvents(JSON.parse(batchJson));
}

/**
 * Fold a new batch into the pipeline state and rebuild topology + health map.
 * `rules` are evaluated against a metric snapshot derived from the events.
 */
export function ingestOtelBatch(
  state: OtelPipelineState,
  batchJson: string,
  rules: AlertRule[],
): { next: OtelPipelineState; added: number; fired: FiredAlert[] } {
  const added = convertOtelBatch(batchJson);
  const events = [...state.events, ...added];

  let topology: TopologyGraph | null = null;
  let report: RootCauseReport | null = null;
  let serviceHealth: Record<string, ServiceHealth> = {};
  try {
    const result = analyzeDistributed(events);
    topology = result.graph;
    report = result.report;
    for (const node of topology.nodes) serviceHealth[node.id] = node.health;
  } catch {
    // keep previous topology on malformed incremental data
  }

  const snapshot = buildMetricSnapshot({
    errorRate: events.length > 0 ? (events.filter(e => e.error).length / events.length) * 100 : 0,
    eventRate: 0,
  });
  const fired = evaluateAlerts(rules, snapshot);

  const next: OtelPipelineState = {
    events,
    topology,
    report,
    serviceHealth,
    totalEvents: events.length,
    batchCount: state.batchCount + 1,
  };
  return { next, added: added.length, fired };
}

export function summarizePipelineHealth(topology: TopologyGraph | null): { healthy: number; warning: number; faulty: number } {
  if (!topology) return { healthy: 0, warning: 0, faulty: 0 };
  const counts = { healthy: 0, warning: 0, faulty: 0 };
  for (const n of topology.nodes) {
    if (n.health === 'healthy') counts.healthy++;
    else if (n.health === 'warning') counts.warning++;
    else counts.faulty++;
  }
  return counts;
}