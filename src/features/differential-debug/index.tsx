import { useState, useCallback, useMemo } from 'react';
import { analyzeDifferential } from '../../shared/differential';
import type { DifferentialAnalysis, DivergencePoint, ValueDiff } from '../../shared/differential';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import { ExportButton } from '../report/ExportButton';
import { toMarkdown } from '../report/exportUtils';
import type { TracingEvent } from '../../shared/types';
import { useI18n } from '../../shared/i18n/useI18n';

interface LoadedRun {
  name: string;
  events: TracingEvent[];
}

export function DifferentialDebugPage() {
  const { t } = useI18n();
  const [normal, setNormal] = useState<LoadedRun | null>(null);
  const [fault, setFault] = useState<LoadedRun | null>(null);
  const [analysis, setAnalysis] = useState<DifferentialAnalysis | null>(null);
  const [selectedDivergence, setSelectedDivergence] = useState<number>(0);

  const normalUpload = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      const events = JSON.parse(content) as TracingEvent[];
      setNormal({ name: 'normal', events });
    }, []),
  });
  const faultUpload = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      const events = JSON.parse(content) as TracingEvent[];
      setFault({ name: 'fault', events });
    }, []),
  });

  const { loading: normalLoading, error: normalError, fileName: normalFileName, fileSize: normalFileSize, handleFile: normalHandleFile, progress: normalProgress, urlLoading: normalUrlLoading, urlError: normalUrlError, urlProgress: normalUrlProgress, loadFromUrl: normalLoadFromUrl, cancelUrl: normalCancelUrl } = normalUpload;
  const { loading: faultLoading, error: faultError, fileName: faultFileName, fileSize: faultFileSize, handleFile: faultHandleFile, progress: faultProgress, urlLoading: faultUrlLoading, urlError: faultUrlError, urlProgress: faultUrlProgress, loadFromUrl: faultLoadFromUrl, cancelUrl: faultCancelUrl } = faultUpload;

  const loading = normalLoading || faultLoading;
  const error = normalError || faultError;

  function handleReset() {
    normalUpload.handleReset();
    faultUpload.handleReset();
    setAnalysis(null);
    setSelectedDivergence(0);
  }

  const runAnalysis = useCallback(() => {
    if (!normal || !fault) return;
    setAnalysis(null);
    try {
      const result = analyzeDifferential(normal.events, fault.events);
      setAnalysis(result);
      setSelectedDivergence(0);
    } catch (err) {
      console.error('Differential analysis failed:', err);
    }
  }, [normal, fault]);

  const current = useMemo(() => {
    if (!analysis || analysis.divergences.length === 0) return null;
    return analysis.divergences[Math.min(selectedDivergence, analysis.divergences.length - 1)];
  }, [analysis, selectedDivergence]);

  // ── Upload screen ───────────────────────────────────────────────────
  if (!normal || !fault) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('diffDebug.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('diffDebug.description')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('diffDebug.normalRun')}</p>
            <FileUpload onFile={normalHandleFile} accept=".json" label={t('diffDebug.uploadNormal')} maxSize={500 * 1024 * 1024} fileName={normalFileName} fileSize={normalFileSize} onReset={() => { setNormal(null); }} loading={normalLoading} progress={normalProgress} onUrlLoad={normalLoadFromUrl} urlLoading={normalUrlLoading} urlError={normalUrlError} urlProgress={normalUrlProgress} onUrlCancel={normalCancelUrl} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('diffDebug.faultRun')}</p>
            <FileUpload onFile={faultHandleFile} accept=".json" label={t('diffDebug.uploadFault')} maxSize={500 * 1024 * 1024} fileName={faultFileName} fileSize={faultFileSize} onReset={() => { setFault(null); }} loading={faultLoading} progress={faultProgress} onUrlLoad={faultLoadFromUrl} urlLoading={faultUrlLoading} urlError={faultUrlError} urlProgress={faultUrlProgress} onUrlCancel={faultCancelUrl} />
          </div>
        </div>

        {(error || normalUrlError || faultUrlError) && <p className="text-sm text-red-600 dark:text-red-400">{error ?? normalUrlError ?? faultUrlError}</p>}
        <LoadingOverlay visible={loading} message={t('diffDebug.loading')} />

        <div className="mt-8">
          <EmptyState
            title={t('diffDebug.noData')}
            description={t('diffDebug.description')}
          />
        </div>
      </div>
    );
  }

  // ── Analysis screen ─────────────────────────────────────────────────
  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('diffDebug.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('diffDebug.runsCount').replace('{normal}', normal.name).replace('{fault}', fault.name)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runAnalysis}
            className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 transition-colors"
          >
            {t('diffDebug.analyze')}
          </button>
          <button onClick={handleReset} className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            {t('diffDebug.clearStart')}
          </button>
          {analysis && (
            <ExportButton
              filename="differential-debug"
              onExportMarkdown={() => toMarkdown({
                title: t('diffDebug.exportTitle'),
                sections: [
                  {
                    title: t('diffDebug.exportRuns'),
                    type: 'stats',
                    content: [
                      { label: t('diffDebug.normalRun'), value: normal.name },
                      { label: t('diffDebug.faultRun'), value: fault.name },
                      { label: t('diffDebug.analyzeTime'), value: `${analysis.meta.elapsedMs.toFixed(0)}ms` },
                    ],
                  },
                  {
                    title: t('diffDebug.exportAlignment'),
                    type: 'stats',
                    content: [
                      { label: t('diffDebug.similarity'), value: `${(analysis.alignment.similarity * 100).toFixed(1)}%` },
                      { label: t('diffDebug.editDistance'), value: analysis.alignment.editDistance.toLocaleString() },
                      { label: t('diffDebug.divergences'), value: analysis.divergences.length.toLocaleString() },
                    ],
                  },
                  {
                    title: t('diffDebug.exportFirstDivergence'),
                    type: 'text',
                    content: analysis.report.firstDivergence
                      ? analysis.report.firstDivergence.description
                      : t('diffDebug.noDivergence'),
                  },
                  {
                    title: t('diffDebug.exportDivergences'),
                    type: 'alert' as const,
                    content: {
                      level: analysis.divergences.length > 0 ? 'warning' : 'info',
                      message: analysis.report.summary,
                    },
                  },
                  ...(analysis.report.recommendations.length > 0
                    ? [{
                      title: t('diffDebug.exportRecommendations'),
                      type: 'text' as const,
                      content: analysis.report.recommendations.map(r => `- ${r}`).join('\n'),
                    }]
                    : []),
                ],
              })}
            />
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}
      <LoadingOverlay visible={loading} message={t('diffDebug.analyzing')} />

      {!analysis && !loading && (
        <EmptyState title={t('diffDebug.ready')} description={t('diffDebug.analyzeHint')} />
      )}

      {analysis && (
        <div className="flex flex-col gap-4">
          {/* Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title={t('diffDebug.similarity')} value={`${(analysis.alignment.similarity * 100).toFixed(1)}%`} color={analysis.alignment.similarity > 0.95 ? 'text-emerald-600 dark:text-emerald-400' : analysis.alignment.similarity > 0.7 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'} />
            <StatCard title={t('diffDebug.divergences')} value={analysis.divergences.length.toLocaleString()} color={analysis.divergences.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'} />
            <StatCard title={t('diffDebug.editDistance')} value={analysis.alignment.editDistance.toLocaleString()} />
            <StatCard title={t('diffDebug.analyzeTime')} value={`${analysis.meta.elapsedMs.toFixed(0)}ms`} />
          </div>

          {/* Summary report */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">{t('diffDebug.summary')}</p>
            <p className="text-sm text-gray-600 dark:text-gray-300">{analysis.report.summary}</p>
            {analysis.report.recommendations.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {analysis.report.recommendations.map((r, i) => (
                  <li key={i} className="text-xs text-gray-600 dark:text-gray-300 flex items-start gap-2">
                    <span className="text-indigo-500 mt-0.5">›</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {analysis.divergences.length === 0 ? (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4">
              <p className="text-sm text-emerald-700 dark:text-emerald-300">{t('diffDebug.noDivergence')}</p>
            </div>
          ) : (
            <>
              {/* Divergence list */}
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                  <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('diffDebug.divergenceList')}</h2>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {analysis.divergences.map((d, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedDivergence(idx)}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                        idx === selectedDivergence ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        d.cause.role === 'cause' ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
                      }`}>
                        {d.order}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                          {t(`diffDebug.kind.${d.eventDiff.kind}`)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{d.description}</p>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-0.5">
                        <span className={`text-xs font-medium ${d.cause.role === 'cause' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                          {t(`diffDebug.role.${d.cause.role}`)}
                        </span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">{t('diffDebug.confidence')} {(d.confidence * 100).toFixed(0)}%</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Detail panel */}
              {current && <DivergenceDetail divergence={current} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DivergenceDetail({ divergence }: { divergence: DivergencePoint }) {
  const { t } = useI18n();
  const d = divergence.eventDiff;

  const renderValue = (v: unknown): string => {
    if (v === undefined) return '—';
    if (typeof v === 'string') return v.length > 120 ? `${v.slice(0, 120)}…` : v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t('diffDebug.detailTitle').replace('{order}', String(divergence.order))}
        </h2>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
          divergence.cause.role === 'cause'
            ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
            : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
        }`}>
          {t(`diffDebug.role.${divergence.cause.role}`)}
        </span>
      </div>

      {/* Cause reasoning */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <p className="text-xs text-gray-600 dark:text-gray-300">
          <span className="font-medium text-gray-500 dark:text-gray-400">{t('diffDebug.reason')}: </span>
          {divergence.cause.reason}
        </p>
      </div>

      {/* Dual-column event view */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100 dark:divide-gray-800">
        <EventColumn title={t('diffDebug.normalRun')} event={d.normal} empty={t('diffDebug.noEvent')} missingClass="bg-red-50 dark:bg-red-900/20" />
        <EventColumn title={t('diffDebug.faultRun')} event={d.fault} empty={t('diffDebug.noEvent')} missingClass="bg-amber-50 dark:bg-amber-900/20" />
      </div>

      {/* Variable-level diff */}
      {d.valueDiffs.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-800">
          <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900">
            <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('diffDebug.variables')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('diffDebug.varKey')}</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('diffDebug.varNormal')}</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('diffDebug.varFault')}</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('diffDebug.varChange')}</th>
                </tr>
              </thead>
              <tbody>
                {d.valueDiffs.map((v, i) => <ValueRow key={i} v={v} renderValue={renderValue} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stack-level diff */}
      {d.stackDiffs.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-800">
          <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900">
            <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('diffDebug.stacks')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">#</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('diffDebug.stackNormal')}</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('diffDebug.stackFault')}</th>
                </tr>
              </thead>
              <tbody>
                {d.stackDiffs.map((s, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500 font-mono">{s.level}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">{s.before ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs text-red-600 dark:text-red-400">{s.after ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function EventColumn({ title, event, empty, missingClass }: {
  title: string;
  event?: { channel: string; eventType: string; context?: Record<string, unknown>; timestamp?: number; error?: { message?: string } };
  empty: string;
  missingClass: string;
}) {
  if (!event) {
    return (
      <div className={`px-4 py-6 ${missingClass}`}>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{title}</p>
        <p className="text-sm text-gray-400 dark:text-gray-500 italic">{empty}</p>
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{title}</p>
      <p className="text-sm font-mono text-gray-800 dark:text-gray-100">{event.channel}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{event.eventType}</p>
      {event.error?.message && (
        <p className="text-xs text-red-600 dark:text-red-400 mb-2">⚠ {event.error.message}</p>
      )}
      {event.context && Object.keys(event.context).length > 0 && (
        <pre className="text-[11px] text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(event.context, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ValueRow({ v, renderValue }: { v: ValueDiff; renderValue: (x: unknown) => string }) {
  const before = v.before;
  const after = v.after;
  const changed = v.change !== 'removed' && v.change !== 'added' && renderValue(before) !== renderValue(after);
  return (
    <tr className="border-b border-gray-100 dark:border-gray-800">
      <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-200">{v.key}</td>
      <td className={`px-4 py-2 font-mono text-xs ${v.change === 'removed' ? 'text-red-600 dark:text-red-400 line-through' : 'text-gray-600 dark:text-gray-300'}`}>
        {renderValue(before)}
      </td>
      <td className={`px-4 py-2 font-mono text-xs ${v.change === 'added' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-600 dark:text-gray-300'}`}>
        {renderValue(after)}
      </td>
      <td className={`px-4 py-2 text-xs font-medium ${changed || v.change === 'removed' || v.change === 'added' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
        {v.change}
      </td>
    </tr>
  );
}
