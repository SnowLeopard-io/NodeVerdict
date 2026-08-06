/**
 * Incremental, resumable JSON tokenizer.
 *
 * Consumes arbitrary text chunks (from a streaming source such as
 * `file.stream().pipeThrough(new TextDecoderStream())`) and emits each
 * complete top-level JSON value as a string the moment its closing
 * delimiter arrives:
 *
 *   - `[ {...}, {...}, ... ]`  → emits each element `{...}` independently
 *   - `{ ... }` (bare object)  → emits the whole object once at the end
 *   - `"str"` / `123` / `true` → emits the single value once complete
 *
 * Memory stays bounded by the size of the *largest single value*, never by
 * the total input size, so multi-GB trace arrays can be processed without
 * holding the file in memory.
 *
 * Chunk boundaries may fall anywhere (mid-string, mid-number, mid-escape);
 * the state machine is fully resumable.
 */

const WS = new Set([' ', '\t', '\n', '\r']);

/** First character of a JSON scalar value (number / true / false / null). */
const SCALAR_START = new Set(['-', ...'0123456789tfn']);

/** Characters that may continue a scalar token. */
const SCALAR_CONT = new Set([...'-+0123456789.eE', ...'truefalsn']);

export type JsonShape = 'array' | 'object' | 'scalar';

export class IncrementalJsonParser {
  private data = '';
  private i = 0;
  private started = false;
  private finished = false;
  private mode: JsonShape | null = null;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private valueType: 'none' | 'object' | 'array' | 'string' | 'scalar' = 'none';
  private valueStart = -1;
  private valueBase = 0;
  private queue: string[] = [];
  private qHead = 0;

  /** The detected top-level shape, once the first significant char is seen. */
  get shape(): JsonShape | null {
    return this.mode;
  }

  /** True once the top-level value/array has been fully consumed. */
  get isDone(): boolean {
    return this.finished && this.qHead >= this.queue.length;
  }

  /** True after the first significant character has been seen. */
  get hasStarted(): boolean {
    return this.started;
  }

  push(chunk: string): void {
    if (chunk === '') return;
    this.data += chunk;
    this.run();
    this.compact();
  }

  /** Returns the next complete top-level value string, or null if none yet. */
  next(): string | null {
    if (this.qHead >= this.queue.length) return null;
    const value = this.queue[this.qHead++];
    // Array index reads are O(1); reset only once fully drained to avoid the
    // O(n) cost of shift() on every item.
    if (this.qHead === this.queue.length && this.qHead > 4096) {
      this.queue = [];
      this.qHead = 0;
    }
    return value;
  }

  private beginValue() {
    if (this.valueType === 'none') {
      this.valueStart = this.i;
      this.valueBase = this.depth;
    }
  }

  private completeValue() {
    if (this.valueType === 'none' || this.valueStart < 0) return;
    // `valueEnd` includes the closing char: for containers the closing
    // brace/bracket is at `this.i`; for scalars/strings we slice differently.
    let end = this.i + 1;
    if (this.valueType === 'scalar') end = this.i;
    this.queue.push(this.data.slice(this.valueStart, end));
    this.valueType = 'none';
    this.valueStart = -1;
    if (this.mode === 'scalar') this.finished = true;
  }

  private run() {
    while (this.i < this.data.length) {
      const ch = this.data[this.i];

      if (!this.started) {
        if (WS.has(ch)) {
          this.i++;
          continue;
        }
        this.started = true;
        if (ch === '[') {
          this.mode = 'array';
          this.depth = 1;
          this.i++;
          continue;
        }
        if (ch === '{') {
          this.mode = 'object';
          this.beginValue();
          this.valueType = 'object';
          this.depth = 1;
          this.i++;
          continue;
        }
        this.mode = 'scalar';
        continue;
      }

      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (ch === '\\') {
          this.escaped = true;
        } else if (ch === '"') {
          this.inString = false;
          if (this.valueType === 'string' && this.depth === this.valueBase) {
            this.completeValue();
          }
        }
        this.i++;
        continue;
      }

      switch (ch) {
        case '"': {
          this.inString = true;
          if (this.valueType === 'none') {
            this.beginValue();
            this.valueType = 'string';
          }
          this.i++;
          continue;
        }

        case '{':
        case '[': {
          if (this.valueType === 'none') {
            this.beginValue();
            this.valueType = ch === '{' ? 'object' : 'array';
          }
          this.depth++;
          this.i++;
          continue;
        }

        case '}':
        case ']': {
          // A scalar token may be terminated directly by the closing bracket
          // (e.g. the last element of an array/object). Complete it before
          // decrementing depth, since a scalar began at container depth.
          if (this.valueType === 'scalar') {
            this.queue.push(this.data.slice(this.valueStart, this.i));
            this.valueType = 'none';
            this.valueStart = -1;
            if (this.mode === 'scalar') this.finished = true;
          }
          this.depth--;
          if (this.depth === this.valueBase && this.valueType !== 'none') {
            this.completeValue();
          }
          if (this.mode !== 'scalar' && this.depth === 0) {
            this.finished = true;
            this.i++;
            return;
          }
          this.i++;
          continue;
        }

        case ',': {
          if (
            this.mode === 'array'
            && this.depth === this.valueBase
            && this.valueType !== 'none'
          ) {
            this.completeValue();
          }
          this.i++;
          continue;
        }

        default: {
          if (WS.has(ch)) {
            this.i++;
            continue;
          }
          // A scalar token may extend across a chunk boundary. When the
          // previous chunk ended mid-scalar, `valueType` is already 'scalar':
          // resume scanning for its terminator instead of skipping these bytes.
          if (this.valueType === 'scalar') {
            let end = this.i + 1;
            while (end < this.data.length && SCALAR_CONT.has(this.data[end])) {
              end++;
            }
            if (end === this.data.length) {
              // Token still unterminated; wait for the next chunk.
              this.i = end;
              return;
            }
            this.queue.push(this.data.slice(this.valueStart, end));
            this.valueType = 'none';
            this.valueStart = -1;
            if (this.mode === 'scalar') this.finished = true;
            this.i = end;
            continue;
          }
          if (this.valueType === 'none' && SCALAR_START.has(ch)) {
            this.beginValue();
            this.valueType = 'scalar';
            // Scan the whole scalar token now; stop at the first char that
            // cannot be part of it (terminator / whitespace / EOF).
            let end = this.i + 1;
            while (end < this.data.length && SCALAR_CONT.has(this.data[end])) {
              end++;
            }
            if (end === this.data.length) {
              // Token might continue in the next chunk; wait for more data.
              this.i = end;
              return;
            }
            this.queue.push(this.data.slice(this.valueStart, end));
            this.valueType = 'none';
            this.valueStart = -1;
            if (this.mode === 'scalar') this.finished = true;
            this.i = end;
            continue;
          }
          // Leniently skip unexpected characters (malformed JSON).
          this.i++;
          continue;
        }
      }
    }
  }

  /** Drop already-consumed prefix so the internal buffer stays small. */
  private compact() {
    if (this.data.length < 1 << 20) return;
    const keepFrom = this.valueStart >= 0 ? this.valueStart : this.i;
    if (keepFrom > 0) {
      this.data = this.data.slice(keepFrom);
      this.i -= keepFrom;
      if (this.valueStart >= 0) this.valueStart -= keepFrom;
    }
  }
}

/** Convenience: parse a complete string in one go, returning all values. */
export function parseTopLevelValues(text: string): string[] {
  const parser = new IncrementalJsonParser();
  parser.push(text);
  const out: string[] = [];
  let v: string | null;
  while ((v = parser.next()) !== null) out.push(v);
  return out;
}
