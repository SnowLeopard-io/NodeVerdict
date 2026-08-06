import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { analyzeTraceWithLLM, analyzeTraceLocally, loadRcaConfig, saveRcaConfig, clearRcaConfig, isRcaConfigured } from '../../shared/ai';
import type { RcaConfig } from '../../shared/ai';
import { createWorkerClient } from '../../shared/workers/worker-factory';
import type { TracingWorkerInput, TracingWorkerOutput } from '../../shared/workers/tracing-handler';
import { FileUpload, EmptyState, StatCard } from '../../shared/components';
import { ExportButton } from '../report/ExportButton';
import type { TraceViewerData, TraceSpan } from '../../shared/types';
import { useI18n } from '../../shared/i18n/useI18n';

function RcaConfigModal({ open, onClose, onSave }: {
  open: boolean;
  onClose: () => void;
  onSave: (config: RcaConfig) => void;
}) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-4o-mini');
  useEffect(() => {
    const config = loadRcaConfig();
    if (config) {
      setApiKey(config.apiKey ?? '');
      setBaseUrl(config.baseUrl ?? 'https://api.openai.com/v1');
      setModel(config.model ?? 'gpt-4o-mini');
    }
  }, [open]);
  const [showKey, setShowKey] = useState(false);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 max-h-[calc(100vh-2rem)] overflow-y-auto my-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">{t('aiRca.configTitle')}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{t('aiRca.configDesc')}</p>

        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">{t('aiRca.apiKey')}</label>
        <div className="flex gap-2 mb-3">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button onClick={() => setShowKey(!showKey)} className="px-3 py-2 text-xs rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
            {showKey ? t('aiRca.hide') : t('aiRca.show')}
          </button>
        </div>

        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">{t('aiRca.baseUrl')}</label>
        <input
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          placeholder="https://api.openai.com/v1"
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-800 dark:text-gray-100 mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />

        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">{t('aiRca.model')}</label>
        <input
          value={model}
          onChange={e => setModel(e.target.value)}
          placeholder="gpt-4o-mini"
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-800 dark:text-gray-100 mb-5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />

        <div className="flex justify-end gap-2">
          {isRcaConfigured() && (
            <button
              onClick={() => { clearRcaConfig(); onClose(); }}
              className="px-4 py-2 text-sm rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              {t('aiRca.clearKey')}
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            {t('aiRca.cancel')}
          </button>
          <button
            onClick={() => { saveRcaConfig({ apiKey, baseUrl, model }); onSave({ apiKey, baseUrl, model }); }}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            {t('aiRca.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function AiRcaPage() {
  const { t, lang } = useI18n();
  const [analysis, setAnalysis] = useState<TraceViewerData | null>(null);
  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const [report, setReport] = useState<string>('');
  const [reportError, setReportError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSession, setModalSession] = useState(0);
  const reportRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const workerRef = useRef<ReturnType<typeof createWorkerClient<TracingWorkerInput, TracingWorkerOutput>> | null>(null);
  const [rcaLoading, setRcaLoading] = useState(false);

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
      setRcaLoading(true);
      try {
        const a = await w.execute({ content, format: 'json' });
        applyTrace(a);
      } finally {
        setRcaLoading(false);
      }
    }, [getWorker]),
    onBinaryFile: useCallback(async (buffer: ArrayBuffer) => {
      const w = getWorker();
      setRcaLoading(true);
      try {
        const a = await w.execute({ content: '', format: 'ndv', ndvBuffer: buffer });
        applyTrace(a);
      } finally {
        setRcaLoading(false);
      }
    }, [getWorker]),
  });
  const { loading, error, fileName, fileSize, handleFile, progress, urlLoading, urlError, urlProgress, loadFromUrl, cancelUrl, handleReset: uploadReset } = upload;

  function applyTrace(a: TraceViewerData) {
    const s = a.spans;
    setAnalysis(a);
    setSpans(s);
    setReport('');
    setReportError(null);
  }

  function handleReset() {
    uploadReset();
    setAnalysis(null);
    setSpans([]);
    setReport('');
    setReportError(null);
  }

  async function runDiagnosis(useLocal: boolean) {
    if (!analysis) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setReportError(null);
    setReport('');
    try {
      const result = useLocal
        ? analyzeTraceLocally(analysis, spans, lang)
        : await analyzeTraceWithLLM({
            config: loadRcaConfig()!,
            analysis,
            spans,
            lang,
            signal: controller.signal,
            onStream: chunk => setReport(prev => prev + chunk),
          });
      if (controller.signal.aborted) return;
      setReport(result);
    } catch (err) {
      if (controller.signal.aborted) return;
      setReportError((err as Error).message);
    } finally {
      if (abortRef.current === controller) {
        setRunning(false);
        requestAnimationFrame(() => reportRef.current?.scrollTo({ top: reportRef.current.scrollHeight }));
      }
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  async function handleAiDiagnose() {
    if (!isRcaConfigured()) {
      setModalSession(s => s + 1);
      setModalOpen(true);
      return;
    }
    await runDiagnosis(false);
  }

  const stats = useMemo(() => {
    if (!analysis) return null;
    return {
      events: analysis.totalEvents,
      operations: analysis.totalOperations,
      errorRate: `${(analysis.errorRate * 100).toFixed(1)}%`,
      channels: analysis.channels.length,
    };
  }, [analysis]);

  return (
    <div className={!analysis ? "p-6 max-w-3xl mx-auto" : "p-6"}>
      <RcaConfigModal
        key={modalSession}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={async () => { setModalOpen(false); await runDiagnosis(false); }}
      />

      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('aiRca.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('aiRca.subtitle')}</p>
        </div>
        <div className="w-full max-w-2xl">
        <FileUpload
          onFile={handleFile}
          accept=".json,.ndv"
          label={t('aiRca.uploadLabel')}
          maxSize={500 * 1024 * 1024}
          fileName={fileName}
          fileSize={fileSize}
          onReset={handleReset}
          loading={loading}
          progress={progress}
          onUrlLoad={loadFromUrl}
          urlLoading={urlLoading}
          urlError={urlError}
          urlProgress={urlProgress}
          onUrlCancel={cancelUrl}
        />
        {(error || urlError) && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error ?? urlError}</p>}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!analysis ? (
        <div className="mt-8">
          <EmptyState
            title={t('aiRca.noData')}
            description={t('aiRca.noDataDesc')}
          />
        </div>
      ) : (
        <>
          {stats && (
            <div className="grid grid-cols-4 gap-3 mb-4">
              <StatCard title={t('aiRca.events')} value={stats.events.toString()} />
              <StatCard title={t('aiRca.operations')} value={stats.operations.toString()} />
              <StatCard title={t('aiRca.errorRate')} value={stats.errorRate} color={parseFloat(stats.errorRate) > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'} />
              <StatCard title={t('aiRca.channels')} value={stats.channels.toString()} />
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              onClick={handleAiDiagnose}
              disabled={running}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {running ? t('aiRca.analyzing') : t('aiRca.diagnose')}
            </button>
            {running && (
              <button
                onClick={handleCancel}
                className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                {t('aiRca.cancel')}
              </button>
            )}
            {!isRcaConfigured() && (
              <button
                onClick={() => { setModalSession(s => s + 1); setModalOpen(true); }}
                className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                {t('aiRca.configure')}
              </button>
            )}
            {!isRcaConfigured() && (
              <button
                onClick={() => runDiagnosis(true)}
                disabled={running}
                className="px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {t('aiRca.localDiagnose')}
              </button>
            )}
            {report && !running && (
              <ExportButton filename="ai-rca-report" onExportMarkdown={() => report} />
            )}
          </div>

          {reportError && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
              {reportError}
            </div>
          )}

          {(running || report) && (
            <div ref={reportRef} className="max-h-[480px] overflow-auto rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-6">
              {report ? (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                  <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  {t('aiRca.analyzing')}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
