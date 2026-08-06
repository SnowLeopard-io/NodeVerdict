import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useRootStore } from '../../stores';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { parseMemoryTimeline, calculateGrowthRate } from '../../shared/engine';
import { UploadHeader, WideUpload, EmptyState, StatCard, LoadingOverlay, Page, StatGrid } from '../../shared/components';
import { formatBytes, formatDuration } from '../../shared/utils';
import type { MemoryTimeline, MemoryGrowthRate } from '../../shared/types';
import * as d3 from 'd3';
import { ExportButton } from '../report/ExportButton';
import { toMarkdown } from '../report/exportUtils';
import { useI18n } from '../../shared/i18n/useI18n';

function MemoryChart({ timeline }: { timeline: MemoryTimeline }) {
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
    setDimensions({ width: contentWidth, height: 300 });
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height: 300 });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const chartData = useMemo(() => {
    const t0 = timeline.snapshots[0].timestamp;
    return timeline.snapshots.map(s => ({
      timeSec: (s.timestamp - t0) / 1000,
      rss: s.rss / (1024 * 1024),
      heapUsed: s.heapUsed / (1024 * 1024),
      external: s.external / (1024 * 1024),
    }));
  }, [timeline]);

  useEffect(() => {
    if (!svgRef.current || chartData.length === 0 || !dimensions) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 30, right: 20, bottom: 40, left: 60 };
    const w = dimensions.width - margin.left - margin.right;
    const h = dimensions.height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([0, d3.max(chartData, d => d.timeSec)! * 1.05])
      .range([0, w]);

    const maxY = d3.max(chartData, d => Math.max(d.rss, d.heapUsed, d.external))! * 1.1;
    const y = d3.scaleLinear()
      .domain([0, maxY])
      .range([h, 0]);

    // Line generators
    const line = d3.line<{ timeSec: number; value: number }>()
      .x(d => x(d.timeSec))
      .y(d => y(d.value))
      .curve(d3.curveMonotoneX);

    // RSS line
    g.append('path')
      .datum(chartData.map(d => ({ timeSec: d.timeSec, value: d.rss })))
      .attr('fill', 'none')
      .attr('stroke', '#3b82f6')
      .attr('stroke-width', 2)
      .attr('d', line);

    // heapUsed line
    g.append('path')
      .datum(chartData.map(d => ({ timeSec: d.timeSec, value: d.heapUsed })))
      .attr('fill', 'none')
      .attr('stroke', '#22c55e')
      .attr('stroke-width', 2)
      .attr('d', line);

    // external line
    g.append('path')
      .datum(chartData.map(d => ({ timeSec: d.timeSec, value: d.external })))
      .attr('fill', 'none')
      .attr('stroke', '#f97316')
      .attr('stroke-width', 2)
      .attr('d', line);

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat(d => `${d}s`))
      .selectAll('text')
      .attr('font-size', '10px');

    // Y axis
    g.append('g')
      .call(d3.axisLeft(y).ticks(6).tickFormat(d => `${d} MB`))
      .selectAll('text')
      .attr('font-size', '10px');

    // Axis styling for dark mode
    g.selectAll('.domain, .tick line').attr('stroke', 'currentColor');
    g.selectAll('.tick text').attr('fill', 'currentColor');

    // Axis labels
    g.append('text')
      .attr('x', w / 2)
      .attr('y', h + margin.bottom - 6)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', 'currentColor')
      .text(t('memoryTimeline.timeSeconds'));

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -h / 2)
      .attr('y', -margin.left + 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', 'currentColor')
      .text(t('memoryTimeline.memoryMb'));

  }, [chartData, dimensions]);

  return (
    <div ref={containerRef} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      {/* Legend */}
      <div className="flex items-center gap-6 mb-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded bg-blue-500 inline-block" />
          <span className="text-gray-600 dark:text-gray-300">{t('memoryTimeline.rss')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded bg-green-500 inline-block" />
          <span className="text-gray-600 dark:text-gray-300">{t('memoryTimeline.heapUsed')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded bg-orange-500 inline-block" />
          <span className="text-gray-600 dark:text-gray-300">{t('memoryTimeline.external')}</span>
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

export function MemoryTimelinePage() {
  const { t } = useI18n();
  const [memoryTimeline, setMemoryTimeline] = useState<MemoryTimeline | null>(null);
  const [growthRate, setGrowthRate] = useState<MemoryGrowthRate | null>(null);
  const upload = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      const timeline = parseMemoryTimeline(content);
      const rate = calculateGrowthRate(timeline);
      setMemoryTimeline(timeline);
      setGrowthRate(rate);
    }, []),
  });
  const { error, handleReset: uploadReset } = upload;

  // Wrap the error with a more helpful message
  const displayError = error?.includes('JSON')
    ? t('memoryTimeline.invalidFormat')
    : error;

  function handleReset() {
    uploadReset();
    setMemoryTimeline(null);
    setGrowthRate(null);
  }

  if (!memoryTimeline) {
    return (
      <Page maxWidth="3xl">
        <UploadHeader
          title={t('memoryTimeline.title')}
          description={t('memoryTimeline.description')}
          api={upload}
          accept=".json"
          label={t('memoryTimeline.uploadHint')}
          maxSize={3 * 1024 * 1024 * 1024}
          onReset={handleReset}
          error={displayError}
        />
        <LoadingOverlay visible={upload.loading || upload.urlLoading} message={t('memoryTimeline.loading')} />
        <div className="mt-8">
          <EmptyState
            title={t('memoryTimeline.noData')}
            description={t('memoryTimeline.description')}
          />
        </div>
      </Page>
    );
  }

  const { snapshots, durationMs, intervalMs } = memoryTimeline;

  return (
    <Page>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('memoryTimeline.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('memoryTimeline.snapshotsCount').replace('{count}', snapshots.length.toLocaleString()).replace('{duration}', formatDuration(durationMs))}
          </p>
        </div>
        <ExportButton
            onExportMarkdown={() => toMarkdown({
              title: t('memoryTimeline.exportTitle'),
              sections: [
                {
                  title: t('memoryTimeline.summary'),
                  type: 'stats',
                  content: [
                    { label: t('memoryTimeline.duration'), value: formatDuration(durationMs) },
                    { label: t('memoryTimeline.snapshots'), value: snapshots.length.toLocaleString() },
                    { label: t('memoryTimeline.interval'), value: formatDuration(intervalMs) },
                  ],
                },
                ...(growthRate ? [{
                  title: t('memoryTimeline.growthRateStatus'),
                  type: 'alert' as const,
                  content: {
                    level: (growthRate.flagged ? 'error' : 'info') as 'error' | 'info',
                    message: growthRate.summary,
                  },
                }] : []),
                {
                  title: t('memoryTimeline.allSnapshots'),
                  type: 'table',
                  content: {
                    headers: [t('memoryTimeline.time'), t('memoryTimeline.rss'), t('memoryTimeline.heapUsed'), t('memoryTimeline.heapTotal'), t('memoryTimeline.external'), t('memoryTimeline.arrayBuffers')],
                    rows: snapshots.slice(0, 50).map((s, idx) => {
                      const t0 = snapshots[0].timestamp;
                      const relTime = ((s.timestamp - t0) / 1000).toFixed(2);
                      return [
                        `${relTime}s`,
                        formatBytes(s.rss),
                        formatBytes(s.heapUsed),
                        formatBytes(s.heapTotal),
                        formatBytes(s.external),
                        formatBytes(s.arrayBuffers),
                      ];
                    }),
                  },
                },
              ],
            })}
            filename="memory-timeline"
          />
      </div>

      <div className="mb-4">
        <WideUpload api={upload} accept=".json" label={t('memoryTimeline.uploadHint')} maxSize={3 * 1024 * 1024 * 1024} onReset={handleReset} error={displayError} />
      </div>

      {/* Stat Cards */}
      <StatGrid cols={3}>
        <StatCard title={t('memoryTimeline.duration')} value={formatDuration(durationMs)} />
        <StatCard title={t('memoryTimeline.snapshots')} value={snapshots.length.toLocaleString()} />
        <StatCard title={t('memoryTimeline.interval')} value={formatDuration(intervalMs)} />
      </StatGrid>

      {/* Growth Rate Alert */}
      {growthRate && (
        <div className={`mb-4 p-4 rounded-lg border ${
          growthRate.flagged
            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
        }`}>
          <div className="flex items-start gap-3">
            <svg className={`w-5 h-5 mt-0.5 shrink-0 ${
              growthRate.flagged ? 'text-red-500' : 'text-emerald-500'
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {growthRate.flagged ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              )}
            </svg>
            <div>
              <p className={`text-sm font-semibold ${
                growthRate.flagged ? 'text-red-800 dark:text-red-300' : 'text-emerald-800 dark:text-emerald-300'
              }`}>
                {growthRate.flagged ? t('memoryTimeline.growthRateAlert') : t('memoryTimeline.growthRateStatus')}
              </p>
              <p className={`text-xs mt-1 ${
                growthRate.flagged ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
              }`}>
                {growthRate.summary}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('memoryTimeline.trendChart')}</h2>
        <MemoryChart timeline={memoryTimeline} />
      </div>

      {/* Data Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('memoryTimeline.allSnapshots')}</h2>
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0">
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('memoryTimeline.time')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('memoryTimeline.rss')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('memoryTimeline.heapUsed')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('memoryTimeline.heapTotal')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('memoryTimeline.external')}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('memoryTimeline.arrayBuffers')}</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s, idx) => {
                const t0 = snapshots[0].timestamp;
                const relTime = ((s.timestamp - t0) / 1000).toFixed(2);
                return (
                  <tr
                    key={idx}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">{relTime}s</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(s.rss)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(s.heapUsed)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(s.heapTotal)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(s.external)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(s.arrayBuffers)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  );
}