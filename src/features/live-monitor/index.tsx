import { useState, useRef, useCallback, useEffect } from 'react';
import { StatCard } from '../../shared/components';
import { formatBytes, formatTimestamp, channelColor } from '../../shared/utils';
import { RealtimeChart } from './components/RealtimeChart';
import { MemoryGauge } from './components/MemoryGauge';
import { EventRateChart } from './components/EventRateChart';
import { useRootStore } from '../../stores';
import { evaluateAlerts, buildMetricSnapshot } from '../../shared/engine';
import { useI18n } from '../../shared/i18n/useI18n';
import { useBackend, BackendOfflineBanner } from '../../shared/backend';
import { FlameGraph } from '../cpu-profiler/components/FlameGraph';
import type { FlameFrame } from '../../shared/types';

interface WebSocketMessage {
  type?: string;
  data?: any;
  message?: string;
  command?: string;
  index?: number;
  total?: number;
  channel?: string;
  eventType?: string;
  timestamp?: number;
  agent?: string;
  version?: number;
  pid?: number;
  [key: string]: any;
}

interface LogEntry {
  text: string;
  type: 'info' | 'error';
  time: Date;
}

interface TracingEventEntry {
  channel: string;
  eventType: string;
  timestamp: number;
}

interface ChunkBuffer {
  chunks: Record<number, string>;
  total: number;
  received: number;
}

interface GcEventEntry {
  kind: string;
  durationMs: number;
  reclaimedMb: number;
  intervalMs: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  timestamp: number;
}

interface ServerAlert {
  id: string;
  level: 'info' | 'warning' | 'critical';
  metric: string;
  value: number;
  threshold: number;
  message: string;
  source: string;
  timestamp: number;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

function gcKindColor(kind: string): string {
  const lower = kind.toLowerCase();
  if (lower.includes('inferred')) return '#0ea5e9';
  if (lower.includes('scavenge') || lower.includes('minor')) return '#22c55e';
  if (lower.includes('mark') || lower.includes('sweep') || lower.includes('compact')) return '#f97316';
  return '#64748b';
}

type SnapState = 'idle' | 'receiving' | 'ready';
type CpuProfileState = 'idle' | 'receiving' | 'ready';

/** Coerce an unknown numeric field to a finite number, defaulting to 0. */
function toFinite(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function LiveMonitorPage() {
  const { t } = useI18n();
  // Connection
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('9876');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [agentPid, setAgentPid] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Backend capability detection — shows a "backend server required" banner
  // when the Live Agent is not reachable, while preserving the manual connect UI.
  const backend = useBackend({ host, port, retryIntervalMs: 5000 });
  useEffect(() => {
    backend.setHost(host);
    backend.setPort(port);
  }, [host, port]);

  // Log
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Memory
  const [memoryData, setMemoryData] = useState<{ rss: number; heapTotal: number; heapUsed: number; external: number } | null>(null);

  // Running high-water marks for RSS/external gauges (no fixed "total" exists).
  const memoryPeaks = useRef({ rss: 0, external: 0 });
  useEffect(() => {
    if (!memoryData) return;
    const peaks = memoryPeaks.current;
    if (memoryData.rss > peaks.rss) peaks.rss = memoryData.rss;
    if (memoryData.external > peaks.external) peaks.external = memoryData.external;
  }, [memoryData]);
  const rssPeak = memoryPeaks.current.rss || 1;
  const externalPeak = memoryPeaks.current.external || 1;

  // Tracing
  const [tracingActive, setTracingActive] = useState(false);
  const [tracingEvents, setTracingEvents] = useState<TracingEventEntry[]>([]);

  // Heap snapshot
  const [snapState, setSnapState] = useState<SnapState>('idle');
  const snapBufferRef = useRef<ChunkBuffer>({ chunks: {}, total: 0, received: 0 });
  const [snapDownloadUrl, setSnapDownloadUrl] = useState<string | null>(null);

  // CPU profile
  const [cpuProfileState, setCpuProfileState] = useState<CpuProfileState>('idle');
  const cpuProfileBufferRef = useRef<ChunkBuffer>({ chunks: {}, total: 0, received: 0 });
  const [cpuProfileDownloadUrl, setCpuProfileDownloadUrl] = useState<string | null>(null);

  // Memory polling
  const [memPollingActive, setMemPollingActive] = useState(false);
  const [memPollingInterval, setMemPollingInterval] = useState(1000);

  // GC monitoring
  const [gcStarted, setGcStarted] = useState(false);
  const [gcEvents, setGcEvents] = useState<GcEventEntry[]>([]);

  // Leak detector
  const [leakDetectorActive, setLeakDetectorActive] = useState(false);
  const [leakRateMbPerSec, setLeakRateMbPerSec] = useState(2);
  const [leakHeapPercent, setLeakHeapPercent] = useState(90);

  // Backend-pushed alerts (GC churn, leak detector, ...)
  const [serverAlerts, setServerAlerts] = useState<ServerAlert[]>([]);

  // Real-time flame graph streaming
  const [flameStreamActive, setFlameStreamActive] = useState(false);
  const [flameWindowMs, setFlameWindowMs] = useState(3000);
  const [flameSampleInterval, setFlameSampleInterval] = useState(1000);
  const [flameData, setFlameData] = useState<{ flameTree: FlameFrame; totalTimeMs: number; sampleCount: number; windowIndex: number; updatedAt: number } | null>(null);

  // Live Dashboard
  const [memoryHistory, setMemoryHistory] = useState<Array<{ time: number; rss: number; heapUsed: number; heapTotal: number; external: number }>>([]);
  const [eventRateHistory, setEventRateHistory] = useState<Map<string, { count: number; color: string }>>(new Map());
  const chartRowRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(480);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  function addLog(text: string, type: 'info' | 'error' = 'info') {
    setLogs(prev => [...prev.slice(-199), { text, type, time: new Date() }]);
  }

  // Chunk assembly helpers
  function resetSnapBuffer() {
    snapBufferRef.current = { chunks: {}, total: 0, received: 0 };
    setSnapDownloadUrl(null);
  }

  function resetCpuProfileBuffer() {
    cpuProfileBufferRef.current = { chunks: {}, total: 0, received: 0 };
    setCpuProfileDownloadUrl(null);
  }

  function assembleChunk(
    index: number,
    total: number,
    data: string,
    bufferRef: React.MutableRefObject<ChunkBuffer>,
    onReady: (url: string) => void,
  ) {
    const buf = bufferRef.current;
    if (buf.total === 0) buf.total = total;
    if (!buf.chunks[index]) {
      buf.chunks[index] = data;
      buf.received++;
    }
    if (buf.received === buf.total) {
      // Reassemble
      const ordered: string[] = [];
      for (let i = 0; i < buf.total; i++) {
        ordered.push(buf.chunks[i] ?? '');
      }
      const full = ordered.join('');
      const blob = new Blob([full], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      onReady(url);
      // Reset buffer
      bufferRef.current = { chunks: {}, total: 0, received: 0 };
    }
  }

  // WebSocket message handler — broadly compatible with any agent protocol
  const handleMessage = useCallback((event: MessageEvent) => {
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      addLog(t('liveMonitor.log.parseError').replace('{data}', String(event.data)), 'error');
      return;
    }

    // Try to detect and extract memory data from any message shape
    tryExtractMemory(msg);

    // Try to detect and extract tracing events from any message shape
    tryExtractEvent(msg);

    // Try to detect and handle chunked file transfers
    tryExtractChunk(msg);

    // Try to detect GC events (precise channel or heap-drop inference)
    tryExtractGcEvent(msg);

    // Try to detect backend-pushed alerts (GC churn, leak detector)
    tryExtractServerAlert(msg);

    // Try to detect streaming flame graph windows
    tryExtractFlameStream(msg);

    // Handle known protocol messages
    const msgType = msg.type ?? '';
    switch (msgType) {
      case 'hello':
        if (msg.agent) {
          addLog(t('liveMonitor.log.connected')
            .replace('{agent}', String(msg.agent))
            .replace('{version}', String(msg.version ?? '?'))
            .replace('{pid}', String(msg.pid ?? '?')));
          if (msg.pid) setAgentPid(msg.pid);
        }
        break;
      case 'status':
      case 'info':
      case 'log':
        addLog(msg.message ?? msg.text ?? msg.data ?? '');
        break;
      case 'error':
        addLog(msg.message ?? msg.text ?? t('common.error'), 'error');
        break;
      case 'memory-usage':
      case 'memory':
      case 'mem':
        // Already handled by tryExtractMemory above
        break;
      case 'event':
      case 'trace':
      case 'tracing':
        // Already handled by tryExtractEvent above
        break;
      case 'heap-snapshot-chunk':
      case 'cpu-profile-chunk':
        // Already handled by tryExtractChunk above
        break;
      case 'chunk':
        // Already handled by tryExtractChunk above
        break;
      case 'gc-event':
      case 'gc':
        // Already handled by tryExtractGcEvent above
        break;
      case 'alert':
      case 'alarm':
        // Already handled by tryExtractServerAlert above
        break;
      case 'flame-stream':
      case 'flame':
        // Already handled by tryExtractFlameStream above
        break;
      default:
         // Silently ignore unknown types — no noisy logs
         break;
     }
   }, []);

  /** Attempt to extract memory usage data from any message shape */
  function tryExtractMemory(msg: Record<string, any>) {
    // Look for memory data in various shapes
    const mem = msg.data ?? msg;
    const rss = mem.rss ?? mem.RSS ?? mem.memoryRss ?? mem.mem_rss;
    const heapUsed = mem.heapUsed ?? mem.heap_used ?? mem.heapUsedBytes ?? mem.usedHeap;
    const heapTotal = mem.heapTotal ?? mem.heap_total ?? mem.heapTotalBytes ?? mem.totalHeap;
    const external = mem.external ?? mem.externalMemory ?? mem.external_memory;

    if (rss != null && heapUsed != null) {
      setMemoryData({
        rss: Number(rss),
        heapTotal: Number(heapTotal ?? 0),
        heapUsed: Number(heapUsed),
        external: Number(external ?? 0),
      });
      return true;
    }
    // Deeper search: check if any nested object has memory-like fields
    if (msg.data && typeof msg.data === 'object') {
      for (const key of Object.keys(msg.data)) {
        const val = msg.data[key];
        if (val && typeof val === 'object' && val.rss != null) {
          setMemoryData({
            rss: Number(val.rss),
            heapTotal: Number(val.heapTotal ?? 0),
            heapUsed: Number(val.heapUsed ?? 0),
            external: Number(val.external ?? 0),
          });
          return true;
        }
      }
    }
    return false;
  }

  /** Attempt to extract tracing events from any message shape */
  function tryExtractEvent(msg: Record<string, any>) {
    const data = msg.data ?? msg;
    const channel = msg.channel ?? data.channel ?? data.name;
    const eventType = msg.eventType ?? data.eventType ?? data.type ?? data.event ?? msgTypeName(msg);

    if (channel && eventType && typeof channel === 'string') {
      setTracingEvents(prev => {
        const next = [{
          channel,
          eventType: String(eventType),
          timestamp: msg.timestamp ?? data.timestamp ?? Date.now(),
        }, ...prev];
        return next.slice(0, 100);
      });
      return true;
    }
    return false;
  }

  /** Attempt to extract chunked file data from any message shape */
  function tryExtractChunk(msg: Record<string, any>) {
    const data = msg.data ?? '';
    const index = msg.index ?? msg.seq ?? msg.part ?? msg.chunkIndex;
    const total = msg.total ?? msg.count ?? msg.parts ?? msg.totalChunks;

    // Check if this looks like a chunk message
    if (index != null && total != null && total > 1) {
      const idx = Number(index);
      const tot = Number(total);

      // Determine if this is a heap snapshot or CPU profile chunk
      if (msg.type?.includes('snapshot') || msg.type?.includes('heap')) {
        if (snapState === 'idle') setSnapState('receiving');
        assembleChunk(idx, tot, String(data), snapBufferRef, (url) => {
          setSnapDownloadUrl(url);
          setSnapState('ready');
          addLog(t('liveMonitor.snapshotReady'));
        });
      } else if (msg.type?.includes('cpu') || msg.type?.includes('profile')) {
        if (cpuProfileState === 'idle') setCpuProfileState('receiving');
        assembleChunk(idx, tot, String(data), cpuProfileBufferRef, (url) => {
          setCpuProfileDownloadUrl(url);
          setCpuProfileState('ready');
          addLog(t('liveMonitor.profileReady'));
        });
      } else {
        // Generic chunk — try heap snapshot first
        if (snapState === 'idle') setSnapState('receiving');
        assembleChunk(idx, tot, String(data), snapBufferRef, (url) => {
          setSnapDownloadUrl(url);
          setSnapState('ready');
          addLog(t('liveMonitor.log.chunkComplete'));
        });
      }
      return true;
    }
    return false;
  }

  /** Attempt to extract GC events (precise or inferred) from any message shape */
  function tryExtractGcEvent(msg: Record<string, any>) {
    const data = msg.data ?? msg;
    const kind = msg.kind ?? data.kind ?? data.gcType;
    const gcBytes = data.gcBytes;
    const rawReclaimed = data.reclaimedMb ?? data.reclaimed ?? (gcBytes != null ? gcBytes / (1024 * 1024) : undefined);
    const reclaimedMb = toFinite(rawReclaimed);
    const heapUsed = data.heapUsed ?? data.heap_used;
    const isGcType = msg.type?.includes('gc-event') || msg.type === 'gc';

    if (isGcType || (kind && (heapUsed != null || reclaimedMb != null))) {
      setGcEvents(prev => [{
        kind: String(kind),
        durationMs: toFinite(data.durationMs ?? data.duration),
        reclaimedMb,
        intervalMs: toFinite(data.intervalMs),
        rss: toFinite(data.rss),
        heapUsed: toFinite(heapUsed),
        heapTotal: toFinite(data.heapTotal),
        timestamp: toFinite(msg.timestamp ?? data.timestamp ?? Date.now()),
      }, ...prev].slice(0, 100));
      return true;
    }
    return false;
  }

  /** Attempt to extract backend-pushed alerts from any message shape */
  function tryExtractServerAlert(msg: Record<string, any>) {
    const data = msg.data ?? msg;
    const level = msg.level ?? data.level;
    const message = msg.message ?? data.message;
    const isAlertType = msg.type === 'alert' || msg.type === 'alarm';

    if (isAlertType || (level && message)) {
      setServerAlerts(prev => [{
        id: String(msg.id ?? data.id ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        level: (['info', 'warning', 'critical'].includes(level) ? level : 'warning'),
        metric: String(msg.metric ?? data.metric ?? 'unknown'),
        value: Number(data.value ?? msg.value ?? 0),
        threshold: Number(data.threshold ?? msg.threshold ?? 0),
        message: String(message),
        source: String(msg.source ?? data.source ?? 'backend'),
        timestamp: Number(msg.timestamp ?? data.timestamp ?? Date.now()),
      }, ...prev].slice(0, 50));
      return true;
    }
    return false;
  }

  /** Attempt to extract real-time flame graph windows */
  function tryExtractFlameStream(msg: Record<string, any>) {
    const data = msg.data ?? msg;
    const tree = data.flameTree ?? data.tree;
    const isFlameType = msg.type === 'flame-stream' || msg.type === 'flame';

    if (isFlameType || (tree && tree.value != null && Array.isArray(tree.children))) {
      setFlameData({
        flameTree: tree as FlameFrame,
        totalTimeMs: Number(data.totalTimeMs ?? data.totalTime ?? tree.value ?? 0),
        sampleCount: Number(data.sampleCount ?? 0),
        windowIndex: Number(data.windowIndex ?? 0),
        updatedAt: Number(data.timestamp ?? Date.now()),
      });
      return true;
    }
    return false;
  }

  function msgTypeName(msg: Record<string, any>): string {
    return msg.type ?? msg.event ?? msg.name ?? 'message';
  }

  function connect() {
    const url = `ws://${host}:${port}`;
    setConnectionStatus('connecting');
    addLog(t('liveMonitor.connecting') + ` ${url}...`);

    const ws = new WebSocket(url);
    ws.onopen = () => {
      setConnectionStatus('connected');
      addLog(t('liveMonitor.connected'));
    };
    ws.onmessage = handleMessage;
    ws.onclose = () => {
      setConnectionStatus('disconnected');
      setAgentPid(null);
      addLog(t('liveMonitor.disconnected'));
    };
    ws.onerror = () => {
      setConnectionStatus('disconnected');
      setAgentPid(null);
      addLog(t('liveMonitor.connectionError'), 'error');
    };
    wsRef.current = ws;
  }

  function disconnect() {
    wsRef.current?.close();
    wsRef.current = null;
    setConnectionStatus('disconnected');
    setAgentPid(null);
  }

  function sendCommand(command: string, extra: Record<string, any> = {}) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command, ...extra }));
    }
  }

  // Tracing
  function toggleTracing() {
    if (tracingActive) {
      sendCommand('stop-tracing');
      setTracingActive(false);
      addLog(t('liveMonitor.tracingStopped'));
    } else {
      setTracingEvents([]);
      sendCommand('start-tracing');
      setTracingActive(true);
      addLog(t('liveMonitor.tracingStarted'));
    }
  }

  // Heap snapshot
  function takeHeapSnapshot() {
    resetSnapBuffer();
    setSnapState('receiving');
    sendCommand('take-heap-snapshot');
    addLog(t('liveMonitor.takeHeapSnapshot') + '...');
  }

  function downloadSnap() {
    if (snapDownloadUrl) {
      const a = document.createElement('a');
      a.href = snapDownloadUrl;
      a.download = `heap-snapshot-${Date.now()}.heapsnapshot`;
      a.click();
    }
  }

  // CPU profile
  function toggleCpuProfile() {
    if (cpuProfileState === 'ready' || cpuProfileState === 'receiving') {
      sendCommand('stop-cpu-profile');
      setCpuProfileState('idle');
      resetCpuProfileBuffer();
      addLog(t('liveMonitor.profileReady'));
    } else {
      resetCpuProfileBuffer();
      setCpuProfileState('receiving');
      sendCommand('start-cpu-profile');
      addLog(t('liveMonitor.startCpuProfile') + '...');
    }
  }

  function downloadCpuProfile() {
    if (cpuProfileDownloadUrl) {
      const a = document.createElement('a');
      a.href = cpuProfileDownloadUrl;
      a.download = `cpu-profile-${Date.now()}.cpuprofile`;
      a.click();
    }
  }

  // Memory polling
  function toggleMemPolling() {
    if (memPollingActive) {
      sendCommand('stop-memory-polling');
      setMemPollingActive(false);
      addLog(t('liveMonitor.stopMemoryPolling'));
    } else {
      sendCommand('start-memory-polling');
      setMemPollingActive(true);
      addLog(t('liveMonitor.startMemoryPolling') + ` (interval: ${memPollingInterval}ms)`);
    }
  }

  // GC monitoring
  function toggleGc() {
    if (gcStarted) {
      sendCommand('stop-gc');
      setGcStarted(false);
      addLog(t('liveMonitor.gc.stopped'));
    } else {
      setGcEvents([]);
      sendCommand('start-gc');
      setGcStarted(true);
      addLog(t('liveMonitor.gc.started'));
    }
  }

  // Leak detector
  function toggleLeakDetector() {
    if (leakDetectorActive) {
      sendCommand('stop-leak-detector');
      setLeakDetectorActive(false);
      addLog(t('liveMonitor.leak.stopped'));
    } else {
      sendCommand('start-leak-detector', {
        rateBps: leakRateMbPerSec * 1024 * 1024,
        heapPercent: leakHeapPercent,
      });
      setLeakDetectorActive(true);
      addLog(t('liveMonitor.leak.started'));
    }
  }

  // Flame graph streaming
  function toggleFlameStream() {
    if (flameStreamActive) {
      sendCommand('stop-flame-stream');
      setFlameStreamActive(false);
      addLog(t('liveMonitor.flame.stopped'));
    } else {
      setFlameData(null);
      sendCommand('start-flame-stream', {
        windowMs: flameWindowMs,
        sampleInterval: flameSampleInterval,
      });
      setFlameStreamActive(true);
      addLog(t('liveMonitor.flame.started') + ` (window: ${flameWindowMs}ms)`);
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // ResizeObserver for chart width
  useEffect(() => {
    const el = chartRowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setChartWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track memory history
  useEffect(() => {
    if (!memoryData) return;
    const now = Date.now();
    const entry = {
      time: now,
      rss: memoryData.rss,
      heapUsed: memoryData.heapUsed,
      heapTotal: memoryData.heapTotal,
      external: memoryData.external,
    };
    setMemoryHistory(prev => {
      const next = [...prev, entry];
      return next.slice(-120);
    });
  }, [memoryData]);

  // Track event rate history
  useEffect(() => {
    if (tracingEvents.length === 0) return;
    const latest = tracingEvents[0];
    if (!latest) return;
    setEventRateHistory(prev => {
      const next = new Map(prev);
      const ch = latest.channel;
      const existing = next.get(ch);
      const color = existing?.color ?? channelColor(ch);
      next.set(ch, {
        count: (existing?.count ?? 0) + 1,
        color,
      });
      // Prune old entries if too many channels
      if (next.size > 50) {
        const sorted = [...next.entries()].sort((a, b) => b[1].count - a[1].count);
        next.clear();
        for (const [k, v] of sorted.slice(0, 50)) {
          next.set(k, v);
        }
      }
      return next;
    });
  }, [tracingEvents]);

  // Alert evaluation
  const { alertRules, addFiredAlert, firedAlerts } = useRootStore();
  const lastAlertAtRef = useRef(new Map<string, number>());
  const eventRateRef = useRef<{ at: number; count: number } | null>(null);
  useEffect(() => {
    if (!memoryData) return;
    const errorEvents = tracingEvents.filter(e => e.eventType.toLowerCase().includes('error'));
    const traceErrorRate = tracingEvents.length > 0 ? (errorEvents.length / tracingEvents.length) * 100 : 0;
    // eventRate is events/second, not the cumulative count. Sample the delta
    // since the previous tick so the value is actually a rate.
    const now = Date.now();
    const last = eventRateRef.current;
    let eventRate = 0;
    if (last) {
      const dt = (now - last.at) / 1000;
      if (dt > 0) eventRate = (tracingEvents.length - last.count) / dt;
    }
    eventRateRef.current = { at: now, count: tracingEvents.length };

    const snapshot = buildMetricSnapshot({
      memoryData,
      memoryHistory,
      errorRate: traceErrorRate,
      eventRate,
    });
    const fired = evaluateAlerts(alertRules, snapshot);
    const cooldown = lastAlertAtRef.current;
    for (const f of fired) {
      // Cooldown per rule so a persistent threshold doesn't spam identical
      // alerts on every memory tick.
      const lastAt = cooldown.get(f.ruleId) ?? 0;
      if (now - lastAt < 10_000) continue;
      cooldown.set(f.ruleId, now);
      addFiredAlert(f);
      addLog(t('liveMonitor.log.alert').replace('{level}', f.level).replace('{message}', f.message), f.level === 'critical' ? 'error' : 'info');
    }
  }, [memoryData, alertRules, tracingEvents, memoryHistory]);

  const statusDot = connectionStatus === 'connected'
    ? 'bg-green-500'
    : connectionStatus === 'connecting'
      ? 'bg-yellow-500'
      : 'bg-red-500';

  const statusLabel = connectionStatus === 'connected'
    ? t('liveMonitor.connected')
    : connectionStatus === 'connecting'
      ? t('liveMonitor.connecting')
      : t('liveMonitor.disconnected');

  // Derived data for charts
  const rssHistory = memoryHistory.map(d => ({ time: d.time, value: d.rss / (1024 * 1024) }));
  const heapUsedHistory = memoryHistory.map(d => ({ time: d.time, value: d.heapUsed / (1024 * 1024) }));
  const eventRateEntries: Array<{ channel: string; count: number; color: string }> = [];
  eventRateHistory.forEach((v, k) => {
    eventRateEntries.push({ channel: k, count: v.count, color: v.color });
  });

  const maxReclaimedMb = gcEvents.length > 0
    ? Math.max(...gcEvents.map(e => e.reclaimedMb))
    : 0;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('liveMonitor.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t('liveMonitor.description')}
        </p>
      </div>

      {/* Backend availability banner — shows "需要后端服务器" when no agent is running */}
      {backend.status !== 'online' && (
        <BackendOfflineBanner
          status={backend.status}
          info={backend.info}
          error={backend.error}
          host={backend.host}
          port={backend.port}
          onRetry={backend.retry}
        />
      )}
      {backend.status === 'online' && (
        <div className="mb-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          {t('backend.online')}
          {backend.info?.pid ? (
            <span className="text-xs text-emerald-700/70 dark:text-emerald-400/70">
              · {backend.info.name} v{backend.info.version} · PID {backend.info.pid}
            </span>
          ) : null}
        </div>
      )}

      {/* Connection Panel */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('liveMonitor.host')}</label>
            <input
              type="text"
              value={host}
              onChange={e => setHost(e.target.value)}
              disabled={connectionStatus !== 'disconnected'}
              className="w-32 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('liveMonitor.port')}</label>
            <input
              type="text"
              value={port}
              onChange={e => setPort(e.target.value)}
              disabled={connectionStatus !== 'disconnected'}
              className="w-24 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
            />
          </div>
          <div className="pt-5">
            {connectionStatus === 'disconnected' ? (
              <button
                onClick={connect}
                className="px-4 py-2 rounded-lg font-medium text-sm bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {t('liveMonitor.connect')}
              </button>
            ) : (
              <button
                onClick={disconnect}
                className="px-4 py-2 rounded-lg font-medium text-sm bg-red-600 hover:bg-red-700 text-white"
              >
                {t('liveMonitor.disconnect')}
              </button>
            )}
          </div>
          <div className="pt-5 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full inline-block ${statusDot}`} />
            <span className="text-sm text-gray-600 dark:text-gray-300">{statusLabel}</span>
            {agentPid !== null && (
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">{t('liveMonitor.pid')}: {agentPid}</span>
            )}
          </div>
        </div>
      </div>

      {connectionStatus === 'connected' && (
        <>
          {/* Alert strip */}
          {firedAlerts.length > 0 && (
            <div className="mb-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('liveMonitor.alerts')}</span>
              </div>
              <div className="space-y-1">
                {firedAlerts.slice(0, 3).map((fa, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded font-medium ${
                      fa.level === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        : fa.level === 'warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    }`}>{fa.level.toUpperCase()}</span>
                    <span className="text-gray-600 dark:text-gray-300">{fa.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Memory Panel */}
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('liveMonitor.memory')}</h2>
            <div className="grid grid-cols-4 gap-3">
              <StatCard title={t('liveMonitor.rss')} value={memoryData ? formatBytes(memoryData.rss) : '-'} />
              <StatCard title={t('liveMonitor.heapUsed')} value={memoryData ? formatBytes(memoryData.heapUsed) : '-'} />
              <StatCard title={t('liveMonitor.heapTotal')} value={memoryData ? formatBytes(memoryData.heapTotal) : '-'} />
              <StatCard title={t('liveMonitor.external')} value={memoryData ? formatBytes(memoryData.external) : '-'} />
            </div>
          </div>

          {/* Live Dashboard */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">{t('liveMonitor.liveDashboard')}</h2>
            
            {/* Memory Gauges Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <MemoryGauge used={memoryData?.heapUsed ?? 0} total={memoryData?.heapTotal ?? 1} label={t('liveMonitor.heapUsed')} color="#22c55e" />
              <MemoryGauge used={memoryData?.rss ?? 0} total={rssPeak} label={t('liveMonitor.rss')} color="#3b82f6" />
              <MemoryGauge used={memoryData?.external ?? 0} total={externalPeak} label={t('liveMonitor.external')} color="#f97316" />
              <MemoryGauge used={memoryData?.heapUsed ?? 0} total={memoryData?.rss && memoryData.rss > 0 ? memoryData.rss : 1} label={t('liveMonitor.heapPercent')} color="#8b5cf6" />
            </div>

            {/* Real-time Charts Row */}
            <div ref={chartRowRef} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('liveMonitor.memoryTrend')}</h3>
                <RealtimeChart data={rssHistory} width={chartWidth / 2 - 8} height={180} color="#3b82f6" label={t('liveMonitor.rss')} unit=" MB" />
              </div>
              <div>
                <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('liveMonitor.heapTrend')}</h3>
                <RealtimeChart data={heapUsedHistory} width={chartWidth / 2 - 8} height={180} color="#22c55e" label={t('liveMonitor.heapUsed')} unit=" MB" />
              </div>
            </div>

            {/* Event Rate Chart */}
            {eventRateEntries.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('liveMonitor.eventRate')}</h3>
                <EventRateChart events={eventRateEntries} width={chartWidth} height={Math.min(eventRateEntries.length * 28 + 16, 300)} />
              </div>
            )}
          </div>

          {/* Actions Panel */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">{t('liveMonitor.actions')}</h2>
            <div className="flex flex-wrap gap-3 items-center">
              {/* Heap Snapshot */}
              <button
                onClick={takeHeapSnapshot}
                disabled={snapState === 'receiving'}
                className="px-4 py-2 rounded-lg font-medium text-sm bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
              >
                {snapState === 'receiving' ? t('common.loading') : t('liveMonitor.takeHeapSnapshot')}
              </button>
              {snapState === 'ready' && snapDownloadUrl && (
                <button
                  onClick={downloadSnap}
                  className="px-4 py-2 rounded-lg font-medium text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {t('liveMonitor.downloadSnapshot')}
                </button>
              )}

              {/* CPU Profile */}
              <button
                onClick={toggleCpuProfile}
                disabled={cpuProfileState === 'receiving'}
                className="px-4 py-2 rounded-lg font-medium text-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50"
              >
                {cpuProfileState === 'ready' || cpuProfileState === 'receiving'
                  ? t('liveMonitor.stopCpuProfile')
                  : t('liveMonitor.startCpuProfile')}
              </button>
              {cpuProfileState === 'ready' && cpuProfileDownloadUrl && (
                <button
                  onClick={downloadCpuProfile}
                  className="px-4 py-2 rounded-lg font-medium text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {t('liveMonitor.downloadProfile')}
                </button>
              )}

              {/* Memory Polling */}
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={memPollingInterval}
                  onChange={e => setMemPollingInterval(Number(e.target.value))}
                  min={100}
                  step={100}
                  disabled={memPollingActive}
                  className="w-20 px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">ms</span>
                <button
                  onClick={toggleMemPolling}
                  className="px-4 py-2 rounded-lg font-medium text-sm bg-cyan-600 hover:bg-cyan-700 text-white"
                >
                  {memPollingActive ? t('liveMonitor.stopMemoryPolling') : t('liveMonitor.startMemoryPolling')}
                </button>
              </div>
            </div>
          </div>

          {/* Backend Alerts */}
          {serverAlerts.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('liveMonitor.backendAlerts')}</h2>
                <button
                  onClick={() => setServerAlerts([])}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  {t('common.clear')}
                </button>
              </div>
              <div className="space-y-1.5">
                {serverAlerts.slice(0, 8).map((a, idx) => (
                  <div key={a.id ?? idx} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${
                      a.level === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        : a.level === 'warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    }`}>{a.level.toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-700 dark:text-gray-200 break-words">{a.message}</p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                        {a.source} · {formatTimestamp(a.timestamp)}
                        {a.value > 0 ? ` · ${a.value.toFixed(1)} / ${a.threshold.toFixed(1)}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* GC & Leak Detection */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('liveMonitor.gc.title')}</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleGc}
                  className="px-4 py-2 rounded-lg font-medium text-sm bg-teal-600 hover:bg-teal-700 text-white"
                >
                  {gcStarted ? t('liveMonitor.gc.stop') : t('liveMonitor.gc.start')}
                </button>
                <button
                  onClick={toggleLeakDetector}
                  className={`px-4 py-2 rounded-lg font-medium text-sm text-white ${leakDetectorActive ? 'bg-red-600 hover:bg-red-700' : 'bg-violet-600 hover:bg-violet-700'}`}
                >
                  {leakDetectorActive ? t('liveMonitor.leak.stop') : t('liveMonitor.leak.start')}
                </button>
              </div>
            </div>

            {/* Leak thresholds */}
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <label className="text-xs text-gray-500 dark:text-gray-400">
                {t('liveMonitor.leak.rate')}
                <input
                  type="number"
                  value={leakRateMbPerSec}
                  onChange={e => setLeakRateMbPerSec(Number(e.target.value))}
                  min={0.1}
                  step={0.1}
                  disabled={leakDetectorActive}
                  className="ml-2 w-20 px-2 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                />
                <span className="ml-1">MB/s</span>
              </label>
              <label className="text-xs text-gray-500 dark:text-gray-400">
                {t('liveMonitor.leak.heapPercent')}
                <input
                  type="number"
                  value={leakHeapPercent}
                  onChange={e => setLeakHeapPercent(Number(e.target.value))}
                  min={10}
                  max={100}
                  disabled={leakDetectorActive}
                  className="ml-2 w-20 px-2 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                />
                <span className="ml-1">%</span>
              </label>
              <span className="text-xs text-gray-400 dark:text-gray-500">{t('liveMonitor.leak.desc')}</span>
            </div>

            {/* GC stats */}
            {gcEvents.length > 0 && (
              <div className="grid grid-cols-3 gap-3 mb-3">
                <StatCard title={t('liveMonitor.gc.count')} value={String(gcEvents.length)} />
                <StatCard title={t('liveMonitor.gc.maxReclaimed')} value={formatBytes(maxReclaimedMb * 1024 * 1024)} />
                <StatCard title={t('liveMonitor.gc.longPauses')} value={String(gcEvents.filter(e => e.durationMs > 100).length)} />
              </div>
            )}

            {/* GC event feed */}
            {gcStarted && gcEvents.length > 0 && (
              <div className="max-h-64 overflow-y-auto space-y-1.5">
                {gcEvents.map((evt, idx) => (
                  <div key={idx} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
                    evt.intervalMs > 0 && evt.intervalMs < 250
                      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                      : 'bg-gray-50 dark:bg-gray-900/50 border-gray-100 dark:border-gray-800'
                  }`}>
                    <span className="px-2 py-0.5 rounded text-xs font-medium text-white shrink-0"
                      style={{ backgroundColor: gcKindColor(evt.kind) }}
                    >
                      {evt.kind}
                    </span>
                    {evt.reclaimedMb > 0 && (
                      <span className="text-xs text-gray-600 dark:text-gray-300 shrink-0">
                        {formatBytes(evt.reclaimedMb * 1024 * 1024)}
                      </span>
                    )}
                    {evt.durationMs > 0 && (
                      <span className={`text-xs shrink-0 ${evt.durationMs > 100 ? 'text-red-500 dark:text-red-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                        {evt.durationMs.toFixed(1)}ms
                      </span>
                    )}
                    {evt.intervalMs > 0 && (
                      <span className={`text-xs shrink-0 ${evt.intervalMs < 250 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
                        {t('liveMonitor.gc.interval')} {evt.intervalMs}ms
                      </span>
                    )}
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto shrink-0 font-mono">
                      {formatTimestamp(evt.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {gcStarted && gcEvents.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500">{t('liveMonitor.gc.waiting')}</p>
            )}
          </div>

          {/* Live Flame Graph (streaming) */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('liveMonitor.flame.title')}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs text-gray-500 dark:text-gray-400">
                  {t('liveMonitor.flame.window')}
                  <input
                    type="number"
                    value={flameWindowMs}
                    onChange={e => setFlameWindowMs(Number(e.target.value))}
                    min={500}
                    max={30000}
                    step={500}
                    disabled={flameStreamActive}
                    className="ml-1 w-20 px-2 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                  />
                  <span className="ml-1">ms</span>
                </label>
                <label className="text-xs text-gray-500 dark:text-gray-400">
                  {t('liveMonitor.flame.sampling')}
                  <input
                    type="number"
                    value={flameSampleInterval}
                    onChange={e => setFlameSampleInterval(Number(e.target.value))}
                    min={100}
                    max={5000}
                    step={100}
                    disabled={flameStreamActive}
                    className="ml-1 w-20 px-2 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                  />
                  <span className="ml-1">µs</span>
                </label>
                <button
                  onClick={toggleFlameStream}
                  className={`px-4 py-2 rounded-lg font-medium text-sm text-white ${flameStreamActive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  {flameStreamActive ? t('liveMonitor.flame.stop') : t('liveMonitor.flame.start')}
                </button>
              </div>
            </div>

            {flameData && (
              <div className="mb-3 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                <span>
                  {t('liveMonitor.flame.windowIndex')}: <span className="font-mono">{flameData.windowIndex}</span>
                </span>
                <span>
                  {t('liveMonitor.flame.samples')}: <span className="font-mono">{flameData.sampleCount}</span>
                </span>
                <span>
                  {t('liveMonitor.flame.time')}: <span className="font-mono">{flameData.totalTimeMs.toFixed(1)}ms</span>
                </span>
                <span>
                  {t('liveMonitor.flame.updated')}: <span className="font-mono">{formatTimestamp(flameData.updatedAt)}</span>
                </span>
              </div>
            )}

            {flameData ? (
              <FlameGraph flameTree={flameData.flameTree} totalTime={flameData.totalTimeMs || 1} />
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {flameStreamActive ? t('liveMonitor.flame.waiting') : t('liveMonitor.flame.idle')}
              </p>
            )}
          </div>

          {/* Tracing Panel */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('liveMonitor.tracing')}</h2>
              <div className="flex items-center gap-3">
                {tracingActive && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {t('report.totalEvents')}: {tracingEvents.length}
                  </span>
                )}
                <button
                  onClick={toggleTracing}
                  className="px-4 py-2 rounded-lg font-medium text-sm bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {tracingActive ? t('liveMonitor.stopTracing') : t('liveMonitor.startTracing')}
                </button>
              </div>
            </div>
            {tracingEvents.length > 0 && (
              <div className="max-h-96 overflow-y-auto space-y-1.5">
                {tracingEvents.map((evt, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800"
                  >
                    <span className="px-2 py-0.5 rounded text-xs font-medium text-white"
                      style={{ backgroundColor: channelColor(evt.channel) }}
                    >
                      {evt.channel}
                    </span>
                    <span className="text-xs text-gray-600 dark:text-gray-300">{evt.eventType}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto font-mono">
                      {formatTimestamp(evt.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Status Log */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('liveMonitor.statusLog')}</h2>
        <div className="max-h-48 overflow-y-auto font-mono text-xs space-y-0.5">
          {logs.length === 0 ? (
            <p className="text-gray-400 dark:text-gray-500">{t('liveMonitor.noLogs')}</p>
          ) : (
            logs.map((entry, idx) => (
              <div key={idx} className={`${entry.type === 'error' ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                <span className="text-gray-400 dark:text-gray-500">{formatTimestamp(entry.time.getTime())} </span>
                {entry.text}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}