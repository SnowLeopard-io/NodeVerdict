import { useState, useCallback, useRef, type DragEvent } from 'react';
import type { ProgressInfo } from '../hooks/useFileUpload';
import { useI18n } from '../i18n/useI18n';

interface FileUploadProps {
  onFile: (file: File) => void;
  accept?: string;
  label?: string;
  disabled?: boolean;
  maxSize?: number;
  fileName?: string | null;
  fileSize?: number | null;
  onReset?: () => void;
  loading?: boolean;
  progress?: ProgressInfo | null;
  // Remote URL props
  onUrlLoad?: (url: string) => Promise<void>;
  urlLoading?: boolean;
  urlError?: string | null;
  urlProgress?: { loaded: number; total: number } | null;
  onUrlCancel?: () => void;
}

type UploadMode = 'local' | 'remote';

export function FileUpload({
  onFile,
  accept = '.json',
  label,
  disabled,
  maxSize,
  fileName,
  fileSize,
  onReset,
  loading,
  progress,
  onUrlLoad,
  urlLoading,
  urlError,
  urlProgress,
  onUrlCancel,
}: FileUploadProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<UploadMode>('local');
  const [urlInput, setUrlInput] = useState('');

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) validateAndProcess(file);
  }, [onFile, maxSize]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      validateAndProcess(file);
      e.target.value = '';
    }
  }, [onFile, maxSize]);

  function validateAndProcess(file: File) {
    if (maxSize && file.size > maxSize) {
      alert(`${t('fileUpload.maxSize')}: ${(maxSize / 1024 / 1024).toFixed(0)}MB`);
      return;
    }
    onFile(file);
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatUrlProgress(loaded: number, total: number): string {
    return `${formatFileSize(loaded)} / ${formatFileSize(total)} (${total > 0 ? Math.round((loaded / total) * 100) : 0}%)`;
  }

  const handleUrlLoad = useCallback(() => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    onUrlLoad?.(trimmed);
  }, [urlInput, onUrlLoad]);

  const handleUrlKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleUrlLoad();
    }
  }, [handleUrlLoad]);

  const handleModeChange = useCallback((newMode: UploadMode) => {
    setMode(newMode);
    setDragOver(false);
  }, []);

  // Loading state (local or remote)
  if (loading || urlLoading) {
    const activeProgress = loading ? progress : (urlProgress ? {
      loaded: urlProgress.loaded,
      total: urlProgress.total,
      percent: urlProgress.total > 0 ? Math.round((urlProgress.loaded / urlProgress.total) * 100) : 0,
    } : null);

    return (
      <div className="flex flex-col gap-2 px-4 py-3 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-lg">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-indigo-500 shrink-0 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
              {urlLoading ? t('fileUpload.loading') : t('fileUpload.loading')}
            </p>
            {activeProgress && (
              <p className="text-xs text-indigo-500">
                {formatUrlProgress(activeProgress.loaded, activeProgress.total)}
              </p>
            )}
          </div>
          {urlLoading && onUrlCancel && (
            <button
              onClick={onUrlCancel}
              className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-white dark:bg-gray-800 border border-red-200 dark:border-red-800 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
            >
              {t('fileUpload.cancel')}
            </button>
          )}
        </div>
        {activeProgress && (
          <div className="w-full h-1.5 bg-indigo-200 dark:bg-indigo-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${activeProgress.percent}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  // Show loaded file state with clear button (local mode only)
  if (fileName && mode === 'local') {
    return (
      <div className="flex flex-col gap-1 px-4 py-3 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-lg">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-indigo-500 dark:text-indigo-400 truncate">{label ?? t('fileUpload.uploadFile')}</p>
            <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300 truncate">{fileName}</p>
            {fileSize != null && <p className="text-xs text-indigo-500">{formatFileSize(fileSize)}</p>}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onReset?.(); }}
            className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-white dark:bg-gray-800 border border-red-200 dark:border-red-800 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
          >
            {t('common.clear')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Mode toggle tabs */}
      <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <button
          type="button"
          onClick={() => handleModeChange('local')}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            mode === 'local'
              ? 'bg-indigo-500 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          {t('fileUpload.localFile')}
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('remote')}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            mode === 'remote'
              ? 'bg-indigo-500 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          {t('fileUpload.remoteUrl')}
        </button>
      </div>

      {/* Remote URL mode */}
      {mode === 'remote' ? (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={handleUrlKeyDown}
              placeholder={t('fileUpload.urlPlaceholder')}
              disabled={disabled}
              className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleUrlLoad}
              disabled={disabled || !urlInput.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {t('fileUpload.load')}
            </button>
          </div>
          {urlError && (
            <p className="text-sm text-red-600 dark:text-red-400">{urlError}</p>
          )}
        </div>
      ) : (
        /* Local file mode - existing drag/drop UI */
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => (disabled ? null : inputRef.current?.click())}
          className={`
            border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
            ${dragOver ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30' : 'border-gray-300 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-gray-50 dark:hover:bg-gray-800'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
          <div className="flex flex-col items-center gap-2">
            <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{label}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('fileUpload.dragDrop')}</p>
          </div>
        </div>
      )}
    </div>
  );
}