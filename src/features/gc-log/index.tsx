import { useCallback, useState } from 'react';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { parseGcLog } from '../../shared/engine';
import { UploadHeader, WideUpload, EmptyState, StatCard, LoadingOverlay, Page, StatGrid } from '../../shared/components';
import { formatDuration } from '../../shared/utils';
import type { GCLogAnalysis } from '../../shared/types';
import { ExportButton } from '../report/ExportButton';
import { toMarkdown } from '../report/exportUtils';
import { useI18n } from '../../shared/i18n/useI18n';

function gcTypeColor(type: string): string {
  const lower = type.toLowerCase();
  if (lower.includes('scavenge')) return 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30';
  if (lower.includes('mark') || lower.includes('sweep')) return 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30';
  if (lower.includes('full')) return 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30';
  return 'text-gray-700 dark:text-gray-400 bg-gray-50 dark:bg-gray-800';
}

export function GcLogPage() {
  const { t } = useI18n();
  const [gcLog, setGcLog] = useState<GCLogAnalysis | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const upload = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      setParseError(null);
      try {
        const result = parseGcLog(content);
        setGcLog(result);
      } catch (err) {
        const message = (err as Error).message;
        if (message.includes('No GC events found')) {
          setParseError(t('gcLog.noGcEvents'));
        } else {
          setParseError(message);
        }
        setGcLog(null);
      }
    }, [t]),
  });
  const { error, handleReset: uploadReset } = upload;

  const displayError = parseError || error;

  function handleReset() {
    uploadReset();
    setGcLog(null);
    setParseError(null);
  }

  if (!gcLog) {
    return (
      <Page maxWidth="3xl">
        <UploadHeader
          title={t('gcLog.title')}
          description={t('gcLog.description')}
          api={upload}
          accept=".txt,.log,.gc.log"
          label={t('gcLog.uploadTitle')}
          maxSize={3 * 1024 * 1024 * 1024}
          onReset={handleReset}
          error={displayError}
        />
        <LoadingOverlay visible={upload.loading || upload.urlLoading} message={t('gcLog.loading')} />
        <div className="mt-8">
          <EmptyState
            title={t('gcLog.noData')}
            description={t('gcLog.description')}
          />
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('gcLog.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('gcLog.eventsCount').replace('{count}', gcLog.totalGcs.toLocaleString()).replace('{totalPause}', gcLog.totalPauseMs.toFixed(1))}
          </p>
        </div>
        <ExportButton
            onExportMarkdown={() => toMarkdown({
              title: t('gcLog.exportTitle'),
              sections: [
                {
                  title: t('memoryTimeline.summary'),
                  type: 'stats',
                  content: [
                    { label: t('gcLog.totalGcs'), value: gcLog.totalGcs.toLocaleString() },
                    { label: t('gcLog.majorGcs'), value: gcLog.majorGcCount.toLocaleString() },
                    { label: t('gcLog.minorGcs'), value: gcLog.minorGcCount.toLocaleString() },
                    { label: t('gcLog.totalPauseTime'), value: formatDuration(gcLog.totalPauseMs) },
                    { label: t('gcLog.avgMajorPause'), value: formatDuration(gcLog.avgMajorPauseMs) },
                    { label: t('gcLog.avgMinorPause'), value: formatDuration(gcLog.avgMinorPauseMs) },
                  ],
                },
                {
                  title: t('gcLog.externalMemory'),
                  type: 'alert' as const,
                  content: {
                    level: (gcLog.externalUnmanaged ? 'error' : 'info') as 'error' | 'info',
                    message: gcLog.externalUnmanaged
                      ? t('gcLog.externalMemoryWarningMsg').replace('{growth}', gcLog.externalGrowthMb.toFixed(1))
                      : t('gcLog.externalMemoryOkMsg').replace('{growth}', gcLog.externalGrowthMb.toFixed(1)),
                  },
                },
                {
                  title: t('gcLog.gcEvents'),
                  type: 'table',
                  content: {
                    headers: [t('gcLog.timestamp'), t('gcLog.type'), t('gcLog.heapBefore'), t('gcLog.heapAfter'), t('gcLog.duration'), t('gcLog.pauseType')],
                    rows: gcLog.entries.slice(0, 50).map(entry => [
                      entry.timestamp.toLocaleString(),
                      entry.type,
                      `${(entry.heapBefore / (1024 * 1024)).toFixed(1)} MB`,
                      `${(entry.heapAfter / (1024 * 1024)).toFixed(1)} MB`,
                      formatDuration(entry.durationMs),
                      entry.pauseType,
                    ]),
                  },
                },
              ],
            })}
            filename="gc-log"
          />
      </div>

      <div className="mb-4">
        <WideUpload api={upload} accept=".txt,.log,.gc.log" label={t('gcLog.uploadTitle')} maxSize={3 * 1024 * 1024 * 1024} onReset={handleReset} error={displayError} />
      </div>

      {/* Stat cards: Total GCs, Major GCs, Minor GCs, Total Pause Time */}
      <StatGrid cols={4}>
        <StatCard title={t('gcLog.totalGcs')} value={gcLog.totalGcs.toLocaleString()} />
        <StatCard title={t('gcLog.majorGcs')} value={gcLog.majorGcCount.toLocaleString()} />
        <StatCard title={t('gcLog.minorGcs')} value={gcLog.minorGcCount.toLocaleString()} />
        <StatCard title={t('gcLog.totalPauseTime')} value={formatDuration(gcLog.totalPauseMs)} />
      </StatGrid>

      {/* Average Pause cards: Avg Major Pause, Avg Minor Pause */}
      <StatGrid cols={2}>
        <StatCard
          title={t('gcLog.avgMajorPause')}
          value={formatDuration(gcLog.avgMajorPauseMs)}
          subtitle={gcLog.majorGcCount > 0 ? t('gcLog.eventsCountSubtitle').replace('{count}', gcLog.majorGcCount.toLocaleString()) : t('gcLog.noMajorEvents')}
        />
        <StatCard
          title={t('gcLog.avgMinorPause')}
          value={formatDuration(gcLog.avgMinorPauseMs)}
          subtitle={gcLog.minorGcCount > 0 ? t('gcLog.eventsCountSubtitle').replace('{count}', gcLog.minorGcCount.toLocaleString()) : t('gcLog.noMinorEvents')}
        />
      </StatGrid>

      {/* External Memory Alert */}
      {gcLog.externalUnmanaged ? (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span className="text-sm font-semibold text-red-700 dark:text-red-400">{t('gcLog.externalMemoryWarning')}</span>
          </div>
          <p className="text-sm text-red-600 dark:text-red-300 ml-7">
            {t('gcLog.externalMemoryWarningMsg').replace('{growth}', gcLog.externalGrowthMb.toFixed(1))}
          </p>
        </div>
      ) : (
        <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-semibold text-green-700 dark:text-green-400">{t('gcLog.externalMemoryOk')}</span>
          </div>
          <p className="text-sm text-green-600 dark:text-green-300 ml-7">
            {t('gcLog.externalMemoryOkMsg').replace('{growth}', gcLog.externalGrowthMb.toFixed(1))}
          </p>
        </div>
      )}

      {/* GC Events Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('gcLog.gcEvents')}</h2>
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0">
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('gcLog.timestamp')}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('gcLog.type')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('gcLog.heapBefore')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('gcLog.heapAfter')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('gcLog.duration')}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('gcLog.pauseType')}</th>
              </tr>
            </thead>
            <tbody>
              {gcLog.entries.map((entry, idx) => {
                const heapBeforeMb = (entry.heapBefore / (1024 * 1024)).toFixed(1);
                const heapAfterMb = (entry.heapAfter / (1024 * 1024)).toFixed(1);
                return (
                  <tr key={idx} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-200">{entry.timestamp.toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${gcTypeColor(entry.type)}`}>
                        {entry.type}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{heapBeforeMb} MB</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{heapAfterMb} MB</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatDuration(entry.durationMs)}</td>
                    <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-300 capitalize">{entry.pauseType}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <LoadingOverlay visible={upload.loading || upload.urlLoading} />
    </Page>
  );
}