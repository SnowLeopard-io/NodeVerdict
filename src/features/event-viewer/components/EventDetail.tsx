import type { TracingEvent } from '../../../shared/types';
import { formatTimestamp, eventTypeColor } from '../../../shared/utils';
import { useI18n } from '../../../shared/i18n/useI18n';

interface EventDetailProps {
  event: TracingEvent;
  onClose: () => void;
}

/** Smart context renderer based on channel type */
function SmartContext({ context, channel }: { context: Record<string, unknown>; channel: string }) {
  const { t } = useI18n();
  // SQL query detection
  if (context.query || context.sql || context.text) {
    const sql = String(context.query ?? context.sql ?? context.text);
    const hasQuery = !!context.query;
    const hasParams = !!context.parameters;
    const hasRows = context.rows !== undefined;
    return (
      <div className="space-y-2">
        {hasQuery && (
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">{t('eventViewer.sqlQuery')}</p>
            <pre className="text-xs bg-blue-50 border border-blue-100 rounded p-2 overflow-auto max-h-32 text-blue-800 font-mono"
              dangerouslySetInnerHTML={{ __html: highlightSql(sql) }}
            />
          </div>
        )}
        {hasParams && (
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('eventViewer.parameters')}</p>
            <pre className="text-xs bg-gray-50 dark:bg-gray-800 rounded p-1 overflow-auto max-h-20">
              {JSON.stringify(context.parameters, null, 2)}
            </pre>
          </div>
        )}
        {hasRows && (
          <div className="flex justify-between">
            <span className="text-xs text-gray-500">{t('eventViewer.rowsAffected')}</span>
            <span className="text-xs font-medium">{String(context.rows)}</span>
          </div>
        )}
        {renderOtherFields(context, ['query', 'sql', 'text', 'parameters', 'rows'], t)}
      </div>
    );
  }

  // HTTP request detection
  const hasMethod = !!context.method;
  const hasUrl = !!(context.url || context.path);
  const hasStatusCode = context.statusCode !== undefined;
  const hasHeaders = !!context.headers;
  if (hasUrl || hasMethod || hasStatusCode) {
    return (
      <div className="space-y-1.5">
        {hasMethod && hasUrl && (
          <div className="flex items-center gap-2">
            <span className={`text-xs px-1.5 py-0.5 rounded font-mono font-bold ${
              String(context.method) === 'GET' ? 'bg-emerald-100 text-emerald-700' :
              String(context.method) === 'POST' ? 'bg-blue-100 text-blue-700' :
              String(context.method) === 'DELETE' ? 'bg-red-100 text-red-700' :
              'bg-amber-100 text-amber-700'
            }`}>
              {String(context.method)}
            </span>
            <span className="text-xs font-mono text-gray-700 dark:text-gray-200 truncate">{String(context.url ?? context.path)}</span>
          </div>
        )}
        {hasStatusCode && (
          <div className="flex justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('eventViewer.status')}</span>
            <span className={`text-xs font-mono font-medium ${
              Number(context.statusCode) >= 400 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600'
            }`}>
              {String(context.statusCode)}
            </span>
          </div>
        )}
        {hasHeaders && (
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('eventViewer.headers')}</p>
            <pre className="text-xs bg-gray-50 dark:bg-gray-800 rounded p-1 overflow-auto max-h-20">
              {JSON.stringify(context.headers, null, 2)}
            </pre>
          </div>
        )}
        {renderOtherFields(context, ['url', 'path', 'method', 'statusCode', 'headers', 'request'], t)}
      </div>
    );
  }

  // Redis command detection
  const hasCmd = !!context.command;
  const hasKey = !!context.key;
  const hasKeys = !!context.keys;
  if (hasCmd || hasKey || hasKeys) {
    return (
      <div className="space-y-1.5">
        {hasCmd && (
          <div className="flex justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('eventViewer.command')}</span>
            <span className="text-xs font-mono font-medium text-purple-700">{String(context.command).toUpperCase()}</span>
          </div>
        )}
        {hasKey && (
          <div className="flex justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('eventViewer.key')}</span>
            <span className="text-xs font-mono text-gray-700 dark:text-gray-200">{String(context.key)}</span>
          </div>
        )}
        {hasKeys && (
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('eventViewer.keys')}</p>
            <pre className="text-xs bg-gray-50 dark:bg-gray-800 rounded p-1">{(context.keys as string[]).join(', ')}</pre>
          </div>
        )}
        {renderOtherFields(context, ['command', 'key', 'keys'], t)}
      </div>
    );
  }

  // Error context
  const hasStack = !!context.stack;
  const hasError = !!context.error;
  if (hasStack || hasError) {
    return (
      <div className="space-y-1.5">
        {hasError && (
          <div className="flex justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('eventViewer.error')}</span>
            <span className="text-xs text-red-600 dark:text-red-400">{String(context.error)}</span>
          </div>
        )}
        {hasStack && (
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">{t('eventViewer.stackTrace')}</p>
            <pre className="text-xs bg-red-50 border border-red-100 rounded p-2 overflow-auto max-h-32 text-red-800 font-mono">
              {String(context.stack)}
            </pre>
          </div>
        )}
        {renderOtherFields(context, ['error', 'stack', 'message'], t)}
      </div>
    );
  }

  // Default: render all fields as JSON
  return (
    <pre className="text-xs bg-gray-50 dark:bg-gray-800 rounded p-2 overflow-auto max-h-48">
      {JSON.stringify(context, null, 2)}
    </pre>
  );
}

function renderOtherFields(context: Record<string, unknown>, exclude: string[], t: (key: string) => string): React.ReactNode {
  const remaining = Object.entries(context).filter(([k]) => !exclude.includes(k));
  if (remaining.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('eventViewer.otherFields')}</p>
      {remaining.map(([key, value]) => (
        <div key={key} className="flex justify-between text-xs py-0.5">
          <span className="text-gray-500 dark:text-gray-400">{key}</span>
          <span className="text-gray-700 dark:text-gray-200 font-mono max-w-[150px] truncate">
            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function highlightSql(sql: string): string {
  // First, HTML-escape the input to prevent XSS.
  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const keywords = new Set(['SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
    'DELETE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AND', 'OR', 'NOT',
    'IN', 'LIKE', 'BETWEEN', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
    'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'EXISTS', 'UNION', 'CASE',
    'WHEN', 'THEN', 'ELSE', 'END', 'NULL', 'IS', 'TRUE', 'FALSE']);

  // Single leftmost-match pass: strings and comments are matched before words
  // and numbers, so tokens inside them are never re-highlighted (and no
  // placeholder collisions can corrupt the output).
  const TOKEN = /(?:'[^']*'|--[^\n]*)|(\b\d[\d.eE+-]*\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

  return escapeHtml(sql).replace(TOKEN, (match, num, word) => {
    if (num !== undefined) return '<span class="text-yellow-600">' + match + '</span>';
    if (word !== undefined && keywords.has(word.toUpperCase())) {
      return '<span class="text-purple-700 font-semibold">' + word + '</span>';
    }
    if (match.startsWith("'")) return '<span class="text-green-600">' + match + '</span>';
    if (match.startsWith('--')) return '<span class="text-gray-500 italic">' + match + '</span>';
    // Plain text: leave as-is.
    return match;
  });
}

export function EventDetail({ event, onClose }: EventDetailProps) {
  const { t } = useI18n();
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('eventViewer.eventDetail')}</h3>
        <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">{t('eventViewer.channel')}</span>
          <span className="font-medium text-gray-900 dark:text-gray-100">{event.channel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">{t('eventViewer.type')}</span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${eventTypeColor(event.eventType)}`}>
            {event.eventType}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">{t('eventViewer.timestamp')}</span>
          <span className="font-mono text-xs text-gray-600 dark:text-gray-300">{formatTimestamp(event.timestamp)}</span>
        </div>
        {event.duration !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">{t('eventViewer.duration')}</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{event.duration.toFixed(2)}ms</span>
          </div>
        )}
        {event.error && (
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">{t('eventViewer.error')}</span>
            <span className="text-red-600 dark:text-red-400">{event.error.message}</span>
          </div>
        )}
        {event.operationId && (
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">{t('eventViewer.operationId')}</span>
            <span className="text-xs font-mono text-gray-600 dark:text-gray-300 max-w-[150px] truncate">{event.operationId}</span>
          </div>
        )}
      </div>

      {event.context && Object.keys(event.context).length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('eventViewer.context')}</p>
          <SmartContext context={event.context} channel={event.channel} />
        </div>
      )}
    </div>
  );
}