import { useCallback, useMemo, useState } from 'react';
import { useRootStore } from '../../stores';
import { useUnifiedFileUpload } from '../../shared/hooks';
import type { TracingAnalysis } from '../../shared/types';
import type { TraceStreamResult } from '../../shared/streaming/trace-stream-client';
import { useI18n } from '../../shared/i18n/useI18n';
import { EventTimeline } from './components/EventTimeline';
import { EventDetail } from './components/EventDetail';
import { EventSummary } from './components/EventSummary';
import { ChannelFilter } from '../../shared/components';
import { FileUpload } from '../../shared/components';
import { EmptyState } from '../../shared/components';
import { LoadingOverlay } from '../../shared/components';
import { ExportButton } from '../report/ExportButton';
import { toMarkdown } from '../report/exportUtils';

export function EventViewerPage() {
  const { t } = useI18n();
  const {
    tracingAnalysis,
    setTracingAnalysis,
    selectedChannels,
    setSelectedChannels,
    selectedEventIndex,
    setSelectedEventIndex,
  } = useRootStore();

   const [streamMeta, setStreamMeta] = useState<{ truncated: boolean; eventsSeen: number } | null>(null);

   const handleAnalysis = useCallback((analysis: TracingAnalysis, meta: TraceStreamResult['meta']) => {
     setTracingAnalysis(analysis);
     setSelectedChannels(analysis.channels);
     setSelectedEventIndex(null);
     setStreamMeta({ truncated: meta.truncated, eventsSeen: meta.eventsSeen });
   }, [setTracingAnalysis, setSelectedChannels, setSelectedEventIndex]);

   const upload = useUnifiedFileUpload({ onAnalysis: handleAnalysis });
   const { loading, error, fileName, fileSize, handleFile, progress, urlLoading, urlError, urlProgress, loadFromUrl, cancelUrl, handleReset: uploadReset } = upload;

   function handleReset() {
     uploadReset();
     setTracingAnalysis(null);
     setSelectedChannels([]);
     setSelectedEventIndex(null);
     setStreamMeta(null);
   }

   const filteredEvents = useMemo(() => {
     if (!tracingAnalysis) return [];
     if (selectedChannels.length === 0) return tracingAnalysis.events;
     return tracingAnalysis.events.filter(e => selectedChannels.includes(e.channel));
   }, [tracingAnalysis, selectedChannels]);

   const selectedEvent = useMemo(() => {
     if (selectedEventIndex === null) return null;
     return filteredEvents[selectedEventIndex] ?? null;
   }, [selectedEventIndex, filteredEvents]);

  if (!tracingAnalysis) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('eventViewer.uploadTitle')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('eventViewer.uploadHint')}</p>
        </div>
        <FileUpload
          onFile={handleFile}
          accept=".json"
          label={t('eventViewer.uploadTitle')}
          maxSize={500 * 1024 * 1024}
          fileName={fileName}
          fileSize={fileSize}
          onReset={handleReset}
          loading={loading}
          progress={progress}
          onUrlLoad={loadFromUrl}
          urlLoading={urlLoading}
          urlError={urlError}
          urlProgress={urlProgress}
          onUrlCancel={cancelUrl}
        />
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {urlError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{urlError}</p>}
        <LoadingOverlay visible={loading || urlLoading} message={t('eventViewer.parsingEvents')} />
        <div className="mt-8">
          <EmptyState
            title={t('eventViewer.noEvents')}
            description={t('eventViewer.uploadHint')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('eventViewer.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('eventViewer.eventsAndOps').replace('{events}', String(tracingAnalysis.totalEvents)).replace('{operations}', String(tracingAnalysis.totalOperations))}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            onExportMarkdown={() => toMarkdown({
              title: t('eventViewer.exportTitle'),
              sections: [
                {
                  title: t('eventViewer.summary'),
                  type: 'stats',
                  content: [
                    { label: t('eventViewer.totalEvents'), value: tracingAnalysis.totalEvents.toLocaleString() },
                    { label: t('eventViewer.totalOperations'), value: tracingAnalysis.totalOperations.toLocaleString() },
                    { label: t('eventViewer.errorRate'), value: `${(tracingAnalysis.errorRate * 100).toFixed(1)}%` },
                    { label: t('eventViewer.totalChannels'), value: tracingAnalysis.channels.length.toString() },
                  ],
                },
                {
                  title: t('eventViewer.channelStats'),
                  type: 'table',
                  content: {
                    headers: [t('eventViewer.channel'), t('eventViewer.operations'), t('eventViewer.avgLatency'), t('eventViewer.p95Latency'), t('eventViewer.errors')],
                    rows: tracingAnalysis.channelStats.slice(0, 30).map(cs => [
                      cs.channel,
                      cs.totalOperations.toString(),
                      `${cs.avgDuration.toFixed(0)}ms`,
                      `${cs.p95Duration.toFixed(0)}ms`,
                      cs.errorCount.toString(),
                    ]),
                  },
                },
              ],
            })}
            filename="event-viewer"
          />
          <div className="w-72">
            <FileUpload
              onFile={handleFile}
              accept=".json"
              label={t('eventViewer.uploadTitle')}
              maxSize={500 * 1024 * 1024}
              fileName={fileName}
              fileSize={fileSize}
              onReset={handleReset}
              loading={loading}
              progress={progress}
              onUrlLoad={loadFromUrl}
              urlLoading={urlLoading}
              urlError={urlError}
              urlProgress={urlProgress}
              onUrlCancel={cancelUrl}
            />
          </div>
        </div>
      </div>

      <EventSummary analysis={tracingAnalysis} />

      {streamMeta?.truncated && (
        <div className="mt-3 px-4 py-2.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-700 dark:text-amber-400">
          {t('eventViewer.truncatedNotice').replace('{events}', streamMeta.eventsSeen.toLocaleString())}
        </div>
      )}

      <div className="mt-4 mb-3">
        <ChannelFilter
          channels={tracingAnalysis.channels}
          selected={selectedChannels}
          onChange={setSelectedChannels}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <EventTimeline
            events={filteredEvents}
            selectedIndex={selectedEventIndex}
            onSelect={setSelectedEventIndex}
          />
        </div>
        <div>
          {selectedEvent ? (
            <EventDetail event={selectedEvent} onClose={() => setSelectedEventIndex(null)} />
          ) : (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-6 text-center text-sm text-gray-400 dark:text-gray-500">
              {t('eventViewer.selectEvent')}
            </div>
          )}
        </div>
      </div>

      <LoadingOverlay visible={loading || urlLoading} message={t('eventViewer.parsingEvents')} />
    </div>
  );
}