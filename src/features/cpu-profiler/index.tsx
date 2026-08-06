import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { useRootStore } from '../../stores';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { createWorkerClient } from '../../shared/workers/worker-factory';
import { FlameGraph } from './components/FlameGraph';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import type { CpuProfileAnalysis } from '../../shared/types';
import { ExportButton } from '../report/ExportButton';
import { toMarkdown } from '../report/exportUtils';
import { useI18n } from '../../shared/i18n/useI18n';

export function CpuProfilerPage() {
  const { t } = useI18n();
  const [analysis, setAnalysis] = useState<CpuProfileAnalysis | null>(null);
  const [sortBy, setSortBy] = useState<'self' | 'total'>('total');

  const workerRef = useRef<ReturnType<typeof createWorkerClient<string, CpuProfileAnalysis>> | null>(null);
  const [cpuLoading, setCpuLoading] = useState(false);

  // Lazily create the worker on first use so visiting other pages doesn't spawn
  // an idle Web Worker at startup.
  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = createWorkerClient<string, CpuProfileAnalysis>(
        new Worker(new URL('../../shared/workers/cpu-profile-handler.ts', import.meta.url), { type: 'module' }),
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

  // Must be before any early return to keep hooks consistent
  const sortedFunctions = useMemo(() => {
    if (!analysis) return [];
    const list = [...analysis.hotFunctions];
    if (sortBy === 'self') {
      list.sort((a, b) => b.selfTime - a.selfTime);
    } else {
      list.sort((a, b) => b.totalTime - a.totalTime);
    }
    return list.slice(0, 100);
  }, [analysis, sortBy]);
  const upload = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      const w = getWorker();
      setCpuLoading(true);
      try {
        const result = await w.execute(content);
        setAnalysis(result);
      } finally {
        setCpuLoading(false);
      }
    }, [getWorker]),
  });
  const { loading, error, fileName, fileSize, handleFile, progress, urlLoading, urlError, urlProgress, loadFromUrl, cancelUrl, handleReset } = upload;

  if (!analysis) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('cpuProfiler.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('cpuProfiler.description')}</p>
        </div>
        <FileUpload
          onFile={handleFile}
          accept=".cpuprofile,.json"
          label={t('cpuProfiler.uploadTitle')}
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
        <LoadingOverlay visible={loading || urlLoading || cpuLoading} message={t('cpuProfiler.loading')} />
        <div className="mt-8">
          <EmptyState
            title={t('cpuProfiler.noData')}
            description={t('cpuProfiler.uploadHint')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('cpuProfiler.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('cpuProfiler.samplesTotal')
              .replace('{samples}', analysis.sampleCount.toLocaleString())
              .replace('{ms}', analysis.totalTime.toFixed(2))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            onExportMarkdown={() => toMarkdown({
              title: t('cpuProfiler.exportTitle'),
              sections: [
                {
                  title: t('cpuProfiler.summary'),
                  type: 'stats',
                  content: [
                    { label: t('cpuProfiler.totalTime'), value: `${analysis.totalTime.toFixed(1)}ms` },
                    { label: t('cpuProfiler.samples'), value: analysis.sampleCount.toLocaleString() },
                    { label: t('cpuProfiler.functions'), value: analysis.hotFunctions.length.toLocaleString() },
                    { label: t('cpuProfiler.topHot'), value: analysis.topFunctions[0]?.functionName ?? 'N/A' },
                  ],
                },
                {
                  title: t('cpuProfiler.hotFunctions'),
                  type: 'table',
                  content: {
                    headers: [t('cpuProfiler.functionName'), t('cpuProfiler.exportFile'), t('cpuProfiler.selfTime'), t('cpuProfiler.totalTimeLabel'), t('cpuProfiler.exportSelfPercent'), t('cpuProfiler.exportHits')],
                    rows: sortedFunctions.slice(0, 30).map(fn => [
                      fn.functionName,
                      fn.url ? fn.url.split('/').pop() + (fn.line ? `:${fn.line}` : '') : '-',
                      `${fn.selfTime.toFixed(2)}ms`,
                      `${fn.totalTime.toFixed(2)}ms`,
                      `${fn.selfPercent.toFixed(1)}%`,
                      fn.hitCount.toLocaleString(),
                    ]),
                  },
                },
              ],
            })}
            filename="cpu-profile"
          />
          <div className="w-72">
            <FileUpload
              onFile={handleFile}
              accept=".cpuprofile,.json"
              label={t('cpuProfiler.uploadTitle')}
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
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard title={t('cpuProfiler.totalTime')} value={`${analysis.totalTime.toFixed(1)}ms`} />
        <StatCard title={t('cpuProfiler.samples')} value={analysis.sampleCount.toLocaleString()} />
        <StatCard title={t('cpuProfiler.functions')} value={analysis.hotFunctions.length.toLocaleString()} />
        <StatCard title={t('cpuProfiler.topHot')} value={analysis.topFunctions[0]?.functionName ?? 'N/A'} subtitle={analysis.topFunctions[0] ? `${analysis.topFunctions[0].totalTime.toFixed(1)}ms` : ''} />
      </div>

      {/* Profiler Controls */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg mb-4">
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('cpuProfiler.flameGraph.controls')}</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('cpuProfiler.sortBy')}:</span>
            <button
              onClick={() => setSortBy('total')}
              className={`px-2 py-1 text-xs rounded ${sortBy === 'total' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              {t('cpuProfiler.sortTotal')}
            </button>
            <button
              onClick={() => setSortBy('self')}
              className={`px-2 py-1 text-xs rounded ${sortBy === 'self' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              {t('cpuProfiler.sortSelf')}
            </button>
            <span className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
            <button
              onClick={handleReset}
              className="px-2 py-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
            >
              ✕ {t('cpuProfiler.flameGraph.clear')}
            </button>
          </div>
        </div>
        <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
          {t('cpuProfiler.flameGraph.hint')}
        </div>
      </div>

      {/* Flame Graph */}
      <div className="mb-6">
        <FlameGraph flameTree={analysis.flameTree} totalTime={analysis.totalTime} />
      </div>

      {/* Hot Functions Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('cpuProfiler.hotFunctions')}</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('cpuProfiler.sortBy')}:</span>
            <button
              onClick={() => setSortBy('total')}
              className={`px-2 py-1 text-xs rounded ${sortBy === 'total' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              {t('cpuProfiler.sortTotal')}
            </button>
            <button
              onClick={() => setSortBy('self')}
              className={`px-2 py-1 text-xs rounded ${sortBy === 'self' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              {t('cpuProfiler.sortSelf')}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0">
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('cpuProfiler.functionName')}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('cpuProfiler.exportFile')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('cpuProfiler.selfTime')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('cpuProfiler.totalTimeLabel')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('cpuProfiler.exportSelfPercent')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('cpuProfiler.exportHits')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedFunctions.map((fn, idx) => (
                <tr key={idx} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-200 max-w-xs truncate">{fn.functionName}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 max-w-[120px] truncate">
                    {fn.url ? fn.url.split('/').pop() + (fn.line ? `:${fn.line}` : '') : '-'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{fn.selfTime.toFixed(2)}ms</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{fn.totalTime.toFixed(2)}ms</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{fn.selfPercent.toFixed(1)}%</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-600 dark:text-gray-300">{fn.hitCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}