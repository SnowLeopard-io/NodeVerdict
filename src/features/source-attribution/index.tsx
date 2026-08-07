import { useCallback, useMemo, useState } from 'react';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { createWorkerClient } from '../../shared/workers/worker-factory';
import { attributeSpans } from '../../shared/source/source-attribution';
import { Page, EmptyState, StatCard, UploadHeader } from '../../shared/components';
import { ExportButton } from '../report/ExportButton';
import type { TraceViewerData, TraceSpan } from '../../shared/types';
import type { TracingWorkerInput, TracingWorkerOutput } from '../../shared/workers/tracing-handler';
import { useI18n } from '../../shared/i18n/useI18n';

export function SourceAttributionPage() {
  const { t } = useI18n();
  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const getWorker = useCallback((w?: ReturnType<typeof createWorkerClient<TracingWorkerInput, TracingWorkerOutput>> | null) => w ?? createWorkerClient<TracingWorkerInput, TracingWorkerOutput>(new Worker(new URL('../../shared/workers/tracing-handler.ts', import.meta.url), { type: 'module' })), []);
  const upload = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      setLoading(true);
      const worker = getWorker();
      try {
        const a = await worker.execute({ content, format: 'json' });
        setSpans(a.spans);
        setLoaded(true);
      } finally {
        worker.terminate();
        setLoading(false);
      }
    }, [getWorker]),
  });
  const { handleReset, error } = upload;

  const flattenChildren = (span: TraceSpan): TraceSpan[] =>
    span.children.flatMap(child => [child, ...flattenChildren(child)]);

  const attribution = useMemo(() => {
    if (!spans.length) return null;
    const allSpans = spans.flatMap(s => [s, ...flattenChildren(s)]);
    return attributeSpans(allSpans);
  }, [spans]);
  const rows = attribution?.sites ?? [];
  const totalDuration = attribution?.sites.reduce((s, x) => s + x.totalDuration, 0) ?? 0;

  return (
    <Page>
      <UploadHeader
        title={t('sourceAttr.title')}
        description={t('sourceAttr.description')}
        api={upload}
        accept=".json,.ndv"
        label={t('sourceAttr.uploadLabel')}
        maxSize={500 * 1024 * 1024}
        onReset={() => { handleReset(); setSpans([]); setLoaded(false); }}
        error={error}
      />

      {!loaded ? (
        <div className="mt-8">
          <EmptyState title={t('sourceAttr.noData')} description={t('sourceAttr.noDataDesc')} />
        </div>
      ) : (
        <>
          {attribution && (
            <div className="grid grid-cols-4 gap-3 mb-4">
              <StatCard title={t('sourceAttr.sites')} value={attribution.sites.length.toString()} />
              <StatCard title={t('sourceAttr.appFiles')} value={attribution.appFiles.toString()} />
              <StatCard title={t('sourceAttr.frames')} value={attribution.totalFrames.toString()} />
              <StatCard title={t('sourceAttr.attributedMs')} value={`${totalDuration.toFixed(0)}ms`} />
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-400 text-left">
                <tr>
                  <th className="px-4 py-2">{t('sourceAttr.site')}</th>
                  <th className="px-4 py-2 text-right">{t('sourceAttr.duration')}</th>
                  <th className="px-4 py-2 text-right">{t('sourceAttr.count')}</th>
                  <th className="px-4 py-2 text-right">{t('sourceAttr.errors')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.map(s => (
                  <tr key={`${s.file}#${s.functionName}#${s.line ?? 0}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-4 py-2">
                      <div className="font-mono text-xs text-gray-700 dark:text-gray-300">{s.functionName}()</div>
                      <div className="font-mono text-xs text-gray-400 dark:text-gray-500">{s.file}{s.line ? `:${s.line}` : ''}</div>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{s.totalDuration.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{s.count}</td>
                    <td className="px-4 py-2 text-right">
                      {s.errorCount > 0 ? <span className="font-medium text-red-600 dark:text-red-400">{s.errorCount}</span> : <span className="text-gray-400">0</span>}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">{t('sourceAttr.noStacks')}</td></tr>}
              </tbody>
            </table>
          </div>
          {attribution && (
            <div className="mt-3">
              <ExportButton filename="source-attribution" onExportMarkdown={() => renderMarkdown(attribution)} />
            </div>
          )}
        </>
      )}
    </Page>
  );
}

function renderMarkdown(r: ReturnType<typeof attributeSpans>): string {
  const lines: string[] = ['# ' + 'Source Attribution', ''];
  lines.push(`| ${'Site'} | ${'Duration (ms)'} | ${'Count'} | ${'Errors'} |`);
  lines.push('|---|---|---|---|');
  for (const s of r.sites) lines.push(`| ${s.functionName}() ${s.file}${s.line ? `:${s.line}` : ''} | ${s.totalDuration.toFixed(1)} | ${s.count} | ${s.errorCount} |`);
  return lines.join('\n');
}