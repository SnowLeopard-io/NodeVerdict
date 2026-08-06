import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { decompressReport } from '../../shared/engine/report-generator';
import { diffReports, renderDiffMarkdown } from '../../shared/engine/report-diff';
import type { ReportData } from '../../shared/types';
import { Page, EmptyState, StatCard } from '../../shared/components';
import { ExportButton } from '../report/ExportButton';
import { useI18n } from '../../shared/i18n/useI18n';

const KIND_LABEL: Record<string, string> = { added: 'o+', removed: 'o-', grown: 'grown', shrunk: 'shrunk', regressed: 'err', unchanged: '—' };

export function ReportDiffPage() {
  const { t, lang } = useI18n();
  const [base, setBase] = useState<string>('');
  const [head, setHead] = useState<string>('');

  const baseData = useMemo(() => parse(base), [base]);
  const headData = useMemo(() => parse(head), [head]);
  const diff = useMemo(() => (baseData || headData ? diffReports(baseData, headData) : null), [baseData, headData]);

  return (
    <Page maxWidth="5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('reportDiff.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('reportDiff.description')}</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <ReportInput label={t('reportDiff.base')} value={base} onChange={setBase} hint={t('reportDiff.jsonOrCompressed')} />
        <ReportInput label={t('reportDiff.head')} value={head} onChange={setHead} hint={t('reportDiff.jsonOrCompressed')} />
      </div>

      {!diff ? (
        <div className="mt-8"><EmptyState title={t('reportDiff.noData')} description={t('reportDiff.noDataDesc')} /></div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatCard title={t('reportDiff.eventsDelta')} value={fmtDelta(diff.totalEvents.delta, '')} color={deltaColor(diff.totalEvents.delta)} />
            <StatCard title={t('reportDiff.errorRateDelta')} value={fmtDelta(diff.errorRate.delta, 'pp')} color={deltaColor(diff.errorRate.delta)} />
            <StatCard title={t('reportDiff.heapDelta')} value={diff.heap.sizeDeltaMb == null ? '—' : `${diff.heap.sizeDeltaMb >= 0 ? '+' : ''}${diff.heap.sizeDeltaMb.toFixed(1)}MB`} color={deltaColor(diff.heap.sizeDeltaMb)} />
          </div>

          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden mb-4">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-400 text-left">
                <tr>
                  <th className="px-4 py-2">{t('reportDiff.channel')}</th>
                  <th className="px-4 py-2 text-right">{t('reportDiff.avgDelta')}</th>
                  <th className="px-4 py-2 text-right">{t('reportDiff.p95Delta')}</th>
                  <th className="px-4 py-2 text-right">{t('reportDiff.p99Delta')}</th>
                  <th className="px-4 py-2 text-right">{t('reportDiff.errorsDelta')}</th>
                  <th className="px-4 py-2">{t('reportDiff.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {diff.channels.filter(c => c.status !== 'unchanged').map(c => (
                  <tr key={c.channel} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">{c.channel}</td>
                    <td className={`px-4 py-2 text-right ${deltaColor(c.avgDelta)}`}>{fmtDelta(c.avgDelta, '')}</td>
                    <td className={`px-4 py-2 text-right ${deltaColor(c.p95Delta)}`}>{fmtDelta(c.p95Delta, '')}</td>
                    <td className={`px-4 py-2 text-right ${deltaColor(c.p99Delta)}`}>{fmtDelta(c.p99Delta, '')}</td>
                    <td className={`px-4 py-2 text-right ${deltaColor(c.errorDelta)}`}>{fmtDelta(c.errorDelta, '')}</td>
                    <td className="px-4 py-2"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">{KIND_LABEL[c.status]}</span></td>
                  </tr>
                ))}
                {diff.channels.filter(c => c.status !== 'unchanged').length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{t('reportDiff.noChannels')}</td></tr>}
              </tbody>
            </table>
          </div>

          {(diff.keyFindingsAdded.length > 0 || diff.keyFindingsRemoved.length > 0) && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-4">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{t('reportDiff.findings')}</p>
              {diff.keyFindingsAdded.map(f => <div key={f} className="text-sm text-amber-600 dark:text-amber-400 mb-1">+ {f}</div>)}
              {diff.keyFindingsRemoved.map(f => <div key={f} className="text-sm text-gray-400 mb-1">- {f}</div>)}
            </div>
          )}

          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('reportDiff.markdown')}</p>
            <ExportButton filename="report-diff" onExportMarkdown={() => renderDiffMarkdown(diff, lang)} />
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 max-h-[360px] overflow-auto">
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{renderDiffMarkdown(diff, lang)}</ReactMarkdown>
            </div>
          </div>
        </>
      )}
    </Page>
  );
}

function parse(text: string): ReportData | null {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as ReportData;
  } catch {
    return decompressReport(text.trim());
  }
}

function ReportInput({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{label}</p>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={6} spellCheck={false}
        className="w-full font-mono text-xs p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        placeholder={hint} />
    </div>
  );
}

function fmtDelta(v: number | null, suffix: string): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}${suffix}`;
}
function deltaColor(v: number | null): string | undefined {
  if (v == null) return undefined;
  return v > 0 ? 'text-red-600 dark:text-red-400' : v < 0 ? 'text-emerald-600 dark:text-emerald-400' : undefined;
}