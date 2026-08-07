# NodeVerdict Tutorial

NodeVerdict is a browser-based **Node.js diagnostic data viewer**. It helps you visualize TracingChannel diagnostic events, analyze CPU profiles, and inspect heap snapshots — all analysis runs locally in your browser, **no data is uploaded to any server**.

---

## 1. Generating TracingChannel Diagnostic Data

### 1.1 What is TracingChannel?

Since Node.js 19.9, the built-in `diagnostics_channel.TracingChannel` API allows libraries to natively emit structured events (`start` / `end` / `asyncStart` / `asyncEnd` / `error`). Major libraries (mysql2, ioredis, node-redis, etc.) already support it.

### 1.2 Quick Start: Capture Events in Your Project

Add a subscription script to your Node.js application to capture all TracingChannel events and export them as JSON:

```js
// capture-events.js
const diagnostics_channel = require('diagnostics_channel');

const capturedEvents = [];
const MAX_EVENTS = 10000;

// Common channel names: mysql2:query, ioredis:command, redis:command, pg:query, express:request
const channels = [
  'mysql2:query',
  'ioredis:command',
  'redis:command',
  'pg:query',
  'express:request',
  'express:response',
  'kafkajs:producer',
  'kafkajs:consumer',
];

for (const channelName of channels) {
  const ch = diagnostics_channel.channel(channelName);
  if (ch) {
    ch.subscribe((event) => {
      if (capturedEvents.length >= MAX_EVENTS) return;
      capturedEvents.push({
        channel: channelName,
        eventType: event.name, // 'start' | 'end' | 'asyncStart' | 'asyncEnd' | 'error'
        context: event,
        timestamp: Date.now(),
      });
    });
  }
}

process.on('SIGINT', () => {
  console.log(JSON.stringify(capturedEvents, null, 2));
  process.exit(0);
});
```

### 1.3 Complete Example: Express + mysql2

```js
const express = require('express');
const mysql = require('mysql2/promise');
const diagnostics_channel = require('diagnostics_channel');

const app = express();
const capturedEvents = [];

const channels = ['mysql2:query', 'express:request'];
for (const name of channels) {
  const ch = diagnostics_channel.channel(name);
  if (ch) {
    ch.subscribe((event) => {
      capturedEvents.push({
        channel: name,
        eventType: event.name,
        context: event,
        timestamp: Date.now(),
        operationId: event.id || `${name}:${Date.now()}`,
      });
    });
  }
}

app.get('/users', async (req, res) => {
  const conn = await mysql.createConnection({ /* ... */ });
  const [rows] = await conn.query('SELECT * FROM users');
  res.json(rows);
});

setTimeout(() => {
  console.log(JSON.stringify(capturedEvents, null, 2));
  process.exit(0);
}, 5000);

app.listen(3000);
```

### 1.4 Event Format

NodeVerdict expects the following event structure:

```typescript
interface TracingEvent {
  channel: string;           // Channel name, e.g. "mysql2:query"
  eventType: 'start' | 'end' | 'asyncStart' | 'asyncEnd' | 'error';
  context: Record<string, any>;  // Library-specific context
  timestamp: number;         // Event timestamp (milliseconds)
  duration?: number;         // Operation duration (milliseconds)
  error?: { message: string; stack?: string; name?: string };
  operationId?: string;      // For correlating start/end events
}
```

---

## 2. Generating CPU Profiles

### 2.1 Using the Built-in --cpu-prof Flag

```bash
# Run your app and generate a CPU profile
node --cpu-prof --cpu-prof-interval=1000 app.js

# Specify output file
node --cpu-prof --cpu-prof-name=my-app.cpuprofile app.js
```

Options:
- `--cpu-prof`: Enable CPU profiling
- `--cpu-prof-interval`: Sampling interval (microseconds), default 1000 (1ms)
- `--cpu-prof-name`: Output filename
- `--cpu-prof-dir`: Output directory

### 2.2 Using Chrome DevTools

1. Start your Node.js app with `--inspect`
2. Open `chrome://inspect` in Chrome
3. Click "Open dedicated DevTools for Node"
4. Go to the "Performance" or "Profiler" tab
5. Click "Start" to begin recording, then "Stop"
6. Click "Save" to export as `.cpuprofile`

---

## 3. Generating Heap Snapshots

### 3.1 Using --heapsnapshot-signal

```bash
# Start the app listening for SIGUSR2
node --heapsnapshot-signal=SIGUSR2 app.js

# In another terminal, send the signal
kill -USR2 <PID>
```

### 3.2 Using the v8 Module (Programmatic)

```js
const v8 = require('v8');

const snapshot = v8.getHeapSnapshot();
const writer = require('fs').createWriteStream('heap.heapsnapshot');
snapshot.pipe(writer);
```

### 3.3 Using Chrome DevTools

1. Start your app with `--inspect`
2. Open `chrome://inspect`
3. Go to the "Memory" tab
4. Click "Take Snapshot"
5. Click "Save" to export

---

## 4. Using NodeVerdict Features

### 4.1 Event Viewer

Upload tracing event JSON files and browse the event timeline.

**Features:**
- Filter by channel
- Click events to inspect full context
- Color-coded event types (start/end/error)
- Operation duration display

**Steps:**
1. Click "Event Viewer" in the sidebar
2. Upload a `tracing-events.json` file
3. Use the channel filter to narrow down
4. Click any event to see its details

### 4.2 Trace Viewer

Visualize async operation chains using a waterfall chart.

**Features:**
- D3.js waterfall chart, similar to Chrome DevTools Performance panel
- Operation dependency graph
- Automatic P95+ bottleneck detection

**Steps:**
1. Upload tracing events with `operationId` fields
2. View the waterfall chart showing nested operations
3. Bottleneck results highlight the slowest operations

### 4.3 CPU Profiler

Upload `.cpuprofile` files and visualize hot functions with an interactive flame graph.

**Features:**
- Interactive flame graph (click to zoom, hover for details)
- Hot functions table sorted by Self Time / Total Time
- Call stack drill-down

**Steps:**
1. Upload a `.cpuprofile` file
2. The flame graph shows the full call stack
3. Click any block to zoom in
4. Click "Reset Zoom" to go back
5. Check the hot functions table for bottlenecks

### 4.4 Heap Analyzer

Parse `.heapsnapshot` files and analyze memory usage.

**Features:**
- Hot objects list sorted by retained size
- Automatic leak detection (cache growth, closures, event listeners)
- GC root path display

**Steps:**
1. Upload a `.heapsnapshot` file
2. View the "Hot Objects" table for the largest objects
3. "Leak Detection" panel flags suspicious objects
4. Click an object to see the GC root path

### 4.5 Heap Diff

Compare two heap snapshots to identify memory growth.

**Features:**
- Upload two snapshots (before/after)
- Object count delta, size delta
- New/grown/removed object types

**Steps:**
1. Upload a baseline snapshot in "Before"
2. Upload a comparison snapshot in "After"
3. Review the delta table for changes
4. Focus on types with the largest "Size Delta"

### 4.6 Time Series

Analyze event trends over time.

**Features:**
- Throughput bar chart (events/bucket)
- Latency distribution histogram
- Per-channel latency breakdown

**Steps:**
1. Upload tracing events with timestamps
2. View the throughput trend chart
3. Check the latency distribution
4. Review per-channel average and P95 latency

### 4.7 Perf Compare

Load two tracing datasets and compare performance.

**Features:**
- Side-by-side statistics
- Per-channel latency delta and percentage change
- Error rate comparison

**Steps:**
1. Upload baseline data in "Baseline"
2. Upload changed data in "Changed"
3. Review the comparison table
4. Green = improvement, Red = regression

### 4.8 Validator

Validate TracingChannel event format correctness.

**Features:**
- Naming convention check (`{package}:{operation}` pattern)
- Required field validation
- Event pairing check (start/end completeness)
- OpenTelemetry semantic convention alignment

**Steps:**
1. Upload events to validate
2. Review warnings and errors in the results
3. Fix format issues based on suggestions

### 4.9 Search & Filter

Full-text search and advanced filtering across all events.

**Features:**
- Full-text search (regex supported)
- Case-sensitive toggle
- Duration range filter
- Status filter (success/error/incomplete)
- Time range filter

**Steps:**
1. Upload events
2. Type keywords in the search box (regex supported)
3. Use filters to narrow results
4. Result count updates in real-time

### 4.10 Live Monitor

Connect to a running Node.js process in real-time via WebSocket — no restart, no dump file needed.

**Features:**
- Real-time memory usage polling (RSS, heapUsed, heapTotal, external)
- Live TracingChannel event streaming
- On-demand heap snapshot (download as `.heapsnapshot`)
- On-demand CPU profile (download as `.cpuprofile`)

**Steps:**
1. Install the agent on the target machine:
   ```bash
   cd server
   npm install
   ```
2. Start the agent alongside your Node.js application:
   ```bash
   node server/live-agent.mjs --port 9876
   ```
   Options:
   - `--port`: Agent WebSocket port (default: 9876)
   - `--channels`: Comma-separated diagnostics_channel names to subscribe to
   - `--connect`: Connect to a remote Node.js inspector URL instead of local

3. Open NodeVerdict in your browser, click "Live Monitor" in the sidebar
4. Enter `localhost:9876` (or the agent's host:port) and click "Connect"
5. Use the panels to monitor, trace, and capture diagnostics in real-time

### 4.11 Report

Generate shareable diagnostic reports.

**Features:**
- URL-encoded reports (zero infrastructure, share via link)
- Offline HTML report export
- Auto-generated key findings summary

**Steps:**
1. Upload events
2. Review the auto-generated summary
3. Click "Copy Shareable Link" for URL-encoded report
4. Click "Export Offline Report" for a standalone HTML file

### 4.12 JIT Insights

Analyze V8 JIT compiler traces to find deoptimization and hidden-class problems.

**Features:**
- Parses combined `--trace-ic`, `--trace-opt`, and `--trace-deopt` output
- IC State Graph — force-directed visualization of hidden-class (map) flow into each inline-cache site, colored by polymorphism (green/amber/red)
- Opt Timeline — per-function optimize/deoptimize sequences with loop detection
- Anti-pattern detection — megamorphic ICs, deopt storms, optimize/deopt loops, hidden-class fragmentation, optimization suppression (with severity + health score)
- Semantic code patches — rewrites object-literal and field-initialization order to unify hidden classes, verified by an AST-equivalence checker
- End-to-end auto-fix — upload the matching source file and each finding is located to its function and rewritten directly; apply the patches and download the fixed file

**Steps:**
1. Run your app under V8 with all three trace flags: `node --trace-ic --trace-opt --trace-deopt app.js 2> trace.log`
2. Open "JIT Insights" and upload the file (sample: `examples/v8-jit-trace.log`)
3. Review the Overview for hot IC sites and findings
4. Open the IC State Graph to see which maps flow into megamorphic sites
5. Use the Opt Timeline to spot optimize/deopt loops in specific functions
6. Open "Patches → Auto-fix from log", upload the same source file (sample: `examples/demo.js`), then apply fixes per finding and download the rewritten file
7. Use "Manual rewrite" to experiment on any pasted snippet

---

## 5. Sample Files Quick Start

20 sample files are available in the `examples/` directory:

| File | Best For | Description |
|------|----------|-------------|
| `tracing-events.json` | Event Viewer, Trace Viewer | mysql2 + ioredis mixed events with deadlock |
| `tracing-multi-lib.json` | Trace Viewer, Report | pg + KafkaJS + Express cross-library trace |
| `tracing-cross-lib.json` | Trace Viewer | Express → Auth → Redis → MySQL → Kafka full chain |
| `tracing-http-errors.json` | Event Viewer, Validator, Report | 7 HTTP error scenarios |
| `tracing-invalid.json` | Validator | Malformed data for validator testing |
| `tracing-search-filter.json` | Search & Filter | 40+ events, 8 channels, mixed status |
| `tracing-perf-before.json` | Perf Compare | Baseline performance data |
| `tracing-perf-after.json` | Perf Compare | Optimized performance data |
| `tracing-time-series.json` | Time Series | 14 operations across 1200ms window |
| `cpu-profile-sample.cpuprofile` | CPU Profiler | 400-sample CPU profile |
| `cpu-profile-diff-after.cpuprofile` | CPU Diff | Regressed profile (hotter `mysql.query`, added `queryBuilder`, removed `serialize`) — pair with the sample above |
| `source-attribution.json` | Source Attribution | Error stacks pointing into `src/...` app code; outer frame attributed as hot site |
| `heap-sample.heapsnapshot` | Heap Analyzer | Minimal heap snapshot (5 nodes) |
| `heap-express-app.heapsnapshot` | Heap Analyzer | Realistic Express app heap |
| `heap-diff-before.heapsnapshot` | Heap Diff | Heap comparison baseline |
| `heap-diff-after.heapsnapshot` | Heap Diff | Heap comparison (with leaks) |
| `heap-string-leak.heapsnapshot` | Heap Analyzer | String concatenation leak with external memory |
| `memory-timeline.json` | Memory Timeline | 16 snapshots, RSS 65MB→250MB growth |
| `gc-trace-gc.log` | GC Log Analyzer | 33 GC events (Scavenge + Mark-sweep) |
| `v8-jit-trace.log` | JIT Insights | V8 trace-ic/opt/deopt output with megamorphic ICs and deopt storms |
| `demo.js` | JIT Insights | Source matching `v8-jit-trace.log` for the end-to-end auto-fix flow |

### Recommended Learning Path

1. **Event Viewer** → `tracing-events.json` — Explore basic events
2. **Trace Viewer** → `tracing-cross-lib.json` — View async chains
3. **CPU Profiler** → `cpu-profile-sample.cpuprofile` — Experience flame graphs
4. **Heap Analyzer** → `heap-express-app.heapsnapshot` — Analyze memory
5. **Heap Diff** → `heap-diff-before.heapsnapshot` + `heap-diff-after.heapsnapshot` — Compare memory
6. **Perf Compare** → `tracing-perf-before.json` + `tracing-perf-after.json` — Verify optimization
7. **Time Series** → `tracing-time-series.json` — View trends
8. **Search & Filter** → `tracing-search-filter.json` — Try advanced search
9. **Report** → `tracing-events.json` — Generate a shareable report
10. **Live Monitor** → Start the agent and connect to a running Node.js process
11. **JIT Insights** → `v8-jit-trace.log` — Detect deopt storms and IC polymorphism

---

## 6. FAQ

### Is my data uploaded to any server?

**No.** All analysis runs entirely in your browser. Data is processed in Web Workers and never leaves your device.

### What file formats are supported?

- **Tracing events**: JSON files (up to 3GB, streamed via Web Worker)
- **CPU Profile**: `.cpuprofile` files (up to 3GB)
- **Heap Snapshot**: `.heapsnapshot` files (up to 3GB, streamed via Web Worker)
- **Memory Timeline**: JSON files with `process.memoryUsage()` snapshots
- **GC Log**: V8 `--trace-gc` log files

### Does every page support dark mode?

Yes. Click the dark/light mode toggle at the bottom of the sidebar. Your preference is saved in `localStorage` and persists across sessions.

### Is page state preserved when switching pages?

Yes. NodeVerdict keeps all pages rendered in the DOM. Switching pages hides the previous page but preserves all state — no need to re-upload files when you switch back.