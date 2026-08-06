import { useState, useCallback, useRef, useEffect } from 'react';
import { diffHeapSnapshots } from '../../shared/engine';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { createWorkerClient } from '../../shared/workers/worker-factory';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import { formatBytes } from '../../shared/utils';
import type { HeapSnapshot, HeapAnalysis } from '../../shared/types';
import type { HeapDiffResult } from '../../shared/engine';
import { useRootStore } from '../../stores/root-store';
import { ExportButton } from '../report/ExportButton';
import { toMarkdown } from '../report/exportUtils';
import { useI18n } from '../../shared/i18n/useI18n';

export function HeapDiffPage() {
  const { t } = useI18n();
  const [snapshotA, setSnapshotA] = useState<HeapSnapshot | null>(null);
  const [snapshotB, setSnapshotB] = useState<HeapSnapshot | null>(null);
  const [diffResult, setDiffResult] = useState<HeapDiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileAName, setFileAName] = useState<string | null>(null);
  const [fileBName, setFileBName] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

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

  const parseInWorker = useCallback(async (content: string): Promise<HeapSnapshot> => {
    const analysis = await getHeapWorker().execute(content);
    return analysis.snapshot;
  }, [getHeapWorker]);

  const uploadA = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      setError(null);
      setFileAName('A');
      setHeapLoading(true);
      try {
        const snapshot = await parseInWorker(content);
        setSnapshotA(snapshot);
        if (snapshotB) {
          setDiffResult(diffHeapSnapshots(snapshot, snapshotB));
        }
      } catch (err) {
        const msg = (err as Error).message;
        setError(msg.includes('"snapshot" field') ? t('heapDiff.error') : msg);
      } finally {
        setHeapLoading(false);
      }
    }, [snapshotB, t, parseInWorker]),
  });
  const uploadB = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      setError(null);
      setFileBName('B');
      setHeapLoading(true);
      try {
        const snapshot = await parseInWorker(content);
        setSnapshotB(snapshot);
        if (snapshotA) {
          setDiffResult(diffHeapSnapshots(snapshotA, snapshot));
        }
      } catch (err) {
        const msg = (err as Error).message;
        setError(msg.includes('"snapshot" field') ? t('heapDiff.error') : msg);
      } finally {
        setHeapLoading(false);
      }
    }, [snapshotA, t, parseInWorker]),
  });

  const { loading: loadingA, error: errorA, fileName: fileNameA, fileSize: fileSizeA, handleFile: handleFileA, progress: progressA, urlLoading: urlLoadingA, urlError: urlErrorA, urlProgress: urlProgressA, loadFromUrl: loadFromUrlA, cancelUrl: cancelUrlA, handleReset: resetA } = uploadA;
  const { loading: loadingB, error: errorB, fileName: fileNameB, fileSize: fileSizeB, handleFile: handleFileB, progress: progressB, urlLoading: urlLoadingB, urlError: urlErrorB, urlProgress: urlProgressB, loadFromUrl: loadFromUrlB, cancelUrl: cancelUrlB, handleReset: resetB } = uploadB;

  const loading = loadingA || loadingB || heapLoading;

  function handleReset() {
    resetA();
    resetB();
    setSnapshotA(null);
    setSnapshotB(null);
    setDiffResult(null);
    setError(null);
    setFileAName(null);
    setFileBName(null);
    setSaveMessage(null);
  }

  function handleSaveToHistory() {
    if (!diffResult) return;
    useRootStore.getState().addSnapshotRecord({
      label: t('heapDiff.titleVs').replace('{a}', fileAName ?? t('heapDiff.snapshotA')).replace('{b}', fileBName ?? t('heapDiff.snapshotB')),
      beforeName: fileAName ?? t('heapDiff.snapshotA'),
      afterName: fileBName ?? t('heapDiff.snapshotB'),
      beforeSize: diffResult.totalSizeBefore,
      afterSize: diffResult.totalSizeAfter,
      newNodeCount: diffResult.newNodes.length,
      removedNodeCount: diffResult.removedNodes.length,
      retainedSizeDelta: diffResult.totalSizeDelta,
      growthRate: diffResult.totalSizeBefore > 0
        ? (diffResult.totalSizeDelta / diffResult.totalSizeBefore) * 100
        : null,
      flagged: diffResult.totalSizeDelta > 0,
    });
    setSaveMessage(t('heapDiff.saved'));
    setTimeout(() => setSaveMessage(null), 3000);
  }

  if (!diffResult) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('heapDiff.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('heapDiff.description')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('heapDiff.uploadBefore')}</p>
            <FileUpload
              onFile={handleFileA}
              accept=".heapsnapshot,.json"
              label={t('heapDiff.uploadBefore')}
              maxSize={3 * 1024 * 1024 * 1024}
              fileName={fileNameA}
              fileSize={fileSizeA}
              onReset={resetA}
              loading={loadingA}
              progress={progressA}
              onUrlLoad={loadFromUrlA}
              urlLoading={urlLoadingA}
              urlError={urlErrorA}
              urlProgress={urlProgressA}
              onUrlCancel={cancelUrlA}
            />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('heapDiff.uploadAfter')}</p>
            <FileUpload
              onFile={handleFileB}
              accept=".heapsnapshot,.json"
              label={t('heapDiff.uploadAfter')}
              maxSize={3 * 1024 * 1024 * 1024}
              fileName={fileNameB}
              fileSize={fileSizeB}
              onReset={resetB}
              loading={loadingB}
              progress={progressB}
              onUrlLoad={loadFromUrlB}
              urlLoading={urlLoadingB}
              urlError={urlErrorB}
              urlProgress={urlProgressB}
              onUrlCancel={cancelUrlB}
            />
          </div>
        </div>

        {(error || errorA || errorB || urlErrorA || urlErrorB) && <p className="text-sm text-red-600 dark:text-red-400">{error ?? errorA ?? errorB ?? urlErrorA ?? urlErrorB}</p>}
        <LoadingOverlay visible={loading} message={t('heapDiff.loading')} />

        <div className="mt-8">
          <EmptyState
            title={t('heapDiff.noData')}
            description={t('heapDiff.uploadHint')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('heapDiff.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('heapDiff.comparing')
              .replace('{a}', fileAName ?? t('heapDiff.snapshotA'))
              .replace('{b}', fileBName ?? t('heapDiff.snapshotB'))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            onExportMarkdown={() => toMarkdown({
              title: t('heapDiff.exportTitle'),
              sections: [
                {
                  title: t('heapDiff.summary'),
                  type: 'stats',
                  content: [
                    { label: t('heapDiff.sizeBefore'), value: formatBytes(diffResult.totalSizeBefore) },
                    { label: t('heapDiff.sizeAfter'), value: formatBytes(diffResult.totalSizeAfter) },
                    { label: t('heapDiff.sizeDelta'), value: `${diffResult.totalSizeDelta >= 0 ? '+' : ''}${formatBytes(Math.abs(diffResult.totalSizeDelta))}` },
                    { label: t('heapDiff.objectDelta'), value: `${diffResult.totalCountDelta >= 0 ? '+' : ''}${diffResult.totalCountDelta.toLocaleString()}` },
                    { label: t('heapDiff.newTypes'), value: diffResult.newNodes.length.toString() },
                    { label: t('heapDiff.growingTypes'), value: diffResult.growingNodes.length.toString() },
                    { label: t('heapDiff.removedTypes'), value: diffResult.removedNodes.length.toString() },
                  ],
                },
                {
                  title: t('heapDiff.typeComparison'),
                  type: 'table',
                  content: {
                    headers: [t('heapAnalyzer.name'), t('heapDiff.type'), t('heapDiff.objectDelta'), t('heapDiff.sizeBeforeLabel'), t('heapDiff.sizeAfterLabel'), t('heapDiff.sizeDeltaLabel')],
                    rows: diffResult.nodes.slice(0, 50).map(node => [
                      node.name,
                      node.type,
                      `${node.countDelta > 0 ? '+' : ''}${node.countDelta.toLocaleString()}`,
                      formatBytes(node.beforeSize),
                      formatBytes(node.afterSize),
                      `${node.sizeDelta > 0 ? '+' : ''}${formatBytes(node.sizeDelta)}`,
                    ]),
                  },
                },
                ...(diffResult.growingNodes.length > 0 ? [{
                  title: t('heapDiff.growingTypes'),
                  type: 'alert' as const,
                  content: {
                    level: 'warning' as const,
                    message: diffResult.growingNodes.slice(0, 10).map(n => t('heapDiff.grewBy').replace('{name}', n.name).replace('{delta}', formatBytes(n.sizeDelta))).join('; '),
                  },
                }] : []),
                ...(diffResult.removedNodes.length > 0 ? [{
                  title: t('heapDiff.removedTypes'),
                  type: 'alert' as const,
                  content: {
                    level: 'info' as const,
                    message: t('heapDiff.removedTypesCount').replace('{count}', String(diffResult.removedNodes.length)),
                  },
                }] : []),
              ],
            })}
            filename="heap-diff"
          />
          <button
            onClick={handleSaveToHistory}
            className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            {t('heapDiff.saveToHistory')}
          </button>
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {t('common.clear')} & {t('common.reset')}
          </button>
        </div>
      </div>

      {saveMessage && (
        <div className="mb-4 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg text-sm text-emerald-700 dark:text-emerald-300">
          {saveMessage}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard title={t('heapDiff.sizeBeforeLabel')} value={formatBytes(diffResult.totalSizeBefore)} />
        <StatCard title={t('heapDiff.sizeAfterLabel')} value={formatBytes(diffResult.totalSizeAfter)} />
        <StatCard
          title={t('heapDiff.sizeDeltaLabel')}
          value={`${diffResult.totalSizeDelta >= 0 ? '+' : ''}${formatBytes(Math.abs(diffResult.totalSizeDelta))}`}
          color={diffResult.totalSizeDelta > 0 ? 'text-red-600 dark:text-red-400' : diffResult.totalSizeDelta < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-gray-100'}
        />
        <StatCard
          title={t('heapDiff.objectDelta')}
          value={`${diffResult.totalCountDelta >= 0 ? '+' : ''}${diffResult.totalCountDelta.toLocaleString()}`}
          color={diffResult.totalCountDelta > 0 ? 'text-red-600 dark:text-red-400' : diffResult.totalCountDelta < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-gray-100'}
        />
      </div>

      {/* New / Growing / Removed summaries */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard
          title={t('heapDiff.newTypes')}
          value={diffResult.newNodes.length.toString()}
          color="text-red-600 dark:text-red-400"
        />
        <StatCard
          title={t('heapDiff.growingTypes')}
          value={diffResult.growingNodes.length.toString()}
          color="text-amber-600 dark:text-amber-400"
          subtitle={`${diffResult.growingNodes.slice(0, 3).map(n => `${n.name} +${formatBytes(n.sizeDelta)}`).join(', ')}${diffResult.growingNodes.length > 3 ? '...' : ''}`}
        />
        <StatCard
          title={t('heapDiff.removedTypes')}
          value={diffResult.removedNodes.length.toString()}
          color="text-emerald-600 dark:text-emerald-400"
        />
      </div>

      {/* Full Diff Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('heapDiff.title')} — {t('heapDiff.sizeDeltaLabel')}</h2>
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0">
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapAnalyzer.name')}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapDiff.type')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapDiff.objectDelta')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapDiff.sizeBeforeLabel')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapDiff.sizeAfterLabel')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('heapDiff.sizeDeltaLabel')}</th>
              </tr>
            </thead>
            <tbody>
              {diffResult.nodes.slice(0, 200).map((node, idx) => (
                <tr key={idx} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-200 max-w-xs truncate">{node.name}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{node.type}</td>
                  <td className={`px-4 py-2 text-right font-mono text-xs ${
                    node.countDelta > 0 ? 'text-red-600 dark:text-red-400' : node.countDelta < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-600 dark:text-gray-300'
                  }`}>
                    {node.countDelta > 0 ? '+' : ''}{node.countDelta.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(node.beforeSize)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(node.afterSize)}</td>
                  <td className={`px-4 py-2 text-right font-mono text-xs ${
                    node.sizeDelta > 0 ? 'text-red-600 dark:text-red-400 font-medium' : node.sizeDelta < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-600 dark:text-gray-300'
                  }`}>
                    {node.sizeDelta > 0 ? '+' : ''}{formatBytes(node.sizeDelta)}
                  </td>
                </tr>
              ))}
              {diffResult.nodes.length > 200 && (
                <tr className="bg-gray-50 dark:bg-gray-900">
                  <td colSpan={6} className="px-4 py-3 text-center text-xs text-gray-500 dark:text-gray-400">
                    {t('heapDiff.showingFirst').replace('{limit}', '200').replace('{count}', String(diffResult.nodes.length))}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}