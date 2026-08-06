import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { useRootStore } from '../../stores/root-store';
import { Page, UploadHeader, WideUpload, StatCard, EmptyState } from '../../shared/components';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { formatBytes } from '../../shared/utils';
import { detectLeakPattern, getGrowthTrend } from '../../shared/engine/snapshot-history';
import { useI18n } from '../../shared/i18n/useI18n';
import type { SnapshotDiffRecord } from '../../shared/types';
import * as d3 from 'd3';

function isSnapshotRecord(value: unknown): value is SnapshotDiffRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.timestamp === 'number' &&
    typeof r.label === 'string' &&
    typeof r.beforeSize === 'number' &&
    typeof r.afterSize === 'number' &&
    typeof r.newNodeCount === 'number' &&
    typeof r.removedNodeCount === 'number' &&
    typeof r.retainedSizeDelta === 'number' &&
    (typeof r.growthRate === 'number' || r.growthRate === null) &&
    typeof r.flagged === 'boolean'
  );
}

function TrendChart({ records }: { records: ReturnType<typeof getGrowthTrend> }) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const style = getComputedStyle(containerRef.current);
    const px = (v: string) => parseFloat(v);
    const hPadding = px(style.paddingLeft) + px(style.paddingRight);
    const hBorder = px(style.borderLeftWidth) + px(style.borderRightWidth);
    const contentWidth = containerRef.current.getBoundingClientRect().width - hPadding - hBorder;
    setDimensions({ width: contentWidth, height: 280 });
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height: 280 });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current || records.dates.length === 0 || !dimensions) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 40, left: 60 };
    const w = dimensions.width - margin.left - margin.right;
    const h = dimensions.height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scalePoint<number>()
      .domain(records.retainedSizes.map((_, i) => i))
      .range([0, w]);

    const values = records.retainedSizes.map(v => v / (1024 * 1024));
    const maxY = d3.max(values) ?? 0;
    const minY = d3.min(values) ?? 0;
    const yPadding = Math.max(Math.abs(maxY - minY) * 0.15, 1);
    const y = d3.scaleLinear()
      .domain([minY - yPadding, maxY + yPadding])
      .range([h, 0]);

    // Zero line
    if (minY < 0 && maxY > 0) {
      g.append('line')
        .attr('x1', 0)
        .attr('x2', w)
        .attr('y1', y(0))
        .attr('y2', y(0))
        .attr('stroke', '#ef4444')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4');
    }

    // Line
    const line = d3.line<number>()
      .x((_, i) => x(i)!)
      .y(d => y(d))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(values)
      .attr('fill', 'none')
      .attr('stroke', '#6366f1')
      .attr('stroke-width', 2)
      .attr('d', line);

    // Points
    g.selectAll('circle')
      .data(values.map((v, i) => ({ v, i })))
      .enter()
      .append('circle')
      .attr('cx', d => x(d.i)!)
      .attr('cy', d => y(d.v))
      .attr('r', 4)
      .attr('fill', d => d.v > 0 ? '#ef4444' : d.v < 0 ? '#22c55e' : '#6b7280')
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5);

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${h})`)
      .call(d3.axisBottom(x).tickFormat((d) => records.dates[d as number] || ''))
      .selectAll('text')
      .attr('font-size', '9px')
      .attr('transform', 'rotate(-30)')
      .attr('text-anchor', 'end');

    // Y axis
    g.append('g')
      .call(d3.axisLeft(y).ticks(6).tickFormat(d => `${Number(d).toFixed(1)} MB`))
      .selectAll('text')
      .attr('font-size', '10px');

    // Axis styling for dark mode
    g.selectAll('.domain, .tick line').attr('stroke', 'currentColor');
    g.selectAll('.tick text').attr('fill', 'currentColor');

    // Y axis label
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -h / 2)
      .attr('y', -margin.left + 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', 'currentColor')
      .text(t('snapshot.chartRetained'));

  }, [records, dimensions, t]);

  if (records.dates.length === 0) return null;

  return (
    <div ref={containerRef} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      <div className="flex items-center gap-4 mb-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded bg-indigo-500 inline-block" />
          <span className="text-gray-600 dark:text-gray-300">{t('snapshot.legend.retained')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
          <span className="text-gray-600 dark:text-gray-300">{t('snapshot.legend.growth')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
          <span className="text-gray-600 dark:text-gray-300">{t('snapshot.legend.improvement')}</span>
        </div>
      </div>
      {dimensions && (
        <svg
          ref={svgRef}
          width={dimensions.width}
          height={dimensions.height}
          className="w-full text-gray-700 dark:text-gray-300"
        />
      )}
    </div>
  );
}

export function SnapshotHistoryPage() {
  const { snapshotHistory, clearSnapshotHistory, setSnapshotHistory } = useRootStore();
   const { t } = useI18n();

   const applyRecords = useCallback(async (content: string) => {
     let parsed: unknown;
     try {
       parsed = JSON.parse(content);
     } catch {
       throw new Error(t('snapshot.importError'));
     }
     if (!Array.isArray(parsed) || !parsed.every(isSnapshotRecord)) {
       throw new Error(t('snapshot.importError'));
     }
     setSnapshotHistory(parsed);
   }, [setSnapshotHistory, t]);

   const upload = useUnifiedFileUpload({ onFile: applyRecords });
   const { error, handleReset: uploadReset } = upload;

   const leakPattern = useMemo(() => detectLeakPattern(snapshotHistory), [snapshotHistory]);
   const trendData = useMemo(() => getGrowthTrend(snapshotHistory), [snapshotHistory]);

   function handleReset() {
     uploadReset();
     clearSnapshotHistory();
   }

  function exportHistory() {
    const blob = new Blob([JSON.stringify(snapshotHistory, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'snapshot-history.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <Page>
      {snapshotHistory.length === 0 ? (
        <div className="max-w-3xl mx-auto">
          <UploadHeader
            title={t('snapshot.title')}
            description={t('snapshot.description')}
            api={upload}
            accept=".json"
            label={t('snapshot.uploadLabel')}
            onReset={handleReset}
            error={error}
          />
          <div className="mt-8">
            <EmptyState
              title={t('snapshot.empty')}
              description={t('snapshot.empty.desc')}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('snapshot.title')}</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('snapshot.description')}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {t(snapshotHistory.length === 1 ? 'snapshot.record' : 'snapshot.records').replace('{count}', String(snapshotHistory.length))}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={exportHistory}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {t('snapshot.export')}
              </button>
              <button
                onClick={clearSnapshotHistory}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
              >
                {t('snapshot.clear')}
              </button>
            </div>
          </div>

          <div className="mb-4">
            <WideUpload api={upload} accept=".json" label={t('snapshot.uploadLabel')} onReset={handleReset} error={error} />
          </div>

      {/* Leak Pattern Alert */}
      <div className={`p-4 rounded-lg border ${
        leakPattern.flagged
          ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          : leakPattern.pattern === 'shrinking'
            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
            : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700'
      }`}>
        <div className="flex items-start gap-3">
          <svg className={`w-5 h-5 mt-0.5 shrink-0 ${
            leakPattern.flagged ? 'text-red-500' : leakPattern.pattern === 'shrinking' ? 'text-emerald-500' : 'text-gray-400'
          }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {leakPattern.flagged ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            )}
          </svg>
          <div>
            <p className={`text-sm font-semibold ${
              leakPattern.flagged ? 'text-red-800 dark:text-red-300' : leakPattern.pattern === 'shrinking' ? 'text-emerald-800 dark:text-emerald-300' : 'text-gray-700 dark:text-gray-200'
            }`}>
              {t('snapshot.leakPatternLabel').replace('{pattern}', t('snapshot.patterns.' + leakPattern.pattern))}
            </p>
            <p className={`text-xs mt-1 ${
              leakPattern.flagged ? 'text-red-700 dark:text-red-400' : leakPattern.pattern === 'shrinking' ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'
            }`}>
              {leakPattern.description}
            </p>
          </div>
        </div>
      </div>

      {/* Trend Chart */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('snapshot.trend')}</h2>
        <TrendChart records={trendData} />
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard title={t('snapshot.totalComparisons')} value={snapshotHistory.length.toString()} />
        <StatCard
          title={t('snapshot.avgGrowthRate')}
          value={
            snapshotHistory.length > 0
              ? `${(snapshotHistory.reduce((s, r) => s + (r.growthRate ?? 0), 0) / snapshotHistory.length).toFixed(1)}%`
              : t('common.none')
          }
        />
        <StatCard
          title={t('snapshot.totalNewNodes')}
          value={snapshotHistory.reduce((s, r) => s + r.newNodeCount, 0).toLocaleString()}
        />
        <StatCard
          title={t('snapshot.flaggedRecords')}
          value={snapshotHistory.filter(r => r.flagged).length.toString()}
          color={snapshotHistory.some(r => r.flagged) ? 'text-red-600 dark:text-red-400' : undefined}
        />
      </div>

      {/* History Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">{t('snapshot.allRecords')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-gray-400">{t('snapshot.id')}</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-gray-400">{t('snapshot.timestamp')}</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-gray-400">{t('snapshot.label')}</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-gray-400">{t('snapshot.before')}</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-gray-400">{t('snapshot.after')}</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-gray-400">{t('snapshot.delta')}</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-gray-400">{t('snapshot.growthRate')}</th>
              </tr>
            </thead>
            <tbody>
              {snapshotHistory.map((record) => (
                <tr
                  key={record.id}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {record.id.slice(0, 16)}…
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                    {new Date(record.timestamp).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-200 max-w-xs truncate">
                    {record.label}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">
                    {formatBytes(record.beforeSize)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">
                    {formatBytes(record.afterSize)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono text-xs font-medium ${
                    record.retainedSizeDelta > 0
                      ? 'text-red-600 dark:text-red-400'
                      : record.retainedSizeDelta < 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-gray-500 dark:text-gray-400'
                  }`}>
                    <span className="flex items-center justify-end gap-1">
                      <span className={`w-2 h-2 rounded-full inline-block ${
                        record.retainedSizeDelta > 0
                          ? 'bg-red-500'
                          : record.retainedSizeDelta < 0
                            ? 'bg-green-500'
                            : 'bg-gray-400'
                      }`} />
                      {record.retainedSizeDelta > 0 ? '+' : ''}{formatBytes(Math.abs(record.retainedSizeDelta))}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">
                    {record.growthRate !== null ? `${record.growthRate.toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
        </div>
      )}
    </Page>
  );
}