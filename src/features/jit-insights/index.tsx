import { useCallback, useMemo, useState } from 'react';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { parseV8Trace, analyzeJit, generatePatches } from '../../shared/engine';
import type { JitAnalysis, JitFinding } from '../../shared/types';
import { UploadHeader, WideUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import { useUIStore } from '../../stores';
import { useI18n } from '../../shared/i18n/useI18n';
import { ExportButton } from '../report/ExportButton';
import { toMarkdown } from '../report/exportUtils';
import { IcStateGraph } from './components/IcStateGraph';
import { OptTimeline } from './components/OptTimeline';
import { FindingsList } from './components/FindingsList';
import { PatchPanel } from './components/PatchPanel';
import { AutoFixPanel } from './components/AutoFixPanel';

type Tab = 'overview' | 'graph' | 'timeline' | 'findings' | 'patches';

const STATE_BADGE: Record<string, string> = {
  monomorphic: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  polymorphic: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  megamorphic: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  uninitialized: 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

export function JitInsightsPage() {
  const { t } = useI18n();
  const darkMode = useUIStore(s => s.darkMode);

  const [analysis, setAnalysis] = useState<JitAnalysis | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [patchMode, setPatchMode] = useState<'autofix' | 'manual'>('autofix');

  const upload = useUnifiedFileUpload({
     onFile: useCallback(async (content: string) => {
      setParseError(null);
      try {
        const trace = parseV8Trace(content);
        if (trace.icEvents.length === 0 && trace.optEvents.length === 0 && trace.deoptEvents.length === 0) {
          setParseError(t('jitInsights.noEvents'));
          setAnalysis(null);
          return;
        }
        setAnalysis(analyzeJit(trace));
        setSelectedSite(null);
        setTab('overview');
      } catch (err) {
        setParseError((err as Error).message);
        setAnalysis(null);
      }
    }, [t]),
  });
  const { error, handleReset: uploadReset } = upload;

  const displayError = parseError || error;

  function handleReset() {
    uploadReset();
    setAnalysis(null);
    setParseError(null);
    setSelectedSite(null);
  }

  const demoTrace = useMemo(() => (analysis ? analysis.trace : null), [analysis]);
  const findings = useMemo(() => analysis?.findings ?? [], [analysis]);
  const criticalCount = useMemo(() => findings.filter((f: JitFinding) => f.severity === 'critical').length, [findings]);

  const TAB_DEFS: { id: Tab; label: string }[] = [
    { id: 'overview', label: t('jitInsights.tab.overview') },
    { id: 'graph', label: t('jitInsights.tab.graph') },
    { id: 'timeline', label: t('jitInsights.tab.timeline') },
    { id: 'findings', label: t('jitInsights.tab.findings') },
    { id: 'patches', label: t('jitInsights.tab.patches') },
  ];

  if (!analysis || !demoTrace) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <UploadHeader
          title={t('jitInsights.title')}
          description={t('jitInsights.description')}
          api={upload}
          accept=".txt,.log"
          label={t('jitInsights.uploadTitle')}
          maxSize={512 * 1024 * 1024}
          onReset={handleReset}
          error={displayError}
        />
        <div className="mt-8">
          <EmptyState title={t('jitInsights.noData')} description={t('jitInsights.description')} />
        </div>
        <LoadingOverlay visible={upload.loading || upload.urlLoading} />
      </div>
    );
  }

  const siteRows = analysis.sites.slice(0, 12);

  return (
    <div className="p-6">
      <div className="mb-4">
        <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('jitInsights.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('jitInsights.summary').replace('{ic}', demoTrace.icEvents.length.toLocaleString()).replace('{opt}', demoTrace.optEvents.length.toLocaleString()).replace('{deopt}', demoTrace.deoptEvents.length.toLocaleString())}
          </p>
        </div>
        <ExportButton
            filename="jit-insights"
            onExportMarkdown={() => toMarkdown({
              title: t('jitInsights.exportTitle'),
              sections: [
                {
                  title: t('jitInsights.exportTraceSummary'),
                  type: 'stats',
                  content: [
                    { label: t('jitInsights.icEvents'), value: demoTrace.icEvents.length.toLocaleString() },
                    { label: t('jitInsights.optEvents'), value: demoTrace.optEvents.length.toLocaleString() },
                    { label: t('jitInsights.deoptEvents'), value: demoTrace.deoptEvents.length.toLocaleString() },
                    { label: t('jitInsights.health'), value: `${Math.round(analysis.healthScore * 100)}%` },
                    { label: t('jitInsights.findingsCount').replace('{count}', String(findings.length)), value: '' },
                  ],
                },
                {
                  title: t('jitInsights.exportHotSites'),
                  type: 'table',
                  content: {
                    headers: [t('jitInsights.site'), t('jitInsights.state'), t('jitInsights.maps'), t('jitInsights.hits'), t('jitInsights.keys')],
                    rows: analysis.sites.slice(0, 12).map(site => [
                      site.site ?? '—',
                      site.state,
                      String(site.maps.length),
                      String(site.hits),
                      site.keys.slice(0, 4).join(', ') + (site.keys.length > 4 ? '…' : ''),
                    ]),
                  },
                },
                {
                  title: t('jitInsights.exportFindings'),
                  type: 'text',
                  content: findings.length === 0
                    ? t('jitInsights.empty')
                    : findings.map(f =>
                      `- **[${f.severity.toUpperCase()}] ${f.title}**\n  - Target: ${f.target}\n  - ${f.detail}\n  - Evidence:\n${f.evidence.map(e => `    - ${e}`).join('\n')}`
                    ).join('\n\n'),
                },
              ],
            })}
          />
        </div>
      </div>

      <div className="mb-4">
        <WideUpload api={upload} accept=".txt,.log" label={t('jitInsights.uploadTitle')} maxSize={512 * 1024 * 1024} onReset={handleReset} error={displayError} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard title={t('jitInsights.icEvents')} value={demoTrace.icEvents.length.toLocaleString()} subtitle={t('jitInsights.icEventsSub').replace('{count}', analysis.sites.length.toLocaleString())} />
        <StatCard title={t('jitInsights.optEvents')} value={demoTrace.optEvents.length.toLocaleString()} />
        <StatCard title={t('jitInsights.deoptEvents')} value={demoTrace.deoptEvents.length.toLocaleString()} subtitle={t('jitInsights.findingsCount').replace('{count}', String(findings.length))} />
        <StatCard
          title={t('jitInsights.health')}
          value={`${Math.round(analysis.healthScore * 100)}%`}
          color={analysis.healthScore > 0.6 ? 'text-emerald-600 dark:text-emerald-400' : analysis.healthScore > 0.35 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}
          subtitle={criticalCount > 0 ? t('jitInsights.criticalCount').replace('{count}', String(criticalCount)) : t('jitInsights.noCritical')}
        />
      </div>

      <div className="mb-4 flex items-center gap-1 flex-wrap">
        {TAB_DEFS.map(def => (
          <button
            key={def.id}
            onClick={() => setTab(def.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === def.id ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            {def.label}
            {def.id === 'findings' && findings.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] bg-white/20">{findings.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-sm font-semibold text-gray-700 dark:text-gray-200">
              {t('jitInsights.hotSites')}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-left">
                    <th className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('jitInsights.kind')}</th>
                    <th className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('jitInsights.site')}</th>
                    <th className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('jitInsights.state')}</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500 dark:text-gray-400">{t('jitInsights.maps')}</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500 dark:text-gray-400">{t('jitInsights.hits')}</th>
                    <th className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('jitInsights.keys')}</th>
                  </tr>
                </thead>
                <tbody>
                  {siteRows.map(site => (
                    <tr key={site.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-200">{site.kind}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">{site.site ?? '—'}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded capitalize ${STATE_BADGE[site.state] ?? ''}`}>
                          {site.state}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{site.maps.length}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{site.hits}</td>
                      <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{site.keys.slice(0, 4).join(', ')}{site.keys.length > 4 ? '…' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <FindingsList findings={findings} />
        </div>
      )}

      {tab === 'graph' && (
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('jitInsights.graphHint')}</p>
          <IcStateGraph
            graph={analysis.graph}
            darkMode={darkMode}
            onSelectSite={setSelectedSite}
            selectedSite={selectedSite}
          />
          {selectedSite && (
            <button onClick={() => setSelectedSite(null)} className="mt-2 text-xs text-indigo-600 dark:text-indigo-400">
              {t('jitInsights.clearSelection')}
            </button>
          )}
        </div>
      )}

      {tab === 'timeline' && <OptTimeline trace={demoTrace} functions={analysis.functions} />}

      {tab === 'findings' && <FindingsList findings={findings} />}

      {tab === 'patches' && (
        <div>
          <div className="mb-3 flex items-center gap-1">
            <button
              onClick={() => setPatchMode('autofix')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${patchMode === 'autofix' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}
            >
              {t('jitInsights.patchAutofix')}
            </button>
            <button
              onClick={() => setPatchMode('manual')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${patchMode === 'manual' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}
            >
              {t('jitInsights.patchManual')}
            </button>
          </div>
          {patchMode === 'autofix' ? <AutoFixPanel findings={findings} /> : <PatchPanel />}
        </div>
      )}
    </div>
  );
}
