import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useRootStore } from '../../stores';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { analyzeTracingEvents } from '../../shared/engine';
import { UploadHeader, WideUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import type { TracingEvent, TracingAnalysis } from '../../shared/types';
import * as d3 from 'd3';
import { useI18n } from '../../shared/i18n/useI18n';

function TimeSeriesChart({ analysis }: { analysis: TracingAnalysis }) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    // Measure the content area width (excluding padding & border) to match ResizeObserver's contentRect
    const style = getComputedStyle(containerRef.current);
    const px = (v: string) => parseFloat(v);
    const hPadding = px(style.paddingLeft) + px(style.paddingRight);
    const hBorder = px(style.borderLeftWidth) + px(style.borderRightWidth);
    const contentWidth = containerRef.current.getBoundingClientRect().width - hPadding - hBorder;
    setDimensions({ width: contentWidth, height: 250 });
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height: 250 });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Compute throughput over time
  const chartData = useMemo(() => {
    if (analysis.events.length === 0) return [];
    const timeRange = analysis.timeRange.end - analysis.timeRange.start;
    if (timeRange <= 0) return [];

    const bucketCount = Math.min(50, Math.ceil(analysis.events.length / 10));
    const bucketSize = timeRange / bucketCount;
    const buckets: { time: number; count: number; errors: number }[] = [];

    for (let i = 0; i < bucketCount; i++) {
      const start = analysis.timeRange.start + i * bucketSize;
      const end = start + bucketSize;
      const events = analysis.events.filter(e => e.timestamp >= start && e.timestamp < end);
      const errors = events.filter(e => e.eventType === 'error').length;
      buckets.push({
        time: start + bucketSize / 2,
        count: events.length,
        errors,
      });
    }
    return buckets;
  }, [analysis]);

  useEffect(() => {
    if (!svgRef.current || chartData.length === 0 || !dimensions) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 30, left: 50 };
    const w = dimensions.width - margin.left - margin.right;
    const h = dimensions.height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(chartData.map(d => String(Math.round(d.time))))
      .range([0, w])
      .padding(0.1);

    const y = d3.scaleLinear()
      .domain([0, d3.max(chartData, d => d.count)! * 1.1])
      .range([h, 0]);

    // Bars
    g.selectAll('rect.bar')
      .data(chartData)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', d => x(String(Math.round(d.time)))!)
      .attr('y', d => y(d.count))
      .attr('width', x.bandwidth())
      .attr('height', d => h - y(d.count))
      .attr('fill', 'currentColor')
      .attr('opacity', 0.7);

    // Error markers
    g.selectAll('rect.error')
      .data(chartData.filter(d => d.errors > 0))
      .enter()
      .append('rect')
      .attr('class', 'error')
      .attr('x', d => x(String(Math.round(d.time)))!)
      .attr('y', d => y(d.errors) - 3)
      .attr('width', x.bandwidth())
      .attr('height', d => 6)
      .attr('fill', 'currentColor')
      .attr('opacity', 0.8);

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${h})`)
      .call(d3.axisBottom(x).tickValues(
        chartData.filter((_, i) => i % Math.max(1, Math.floor(chartData.length / 8)) === 0).map(d => String(Math.round(d.time)))
      ).tickFormat(d => `${((Number(d) - analysis.timeRange.start) / 1000).toFixed(1)}s`))
      .selectAll('text')
      .attr('font-size', '10px');

    // Y axis
    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text')
      .attr('font-size', '10px');

    // Make axis elements respond to CSS color (dark mode)
    g.selectAll('.domain, .tick line').attr('stroke', 'currentColor');
    g.selectAll('.tick text').attr('fill', 'currentColor');

    // Labels
    g.append('text')
      .attr('x', w / 2)
      .attr('y', -8)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', 'currentColor')
      .text(t('timeSeries.eventsPerBucket'));

  }, [chartData, analysis.timeRange.start, dimensions]);

  return (
    <div ref={containerRef} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      {dimensions && <svg ref={svgRef} width={dimensions.width} height={dimensions.height} className="block text-gray-600 dark:text-gray-300" />}
    </div>
  );
}

function LatencyDistribution({ analysis }: { analysis: TracingAnalysis }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    // Measure the content area width (excluding padding & border) to match ResizeObserver's contentRect
    const style = getComputedStyle(containerRef.current);
    const px = (v: string) => parseFloat(v);
    const hPadding = px(style.paddingLeft) + px(style.paddingRight);
    const hBorder = px(style.borderLeftWidth) + px(style.borderRightWidth);
    const contentWidth = containerRef.current.getBoundingClientRect().width - hPadding - hBorder;
    setDimensions({ width: contentWidth, height: 250 });
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height: 250 });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const histogram = useMemo(() => {
    const durations = analysis.operations
      .filter(op => op.duration > 0)
      .map(op => op.duration);

    if (durations.length === 0) return [];

    const max = Math.max(...durations);
    const bucketCount = 30;
    const bucketSize = max / bucketCount || 1;
    const buckets: { range: string; count: number }[] = [];

    for (let i = 0; i < bucketCount; i++) {
      const low = i * bucketSize;
      const high = (i + 1) * bucketSize;
      const count = durations.filter(d => d >= low && d < high).length;
      buckets.push({
        range: `${low.toFixed(0)}-${high.toFixed(0)}`,
        count,
      });
    }
    return buckets;
  }, [analysis]);

  useEffect(() => {
    if (!svgRef.current || histogram.length === 0 || !dimensions) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 30, left: 50 };
    const w = dimensions.width - margin.left - margin.right;
    const h = dimensions.height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(histogram.map(d => d.range))
      .range([0, w])
      .padding(0.1);

    const y = d3.scaleLinear()
      .domain([0, d3.max(histogram, d => d.count)! * 1.1])
      .range([h, 0]);

    g.selectAll('rect')
      .data(histogram)
      .enter()
      .append('rect')
      .attr('x', d => x(d.range)!)
      .attr('y', d => y(d.count))
      .attr('width', x.bandwidth())
      .attr('height', d => h - y(d.count))
      .attr('fill', 'currentColor')
      .attr('opacity', 0.7);

    g.append('g')
      .attr('transform', `translate(0,${h})`)
      .call(d3.axisBottom(x).tickValues(
        histogram.filter((_, i) => i % 5 === 0).map(d => d.range)
      ))
      .selectAll('text')
      .attr('font-size', '9px')
      .attr('transform', 'rotate(-45)');

    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text')
      .attr('font-size', '10px');

    // Make axis elements respond to CSS color (dark mode)
    g.selectAll('.domain, .tick line').attr('stroke', 'currentColor');
    g.selectAll('.tick text').attr('fill', 'currentColor');

  }, [histogram, dimensions]);

  return (
    <div ref={containerRef} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      {dimensions && <svg ref={svgRef} width={dimensions.width} height={dimensions.height} className="block text-gray-600 dark:text-gray-300" />}
    </div>
  );
}

export function TimeSeriesPage() {
  const { t } = useI18n();
   const { tracingAnalysis, setTracingAnalysis } = useRootStore();

   const upload = useUnifiedFileUpload({
     onFile: useCallback(async (content: string) => {
       const events = JSON.parse(content) as TracingEvent[];
       const analysis = analyzeTracingEvents(events);
       setTracingAnalysis(analysis);
     }, [setTracingAnalysis]),
   });
   const { error, handleReset: uploadReset } = upload;

   function handleReset() {
     uploadReset();
     setTracingAnalysis(null);
   }

  if (!tracingAnalysis) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <UploadHeader
          title={t('timeSeries.title')}
          description={t('timeSeries.description')}
          api={upload}
          accept=".json"
          label={t('timeSeries.uploadHint')}
          maxSize={500 * 1024 * 1024}
          onReset={handleReset}
          error={error}
        />
        <LoadingOverlay visible={upload.loading || upload.urlLoading} message={t('timeSeries.loading')} />
        <div className="mt-8">
          <EmptyState title={t('timeSeries.noData')} description={t('timeSeries.description')} />
        </div>
      </div>
    );
  }

  const durations = tracingAnalysis.operations.filter(op => op.duration > 0).map(op => op.duration);
  const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const sorted = [...durations].sort((a, b) => a - b);
  const p95 = durations.length ? sorted[Math.ceil(durations.length * 0.95) - 1] : 0;

  return (
    <div className="p-6">
      <div className="mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('timeSeries.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('timeSeries.eventsCount').replace('{events}', tracingAnalysis.totalEvents.toLocaleString()).replace('{operations}', tracingAnalysis.totalOperations.toLocaleString())}</p>
        </div>
        <div className="mt-4">
          <WideUpload api={upload} accept=".json" label={t('timeSeries.uploadHint')} maxSize={500 * 1024 * 1024} onReset={handleReset} error={error} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard title={t('timeSeries.avgThroughput')} value={`${(tracingAnalysis.totalEvents / ((tracingAnalysis.timeRange.end - tracingAnalysis.timeRange.start) / 1000)).toFixed(1)}/s`} subtitle={t('timeSeries.eventsPerSecond')} />
        <StatCard title={t('timeSeries.avgLatency')} value={avgDuration.toFixed(1) + 'ms'} />
        <StatCard title={t('timeSeries.p95Latency')} value={p95.toFixed(1) + 'ms'} color={p95 > 100 ? 'text-orange-600 dark:text-orange-400' : undefined} />
        <StatCard title={t('timeSeries.operations')} value={tracingAnalysis.totalOperations.toLocaleString()} />
      </div>

      <div className="grid grid-cols-1 gap-4 mb-4">
        <TimeSeriesChart analysis={tracingAnalysis} />
      </div>

      <div className="grid grid-cols-1 gap-4 mb-4">
        <LatencyDistribution analysis={tracingAnalysis} />
      </div>

      {/* Channel Latency Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('timeSeries.channelLatency')}</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('timeSeries.channel')}</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('timeSeries.avg')}</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('timeSeries.p50')}</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('timeSeries.p95')}</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('timeSeries.p99')}</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('timeSeries.min')}</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('timeSeries.max')}</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('timeSeries.ops')}</th>
            </tr>
          </thead>
          <tbody>
            {tracingAnalysis.channelStats.map(cs => (
              <tr key={cs.channel} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-4 py-2 font-medium text-gray-700 dark:text-gray-200">{cs.channel}</td>
                <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{cs.avgDuration.toFixed(1)}ms</td>
                <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{cs.p50Duration.toFixed(1)}ms</td>
                <td className={`px-4 py-2 text-right font-mono text-xs ${cs.p95Duration > 100 ? 'text-orange-600 font-medium' : 'text-gray-600 dark:text-gray-300'}`}>
                  {cs.p95Duration.toFixed(1)}ms
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{cs.p99Duration.toFixed(1)}ms</td>
                <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{cs.minDuration.toFixed(1)}ms</td>
                <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{cs.maxDuration.toFixed(1)}ms</td>
                <td className="px-4 py-2 text-right text-xs text-gray-600 dark:text-gray-300">{cs.totalOperations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}