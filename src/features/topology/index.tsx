import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { loadTracingData, loadNdvBuffer } from '../../shared/engine';
import { analyzeDistributed } from '../../shared/distributed';
import type { TopologyGraph, RootCauseReport, ServiceNode, ServiceHealth } from '../../shared/distributed';
import type { TracingEvent, TraceViewerData } from '../../shared/types';
import { useRootStore, useUIStore } from '../../stores';
import { useI18n } from '../../shared/i18n/useI18n';
import { UploadHeader, WideUpload, EmptyState, StatCard, LoadingOverlay, Page, StatGrid } from '../../shared/components';
import { TopologyGraphCanvas } from './components/TopologyGraphCanvas';
import { RootCausePanel } from './components/RootCausePanel';
import { ServiceDetail } from './components/ServiceDetail';
import { createWorkerClient } from '../../shared/workers/worker-factory';
import type { TracingWorkerInput, TracingWorkerOutput } from '../../shared/workers/tracing-handler';

type PanelTab = 'service' | 'rootcause';

const HEALTH_DOT: Record<ServiceHealth, string> = {
  healthy: 'bg-emerald-500',
  warning: 'bg-amber-500',
  faulty: 'bg-red-500',
};

export function TopologyPage() {
  const { t } = useI18n();
  const darkMode = useUIStore(s => s.darkMode);
  const setTraceData = useRootStore(s => s.setTraceData);
  const navigate = useUIStore(s => s.navigate);

  const [graph, setGraph] = useState<TopologyGraph | null>(null);
  const [report, setReport] = useState<RootCauseReport | null>(null);
  const [events, setEvents] = useState<TracingEvent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>('service');

  const workerRef = useRef<ReturnType<typeof createWorkerClient<TracingWorkerInput, TracingWorkerOutput>> | null>(null);
  const [topologyLoading, setTopologyLoading] = useState(false);

  // Lazily create the worker on first use so visiting other pages doesn't
  // spawn an idle Web Worker at startup.
  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = createWorkerClient<TracingWorkerInput, TracingWorkerOutput>(
        new Worker(new URL('../../shared/workers/tracing-handler.ts', import.meta.url), { type: 'module' }),
      );
    }
    return workerRef.current;
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const upload = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      const w = getWorker();
      setTopologyLoading(true);
      try {
        const data = await w.execute({ content, format: 'json' });
        // The worker returns the viewer model but not the raw event list, which
        // the distributed analysis needs; parse the events once on the main thread.
        const evts = loadTracingData(content);
        applyEvents(evts, data);
      } finally {
        setTopologyLoading(false);
      }
    }, [getWorker]),
    onBinaryFile: useCallback(async (buffer: ArrayBuffer) => {
      const w = getWorker();
      setTopologyLoading(true);
      try {
        const data = await w.execute({ content: '', format: 'ndv', ndvBuffer: buffer });
        const evts = loadNdvBuffer(buffer);
        applyEvents(evts, data);
      } finally {
        setTopologyLoading(false);
      }
    }, [getWorker]),
  });
  const { error, handleReset: uploadReset } = upload;

   function applyEvents(evts: TracingEvent[], viewerData: TraceViewerData) {
    const result = analyzeDistributed(evts);
    setGraph(result.graph);
    setReport(result.report);
    setEvents(evts);
    setSelected(null);
    setTraceData(viewerData);
  }

  function handleReset() {
    uploadReset();
    setGraph(null);
    setReport(null);
    setEvents([]);
    setSelected(null);
  }

  function openTraceViewer() {
    if (events.length === 0) return;
    // applyEvents already computed and stored the full TraceViewerData, so we
    // can navigate without re-running the expensive analysis on the main thread.
    navigate('trace-viewer');
  }

  const selectedNode = useMemo<ServiceNode | null>(() => {
    if (!graph || !selected) return null;
    return graph.nodes.find(n => n.id === selected) ?? null;
  }, [graph, selected]);

  const faultyCount = useMemo(() => graph?.nodes.filter(n => n.health === 'faulty').length ?? 0, [graph]);

  if (!graph || !report) {
    return (
      <Page maxWidth="3xl">
        <UploadHeader
          title={t('topology.title')}
          description={t('topology.uploadHint')}
          api={upload}
          accept=".json,.ndv"
          label={t('topology.uploadTitle')}
          maxSize={500 * 1024 * 1024}
          onReset={handleReset}
          error={error}
        />
        <div className="mt-8">
          <EmptyState title={t('topology.noData')} description={t('topology.noDataDesc')} />
        </div>
        <LoadingOverlay visible={upload.loading || upload.urlLoading || topologyLoading} />
      </Page>
    );
  }

  return (
    <Page>
      <div className="mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('topology.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('topology.summary').replace('{services}', String(graph.services)).replace('{traces}', String(graph.traces))}
          </p>
        </div>
      </div>

      <div className="mb-4">
        <WideUpload api={upload} accept=".json,.ndv" label={t('topology.uploadTitle')} maxSize={500 * 1024 * 1024} onReset={handleReset} error={error} />
      </div>

        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <StatGrid cols={4}>
        <StatCard title={t('topology.services')} value={String(graph.services)} />
        <StatCard title={t('topology.traces')} value={String(graph.traces)} />
        <StatCard title={t('topology.edges')} value={String(graph.edges.length)} />
        <StatCard
          title={t('topology.faultyServices')}
          value={String(faultyCount)}
          color={faultyCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}
        />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Graph */}
        <div className="xl:col-span-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="h-[420px] xl:h-[560px]">
            <TopologyGraphCanvas
              nodes={graph.nodes}
              edges={graph.edges}
              selected={selected}
              onSelect={setSelected}
              darkMode={darkMode}
            />
          </div>
          {/* Legend */}
          <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-700 flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
            {(['healthy', 'warning', 'faulty'] as ServiceHealth[]).map(h => (
              <span key={h} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${HEALTH_DOT[h]}`} />
                {t(`topology.health.${h}`)}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="w-6 h-0.5 bg-gray-400 dark:bg-gray-500" /> {t('topology.legend.call')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-6 h-0.5 bg-red-500/70" /> {t('topology.legend.error')}
            </span>
            <span className="ml-auto text-gray-400 dark:text-gray-500">{t('topology.legend.interact')}</span>
          </div>
        </div>

        {/* Panel */}
        <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex rounded-lg bg-gray-100 dark:bg-gray-700 p-1 mb-4">
            <button
              onClick={() => setTab('service')}
              className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-colors ${tab === 'service' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
            >
              {t('topology.tab.service')}
            </button>
            <button
              onClick={() => setTab('rootcause')}
              className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-colors ${tab === 'rootcause' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
            >
              {t('topology.tab.rootCause')}
            </button>
          </div>

          {tab === 'service' ? (
            selectedNode ? (
              <ServiceDetail node={selectedNode} edges={graph.edges} onOpenTraces={openTraceViewer} />
            ) : (
              <EmptyState title={t('topology.noSelection')} description={t('topology.noSelectionDesc')} />
            )
          ) : (
            <div className="max-h-[520px] overflow-auto pr-1">
              <RootCausePanel report={report} onOpenTraces={openTraceViewer} />
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
