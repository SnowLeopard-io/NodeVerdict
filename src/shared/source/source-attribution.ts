import type { TraceSpan, TracingEvent } from '../types';
import { parseStack } from '../source/code-linker';

/**
 * Source-level attribution.
 *
 * Maps hot/errored spans back to the source file and function that produced
 * them, using the error stack attached to error spans (or the operation's
 * context stack). Frames from the Node runtime / C++ bindings are filtered so
 * the result surfaces *app* code that is actually responsible for latency or
 * errors.
 *
 * Pure functions over already-extracted stack strings; the optional SourceMap
 * resolution is left to the page (via the fs-access bridge), while this module
 * keeps attribution rules unit-testable.
 */

export interface AttributionSite {
  file: string;
  functionName: string;
  line?: number;
}

export interface SourceAttributionStats {
  sites: Array<{ file: string; functionName: string; line?: number; count: number; totalDuration: number; errorCount: number }>;
  totalFrames: number;
  filteredFrames: number;
  appFiles: number;
}

const INTERNAL_PREFIXES = ['node:internal/', 'internal/'];

/** Is a frame from the Node runtime or a native binding? */
function isRuntimeFile(file: string): boolean {
  if (!file) return true;
  if (INTERNAL_PREFIXES.some(p => file.startsWith(p))) return true;
  if (file === '[eval]' || file === '<anonymous>') return true;
  if (file.startsWith('node:')) return true;
  return false;
}

/** Extract the authored-file frames from a stack string (skips runtime frames). */
export function appFramesFromStack(stack: string | undefined): Array<{ file: string; functionName: string; line?: number }> {
  const frames = parseStack(stack);
  const out: Array<{ file: string; functionName: string; line?: number }> = [];
  for (const f of frames) {
    if (f.filtered) continue;
    // Prefer the resolved original source when a source map linked it.
    const file = f.original?.source ?? f.file;
    if (isRuntimeFile(file)) continue;
    out.push({ file, functionName: f.original?.name ?? f.functionName, line: (f.original?.line1 ?? f.line1) });
  }
  return out;
}

/** Pull a stack string out of a span's metadata / error object. */
export function stackOfSpan(span: TraceSpan): string | undefined {
  const m = span.metadata as Record<string, unknown> | undefined;
  const err = m?.error as { stack?: string } | undefined;
  if (err?.stack) return err.stack;
  const any = m?.stack;
  return typeof any === 'string' ? any : undefined;
}

/**
 * Attribute a set of spans (or flat events) to source sites.
 * `spans` may be TraceSpan[] (reads metadata.error.stack / metadata.stack);
 * `events` may be TracingEvent[] with error.stack for the same purpose.
 */
export function attributeSpans(spansOrEvents: Array<TraceSpan | TracingEvent>): SourceAttributionStats {
  const counts = new Map<string, { file: string; functionName: string; line?: number; count: number; totalDuration: number; errorCount: number }>();
  let totalFrames = 0;
  let filteredFrames = 0;

  const add = (stack: string | undefined, duration: number, isError: boolean) => {
    if (!stack) return;
    const raw = parseStack(stack);
    const frames = raw.filter(f => !f.filtered && !isRuntimeFile(f.original?.source ?? f.file));
    filteredFrames += raw.length - frames.length;
    totalFrames += raw.length;
    // Attribute to the outermost (first) app frame as the responsible call site.
    const target = frames[0];
    if (!target) return;
    const file = target.original?.source ?? target.file;
    const fn = target.original?.name ?? target.functionName;
    const key = `${file}#${fn}#${target.line1 ?? 0}`;
    const cur = counts.get(key);
    if (cur) {
      cur.count += 1;
      cur.totalDuration += duration;
      if (isError) cur.errorCount += 1;
    } else {
      counts.set(key, {
        file,
        functionName: fn,
        line: target.line1,
        count: 1,
        totalDuration: duration,
        errorCount: isError ? 1 : 0,
      });
    }
  };

  for (const s of spansOrEvents) {
    const isSpan = (s as TraceSpan).metadata !== undefined;
    if (isSpan) {
      const span = s as TraceSpan;
      add(stackOfSpan(span), span.duration, span.status === 'error');
    } else {
      const ev = s as TracingEvent;
      const stack = typeof ev.error?.stack === 'string' ? ev.error.stack : undefined;
      add(stack, ev.duration ?? 0, Boolean(ev.error));
    }
  }

  const sites = [...counts.values()]
    .sort((a, b) => b.totalDuration - a.totalDuration || b.count - a.count);

  return {
    sites,
    totalFrames,
    filteredFrames,
    appFiles: new Set(sites.map(s => s.file)).size,
  };
}