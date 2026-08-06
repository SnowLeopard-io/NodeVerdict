import { useState, useCallback, useMemo } from 'react';
import { analyzeTracingEvents, buildWaterfall, findBottlenecks } from '../../shared/engine';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { PageHeader, WideUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import { ExportButton } from '../report/ExportButton';
import { toMarkdown } from '../report/exportUtils';
import { formatDuration } from '../../shared/utils';
import type { TracingEvent, TracingAnalysis, TraceSpan } from '../../shared/types';
import { useI18n } from '../../shared/i18n/useI18n';

interface ComparedData {
  name: string;
  analysis: TracingAnalysis;
  spans: TraceSpan[];
  bottlenecks: TraceSpan[];
}

export function PerfComparePage() {
  const { t } = useI18n();
  const [dataA, setDataA] = useState<ComparedData | null>(null);
  const [dataB, setDataB] = useState<ComparedData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nameA, setNameA] = useState<string>(() => t('perfCompare.before'));
  const [nameB, setNameB] = useState<string>(() => t('perfCompare.after'));

  const uploadA = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      const events = JSON.parse(content) as TracingEvent[];
      const analysis = analyzeTracingEvents(events);
      const spans = buildWaterfall(analysis.operations, analysis.events);
      const allSpans = spans.flatMap(s => [s, ...flattenChildren(s)]);
      const bottlenecks = findBottlenecks(allSpans);
      setDataA({ name: 'A', analysis, spans, bottlenecks });
    }, []),
  });
  const uploadB = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      const events = JSON.parse(content) as TracingEvent[];
      const analysis = analyzeTracingEvents(events);
      const spans = buildWaterfall(analysis.operations, analysis.events);
      const allSpans = spans.flatMap(s => [s, ...flattenChildren(s)]);
      const bottlenecks = findBottlenecks(allSpans);
      setDataB({ name: 'B', analysis, spans, bottlenecks });
    }, []),
  });

  const loading = uploadA.loading || uploadB.loading;
  const uploadError = uploadA.error || uploadB.error;

  function handleReset() {
    uploadA.handleReset();
    uploadB.handleReset();
    setDataA(null);
    setDataB(null);
    setErrorMsg(null);
    setNameA(t('perfCompare.before'));
    setNameB(t('perfCompare.after'));
  }

  const comparison = useMemo(() => {
    if (!dataA || !dataB) return null;

    const channelStats = new Map<string, { aDuration: number; bDuration: number; aError: number; bError: number }>();
    for (const cs of dataA.analysis.channelStats) {
      channelStats.set(cs.channel, { aDuration: cs.avgDuration, bDuration: 0, aError: cs.errorCount, bError: 0 });
    }
    for (const cs of dataB.analysis.channelStats) {
      const existing = channelStats.get(cs.channel) ?? { aDuration: 0, bDuration: 0, aError: 0, bError: 0 };
      existing.bDuration = cs.avgDuration;
      existing.bError = cs.errorCount;
      channelStats.set(cs.channel, existing);
    }

    return {
      totalEventsA: dataA.analysis.totalEvents,
      totalEventsB: dataB.analysis.totalEvents,
      totalOpsA: dataA.analysis.totalOperations,
      totalOpsB: dataB.analysis.totalOperations,
      errorRateA: dataA.analysis.errorRate * 100,
      errorRateB: dataB.analysis.errorRate * 100,
      timeRangeA: dataA.analysis.timeRange.end - dataA.analysis.timeRange.start,
      timeRangeB: dataB.analysis.timeRange.end - dataB.analysis.timeRange.start,
      bottleneckCountA: dataA.bottlenecks.length,
      bottleneckCountB: dataB.bottlenecks.length,
      channels: Array.from(channelStats.entries()).map(([ch, stats]) => ({
        channel: ch,
        avgDurationA: stats.aDuration,
        avgDurationB: stats.bDuration,
        durationDelta: stats.bDuration - stats.aDuration,
        durationPercent: stats.aDuration > 0 ? ((stats.bDuration - stats.aDuration) / stats.aDuration) * 100 : 0,
        errorA: stats.aError,
        errorB: stats.bError,
      })),
    };
  }, [dataA, dataB]);

  if (!dataA || !dataB) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <PageHeader title={t('perfCompare.title')} description={t('perfCompare.description')} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('perfCompare.beforeBaseline')}</p>
            <WideUpload api={uploadA} accept=".json" label={t('perfCompare.uploadBefore')} maxSize={500 * 1024 * 1024} onReset={() => setDataA(null)} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('perfCompare.uploadAfter')}</p>
            <WideUpload api={uploadB} accept=".json" label={t('perfCompare.uploadAfter')} maxSize={500 * 1024 * 1024} onReset={() => setDataB(null)} />
          </div>
        </div>

        {uploadError && <p className="text-sm text-red-600 dark:text-red-400">{uploadError}</p>}
        <LoadingOverlay visible={loading} message={t('perfCompare.loading')} />

        <div className="mt-8">
          <EmptyState
            title={t('perfCompare.noData')}
            description={t('perfCompare.description')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('perfCompare.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('perfCompare.eventsCount').replace('{nameA}', nameA).replace('{nameB}', nameB)}
          </p>
        </div>
        <button onClick={handleReset} className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          {t('perfCompare.clearStart')}
        </button>
        <ExportButton
          filename="perf-compare"
          onExportMarkdown={() => toMarkdown({
            title: t('perfCompare.exportTitle'),
            sections: [
              {
                title: t('perfCompare.exportBaseline'),
                type: 'stats',
                content: [
                  { label: t('perfCompare.events'), value: dataA.analysis.totalEvents.toLocaleString() },
                  { label: t('perfCompare.operations'), value: dataA.analysis.totalOperations.toLocaleString() },
                  { label: t('perfCompare.errorRate'), value: `${(dataA.analysis.errorRate * 100).toFixed(1)}%` },
                  { label: t('perfCompare.duration'), value: formatDuration(dataA.analysis.timeRange.end - dataA.analysis.timeRange.start) },
                ],
              },
              {
                title: t('perfCompare.exportChanged'),
                type: 'stats',
                content: [
                  { label: t('perfCompare.events'), value: dataB.analysis.totalEvents.toLocaleString() },
                  { label: t('perfCompare.operations'), value: dataB.analysis.totalOperations.toLocaleString() },
                  { label: t('perfCompare.errorRate'), value: `${(dataB.analysis.errorRate * 100).toFixed(1)}%` },
                  { label: t('perfCompare.duration'), value: formatDuration(dataB.analysis.timeRange.end - dataB.analysis.timeRange.start) },
                ],
              },
              {
                title: t('perfCompare.exportChannelComparison'),
                type: 'table',
                content: {
                  headers: [t('perfCompare.channel'), t('perfCompare.avgA'), t('perfCompare.avgB'), t('perfCompare.delta'), t('perfCompare.changePercent'), t('perfCompare.errorsAB')],
                  rows: (comparison?.channels ?? []).map(ch => [
                    ch.channel,
                    `${ch.avgDurationA.toFixed(1)}ms`,
                    `${ch.avgDurationB.toFixed(1)}ms`,
                    ch.durationDelta > 0 ? `+${ch.durationDelta.toFixed(1)}ms` : `${ch.durationDelta.toFixed(1)}ms`,
                    `${ch.durationPercent > 0 ? '+' : ''}${ch.durationPercent.toFixed(1)}%`,
                    `${ch.errorA} → ${ch.errorB}`,
                  ]),
                },
              },
            ],
          })}
        />
      </div>

      {/* Overview comparison */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('perfCompare.baseline').replace('{name}', nameA)}</p>
          <div className="grid grid-cols-2 gap-2">
            <StatCard title={t('perfCompare.events')} value={dataA.analysis.totalEvents.toLocaleString()} />
            <StatCard title={t('perfCompare.operations')} value={dataA.analysis.totalOperations.toLocaleString()} />
            <StatCard title={t('perfCompare.errorRate')} value={`${(dataA.analysis.errorRate * 100).toFixed(1)}%`} color={dataA.analysis.errorRate > 0.05 ? 'text-red-600 dark:text-red-400' : ''} />
            <StatCard title={t('perfCompare.duration')} value={formatDuration(dataA.analysis.timeRange.end - dataA.analysis.timeRange.start)} />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('perfCompare.changed').replace('{name}', nameB)}</p>
          <div className="grid grid-cols-2 gap-2">
            <StatCard title={t('perfCompare.events')} value={dataB.analysis.totalEvents.toLocaleString()} />
            <StatCard title={t('perfCompare.operations')} value={dataB.analysis.totalOperations.toLocaleString()} />
            <StatCard title={t('perfCompare.errorRate')} value={`${(dataB.analysis.errorRate * 100).toFixed(1)}%`} color={dataB.analysis.errorRate > 0.05 ? 'text-red-600 dark:text-red-400' : ''} />
            <StatCard title={t('perfCompare.duration')} value={formatDuration(dataB.analysis.timeRange.end - dataB.analysis.timeRange.start)} />
          </div>
        </div>
      </div>

      {/* Channel comparison */}
      {comparison && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('perfCompare.channelComparison')}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('perfCompare.channel')}</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('perfCompare.avgA')}</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('perfCompare.avgB')}</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('perfCompare.delta')}</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('perfCompare.change')}</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('perfCompare.errorsAB')}</th>
                </tr>
              </thead>
              <tbody>
                {comparison.channels.map((ch, idx) => (
                  <tr key={idx} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-4 py-2 font-medium text-gray-700 dark:text-gray-200">{ch.channel}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{ch.avgDurationA.toFixed(1)}ms</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{ch.avgDurationB.toFixed(1)}ms</td>
                    <td className={`px-4 py-2 text-right font-mono text-xs ${
                      ch.durationDelta > 0 ? 'text-red-600 dark:text-red-400' : ch.durationDelta < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''
                    }`}>
                      {ch.durationDelta > 0 ? '+' : ''}{ch.durationDelta.toFixed(1)}ms
                    </td>
                    <td className={`px-4 py-2 text-right font-mono text-xs font-medium ${
                      ch.durationPercent > 5 ? 'text-red-600 dark:text-red-400' : ch.durationPercent < -5 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {ch.durationPercent > 0 ? '+' : ''}{ch.durationPercent.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      <span className={ch.errorA > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}>{ch.errorA}</span>
                      <span className="text-gray-400 dark:text-gray-500"> → </span>
                      <span className={ch.errorB > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}>{ch.errorB}</span>
                    </td>
                  </tr>
                ))}
                {comparison.channels.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">{t('perfCompare.noCommonChannels')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function flattenChildren(span: { children: TraceSpan[] }): TraceSpan[] {
  const result: TraceSpan[] = [];
  for (const child of span.children) {
    result.push(child);
    result.push(...flattenChildren(child));
  }
  return result;
}