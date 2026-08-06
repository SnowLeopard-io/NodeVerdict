import { useCallback, useMemo, useState } from 'react';
import { useRootStore } from '../../stores';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { validateEvents } from '../../shared/engine';
import { UploadHeader, WideUpload, EmptyState, LoadingOverlay, StatCard } from '../../shared/components';
import type { TracingEvent } from '../../shared/types';
import { useI18n } from '../../shared/i18n/useI18n';

function severityBadge(severity: string) {
  switch (severity) {
    case 'error': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    case 'warning': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'info': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    default: return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  }
}

export function ValidatorPage() {
  const { t } = useI18n();
  const { validationResults, setValidationResults } = useRootStore();
  const upload = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      const events = JSON.parse(content) as TracingEvent[];
      const results = validateEvents(events);
      setValidationResults(results);
    }, [setValidationResults]),
  });
  const { error, handleReset } = upload;

  const stats = useMemo(() => {
    if (!validationResults) return null;
    let errors = 0, warnings = 0, infos = 0;
    for (const r of validationResults) {
      for (const i of r.issues) {
        if (i.severity === 'error') errors++;
        else if (i.severity === 'warning') warnings++;
        else infos++;
      }
    }
    return { channels: validationResults.length, errors, warnings, infos };
  }, [validationResults]);

  if (!validationResults) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <UploadHeader
          title={t('validator.title')}
          description={t('validator.uploadHint')}
          api={upload}
          accept=".json"
          label={t('validator.uploadTitle')}
          maxSize={500 * 1024 * 1024}
          onReset={handleReset}
          error={error}
        />
        <LoadingOverlay visible={upload.loading} message={t('validator.validating')} />
        <div className="mt-8">
          <EmptyState
            title={t('validator.noData')}
            description={t('validator.uploadDesc')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('validator.validationResults')}</h1>
        </div>
        <div className="mt-4">
          <WideUpload api={upload} accept=".json" label={t('validator.uploadTitle')} maxSize={500 * 1024 * 1024} onReset={handleReset} error={error} />
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <StatCard title={t('validator.channels')} value={stats.channels.toString()} />
          <StatCard title={t('validator.errors')} value={stats.errors.toString()} color={stats.errors > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'} />
          <StatCard title={t('validator.warnings')} value={stats.warnings.toString()} color={stats.warnings > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-gray-100'} />
          <StatCard title={t('validator.issues')} value={stats.infos.toString()} />
        </div>
      )}

      <div className="space-y-4">
        {validationResults.map(result => (
          <div key={result.channel} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className={`px-4 py-2 flex items-center gap-2 ${result.valid ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
              <span className={`w-2 h-2 rounded-full ${result.valid ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="font-medium text-sm text-gray-700 dark:text-gray-200">{result.channel}</span>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${result.valid ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                {result.valid ? t('validator.valid') : t('validator.invalid')}
              </span>
            </div>

            {result.issues.length > 0 && (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {result.issues.map((issue, idx) => (
                  <div key={idx} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${severityBadge(issue.severity)}`}>
                      {issue.severity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-700 dark:text-gray-200">{issue.message}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{issue.category}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {result.issues.length === 0 && (
              <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{t('validator.noIssues')}</div>
            )}
          </div>
        ))}
      </div>

      <LoadingOverlay visible={upload.loading} />
    </div>
  );
}