import type { ReactNode } from 'react';
import type { ProgressInfo } from '../hooks/useFileUpload';
import { FileUpload } from './FileUpload';
import { useI18n } from '../i18n/useI18n';

/**
 * Unified file-upload UI.
 *
 * Every page that loads a trace / snapshot / profile follows the same shape:
 * a title block on the left and a wide upload box on the right. This module
 * centralizes that layout so pages only wire up their `useUnifiedFileUpload`
 * hook result and a couple of knobs, instead of re-spelling FileUpload + error
 * markup in every feature.
 */

/** The object returned by `useUnifiedFileUpload` (see shared/hooks). */
export interface UploadApi {
  loading: boolean;
  error: string | null;
  fileName: string | null;
  fileSize: number | null;
  handleFile: (file: File) => void;
  progress: ProgressInfo | null;
  urlLoading: boolean;
  urlError: string | null;
  urlProgress: { loaded: number; total: number } | null;
  loadFromUrl: (url: string) => Promise<void>;
  cancelUrl: () => void;
  handleReset: () => void;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Optional action buttons rendered on the right of the title block. */
  actions?: ReactNode;
}

/** Standard page header: title + description, with optional trailing actions. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{title}</h1>
        {description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

interface WideUploadProps {
  /** The `useUnifiedFileUpload` hook result for this slot. */
  api: UploadApi;
  accept?: string;
  label?: string;
  maxSize?: number;
  disabled?: boolean;
  /** Extra reset logic beyond the hook's own reset (e.g. clear page state). */
  onReset?: () => void;
  /** Page-level error to surface alongside the upload errors. */
  error?: string | null;
  /** Optional override for the displayed file name (defaults to `api.fileName`). */
  fileNameOverride?: string | null;
}

/**
 * Wide upload box with built-in error display.
 * Reuses the existing `FileUpload` look (drag-drop, remote URL tab, progress),
 * standardized to a full-width container.
 */
export function WideUpload({ api, accept = '.json,.ndv', label, maxSize = 500 * 1024 * 1024, disabled, onReset, error, fileNameOverride }: WideUploadProps) {
  const { t } = useI18n();
  const resetLabel = label ?? t('fileUpload.uploadFile');

  return (
    <div className="w-full">
      <FileUpload
        onFile={api.handleFile}
        accept={accept}
        label={resetLabel}
        maxSize={maxSize}
        disabled={disabled}
        fileName={fileNameOverride ?? api.fileName}
        fileSize={api.fileSize}
        onReset={() => {
          api.handleReset();
          onReset?.();
        }}
        loading={api.loading}
        progress={api.progress}
        onUrlLoad={api.loadFromUrl}
        urlLoading={api.urlLoading}
        urlError={api.urlError}
        urlProgress={api.urlProgress}
        onUrlCancel={api.cancelUrl}
      />
      {(error || api.error || api.urlError) && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error ?? api.error ?? api.urlError}</p>
      )}
    </div>
  );
}

/**
 * One-call page header + wide upload: the most common layout for trace pages.
 * `onReset` clears page-level state when the user dismisses the uploaded file.
 */
export function UploadHeader({
  title,
  description,
  api,
  accept = '.json,.ndv',
  label,
  maxSize = 500 * 1024 * 1024,
  disabled,
  onReset,
  error,
  fileNameOverride,
  actions,
}: PageHeaderProps & Omit<WideUploadProps, 'api'> & { api: UploadApi; actions?: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{title}</h1>
          {description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
      <div className="mt-4">
        <WideUpload api={api} accept={accept} label={label} maxSize={maxSize} disabled={disabled} onReset={onReset} error={error} fileNameOverride={fileNameOverride} />
      </div>
    </div>
  );
}