import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRootStore } from '../../stores';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { analyzeTracingEvents, generateReport, decompressReport } from '../../shared/engine';
import { encodeReportToHash, decodeReportFromHash } from '../../shared/utils';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import type { TracingEvent, ReportData, ChannelStats } from '../../shared/types';
import { useI18n } from '../../shared/i18n/useI18n';

export function ReportPage() {
  const { t } = useI18n();
  const { reportData, setReportData } = useRootStore();
  const [copied, setCopied] = useState(false);

  const handleFileRead = useCallback(async (content: string) => {
    const events = JSON.parse(content) as TracingEvent[];
    const analysis = analyzeTracingEvents(events);
    const report = generateReport(
      analysis.channelStats,
      analysis.totalEvents,
      analysis.totalOperations,
      analysis.errorRate,
    );
    setReportData(report);
  }, [setReportData]);

  const upload = useUnifiedFileUpload({ onFile: handleFileRead });
  const { loading, error, fileName, fileSize, handleFile, progress, urlLoading, urlError, urlProgress, loadFromUrl, cancelUrl, handleReset } = upload;

  // Check URL hash for shared reports
  useEffect(() => {
    if (!reportData && window.location.hash) {
      const decoded = decodeReportFromHash(window.location.hash);
      if (decoded) setReportData(decoded);
    }
  }, []);

  const reportUrl = useMemo(() => {
    if (!reportData) return '';
    return window.location.origin + window.location.pathname + encodeReportToHash(reportData);
  }, [reportData]);

  const copyLink = useCallback(async () => {
    if (reportUrl) {
      await navigator.clipboard.writeText(reportUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [reportUrl]);

  if (!reportData) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('report.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('report.description')}</p>
        </div>
        <FileUpload onFile={handleFile} accept=".json" label={t('report.uploadTitle')} maxSize={500 * 1024 * 1024} fileName={fileName} fileSize={fileSize} onReset={handleReset} loading={loading} progress={progress} />
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <LoadingOverlay visible={loading} message={t('report.generating')} />
        <div className="mt-8">
          <EmptyState
            title={t('report.noData')}
            description={t('report.uploadHint')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('report.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{new Date(reportData.generatedAt).toLocaleString()}</p>
        </div>
        <div className="w-72">
          <FileUpload
            onFile={handleFile}
            accept=".json"
            label={t('report.uploadTitle')}
            maxSize={500 * 1024 * 1024}
            fileName={fileName}
            fileSize={fileSize}
            onReset={handleReset}
            loading={loading}
            progress={progress}
          />
        </div>
      </div>

      {/* Key Findings */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('report.keyFindings')}</h2>
        <ul className="space-y-1">
          {reportData.keyFindings.map((finding, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
              <span className="text-indigo-500 mt-0.5">•</span>
              {finding}
            </li>
          ))}
        </ul>
      </div>

      {/* Channel Summary */}
      {reportData.eventSummary && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('report.eventSummary')}</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <StatCard title={t('report.totalEvents')} value={reportData.eventSummary.totalEvents.toLocaleString()} />
            <StatCard title={t('report.totalOperations')} value={reportData.eventSummary.totalOperations.toLocaleString()} />
          </div>

          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('report.channel')}</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('report.totalOperations')}</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('report.avgLatency')}</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('report.p95Latency')}</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('report.errors')}</th>
                </tr>
              </thead>
              <tbody>
                {reportData.eventSummary.channels.map(cs => (
                  <tr key={cs.channel} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="px-4 py-2 font-medium text-gray-700 dark:text-gray-200">{cs.channel}</td>
                    <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">{cs.totalOperations}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{cs.avgDuration.toFixed(0)}ms</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{cs.p95Duration.toFixed(0)}ms</td>
                    <td className="px-4 py-2 text-right">
                      <span className={cs.errorCount > 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-400 dark:text-gray-500'}>
                        {cs.errorCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Heap Analysis Summary */}
      {reportData.heapAnalysis && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('report.heapAnalysis')}</h2>
          <div className="grid grid-cols-3 gap-3">
            <StatCard title={t('report.findings.totalSize').replace('{size}', '')} value={`${(reportData.heapAnalysis.totalSize / 1024 / 1024).toFixed(1)}MB`} />
            <StatCard title={t('report.totalEvents')} value={reportData.heapAnalysis.topObjects.length.toString()} />
            <StatCard title={t('report.findings.leakSuspects').replace('{count}', reportData.heapAnalysis.leakCount.toString())} value={reportData.heapAnalysis.leakCount.toString()} color={reportData.heapAnalysis.leakCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900'} />
          </div>
        </div>
      )}

      {/* Share */}
      <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('report.shareReport')}</h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={reportUrl}
            className="flex-1 text-xs font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 text-gray-600 dark:text-gray-300 truncate"
          />
          <button
            onClick={copyLink}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
          >
            {copied ? t('report.urlCopied') : t('report.copyUrl')}
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          {t('report.shareDesc')}
        </p>
      </div>

      {/* Export HTML */}
      <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('report.exportHtml')}</h2>
        <button
          onClick={() => exportHtmlReport(reportData, t)}
          className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors"
        >
          {t('report.exportHtml')}
        </button>
      </div>

      <LoadingOverlay visible={loading} />
    </div>
  );
}

function exportHtmlReport(reportData: ReportData, t: (key: string) => string): void {
  const channels = reportData.eventSummary?.channels ?? [];
  const findings = reportData.keyFindings ?? [];
  const heap = reportData.heapAnalysis;

  const rows = channels.map(cs => `
    <tr>
      <td style="padding:4px 8px;font-size:13px;text-align:left;font-weight:500">${escapeHtml(cs.channel)}</td>
      <td style="padding:4px 8px;font-size:13px;text-align:right">${cs.totalOperations}</td>
      <td style="padding:4px 8px;font-size:13px;text-align:right">${cs.avgDuration.toFixed(1)}ms</td>
      <td style="padding:4px 8px;font-size:13px;text-align:right;color:${cs.p95Duration > 100 ? '#dc2626' : '#6b7280'}">${cs.p95Duration.toFixed(1)}ms</td>
      <td style="padding:4px 8px;font-size:13px;text-align:right;color:${cs.errorCount > 0 ? '#dc2626' : '#6b7280'}">${cs.errorCount}</td>
    </tr>
  `).join('');
  const findingsHtml = findings.map(f => `<li style="margin-bottom:8px;font-size:14px;color:#4b5563">${escapeHtml(f)}</li>`).join('');

  const heapHtml = heap ? `
    <div style="margin-top:16px">
      <h2 style="font-size:18px;font-weight:600;color:#374151;margin-bottom:16px">${t('report.exportHeapAnalysis')}</h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
        <div style="background:#f9fafb;padding:16px;border-radius:8px">
          <p style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">${t('report.exportTotalSize')}</p>
          <p style="font-size:24px;font-weight:bold;color:#1f2937;margin-top:8px">${(heap.totalSize / 1024 / 1024).toFixed(1)}MB</p>
        </div>
        <div style="background:#f9fafb;padding:16px;border-radius:8px">
          <p style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">${t('report.exportTopObjects')}</p>
          <p style="font-size:24px;font-weight:bold;color:#1f2937;margin-top:8px">${heap.topObjects.length}</p>
        </div>
        <div style="background:#fef2f2;padding:16px;border-radius:8px">
          <p style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">${t('report.exportLeakSuspects')}</p>
          <p style="font-size:24px;font-weight:bold;color:#dc2626;margin-top:8px">${heap.leakCount}</p>
        </div>  
      </div>
    </div>
  ` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t('report.exportTitle')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 24px; background: #f9fafb; color: #1f2937; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 24px; font-weight: 700; margin: 0 0 4px 0; }
    .subtitle { font-size: 14px; color: #6b7280; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th { background: #f9fafb; text-align: left; padding: 8px; font-size: 12px; font-weight: 500; color: #6b7280; }
    .header-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    .logo { width: 32px; height: 32px; background: #059669; color: #fff; text-align: center; font-weight: bold; font-size: 18px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
    .findings { margin-bottom: 24px; }
    .footer { text-align: center; font-size: 14px; color: #6b7280; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-row">
      <div class="logo">N</div>
      <h1>${t('report.exportTitle')}</h1>
    </div>
    <p class="subtitle">${t('report.exportGenerated')
      .replace('{date}', new Date(reportData.generatedAt).toLocaleString())
      .replace('{events}', String(reportData.eventSummary?.totalEvents ?? 0))
      .replace('{operations}', String(reportData.eventSummary?.totalOperations ?? 0))}</p>

    <div class="findings">
      <h2 style="font-size:18px;font-weight:600;color:#1f2937;margin-bottom:8px">${t('report.exportKeyFindings')}</h2>
      <ul style="list-style:disc;padding-left:20px;color:#4b5563">${findingsHtml}</ul>
    </div>

    <table>
      <thead>
        <tr>
          <th style="padding:8px 16px;font-weight:500;text-align:left;color:#6b7280">${t('report.exportChannel')}</th>
          <th style="padding:8px 16px;font-weight:500;text-align:right;color:#6b7280">${t('report.exportOps')}</th>
          <th style="padding:8px 16px;font-weight:500;text-align:right;color:#6b7280">${t('report.exportAvg')}</th>
          <th style="padding:8px 16px;font-weight:500;text-align:right;color:#6b7280">${t('report.exportP95')}</th>
          <th style="padding:8px 16px;font-weight:500;text-align:right;color:#6b7280">${t('report.exportErrors')}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${heapHtml}

    <div class="footer">
      <p>${t('report.exportFooter').replace('{time}', new Date().toISOString())}</p>
    </div>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nodeverdict-report.html';
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}