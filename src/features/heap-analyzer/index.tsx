import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { useRootStore } from '../../stores';
import { analyzeStrings, analyzeExternalMemory, calculateGrowthRate } from '../../shared/engine';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { createWorkerClient } from '../../shared/workers/worker-factory';
import type { StringAnalysis, MemoryGrowthRate, HeapAnalysis } from '../../shared/types';
import { UploadHeader, WideUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import { formatBytes } from '../../shared/utils';
import { ExportButton } from '../report/ExportButton';
import { toMarkdown } from '../report/exportUtils';
import { useI18n } from '../../shared/i18n/useI18n';

function severityColor(severity: string) {
  switch (severity) {
    case 'high': return 'border-l-red-500 bg-red-50 dark:bg-red-900/20';
    case 'medium': return 'border-l-amber-500 bg-amber-50 dark:bg-amber-900/20';
    case 'low': return 'border-l-blue-500 bg-blue-50 dark:bg-blue-900/20';
    default: return 'border-l-gray-500 bg-gray-50 dark:bg-gray-900';
  }
}

export function HeapAnalyzerPage() {
  const { t } = useI18n();
  const { heapAnalysis, setHeapAnalysis } = useRootStore();
  const [stringAnalysis, setStringAnalysis] = useState<StringAnalysis | null>(null);
  const [externalMemory, setExternalMemory] = useState<{totalExternal: number; totalArrayBuffers: number; externalStrings: number; externalPercent: number} | null>(null);

  // Persistent heap worker for parsing, created lazily on first use so visiting
  // other pages doesn't spawn an idle Web Worker at startup.
  const heapWorkerRef = useRef<ReturnType<typeof createWorkerClient<string, HeapAnalysis>> | null>(null);
  const [heapLoading, setHeapLoading] = useState(false);

  const getHeapWorker = useCallback(() => {
    if (!heapWorkerRef.current) {
      heapWorkerRef.current = createWorkerClient<string, HeapAnalysis>(
        new Worker(new URL('../../shared/workers/heap-handler.ts', import.meta.url), { type: 'module' }),
      );
    }
    return heapWorkerRef.current;
  }, []);

  useEffect(() => {
    return () => {
      heapWorkerRef.current?.terminate();
      heapWorkerRef.current = null;
    };
  }, []);

  const upload = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      setHeapLoading(true);
      try {
        const analysis = await getHeapWorker().execute(content);
        setHeapAnalysis(analysis);
        // These are lightweight and can run on the main thread
        const stringResult = analyzeStrings(analysis.snapshot);
        const externalResult = analyzeExternalMemory(analysis.snapshot);
        setStringAnalysis(stringResult);
        setExternalMemory(externalResult);
      } finally {
        setHeapLoading(false);
      }
    }, [getHeapWorker, setHeapAnalysis, setStringAnalysis, setExternalMemory]),
  });
  const { error, handleReset: uploadReset } = upload;

  function handleReset() {
    uploadReset();
    setHeapAnalysis(null);
    setStringAnalysis(null);
    setExternalMemory(null);
  }

  // Wrap the raw error from parseHeapSnapshot with a more helpful message
  const displayError = error?.includes('"snapshot" field')
    ? t('heapAnalyzer.error')
    : error;

  if (!heapAnalysis) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <UploadHeader
          title={t('heapAnalyzer.title')}
          description={t('heapAnalyzer.description')}
          api={upload}
          accept=".heapsnapshot,.json"
          label={t('heapAnalyzer.uploadTitle')}
          maxSize={3 * 1024 * 1024 * 1024}
          onReset={handleReset}
          error={displayError}
        />
        <LoadingOverlay visible={upload.loading || upload.urlLoading || heapLoading} message={t('heapAnalyzer.loading')} />
        <div className="mt-8">
          <EmptyState
            title={t('heapAnalyzer.noData')}
            description={t('heapAnalyzer.uploadHint')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('heapAnalyzer.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('heapAnalyzer.nodesEdges')
              .replace('{nodes}', heapAnalysis.snapshot.nodeCount.toLocaleString())
              .replace('{edges}', heapAnalysis.snapshot.edgeCount.toLocaleString())}
          </p>
        </div>
        <ExportButton
            onExportMarkdown={() => toMarkdown({
              title: t('heapAnalyzer.exportTitle'),
              sections: [
                {
                  title: t('heapAnalyzer.summary'),
                  type: 'stats',
                  content: [
                    { label: t('heapAnalyzer.totalSize'), value: formatBytes(heapAnalysis.totalSize) },
                    { label: t('heapAnalyzer.totalRetained'), value: formatBytes(heapAnalysis.snapshot.totalRetainedSize) },
                    { label: t('heapAnalyzer.leakSuspects'), value: heapAnalysis.leakSuspects.length.toString() },
                    { label: t('heapAnalyzer.exportNodes'), value: heapAnalysis.snapshot.nodeCount.toLocaleString() },
                    { label: t('heapAnalyzer.exportEdges'), value: heapAnalysis.snapshot.edgeCount.toLocaleString() },
                  ],
                },
                {
                  title: t('heapAnalyzer.topRetained'),
                  type: 'table',
                  content: {
                    headers: [t('heapAnalyzer.name'), t('heapAnalyzer.retainedSize'), t('heapAnalyzer.count')],
                    rows: heapAnalysis.topRetainedNodes.slice(0, 20).map(item => [
                      item.name,
                      formatBytes(item.size),
                      item.count.toLocaleString(),
                    ]),
                  },
                },
                ...(heapAnalysis.leakSuspects.length > 0 ? [{
                  title: t('heapAnalyzer.leakSuspects'),
                  type: 'alert' as const,
                  content: {
                    level: 'error' as const,
                    message: heapAnalysis.leakSuspects.map(s => `[${s.severity}] ${s.description} — ${s.evidence}`).join('; '),
                  },
                }] : []),
                ...(externalMemory ? [{
                  title: t('heapAnalyzer.externalMemory'),
                  type: 'stats' as const,
                  content: [
                    { label: t('heapAnalyzer.externalMemory'), value: formatBytes(externalMemory.totalExternal) },
                    { label: t('heapAnalyzer.arrayBuffers'), value: formatBytes(externalMemory.totalArrayBuffers) },
                    { label: t('heapAnalyzer.externalPercent'), value: externalMemory.externalPercent.toFixed(1) + '%' },
                  ],
                }] : []),
                ...(stringAnalysis ? [{
                  title: t('heapAnalyzer.stringAnalysis'),
                  type: 'stats' as const,
                  content: [
                    { label: t('heapAnalyzer.totalStrings'), value: stringAnalysis.totalStrings.toLocaleString() },
                    { label: t('heapAnalyzer.stringSize'), value: formatBytes(stringAnalysis.totalSelfSize) },
                    { label: t('heapAnalyzer.uniqueStrings'), value: stringAnalysis.uniqueStrings.toLocaleString() },
                    { label: t('heapAnalyzer.dedupRatio'), value: (stringAnalysis.dedupRatio * 100).toFixed(1) + '%' },
                  ],
                }] : []),
              ],
            })}
            filename="heap-analysis"
          />
      </div>

      <div className="mb-4">
        <WideUpload api={upload} accept=".heapsnapshot,.json" label={t('heapAnalyzer.uploadTitle')} maxSize={3 * 1024 * 1024 * 1024} onReset={handleReset} error={displayError} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard title={t('heapAnalyzer.totalSize')} value={formatBytes(heapAnalysis.totalSize)} />
        <StatCard title={t('heapAnalyzer.totalRetained')} value={formatBytes(heapAnalysis.snapshot.totalRetainedSize)} />
        <StatCard title={t('heapAnalyzer.leakSuspects')} value={heapAnalysis.leakSuspects.length.toString()} color={heapAnalysis.leakSuspects.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'} />
      </div>

      {/* Top Retained Objects */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('heapAnalyzer.topRetained')}</h2>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapAnalyzer.name')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapAnalyzer.retainedSize')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapAnalyzer.count')}</th>
              </tr>
            </thead>
            <tbody>
              {heapAnalysis.topRetainedNodes.slice(0, 20).map((item, idx) => (
                <tr key={idx} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-200">{item.name}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(item.size)}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-600 dark:text-gray-300">{item.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Leak Suspects */}
      {heapAnalysis.leakSuspects.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('heapAnalyzer.leakSuspects')}</h2>
          <div className="space-y-2">
            {heapAnalysis.leakSuspects.map((suspect, idx) => (
              <div
                key={idx}
                className={`border-l-4 rounded-r-lg p-3 ${severityColor(suspect.severity)}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    suspect.severity === 'high' ? 'bg-red-200 dark:bg-red-900/40 text-red-800 dark:text-red-300' :
                    suspect.severity === 'medium' ? 'bg-amber-200 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' :
                    'bg-blue-200 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'
                  }`}>
                    {suspect.severity}
                  </span>
                  <span className="text-xs text-gray-500">{suspect.category.replace('-', ' ')}</span>
                </div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{suspect.description}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{suspect.evidence}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* External Memory */}
      {externalMemory && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('heapAnalyzer.externalMemory')}</h2>
          <div className="grid grid-cols-3 gap-3">
            <StatCard title={t('heapAnalyzer.externalMemory')} value={formatBytes(externalMemory.totalExternal)} color="text-orange-600 dark:text-orange-400" />
            <StatCard title={t('heapAnalyzer.arrayBuffers')} value={formatBytes(externalMemory.totalArrayBuffers)} color="text-purple-600 dark:text-purple-400" />
            <StatCard
              title={t('heapAnalyzer.externalPercent')}
              value={externalMemory.externalPercent.toFixed(1) + '%'}
              color={externalMemory.externalPercent > 20 ? 'text-red-600 dark:text-red-400' : undefined}
            />
          </div>
        </div>
      )}

      {/* String Analysis */}
      {stringAnalysis && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('heapAnalyzer.stringAnalysis')}</h2>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <StatCard title={t('heapAnalyzer.totalStrings')} value={stringAnalysis.totalStrings.toLocaleString()} />
            <StatCard title={t('heapAnalyzer.stringSize')} value={formatBytes(stringAnalysis.totalSelfSize)} />
            <StatCard title={t('heapAnalyzer.uniqueStrings')} value={stringAnalysis.uniqueStrings.toLocaleString()} />
            <StatCard title={t('heapAnalyzer.dedupRatio')} value={(stringAnalysis.dedupRatio * 100).toFixed(1) + '%'} />
          </div>

          {/* Top Largest Strings */}
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">{t('heapAnalyzer.topStrings')}</h3>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapAnalyzer.value')}</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapAnalyzer.selfSize')}</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapAnalyzer.retainedSize')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stringAnalysis.topStrings.slice(0, 20).map((item, idx) => (
                    <tr key={idx} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-200 max-w-xs truncate">{item.value}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(item.selfSize)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(item.retainedSize)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Strings by Type */}
          <div>
            <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">{t('heapAnalyzer.stringsByType')}</h3>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapAnalyzer.type')}</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapAnalyzer.count')}</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapAnalyzer.size')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stringAnalysis.byType.map((item, idx) => (
                    <tr key={idx} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="px-4 py-2 text-xs text-gray-700 dark:text-gray-200 capitalize">{item.type.replace('-', ' ')}</td>
                      <td className="px-4 py-2 text-right text-xs text-gray-600 dark:text-gray-300">{item.count.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(item.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Memory Growth Rate */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('heapAnalyzer.leakPattern')}</h2>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('heapAnalyzer.leakPattern.desc')}</p>
        </div>
      </div>

      <LoadingOverlay visible={upload.loading || heapLoading} />
    </div>
  );
}