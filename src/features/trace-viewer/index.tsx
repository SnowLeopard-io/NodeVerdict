import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { useRootStore } from '../../stores';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { encodeNdv, loadTracingData, loadNdvBuffer } from '../../shared/engine';
import { createWorkerClient } from '../../shared/workers/worker-factory';
import type { TracingWorkerInput, TracingWorkerOutput } from '../../shared/workers/tracing-handler';
import { useI18n } from '../../shared/i18n/useI18n';
import { WaterfallChart } from './components/WaterfallChart';
import { BottleneckList } from './components/BottleneckList';
import { UploadHeader, WideUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import type { TraceViewerData, TracingEvent } from '../../shared/types';
import { formatDuration } from '../../shared/utils';

function handleTraceContent(content: string | ArrayBuffer, worker: ReturnType<typeof createWorkerClient<TracingWorkerInput, TracingWorkerOutput>>): Promise<TraceViewerData> {
  const input: TracingWorkerInput = typeof content === 'string'
    ? { content, format: 'json' }
    : { content: '', format: 'ndv', ndvBuffer: content };
  return worker.execute(input);
}

function downloadNdv(events: TracingEvent[]) {
  if (events.length === 0) return;
  const bytes = encodeNdv(events);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trace-${Date.now()}.ndv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function TraceViewerPage() {
  const { t } = useI18n();
  const { traceData, traceEvents, setTraceData, setTraceEvents } = useRootStore();

  const workerRef = useRef<ReturnType<typeof createWorkerClient<TracingWorkerInput, TracingWorkerOutput>> | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  // Lazily create the worker on first use so visiting other pages doesn't spawn
  // an idle Web Worker at startup.
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
      setTraceLoading(true);
      try {
        const data = await handleTraceContent(content, w);
        setTraceData(data);
        setTraceEvents(loadTracingData(content));
      } finally {
        setTraceLoading(false);
      }
    }, [getWorker, setTraceData, setTraceEvents]),
    onBinaryFile: useCallback(async (buffer: ArrayBuffer) => {
      const w = getWorker();
      setTraceLoading(true);
      try {
        const data = await handleTraceContent(buffer, w);
        setTraceData(data);
        setTraceEvents(loadNdvBuffer(buffer));
      } finally {
        setTraceLoading(false);
      }
    }, [getWorker, setTraceData, setTraceEvents]),
  });
  const { error, handleReset: uploadReset } = upload;

  function handleReset() {
    uploadReset();
    setTraceData(null);
    setTraceEvents([]);
  }

  const spans = traceData?.spans ?? [];
  const dependencies = traceData?.dependencies ?? [];
  const bottlenecks = traceData?.bottlenecks ?? [];

  const totalDuration = traceData?.timeRange ? traceData.timeRange.end - traceData.timeRange.start : 0;

  function spanCount(spans: { children: any[] }[]): number {
    let count = 0;
    for (const s of spans) {
      count++;
      count += spanCount(s.children);
    }
    return count;
  }

  if (!traceData) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <UploadHeader
          title={t('traceViewer.title')}
          description={t('traceViewer.uploadHint')}
          api={upload}
          accept=".json,.ndv"
          label={t('traceViewer.uploadTitle')}
          maxSize={500 * 1024 * 1024}
          onReset={handleReset}
          error={error}
        />
        <LoadingOverlay visible={upload.loading || upload.urlLoading || traceLoading} message={t('traceViewer.buildingTrace')} />
        <div className="mt-8">
          <EmptyState
            title={t('traceViewer.noData')}
            description={t('traceViewer.uploadDesc')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('traceViewer.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('traceViewer.operationsAndLinks').replace('{operations}', String(traceData.totalOperations)).replace('{links}', String(dependencies.length))}</p>
        </div>
        <div className="mt-4">
          <WideUpload api={upload} accept=".json,.ndv" label={t('traceViewer.uploadTitle')} maxSize={500 * 1024 * 1024} onReset={handleReset} error={error} />
        </div>
      </div>

      <div className="mb-4">
        <button
          onClick={() => downloadNdv(traceEvents)}
          className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          {t('traceViewer.exportNdv')}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard title={t('traceViewer.totalSpans')} value={formatDuration(totalDuration)} subtitle={t('traceViewer.spanCount').replace('{count}', String(spanCount(spans)))} />
        <StatCard title={t('traceViewer.operations')} value={traceData.totalOperations.toString()} />
        <StatCard title={t('traceViewer.bottleneckCount')} value={bottlenecks.length.toString()} color={bottlenecks.length > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-900 dark:text-gray-100'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3">
          <WaterfallChart spans={spans} />
        </div>
        <div>
          <BottleneckList bottlenecks={bottlenecks} />
        </div>
      </div>

      <LoadingOverlay visible={upload.loading || traceLoading} />
    </div>
  );
}