import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { createWorkerClient } from '../../shared/workers/worker-factory';
import { diffCpuProfiles, summarizeCpuDiff } from '../../shared/engine/cpu-profile-diff';
import { PageHeader, WideUpload, EmptyState, StatCard } from '../../shared/components';
import { ExportButton } from '../report/ExportButton';
import type { CpuProfileAnalysis, CpuProfileDiff } from '../../shared/types';
import { useI18n } from '../../shared/i18n/useI18n';

interface SideProfile {
  analysis: CpuProfileAnalysis;
  name: string;
}

const KIND_COLOR: Record<string, string> = {
  grown: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
  added: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
  removed: 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800',
  shrunk: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20',
  unchanged: 'text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/60',
};

export function CpuProfileDiffPage() {
  const { t } = useI18n();
  const [before, setBefore] = useState<SideProfile | null>(null);
  const [after, setAfter] = useState<SideProfile | null>(null);

  const workerRef = useRef<ReturnType<typeof createWorkerClient<string, CpuProfileAnalysis>> | null>(null);
  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = createWorkerClient<string, CpuProfileAnalysis>(
        new Worker(new URL('../../shared/workers/cpu-profile-handler.ts', import.meta.url), { type: 'module' }),
      );
    }
    return workerRef.current;
  }, []);
  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null; }, []);

  const makeUpload = (side: 'before' | 'after') => useUnifiedFileUpload({
    onFile: (async (content: string) => {
      const analysis = await getWorker().execute(content);
      if (side === 'before') setBefore({ analysis, name: `${side}.cpuprofile` });
      else setAfter({ analysis, name: `${side}.cpuprofile` });
    }),
  });

  const uploadBefore = makeUpload('before');
  const uploadAfter = makeUpload('after');

  const diff = useMemo(() => {
    if (!before || !after) return null;
    return diffCpuProfiles(before.analysis, after.analysis);
  }, [before, after]);

  const tableRows = useMemo(() => (diff?.entries ?? []).slice(0, 100), [diff]);

  if (!before || !after) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <PageHeader title={t('cpuDiff.title')} description={t('cpuDiff.description')} />
        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">{t('cpuDiff.before')}</p>
            <WideUpload api={uploadBefore} accept=".cpuprofile,.json" label={t('cpuProfiler.uploadTitle')} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">{t('cpuDiff.after')}</p>
            <WideUpload api={uploadAfter} accept=".cpuprofile,.json" label={t('cpuProfiler.uploadTitle')} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('cpuDiff.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{diff ? summarizeCpuDiff(diff) : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setBefore(null); setAfter(null); }} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            {t('common.reset')}
          </button>
          {diff && <ExportButton filename="cpu-profile-diff" onExportMarkdown={() => summarizeCpuDiff(diff) + '\n\n' + renderDiffTable(diff, t)} />}
        </div>
      </div>

      {diff && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <StatCard title={t('cpuDiff.totalDelta')} value={`${diff.totalDeltaMs.toFixed(1)}ms`} color={diff.totalDeltaMs >= 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'} />
          <StatCard title={t('cpuDiff.grown')} value={diff.grownCount.toString()} color="text-red-600 dark:text-red-400" />
          <StatCard title={t('cpuDiff.added')} value={diff.addedCount.toString()} color="text-amber-600 dark:text-amber-400" />
          <StatCard title={t('cpuDiff.shrunk')} value={diff.shrunkCount.toString()} color="text-emerald-600 dark:text-emerald-400" />
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-400 text-left">
            <tr>
              <th className="px-4 py-2">{t('cpuDiff.function')}</th>
              <th className="px-4 py-2 text-right">{t('cpuDiff.beforeMs')}</th>
              <th className="px-4 py-2 text-right">{t('cpuDiff.afterMs')}</th>
              <th className="px-4 py-2 text-right">{t('cpuDiff.deltaMs')}</th>
              <th className="px-4 py-2">{t('cpuDiff.change')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {tableRows.map(e => (
              <tr key={e.key} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">{e.functionName}<span className="text-gray-400 dark:text-gray-500"> @ {e.url}:{e.line}</span></td>
                <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{e.beforeTotalTime.toFixed(1)}</td>
                <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{e.afterTotalTime.toFixed(1)}</td>
                <td className={`px-4 py-2 text-right font-medium ${e.totalDelta >= 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {e.totalDelta >= 0 ? '+' : ''}{e.totalDelta.toFixed(1)}
                </td>
                <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${KIND_COLOR[e.kind]}`}>{t(`cpuDiff.kind.${e.kind}`)}</span></td>
              </tr>
            ))}
            {tableRows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">{t('cpuDiff.noChanges')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderDiffTable(diff: CpuProfileDiff, t: (k: string) => string): string {
  const lines: string[] = [];
  lines.push(`# ${t('cpuDiff.title')}`);
  lines.push('');
  lines.push(`| ${t('cpuDiff.function')} | before | after | delta |`);
  lines.push('|---|---|---|---|');
  for (const e of diff.entries.slice(0, 100)) {
    lines.push(`| ${e.functionName} @ ${e.url}:${e.line} | ${e.beforeTotalTime.toFixed(1)} | ${e.afterTotalTime.toFixed(1)} | ${e.totalDelta >= 0 ? '+' : ''}${e.totalDelta.toFixed(1)} |`);
  }
  return lines.join('\n');
}