import { useCallback, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { loadTracingData } from '../../shared/engine';
import { measureTrace, buildBaselineReport, formatBaselineReport } from '../../shared/gate/baseline';
import { evaluateGate, computeGateMetrics, defaultGateConfig } from '../../shared/gate/performance-gate';
import type { TracingEvent } from '../../shared/types';
import { FileUpload, EmptyState, StatCard } from '../../shared/components';
import { ExportButton } from '../report/ExportButton';
import { useI18n } from '../../shared/i18n/useI18n';

export function CiBaselinePage() {
  const { t } = useI18n();
  const [events, setEvents] = useState<TracingEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');

  const upload = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      setLoading(true);
      try {
        setEvents(loadTracingData(content));
        setFileName('trace');
      } finally {
        setLoading(false);
      }
    }, []),
  });
  const { handleFile, fileSize, handleReset, progress, error, loadFromUrl, urlLoading, urlError, urlProgress, cancelUrl } = upload;

  const report = useMemo(() => (events ? buildBaselineReport(events, fileName || 'ci-trace') : null), [events, fileName]);
  const gate = useMemo(() => (events ? evaluateGate(computeGateMetrics(events)) : null), [events]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('ciBaseline.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('ciBaseline.description')}</p>
        </div>
        <div className="w-full max-w-2xl">
          <FileUpload
            onFile={handleFile}
            accept=".json,.ndv"
            label={t('ciBaseline.uploadLabel')}
            maxSize={500 * 1024 * 1024}
            fileName={fileName || upload.fileName}
            fileSize={fileSize}
            onReset={() => { handleReset(); setEvents(null); }}
            loading={loading || upload.loading}
            progress={progress}
            onUrlLoad={loadFromUrl}
            urlLoading={urlLoading}
            urlError={urlError}
            urlProgress={urlProgress}
            onUrlCancel={cancelUrl}
          />
          {(error || urlError) && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error ?? urlError}</p>}
        </div>
      </div>

      {!events ? (
        <div className="mt-8"><EmptyState title={t('ciBaseline.noData')} description={t('ciBaseline.noDataDesc')} /></div>
      ) : (
        <>
          {report && (
            <div className="grid grid-cols-4 gap-3 mb-4">
              <StatCard title={t('ciBaseline.verdict')} value={report.pass ? 'PASS' : 'FAIL'} color={report.pass ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} />
              <StatCard title={t('ciBaseline.p99')} value={`${report.result.p99LatencyMs.toFixed(1)}ms`} color={report.result.p99LatencyMs <= defaultGateConfig.p99MaxMs ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} />
              <StatCard title={t('ciBaseline.n1')} value={report.result.n1SqlInstances.toString()} color={report.result.n1SqlInstances === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} />
              <StatCard title={t('ciBaseline.ops')} value={report.result.totalOperations.toString()} />
            </div>
          )}

          {gate && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-4">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{t('ciBaseline.gateRules')}</p>
              {gate.rules.map(r => (
                <div key={r.id} className="flex items-center justify-between py-1 border-b border-gray-100 dark:border-gray-700 last:border-0 text-sm">
                  <span className="text-gray-600 dark:text-gray-400">{r.description}</span>
                  <span className={`font-medium ${r.status === 'pass' ? 'text-emerald-600 dark:text-emerald-400' : r.status === 'fail' ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                    {r.status.toUpperCase()} — {r.actual.toFixed(r.unit === 'ms' ? 1 : 0)}{r.unit} / {r.threshold}{r.unit}
                  </span>
                </div>
              ))}
            </div>
          )}

          {report && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('ciBaseline.markdown')}</p>
                <ExportButton filename="ci-baseline" onExportMarkdown={() => formatBaselineReport(report.result, report.name)} />
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 max-h-[360px] overflow-auto">
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.markdown}</ReactMarkdown>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}