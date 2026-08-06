import { useCallback, useMemo, useState } from 'react';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { loadTracingData } from '../../shared/engine';
import { buildReproScript } from '../../shared/engine/repro-extractor';
import type { TracingEvent } from '../../shared/types';
import { FileUpload, EmptyState, StatCard } from '../../shared/components';
import { useI18n } from '../../shared/i18n/useI18n';

export function ReproGeneratorPage() {
  const { t } = useI18n();
  const [events, setEvents] = useState<TracingEvent[] | null>(null);
  const [maxEvents, setMaxEvents] = useState(2000);
  const [copied, setCopied] = useState(false);

  const upload = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => setEvents(loadTracingData(content)), []),
  });
  const { handleFile, fileName, fileSize, handleReset, progress, loading, error, loadFromUrl, urlLoading, urlError, urlProgress, cancelUrl } = upload;

  const script = useMemo(() => (events ? buildReproScript(events, { maxEvents }) : ''), [events, maxEvents]);

  async function copy() {
    if (!script) return;
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be blocked; fall back to select-all
      setCopied(false);
    }
  }

  function download() {
    if (!script) return;
    const blob = new Blob([script], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'repro.mjs';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('repro.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('repro.description')}</p>
        </div>
        <div className="w-full max-w-2xl">
          <FileUpload
            onFile={handleFile}
            accept=".json,.ndv"
            label={t('repro.uploadLabel')}
            maxSize={500 * 1024 * 1024}
            fileName={fileName}
            fileSize={fileSize}
            onReset={() => { handleReset(); setEvents(null); }}
            loading={loading}
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
        <div className="mt-8"><EmptyState title={t('repro.noData')} description={t('repro.noDataDesc')} /></div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatCard title={t('repro.events')} value={events.length.toString()} />
            <StatCard title={t('repro.channels')} value={new Set(events.map(e => e.channel)).size.toString()} />
            <StatCard title={t('repro.embedded')} value={script.length ? countEmbedded(script).toString() : '0'} />
          </div>

          <label className="block text-sm text-gray-600 dark:text-gray-300 mb-2">
            {t('repro.maxEvents')}: <span className="font-mono">{maxEvents}</span>
          </label>
          <input
            type="range" min={100} max={5000} step={100} value={maxEvents}
            onChange={e => setMaxEvents(Number(e.target.value))}
            className="w-full mb-4 accent-indigo-600"
          />

          <div className="flex items-center gap-2 mb-2">
            <button onClick={copy} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">
              {copied ? t('repro.copied') : t('repro.copy')}
            </button>
            <button onClick={download} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              {t('repro.download')}
            </button>
          </div>

          <div className="bg-gray-900 dark:bg-black rounded-xl p-4 max-h-[420px] overflow-auto">
            <pre className="text-xs text-emerald-300 dark:text-emerald-400 font-mono whitespace-pre">{script}</pre>
          </div>
        </>
      )}
    </div>
  );
}

function countEmbedded(script: string): number {
  const m = /replayed (\d+) events/.exec(script);
  return m ? Number(m[1]) : 0;
}