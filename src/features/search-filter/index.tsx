import { useState, useCallback, useMemo } from 'react';
import { useRootStore } from '../../stores';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { analyzeTracingEvents } from '../../shared/engine';
import { ChannelFilter, UploadHeader, WideUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import { formatDuration } from '../../shared/utils';
import type { TracingEvent } from '../../shared/types';
import { useI18n } from '../../shared/i18n/useI18n';

interface SearchOptions {
  query: string;
  useRegex: boolean;
  minDuration: number | null;
  maxDuration: number | null;
  status: string[];
  timeRangeStart: number | null;
  timeRangeEnd: number | null;
  caseSensitive: boolean;
}

export function SearchFilterPage() {
  const { t } = useI18n();
  const { tracingAnalysis, setTracingAnalysis } = useRootStore();
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    query: '',
    useRegex: false,
    minDuration: null,
    maxDuration: null,
    status: [],
    timeRangeStart: null,
    timeRangeEnd: null,
    caseSensitive: false,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleFileRead = useCallback(async (content: string) => {
    const events = JSON.parse(content) as TracingEvent[];
    const analysis = analyzeTracingEvents(events);
    setTracingAnalysis(analysis);
  }, [setTracingAnalysis]);

  const upload = useUnifiedFileUpload({ onFile: handleFileRead });
  const { error, handleReset: uploadReset } = upload;

  function handleReset() {
    uploadReset();
    setTracingAnalysis(null);
    setSearchOptions({
      query: '',
      useRegex: false,
      minDuration: null,
      maxDuration: null,
      status: [],
      timeRangeStart: null,
      timeRangeEnd: null,
      caseSensitive: false,
    });
  }

   // Filtered events
   const filteredEvents = useMemo(() => {
     if (!tracingAnalysis) return { events: [], operations: [] };

     let events = tracingAnalysis.events;
     try {
       const regex = searchOptions.useRegex
         ? new RegExp(searchOptions.query, searchOptions.caseSensitive ? '' : 'i')
         : new RegExp(escapeRegex(searchOptions.query), searchOptions.caseSensitive ? '' : 'i');

       events = events.filter(e => {
         const searchTarget = JSON.stringify({ channel: e.channel, context: e.context, operationId: e.operationId });
         return regex.test(searchTarget);
       });
     } catch {
       // Invalid regex, skip filtering
     }

     // Filter by status (via operations)
     let filteredOperationIds: Set<string> | null = null;
     if (searchOptions.status.length > 0) {
       filteredOperationIds = new Set(
         tracingAnalysis.operations
           .filter(op => searchOptions.status.includes(op.status))
           .map(op => op.operationId)
       );
       events = events.filter(e => !e.operationId || filteredOperationIds!.has(e.operationId));
     }

     // Filter by duration (via operations)
     if (searchOptions.minDuration !== null || searchOptions.maxDuration !== null) {
       const matchingOps = tracingAnalysis.operations.filter(op => {
         if (searchOptions.minDuration !== null && op.duration < searchOptions.minDuration) return false;
         if (searchOptions.maxDuration !== null && op.duration > searchOptions.maxDuration) return false;
         return true;
       });
       const matchingIds = new Set(matchingOps.map(op => op.operationId));
       events = events.filter(e => !e.operationId || matchingIds.has(e.operationId));
     }

     // Filter by time range
     if (searchOptions.timeRangeStart !== null) {
       events = events.filter(e => e.timestamp >= searchOptions.timeRangeStart!);
     }
     if (searchOptions.timeRangeEnd !== null) {
       events = events.filter(e => e.timestamp <= searchOptions.timeRangeEnd!);
     }

     const operations = tracingAnalysis.operations.filter(op =>
       events.some(e => e.operationId === op.operationId)
     );

     return { events, operations };
   }, [tracingAnalysis, searchOptions]);

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function updateSearch(updates: Partial<SearchOptions>) {
    setSearchOptions(prev => ({ ...prev, ...updates }));
   }

   if (!tracingAnalysis) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <UploadHeader
          title={t('searchFilter.title')}
          description={t('searchFilter.description')}
          api={upload}
          accept=".json"
          label={t('searchFilter.uploadHint')}
          maxSize={500 * 1024 * 1024}
          onReset={handleReset}
          error={error}
        />
        <LoadingOverlay visible={upload.loading || upload.urlLoading} message={t('searchFilter.loading')} />
        <div className="mt-8">
          <EmptyState title={t('searchFilter.noData')} description={t('searchFilter.description')} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('searchFilter.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('searchFilter.eventsTotal').replace('{count}', tracingAnalysis.totalEvents.toLocaleString())}</p>
        </div>
        <div className="mt-4">
<WideUpload api={upload} accept=".json" label={t('searchFilter.uploadHint')} maxSize={500 * 1024 * 1024} onReset={handleReset} error={error} />
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchOptions.query}
              onChange={e => updateSearch({ query: e.target.value })}
              placeholder={t('searchFilter.searchHint')}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800 focus:border-indigo-400 dark:focus:border-indigo-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={searchOptions.useRegex}
              onChange={e => updateSearch({ useRegex: e.target.checked })}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            {t('searchFilter.regex')}
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={searchOptions.caseSensitive}
              onChange={e => updateSearch({ caseSensitive: e.target.checked })}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            {t('searchFilter.caseSensitive')}
          </label>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            {showAdvanced ? t('searchFilter.hideAdvanced') : t('searchFilter.advanced')}
          </button>
        </div>

        {/* Results count */}
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t('searchFilter.eventsMatch').replace('{match}', filteredEvents.events.length.toLocaleString()).replace('{total}', tracingAnalysis.totalEvents.toLocaleString())}
          {filteredEvents.events.length !== tracingAnalysis.totalEvents && (
            <span className="text-gray-400 dark:text-gray-500"> {t('searchFilter.hidden').replace('{count}', (tracingAnalysis.totalEvents - filteredEvents.events.length).toLocaleString())}</span>
          )}
        </div>

        {/* Advanced Filters */}
        {showAdvanced && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">{t('searchFilter.durationMin')}</label>
              <input
                type="number"
                min={0}
                value={searchOptions.minDuration ?? ''}
                onChange={e => updateSearch({ minDuration: e.target.value ? Number(e.target.value) : null })}
                placeholder={t('searchFilter.any')}
                className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-indigo-200 dark:focus:ring-indigo-800 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">{t('searchFilter.durationMax')}</label>
              <input
                type="number"
                min={0}
                value={searchOptions.maxDuration ?? ''}
                onChange={e => updateSearch({ maxDuration: e.target.value ? Number(e.target.value) : null })}
                placeholder={t('searchFilter.any')}
                className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-indigo-200 dark:focus:ring-indigo-800 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">{t('searchFilter.status')}</label>
              <div className="flex gap-2">
                {(['success', 'error', 'incomplete'] as const).map(s => (
                  <label key={s} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={searchOptions.status.includes(s)}
                      onChange={e => {
                        if (e.target.checked) {
                          updateSearch({ status: [...searchOptions.status, s] });
                        } else {
                          updateSearch({ status: searchOptions.status.filter(x => x !== s) });
                        }
                      }}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">{t('searchFilter.timeRange')}</label>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={searchOptions.timeRangeStart ?? ''}
                  onChange={e => updateSearch({ timeRangeStart: e.target.value ? Number(e.target.value) : null })}
                  placeholder={t('searchFilter.from')}
                  className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-indigo-200 dark:focus:ring-indigo-800 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                />
                <span className="text-xs text-gray-400 dark:text-gray-500 self-center">-</span>
                <input
                  type="number"
                  value={searchOptions.timeRangeEnd ?? ''}
                  onChange={e => updateSearch({ timeRangeEnd: e.target.value ? Number(e.target.value) : null })}
                  placeholder={t('searchFilter.to')}
                  className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-indigo-200 dark:focus:ring-indigo-800 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results Table */}
      {filteredEvents.events.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0">
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('searchFilter.timestamp')}</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('searchFilter.channel')}</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('searchFilter.eventType')}</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('searchFilter.operation')}</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('searchFilter.context')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.events.map((event, idx) => {
                  const op = filteredEvents.operations.find(o => o.operationId === event.operationId);
                  return (
                    <tr key={idx} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">
                        {new Date(event.timestamp).toISOString().slice(11, 23)}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-700 dark:text-gray-200">{event.channel}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          event.eventType === 'error' ? 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300' :
                          event.eventType === 'start' ? 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' :
                          event.eventType === 'end' ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' :
                          event.eventType === 'asyncStart' ? 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300' :
                          event.eventType === 'asyncEnd' ? 'bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300' :
                          'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                        }`}>
                          {event.eventType}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-300 max-w-[150px] truncate">
                        {event.operationId ?? '-'}
                        {op && <span className="text-gray-400 dark:text-gray-500 ml-1">({formatDuration(op.duration)})</span>}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 max-w-[200px] truncate">
                        {event.context ? JSON.stringify(event.context).slice(0, 80) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filteredEvents.events.length === 0 && (
        <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('searchFilter.noMatch')}</p>
        </div>
      )}
    </div>
  );
}