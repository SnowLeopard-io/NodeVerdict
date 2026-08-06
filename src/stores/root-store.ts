import { create } from 'zustand';
import type { TraceViewerData, TracingAnalysis, HeapAnalysis, ReportData, SnapshotDiffRecord, AlertRule, FiredAlert, TracingEvent } from '../shared/types';
import type { ValidationResult } from '../shared/engine';
import { defaultAlertRules } from '../shared/engine';

/**
 * Root store using Zustand with slice pattern.
 * Each feature registers its slice here for centralized access.
 */
interface RootState {
  // Event Viewer slice
  tracingAnalysis: TracingAnalysis | null;
  setTracingAnalysis: (analysis: TracingAnalysis | null) => void;
  selectedChannels: string[];
  setSelectedChannels: (channels: string[]) => void;
  selectedEventIndex: number | null;
  setSelectedEventIndex: (idx: number | null) => void;

  // Trace Viewer slice
  traceData: TraceViewerData | null;
  setTraceData: (data: TraceViewerData | null) => void;
  traceEvents: TracingEvent[];
  setTraceEvents: (events: TracingEvent[]) => void;

  // Validator slice
  validationResults: ValidationResult[] | null;
  setValidationResults: (results: ValidationResult[] | null) => void;

  // Heap Analyzer slice
  heapAnalysis: HeapAnalysis | null;
  setHeapAnalysis: (analysis: HeapAnalysis | null) => void;

  // Report slice
  reportData: ReportData | null;
  setReportData: (data: ReportData | null) => void;

  // Snapshot History slice
  snapshotHistory: SnapshotDiffRecord[];
  setSnapshotHistory: (history: SnapshotDiffRecord[]) => void;
  addSnapshotRecord: (record: Omit<SnapshotDiffRecord, 'id' | 'timestamp'>) => void;
  clearSnapshotHistory: () => void;

  // Alert Rules slice
  alertRules: AlertRule[];
  addAlertRule: (rule: AlertRule) => void;
  removeAlertRule: (id: string) => void;
  updateAlertRule: (rule: AlertRule) => void;
  toggleAlertRule: (id: string) => void;
  firedAlerts: FiredAlert[];
  addFiredAlert: (alert: FiredAlert) => void;
  clearFiredAlerts: () => void;
}

export const useRootStore = create<RootState>((set) => ({
  // Event Viewer
  tracingAnalysis: null,
  setTracingAnalysis: (analysis) => set({ tracingAnalysis: analysis }),
  selectedChannels: [],
  setSelectedChannels: (channels) => set({ selectedChannels: channels }),
  selectedEventIndex: null,
  setSelectedEventIndex: (idx) => set({ selectedEventIndex: idx }),

  // Trace Viewer
  traceData: null,
  setTraceData: (data) => set({ traceData: data }),
  traceEvents: [],
  setTraceEvents: (events) => set({ traceEvents: events }),

  // Validator
  validationResults: null,
  setValidationResults: (results) => set({ validationResults: results }),

  // Heap Analyzer
  heapAnalysis: null,
  setHeapAnalysis: (analysis) => set({ heapAnalysis: analysis }),

  // Report
  reportData: null,
  setReportData: (data) => set({ reportData: data }),

  // Snapshot History
  snapshotHistory: [],
  setSnapshotHistory: (history) => set({ snapshotHistory: history }),
  addSnapshotRecord: (record) =>
    set((state) => {
      const newRecord: SnapshotDiffRecord = {
        ...record,
        id: `snap-diff-${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
      };
      return { snapshotHistory: [...state.snapshotHistory, newRecord] };
    }),
  clearSnapshotHistory: () => set({ snapshotHistory: [] }),

  // Alert Rules
  alertRules: defaultAlertRules(),
  addAlertRule: (rule) => set((state) => ({ alertRules: [...state.alertRules, rule] })),
  removeAlertRule: (id) => set((state) => ({ alertRules: state.alertRules.filter(r => r.id !== id) })),
  updateAlertRule: (rule) => set((state) => ({ alertRules: state.alertRules.map(r => r.id === rule.id ? rule : r) })),
  toggleAlertRule: (id) => set((state) => ({ alertRules: state.alertRules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r) })),
  firedAlerts: [],
  addFiredAlert: (alert) => set((state) => {
    // Dedupe: skip when the same rule just fired within 5s (alerts are evaluated
    // on every memory tick, which must not flood the list with identical rows).
    const recent = state.firedAlerts.some(
      a => a.ruleId === alert.ruleId
        && a.message === alert.message
        && alert.timestamp !== undefined
        && (alert.timestamp - a.timestamp) < 5000,
    );
    if (recent) return {};
    return { firedAlerts: [alert, ...state.firedAlerts].slice(0, 50) };
  }),
  clearFiredAlerts: () => set({ firedAlerts: [] }),
}));