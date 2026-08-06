import { AppShell } from './AppShell';
import { EventViewerPage } from '../features/event-viewer';
import { TraceViewerPage } from '../features/trace-viewer';
import { ValidatorPage } from '../features/validator';
import { HeapAnalyzerPage } from '../features/heap-analyzer';
import { ReportPage } from '../features/report';
import { CpuProfilerPage } from '../features/cpu-profiler';
import { HeapDiffPage } from '../features/heap-diff';
import { SearchFilterPage } from '../features/search-filter';
import { TimeSeriesPage } from '../features/time-series';
import { PerfComparePage } from '../features/perf-compare';
import { useUIStore, type Page } from '../stores';
import { TutorialPage } from '../features/tutorial';
import { MemoryTimelinePage } from '../features/memory-timeline';
import { GcLogPage } from '../features/gc-log';
import { LiveMonitorPage } from '../features/live-monitor';
import { AlertRulesPage } from '../features/alert-rules';
import { SnapshotHistoryPage } from '../features/snapshot-history';
import { AiRcaPage } from '../features/ai-rca';
import { TopologyPage } from '../features/topology';
import { DifferentialDebugPage } from '../features/differential-debug';
import { JitInsightsPage } from '../features/jit-insights';
import { CpuProfileDiffPage } from '../features/cpu-profile-diff';
import { SourceAttributionPage } from '../features/source-attribution';
import { OtelIngestPage } from '../features/otel-ingest';
import { ReportDiffPage } from '../features/report-diff';
import { CiBaselinePage } from '../features/ci-baseline';
import { ReproGeneratorPage } from '../features/repro-generator';
import { useEffect, useState } from 'react';
import { useI18n } from '../shared/i18n/useI18n';
import { Page as PageLayout } from '../shared/components';

function HomePage() {
  const { navigate } = useUIStore();
  const { t } = useI18n();

  const features: { page: Page; icon: string }[] = [
    { page: 'event-viewer', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
    { page: 'trace-viewer', icon: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z' },
    { page: 'cpu-profiler', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    { page: 'heap-analyzer', icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z' },
    { page: 'heap-diff', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' },
    { page: 'snapshot-history', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { page: 'time-series', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
    { page: 'perf-compare', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
    { page: 'validator', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
    { page: 'search-filter', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
    { page: 'memory-timeline', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
    { page: 'gc-log', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    { page: 'jit-insights', icon: 'M11 3h8v8h-8V3zM5 5h3v14H5V5zm12 10h3v4h-3v-4zm-6 0h3v4h-3v-4z' },
    { page: 'live-monitor', icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
    { page: 'alert-rules', icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
    { page: 'report', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { page: 'topology', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
    { page: 'ai-rca', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    { page: 'differential-debug', icon: 'M12 8v-1m0 12v-1m4.95-10.95l-.707.707m-8.486 8.486l-.707.707M21 12h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
    { page: 'tutorial', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
    { page: 'cpu-profile-diff', icon: 'M3 3v18h18M7 16l4-5 3 3 5-7' },
    { page: 'source-attribution', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' },
    { page: 'otel-ingest', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    { page: 'report-diff', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
    { page: 'ci-baseline', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
    { page: 'repro-generator', icon: 'M10 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-4m-1-1l4-4-4-4m-4 4h8' },
  ];

  return (
    <PageLayout maxWidth="4xl">
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">{t('app.title')}</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-8">{t('app.description')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-[minmax(7.5rem,auto)]">
        {features.map((f, i) => (
          <div
            key={f.page}
            className="animate-fade-up h-full"
            style={{ animationDelay: `${80 + i * 40}ms` }}
          >
            <FeatureCard
              title={t(`feature.${f.page}`)}
              description={t(`feature.${f.page}.desc`)}
              icon={f.icon}
              onClick={() => navigate(f.page)}
            />
          </div>
        ))}
      </div>
    </PageLayout>
  );
}

function FeatureCard({ title, description, icon, onClick, className = '' }: {
  title: string; description: string; icon: string; onClick: () => void; className?: string;
}) {
  return (
    <button onClick={onClick} className={`w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 text-left hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-600 hover:-translate-y-0.5 transition-all group h-full flex flex-col ${className}`}>
      <div className="flex items-start gap-4 flex-1">
        <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/50 transition-colors">
          <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icon} />
          </svg>
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 group-hover:text-indigo-700 dark:group-hover:text-indigo-400 transition-colors">{title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
    </button>
  );
}

export function App() {
  const { currentPage } = useUIStore();
  const darkMode = useUIStore((s) => s.darkMode);

  // Apply dark class on mount and when darkMode changes
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Lazy-mount: only the current (and previously visited) pages are rendered so
  // idle pages don't spawn workers, timers, or polling at startup. Once a page is
  // visited it stays mounted to preserve its local state across navigation.
  const [mountedPages, setMountedPages] = useState<Set<Page>>(() => new Set([currentPage]));
  useEffect(() => {
    setMountedPages(prev => {
      if (prev.has(currentPage)) return prev;
      const next = new Set(prev);
      next.add(currentPage);
      return next;
    });
  }, [currentPage]);

  const pages: { id: Page; node: React.ReactNode }[] = [
    { id: 'home', node: <HomePage /> },
    { id: 'event-viewer', node: <EventViewerPage /> },
    { id: 'trace-viewer', node: <TraceViewerPage /> },
    { id: 'validator', node: <ValidatorPage /> },
    { id: 'heap-analyzer', node: <HeapAnalyzerPage /> },
    { id: 'heap-diff', node: <HeapDiffPage /> },
    { id: 'report', node: <ReportPage /> },
    { id: 'cpu-profiler', node: <CpuProfilerPage /> },
    { id: 'search-filter', node: <SearchFilterPage /> },
    { id: 'time-series', node: <TimeSeriesPage /> },
    { id: 'perf-compare', node: <PerfComparePage /> },
    { id: 'tutorial', node: <TutorialPage /> },
    { id: 'memory-timeline', node: <MemoryTimelinePage /> },
    { id: 'gc-log', node: <GcLogPage /> },
    { id: 'live-monitor', node: <LiveMonitorPage /> },
    { id: 'alert-rules', node: <AlertRulesPage /> },
    { id: 'snapshot-history', node: <SnapshotHistoryPage /> },
    { id: 'ai-rca', node: <AiRcaPage /> },
    { id: 'topology', node: <TopologyPage /> },
    { id: 'differential-debug', node: <DifferentialDebugPage /> },
    { id: 'jit-insights', node: <JitInsightsPage /> },
    { id: 'cpu-profile-diff', node: <CpuProfileDiffPage /> },
    { id: 'source-attribution', node: <SourceAttributionPage /> },
    { id: 'otel-ingest', node: <OtelIngestPage /> },
    { id: 'report-diff', node: <ReportDiffPage /> },
    { id: 'ci-baseline', node: <CiBaselinePage /> },
    { id: 'repro-generator', node: <ReproGeneratorPage /> },
  ];

  return (
    <AppShell>
      {pages.map(page => (
        <div
          key={page.id}
          className={page.id === 'home' ? 'animate-fade-in' : 'animate-fade-up'}
          style={{ display: currentPage === page.id ? 'block' : 'none' }}
        >
          {mountedPages.has(page.id) ? page.node : null}
        </div>
      ))}
    </AppShell>
  );
}