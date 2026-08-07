# NodeVerdict 教程

NodeVerdict 是一个基于浏览器的 **Node.js 诊断数据查看器**。它帮助你可视化 TracingChannel 诊断事件、分析 CPU profile、检查堆快照——所有分析都在你的浏览器本地运行，**数据不会上传到任何服务器**。

---

## 1. 生成 TracingChannel 诊断数据

### 1.1 什么是 TracingChannel？

自 Node.js 19.9 起，内置的 `diagnostics_channel.TracingChannel` API 允许库原生地发出结构化事件（`start` / `end` / `asyncStart` / `asyncEnd` / `error`）。主流库（mysql2、ioredis、node-redis 等）已经支持它。

### 1.2 快速开始：在你的项目中捕获事件

向你的 Node.js 应用添加一个订阅脚本，以捕获所有 TracingChannel 事件并将其导出为 JSON：

```js
// capture-events.js
const diagnostics_channel = require('diagnostics_channel');

const capturedEvents = [];
const MAX_EVENTS = 10000;

// 常见频道名称：mysql2:query、ioredis:command、redis:command、pg:query、express:request
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

### 1.3 完整示例：Express + mysql2

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

### 1.4 事件格式

NodeVerdict 期望以下事件结构：

```typescript
interface TracingEvent {
  channel: string;           // 频道名称，例如 "mysql2:query"
  eventType: 'start' | 'end' | 'asyncStart' | 'asyncEnd' | 'error';
  context: Record<string, any>;  // 库特定的上下文
  timestamp: number;         // 事件时间戳（毫秒）
  duration?: number;         // 操作持续时间（毫秒）
  error?: { message: string; stack?: string; name?: string };
  operationId?: string;      // 用于关联 start/end 事件
}
```

---

## 2. 生成 CPU Profile

### 2.1 使用内置的 --cpu-prof 标志

```bash
# 运行你的应用并生成 CPU profile
node --cpu-prof --cpu-prof-interval=1000 app.js

# 指定输出文件
node --cpu-prof --cpu-prof-name=my-app.cpuprofile app.js
```

选项：
- `--cpu-prof`：启用 CPU 分析
- `--cpu-prof-interval`：采样间隔（微秒），默认 1000（1ms）
- `--cpu-prof-name`：输出文件名
- `--cpu-prof-dir`：输出目录

### 2.2 使用 Chrome DevTools

1. 使用 `--inspect` 启动你的 Node.js 应用
2. 在 Chrome 中打开 `chrome://inspect`
3. 点击 "Open dedicated DevTools for Node"
4. 进入 "Performance" 或 "Profiler" 标签页
5. 点击 "Start" 开始录制，然后点击 "Stop"
6. 点击 "Save" 导出为 `.cpuprofile`

---

## 3. 生成堆快照

### 3.1 使用 --heapsnapshot-signal

```bash
# 启动应用并监听 SIGUSR2
node --heapsnapshot-signal=SIGUSR2 app.js

# 在另一个终端发送信号
kill -USR2 <PID>
```

### 3.2 使用 v8 模块（编程方式）

```js
const v8 = require('v8');

const snapshot = v8.getHeapSnapshot();
const writer = require('fs').createWriteStream('heap.heapsnapshot');
snapshot.pipe(writer);
```

### 3.3 使用 Chrome DevTools

1. 使用 `--inspect` 启动你的应用
2. 打开 `chrome://inspect`
3. 进入 "Memory" 标签页
4. 点击 "Take Snapshot"
5. 点击 "Save" 导出

---

## 4. 使用 NodeVerdict 功能

### 4.1 事件查看器

上传追踪事件 JSON 文件并浏览事件时间线。

**功能：**
- 按频道筛选
- 点击事件查看完整上下文
- 事件类型颜色标识（start/end/error）
- 操作持续时间显示

**步骤：**
1. 在侧边栏点击 "事件查看器"
2. 上传 `tracing-events.json` 文件
3. 使用频道筛选器缩小范围
4. 点击任意事件查看详情

### 4.2 追踪查看器

使用瀑布图可视化异步操作链。

**功能：**
- D3.js 瀑布图，类似 Chrome DevTools Performance 面板
- 操作依赖关系图
- 自动 P95+ 瓶颈检测

**步骤：**
1. 上传包含 `operationId` 字段的追踪事件
2. 查看显示嵌套操作的瀑布图
3. 瓶颈结果高亮显示最慢的操作

### 4.3 CPU 分析器

上传 `.cpuprofile` 文件，使用交互式火焰图可视化热点函数。

**功能：**
- 交互式火焰图（点击缩放，悬停查看详情）
- 按自身时间 / 总时间排序的热点函数表
- 调用栈下钻

**步骤：**
1. 上传 `.cpuprofile` 文件
2. 火焰图显示完整调用栈
3. 点击任意色块放大
4. 点击 "重置缩放" 返回
5. 查看热点函数表定位瓶颈

### 4.4 堆分析器

解析 `.heapsnapshot` 文件并分析内存使用。

**功能：**
- 按保留大小排序的热点对象列表
- 自动泄漏检测（缓存增长、闭包、事件监听器）
- GC 根路径显示

**步骤：**
1. 上传 `.heapsnapshot` 文件
2. 查看 "热点对象" 表格中的最大对象
3. "泄漏检测" 面板标记可疑对象
4. 点击对象查看 GC 根路径

### 4.5 堆差异对比

比较两个堆快照以识别内存增长。

**功能：**
- 上传两个快照（之前/之后）
- 对象数量增量、大小增量
- 新增/增长/移除的对象类型

**步骤：**
1. 在 "之前" 上传基线快照
2. 在 "之后" 上传对比快照
3. 查看增量表了解变化
4. 重点关注 "大小增量" 最大的类型

### 4.6 时序分析

分析事件随时间的趋势。

**功能：**
- 吞吐量柱状图（事件/时间桶）
- 延迟分布直方图
- 各频道延迟细分

**步骤：**
1. 上传带时间戳的追踪事件
2. 查看吞吐量趋势图
3. 检查延迟分布
4. 查看各频道的平均延迟和 P95 延迟

### 4.7 性能对比

加载两组追踪数据并比较性能。

**功能：**
- 并排统计
- 各频道延迟增量和百分比变化
- 错误率对比

**步骤：**
1. 在 "基线" 上传基线数据
2. 在 "变更后" 上传变更数据
3. 查看对比表格
4. 绿色 = 改善，红色 = 回退

### 4.8 数据验证器

验证 TracingChannel 事件格式的正确性。

**功能：**
- 命名规范检查（`{package}:{operation}` 模式）
- 必填字段校验
- 事件配对检查（start/end 完整性）
- OpenTelemetry 语义约定对齐

**步骤：**
1. 上传要验证的事件
2. 在结果中查看警告和错误
3. 根据建议修复格式问题

### 4.9 搜索与筛选

跨所有事件进行全文搜索和高级筛选。

**功能：**
- 全文搜索（支持正则）
- 区分大小写开关
- 时长范围筛选
- 状态筛选（成功/错误/不完整）
- 时间范围筛选

**步骤：**
1. 上传事件
2. 在搜索框中输入关键词（支持正则）
3. 使用筛选器缩小结果
4. 结果数量实时更新

### 4.10 实时监控

通过 WebSocket 实时连接到正在运行的 Node.js 进程——无需重启，无需转储文件。

**功能：**
- 实时内存轮询（RSS、heapUsed、heapTotal、external）
- 实时 TracingChannel 事件流
- 按需获取堆快照（下载为 `.heapsnapshot`）
- 按需获取 CPU profile（下载为 `.cpuprofile`）

**步骤：**
1. 在目标机器上安装代理：
   ```bash
   cd server
   npm install
   ```
2. 在 Node.js 应用旁边启动代理：
   ```bash
   node server/live-agent.mjs --port 9876
   ```
   选项：
   - `--port`：代理 WebSocket 端口（默认：9876）
   - `--channels`：要订阅的 diagnostics_channel 名称（逗号分隔）
   - `--connect`：连接到远程 Node.js inspector URL 而非本地

3. 在浏览器中打开 NodeVerdict，点击侧边栏的 "实时监控"
4. 输入 `localhost:9876`（或代理的 host:port）并点击 "连接"
5. 使用面板实时监控、追踪和捕获诊断数据

### 4.11 报告

生成可分享的诊断报告。

**功能：**
- URL 编码报告（零基础设施，通过链接分享）
- 离线 HTML 报告导出
- 自动生成关键发现摘要

**步骤：**
1. 上传事件
2. 查看自动生成的摘要
3. 点击 "复制分享链接" 获取 URL 编码报告
4. 点击 "导出 HTML" 获取独立 HTML 文件

---

## 5. 示例文件快速开始

`examples/` 目录中提供示例文件：

| 文件 | 最适合用于 | 描述 |
|------|----------|-------------|
| `tracing-events.json` | 事件查看器、追踪查看器 | mysql2 + ioredis 混合事件，含死锁 |
| `tracing-multi-lib.json` | 追踪查看器、报告 | pg + KafkaJS + Express 跨库追踪 |
| `tracing-cross-lib.json` | 追踪查看器 | Express → Auth → Redis → MySQL → Kafka 完整链路 |
| `tracing-http-errors.json` | 事件查看器、验证器、报告 | 7 种 HTTP 错误场景 |
| `tracing-invalid.json` | 验证器 | 用于验证器测试的格式错误数据 |
| `tracing-search-filter.json` | 搜索与筛选 | 40+ 事件、8 个频道、混合状态 |
| `tracing-perf-before.json` | 性能对比 | 基线性能数据 |
| `tracing-perf-after.json` | 性能对比 | 优化后的性能数据 |
| `tracing-time-series.json` | 时序分析 | 1200ms 窗口内的 14 个操作 |
| `cpu-profile-sample.cpuprofile` | CPU 分析器 | 400 样本 CPU profile |
| `cpu-profile-diff-after.cpuprofile` | CPU 差分 | 回退版 profile（`mysql.query` 更热、新增 `queryBuilder`、删除了 `serialize`）— 与上面的基线配对使用 |
| `source-attribution.json` | 源码归因 | 带有指向 `src/...` 应用代码的错误堆栈；最外层帧被归因到热点位置 |
| `heap-sample.heapsnapshot` | 堆分析器 | 最小堆快照（5 个节点） |
| `heap-express-app.heapsnapshot` | 堆分析器 | 真实的 Express 应用堆 |
| `heap-diff-before.heapsnapshot` | 堆差异对比 | 堆比较基线 |
| `heap-diff-after.heapsnapshot` | 堆差异对比 | 堆比较（含泄漏） |
| `heap-string-leak.heapsnapshot` | 堆分析器 | 字符串拼接泄漏，含外部内存 |
| `memory-timeline.json` | 内存时间线 | 16 个快照，RSS 65MB→250MB 增长 |
| `gc-trace-gc.log` | GC 日志分析 | 33 个 GC 事件（Scavenge + Mark-sweep） |

### 推荐学习路径

1. **事件查看器** → `tracing-events.json` — 探索基本事件
2. **追踪查看器** → `tracing-cross-lib.json` — 查看异步链
3. **CPU 分析器** → `cpu-profile-sample.cpuprofile` — 体验火焰图
4. **堆分析器** → `heap-express-app.heapsnapshot` — 分析内存
5. **堆差异对比** → `heap-diff-before.heapsnapshot` + `heap-diff-after.heapsnapshot` — 对比内存
6. **性能对比** → `tracing-perf-before.json` + `tracing-perf-after.json` — 验证优化
7. **时序分析** → `tracing-time-series.json` — 查看趋势
8. **搜索与筛选** → `tracing-search-filter.json` — 尝试高级搜索
9. **报告** → `tracing-events.json` — 生成可分享的报告
10. **实时监控** → 启动代理并连接到正在运行的 Node.js 进程

---

## 6. 常见问题

### 我的数据会上传到任何服务器吗？

**不会。** 所有分析完全在你的浏览器中运行。数据在 Web Worker 中处理，永远不会离开你的设备。

### 支持哪些文件格式？

- **追踪事件**：JSON 文件（最大 3GB，通过 Web Worker 流式处理）
- **CPU Profile**：`.cpuprofile` 文件（最大 3GB）
- **堆快照**：`.heapsnapshot` 文件（最大 3GB，通过 Web Worker 流式处理）
- **内存时间线**：包含 `process.memoryUsage()` 快照的 JSON 文件
- **GC 日志**：V8 `--trace-gc` 日志文件

### 每个页面都支持暗色模式吗？

支持。点击侧边栏底部的暗色/明亮模式切换按钮。你的偏好会保存在 `localStorage` 中，并在会话之间持久保留。

### 切换页面时页面状态会保留吗？

会。NodeVerdict 会保持所有页面渲染在 DOM 中。切换页面会隐藏上一个页面但保留所有状态——切换回来时无需重新上传文件。
