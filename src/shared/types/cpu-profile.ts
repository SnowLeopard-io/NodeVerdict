/** V8 CPU Profile types */

export interface CpuProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  hitCount: number;
  children: number[];
}

export interface CpuProfile {
  nodes: CpuProfileNode[];
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
}

/** A parsed stack frame with timing */
export interface FlameFrame {
  name: string;
  url: string;
  line: number;
  col: number;
  value: number; // duration in ms
  children: FlameFrame[];
  nodeId: number;
  depth: number;
}

/** Hot function (top-down) */
export interface HotFunction {
  functionName: string;
  url: string;
  selfTime: number;
  totalTime: number;
  selfPercent: number;
  totalPercent: number;
  hitCount: number;
  line: number;
}

/** CPU Profile analysis result */
export interface CpuProfileAnalysis {
  profile: CpuProfile;
  flameTree: FlameFrame;
  hotFunctions: HotFunction[];
  totalTime: number;
  sampleCount: number;
  topFunctions: HotFunction[];
}

/** A single function-level change between two CPU profiles. */
export interface CpuProfileDiffEntry {
  key: string;
  functionName: string;
  url: string;
  line: number;
  beforeSelfTime: number;
  afterSelfTime: number;
  beforeTotalTime: number;
  afterTotalTime: number;
  totalDelta: number;
  /** Relative change of total time vs. the larger of the two samples (0..1). */
  changePct: number;
  kind: 'added' | 'removed' | 'grown' | 'shrunk' | 'unchanged';
}

/** Result of diffing two CPU profiles (e.g. commit A vs commit B). */
export interface CpuProfileDiff {
  entries: CpuProfileDiffEntry[];
  totalBeforeMs: number;
  totalAfterMs: number;
  totalDeltaMs: number;
  grownCount: number;
  shrunkCount: number;
  addedCount: number;
  removedCount: number;
}