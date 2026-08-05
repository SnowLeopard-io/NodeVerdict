import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useRootStore } from '../../stores';
import { EmptyState } from '../../shared/components';
import { generateId } from '../../shared/utils';
import { useI18n } from '../../shared/i18n/useI18n';
import type { AlertRule, AlertMetric, AlertOperator, AlertLevel } from '../../shared/types/alert';

const METRIC_OPTIONS: { value: AlertMetric; labelKey: string }[] = [
  { value: 'heapUsedPercent', labelKey: 'alert.metric.heapUsedPercent' },
  { value: 'externalMemory', labelKey: 'alert.metric.externalMemory' },
  { value: 'heapGrowthRate', labelKey: 'alert.metric.heapGrowthRate' },
  { value: 'rssGrowthRate', labelKey: 'alert.metric.rssGrowthRate' },
  { value: 'errorRate', labelKey: 'alert.metric.errorRate' },
  { value: 'eventRate', labelKey: 'alert.metric.eventRate' },
];

const OPERATOR_OPTIONS: { value: AlertOperator; label: string }[] = [
  { value: 'greaterThan', label: '>' },
  { value: 'greaterThanOrEqual', label: '>=' },
  { value: 'lessThan', label: '<' },
  { value: 'lessThanOrEqual', label: '<=' },
];

const LEVEL_OPTIONS: { value: AlertLevel; labelKey: string; color: string }[] = [
  { value: 'info', labelKey: 'alert.level.info', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  { value: 'warning', labelKey: 'alert.level.warning', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { value: 'critical', labelKey: 'alert.level.critical', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
];

const LEVEL_BORDER: Record<AlertLevel, string> = {
  info: 'border-l-blue-500',
  warning: 'border-l-amber-500',
  critical: 'border-l-red-500',
};

const LEVEL_BG: Record<AlertLevel, string> = {
  info: 'bg-blue-50 dark:bg-blue-900/10',
  warning: 'bg-amber-50 dark:bg-amber-900/10',
  critical: 'bg-red-50 dark:bg-red-900/10',
};

const LEVEL_FIRING_BADGE: Record<AlertLevel, string> = {
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

function getMetricLabel(metric: AlertMetric, t: (key: string) => string): string {
  return t(METRIC_OPTIONS.find(o => o.value === metric)?.labelKey ?? '');
}

function getLevelLabel(level: AlertLevel, t: (key: string) => string): string {
  return t(LEVEL_OPTIONS.find(o => o.value === level)?.labelKey ?? '');
}

function getOperatorLabel(op: AlertOperator): string {
  return OPERATOR_OPTIONS.find(o => o.value === op)?.label ?? op;
}

function formatMetricValue(value: number, metric: AlertMetric): string {
  switch (metric) {
    case 'heapUsedPercent': return `${value.toFixed(1)}%`;
    case 'externalMemory': return `${value.toFixed(1)} MB`;
    case 'heapGrowthRate': return `${value.toFixed(2)} MB/s`;
    case 'rssGrowthRate': return `${value.toFixed(2)} MB/s`;
    case 'errorRate': return `${value.toFixed(1)}%`;
    case 'eventRate': return `${value.toFixed(0)} evt/s`;
  }
}

interface FormData {
  name: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: string;
  level: AlertLevel;
}

const emptyForm: FormData = {
  name: '',
  metric: 'heapUsedPercent',
  operator: 'greaterThan',
  threshold: '',
  level: 'warning',
};

export function AlertRulesPage() {
  const { alertRules, addAlertRule, removeAlertRule, updateAlertRule, toggleAlertRule, firedAlerts, clearFiredAlerts } = useRootStore();
  const { t } = useI18n();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }

  function handleSave() {
    const threshold = Number(form.threshold);
    if (!form.name.trim() || isNaN(threshold)) return;

    const rule: AlertRule = {
      id: editingId ?? generateId('alert-'),
      name: form.name.trim(),
      metric: form.metric,
      operator: form.operator,
      threshold,
      level: form.level,
      enabled: true,
      createdAt: editingId ? (alertRules.find(r => r.id === editingId)?.createdAt ?? Date.now()) : Date.now(),
    };

    if (editingId) {
      updateAlertRule(rule);
    } else {
      addAlertRule(rule);
    }
    resetForm();
  }

  function handleEdit(rule: AlertRule) {
    setForm({
      name: rule.name,
      metric: rule.metric,
      operator: rule.operator,
      threshold: String(rule.threshold),
      level: rule.level,
    });
    setEditingId(rule.id);
    setShowForm(true);
  }

  // Determine which rules are currently firing
  const recentFired = firedAlerts.slice(0, 10);
  const firingMap = new Map<string, { value: number; message: string }>();
  for (const fa of recentFired) {
    if (!firingMap.has(fa.ruleId)) {
      firingMap.set(fa.ruleId, { value: fa.value, message: fa.message });
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('alert.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('alert.description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {firedAlerts.length > 0 && (
            <button
              onClick={clearFiredAlerts}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {t('alert.clearAlerts')}
            </button>
          )}
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="px-4 py-2 rounded-lg font-medium text-sm bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {t('alert.addRule')}
          </button>
        </div>
      </div>

      {/* Fired alerts banner */}
      {firedAlerts.length > 0 && (
        <div className="mb-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">{t('alert.recentlyFired')}</h3>
          <div className="space-y-1">
            {firedAlerts.slice(0, 5).map((fa, idx) => {
              const badgeColor = fa.level === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                : fa.level === 'warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
              return (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded font-medium ${badgeColor}`}>{getLevelLabel(fa.level, t)}</span>
                  <span className="text-gray-700 dark:text-gray-200">{fa.message}</span>
                  <span className="text-gray-400 dark:text-gray-500 ml-auto">
                    {new Date(fa.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rules list */}
      {alertRules.length === 0 ? (
        <EmptyState
          title={t('alert.empty')}
          description={t('alert.empty.desc')}
          action={{ label: t('alert.addRule').replace('+ ', ''), onClick: () => { resetForm(); setShowForm(true); } }}
        />
      ) : (
        <div className="grid gap-3">
          {alertRules.map(rule => {
            const firing = firingMap.get(rule.id);
            const levelColor = LEVEL_BORDER[rule.level];
            return (
              <div
                key={rule.id}
                className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 border-l-4 ${levelColor} p-4 ${!rule.enabled ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{rule.name}</h3>
                      {firing && (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${LEVEL_FIRING_BADGE[rule.level]}`}>
                          {t('alert.firing')}
                        </span>
                      )}
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${LEVEL_OPTIONS.find(o => o.value === rule.level)?.color}`}>
                        {getLevelLabel(rule.level, t)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                      <span>{getMetricLabel(rule.metric, t)}</span>
                      <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
                        {getOperatorLabel(rule.operator)} {formatMetricValue(rule.threshold, rule.metric)}
                      </span>
                      {firing && (
                        <span className="font-mono text-red-600 dark:text-red-400">
                          {t('alert.current')}: {formatMetricValue(firing.value, rule.metric)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => handleEdit(rule)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      title={t('alert.edit')}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => toggleAlertRule(rule.id)}
                      className={`p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${rule.enabled ? 'text-emerald-500' : 'text-gray-400'}`}
                      title={rule.enabled ? t('alert.disable') : t('alert.enable')}
                    >
                      {rule.enabled ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={() => removeAlertRule(rule.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title={t('alert.delete')}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal — portal to body so the page container's animated
          transform (fade-up) can't hijack fixed positioning / z-index */}
      {showForm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto my-auto">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-4">
              {editingId ? t('alert.editRule') : t('alert.newRule')}
            </h2>

            <div className="space-y-3">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('alert.ruleName')}</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={t('alert.placeholder.name')}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400"
                />
              </div>

              {/* Metric */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('alert.metric')}</label>
                <select
                  value={form.metric}
                  onChange={e => setForm(f => ({ ...f, metric: e.target.value as AlertMetric }))}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  {METRIC_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                  ))}
                </select>
              </div>

              {/* Operator */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('alert.condition')}</label>
                <select
                  value={form.operator}
                  onChange={e => setForm(f => ({ ...f, operator: e.target.value as AlertOperator }))}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  {OPERATOR_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Threshold */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('alert.threshold')}</label>
                <input
                  type="number"
                  value={form.threshold}
                  onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))}
                  placeholder={t('alert.placeholder.threshold')}
                  step="any"
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400"
                />
              </div>

              {/* Level */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('alert.level')}</label>
                <select
                  value={form.level}
                  onChange={e => setForm(f => ({ ...f, level: e.target.value as AlertLevel }))}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  {LEVEL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={resetForm}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {t('alert.cancel')}
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
              >
                {editingId ? t('alert.update') : t('alert.save')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}