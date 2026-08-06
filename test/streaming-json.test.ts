import { describe, it, expect } from 'vitest';
import { IncrementalJsonParser, parseTopLevelValues } from '../src/shared/streaming';

function feedAll(parser: IncrementalJsonParser, chunks: string[]): string[] {
  for (const c of chunks) parser.push(c);
  const out: string[] = [];
  let v: string | null;
  while ((v = parser.next()) !== null) out.push(v);
  return out;
}

/** Split a string into all possible chunkings and verify identical results. */
function everySplit(text: string, parserFactory: () => IncrementalJsonParser): void {
  const reference = parseTopLevelValues(text);
  for (let i = 1; i <= Math.min(text.length, 8); i++) {
    const p = parserFactory();
    const chunks: string[] = [];
    for (let j = 0; j < text.length; j += i) chunks.push(text.slice(j, j + i));
    const out = feedAll(p, chunks);
    expect(out).toEqual(reference);
  }
}

describe('IncrementalJsonParser', () => {
  it('emits each array element as it completes', () => {
    const p = new IncrementalJsonParser();
    p.push('[{ "a": 1 },');
    expect(p.next()).toBe('{ "a": 1 }');
    p.push(' { "b": 2 }, { "c": 3 }]');
    expect(p.next()).toBe('{ "b": 2 }');
    expect(p.next()).toBe('{ "c": 3 }');
    expect(p.next()).toBeNull();
    expect(p.isDone).toBe(true);
  });

  it('handles chunk boundaries mid-string, mid-number, and mid-escape', () => {
    const text = '[{"k":"hello world","n":12345.67},{"s":"line\\n\\"quoted\\"","t":true,"f":false,"z":null}]';
    everySplit(text, () => new IncrementalJsonParser());
  });

  it('preserves multi-byte unicode split across chunks', () => {
    const text = '[{"msg":"你好世界 🚀 漢字"},{"msg":"héllo wörld"}]';
    everySplit(text, () => new IncrementalJsonParser());
  });

  it('supports empty arrays and trailing commas', () => {
    expect(parseTopLevelValues('[]')).toEqual([]);
    expect(parseTopLevelValues('[1,2,]')).toEqual(['1', '2']);
  });

  it('emits nested arrays and bare scalars', () => {
    expect(parseTopLevelValues('[[1,2],[3]]')).toEqual(['[1,2]', '[3]']);
    expect(parseTopLevelValues('[123,true,null,"x"]')).toEqual(['123', 'true', 'null', '"x"']);
  });

  it('emits the whole top-level object once (bare object mode)', () => {
    const p = new IncrementalJsonParser();
    p.push('{ "resourceSpans": [ { "a": 1 } ], "ok": true }');
    const vals = feedAll(p, []);
    expect(vals).toHaveLength(1);
    expect(JSON.parse(vals[0])).toEqual({ resourceSpans: [{ a: 1 }], ok: true });
    expect(p.shape).toBe('object');
  });

  it('detects top-level array shape and reports done', () => {
    const p = new IncrementalJsonParser();
    p.push('  [');
    expect(p.hasStarted).toBe(true);
    expect(p.shape).toBe('array');
    p.push('{}]');
    expect(p.next()).toBe('{}');
    expect(p.isDone).toBe(true);
  });

  it('streams a large array without unbounded buffer growth', () => {
    const p = new IncrementalJsonParser();
    const elem = '{"channel":"mysql2:query","eventType":"start","timestamp":1,"operationId":"a"}';
    p.push(`[${elem}`);
    p.next();
    for (let i = 0; i < 2000; i++) {
      p.push(`,${elem}`);
      p.next();
    }
    expect(p.isDone).toBe(false);
  });

  it('tolerates whitespace and newlines between elements', () => {
    expect(parseTopLevelValues('[\n  {},\n  {}\n]')).toEqual(['{}', '{}']);
  });

  it('only emits a trailing scalar once its terminator arrives', () => {
    const p = new IncrementalJsonParser();
    p.push('[1, 2');
    expect(p.next()).toBe('1');
    expect(p.next()).toBeNull(); // '2' is still pending — could continue in the next chunk
    p.push(',3]');
    expect(p.next()).toBe('2');
    expect(p.next()).toBe('3');
    expect(p.isDone).toBe(true);
  });

  it('does not drop a scalar split mid-token and terminated by "]"', () => {
    const p = new IncrementalJsonParser();
    p.push('[123');
    p.push('4');
    p.push('5]');
    const out = feedAll(p, []);
    expect(out).toEqual(['12345']);
    expect(p.isDone).toBe(true);
  });

  it('does not drop a trailing scalar inside an object when split across chunks', () => {
    const p = new IncrementalJsonParser();
    p.push('[{"n":1234');
    p.push('5.67},');
    const out = feedAll(p, []);
    expect(out).toEqual(['{"n":12345.67}']);
  });

  it('keeps every split of a scalar-heavy array identical', () => {
    const text = '[12345.67,true,null,-1.5e3,0,999999999999]';
    everySplit(text, () => new IncrementalJsonParser());
  });
});
