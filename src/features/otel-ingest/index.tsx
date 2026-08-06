import { useMemo, useState } from 'react';
import { createEmptyPipelineState, ingestOtelBatch, summarizePipelineHealth } from '../../shared/engine/otel-pipeline';
import { defaultAlertRules } from '../../shared/engine/alert-engine';
import type { OtelPipelineState } from '../../shared/engine/otel-pipeline';
import type { AlertRule } from '../../shared/types/alert';
import { EmptyState, StatCard, PageHeader, WideUpload } from '../../shared/components';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { useI18n } from '../../shared/i18n/useI18n';

const SAMPLE = JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [
  { name: 'api.gateway handle', startTimeUnixNano: String(Date.now() * 1e6), endTimeUnixNano: String((Date.now() + 40) * 1e6), traceId: 't1', spanId: 's1' },
  { name: 'orders.query', startTimeUnixNano: String(Date.now() * 1e6), endTimeUnixNano: String((Date.now() + 180) * 1e6), traceId: 't1', spanId: 's2', parentSpanId: 's1' },
] }] }] });

export function OtelIngestPage() {
  const { t } = useI18n();
  const [state, setState] = useState<OtelPipelineState>(() => createEmptyPipelineState());
  const [rules, setRules] = useState<AlertRule[]>(() => defaultAlertRules());
  const [batchText, setBatchText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastFired, setLastFired] = useState<string[]>([]);

  const upload = useUnifiedFileUpload({
    onFile: (async (content: string) => setBatchText(content)),
  });

  const health = useMemo(() => summarizePipelineHealth(state.topology), [state.topology]);

  function ingest() {
    if (!batchText.trim()) return;
    try {
      const { next, fired } = ingestOtelBatch(state, batchText, rules);
      setState(next);
      setLastFired(fired.map(a => `${a.ruleName} (${a.metric}: ${a.value.toFixed(2)})`));
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title={t('otelIngest.title')} description={t('otelIngest.description')} />

      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard title={t('otelIngest.events')} value={state.totalEvents.toString()} />
        <StatCard title={t('otelIngest.batches')} value={state.batchCount.toString()} />
        <StatCard title={t('otelIngest.services')} value={health.healthy + health.warning + health.faulty > 0 ? String(state.topology?.services ?? 0) : '0'} />
        <StatCard title={t('otelIngest.alerts')} value={lastFired.length.toString()} color={lastFired.length ? 'text-red-600 dark:text-red-400' : undefined} />
      </div>

      <WideUpload api={upload} accept=".json" label={t('otelIngest.uploadLabel')} maxSize={50 * 1024 * 1024} />

      <div className="mt-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('otelIngest.batchLabel')}</p>
          <button onClick={() => setBatchText(SAMPLE)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">{t('otelIngest.sample')}</button>
        </div>
        <textarea
          value={batchText}
          onChange={e => setBatchText(e.target.value)}
          rows={8}
          spellCheck={false}
          className="w-full font-mono text-xs p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder='{"resourceSpans":[{...}]}'
        />
        <div className="mt-3 flex items-center gap-3">
          <button onClick={ingest} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">{t('otelIngest.ingest')}</button>
        </div>
        {errorMsg && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{errorMsg}</p>}
      </div>

      {state.totalEvents === 0 ? (
        <div className="mt-8"><EmptyState title={t('otelIngest.noData')} description={t('otelIngest.noDataDesc')} /></div>
      ) : (
        <div className="mt-6 grid lg:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('otelIngest.topology')} ({t('otelIngest.healthy')} {health.healthy} / {t('otelIngest.warning')} {health.warning} / {t('otelIngest.faulty')} {health.faulty})</p>
            <div className="flex flex-wrap gap-2">
              {health.healthy + health.warning + health.faulty === 0 && <p className="text-sm text-gray-400">{t('otelIngest.noTopology')}</p>}
            </div>
            {state.topology?.nodes.map(n => (
              <div key={n.id} className="flex items-center justify-between py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
                <span className="text-sm text-gray-700 dark:text-gray-300">{n.serviceName}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${n.health === 'healthy' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : n.health === 'warning' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>{n.health}</span>
              </div>
            ))}
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('otelIngest.activeAlerts')}</p>
            {lastFired.length === 0 && <p className="text-sm text-gray-400">{t('otelIngest.noAlerts')}</p>}
            {lastFired.map((msg, i) => (
              <div key={i} className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400 mb-2">{msg}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}