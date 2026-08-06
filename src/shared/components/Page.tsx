import type { ReactNode } from 'react';

/**
 * Reusable page-layout primitives.
 *
 * Every feature page follows the same chrome: a padded/centered page wrapper,
 * a PageHeader (title + optional description + actions), one or more StatGrids,
 * and content "cards". This module centralizes that chrome so pages stop
 * re-spelling `p-6 max-w-3xl mx-auto`, `grid grid-cols-4 gap-3`, and
 * `bg-white dark:bg-gray-800 border ... rounded-xl p-4` by hand.
 */

const MAX_WIDTH_CLASS = {
  none: '',
  '3xl': 'max-w-3xl mx-auto',
  '4xl': 'max-w-4xl mx-auto',
  '5xl': 'max-w-5xl mx-auto',
} as const;

export type PageWidth = keyof typeof MAX_WIDTH_CLASS;

type Size = 'auto' | 'wide';

export interface PageProps {
  children: ReactNode;
  /** Optional horizontal container width. Defaults to none (full-bleed `p-6`). */
  maxWidth?: PageWidth;
  size?: Size;
  className?: string;
}

/**
 * Root wrapper for a feature page. Always applies `p-6`; optionally constrains
 * the content width and centers it.
 */
export function Page({ children, maxWidth = 'none', size, className }: PageProps) {
  const widthClass = size === 'wide' ? 'max-w-7xl mx-auto' : MAX_WIDTH_CLASS[maxWidth ?? 'none'];
  return <div className={`p-6 ${widthClass} ${className ?? ''}`.trim()}>{children}</div>;
}

const COLS_CLASS = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
} as const;

export type StatGridCols = keyof typeof COLS_CLASS;

export interface StatGridProps {
  children: ReactNode;
  cols?: StatGridCols;
  className?: string;
}

/** Responsive grid wrapper for a row of `StatCard`s. */
export function StatGrid({ children, cols = 4, className }: StatGridProps) {
  return <div className={`grid gap-3 mb-4 ${COLS_CLASS[cols]} ${className ?? ''}`.trim()}>{children}</div>;
}

export interface CardProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** `table` reduces padding and rounds for overflow-hidden tables (no body padding). */
  variant?: 'default' | 'table';
  className?: string;
}

/**
 * Reusable content/panel card. Matches the app's two recurring card styles:
 * a padded `rounded-lg` content card (default) or an `overflow-hidden`
 * table card (variant "table").
 */
export function Card({ title, description, actions, children, variant = 'default', className }: CardProps) {
  const outer =
    variant === 'table'
      ? 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden'
      : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg';

  const hasHeader = title || description || actions;

  return (
    <div className={`${outer} ${className ?? ''}`.trim()}>
      {hasHeader && (
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h2>}
            {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={variant === 'table' ? '' : 'p-4'}>{children}</div>
    </div>
  );
}

export interface SectionTitleProps {
  children: ReactNode;
  className?: string;
  hint?: string;
}

/** Small section heading used above an inline (non-card) block. */
export function SectionTitle({ children, hint, className }: SectionTitleProps) {
  return (
    <div className={`mb-2 ${className ?? ''}`.trim()}>
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{children}</h2>
      {hint && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}