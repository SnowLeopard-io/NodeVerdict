/**
 * Load a file via HTTP Range requests, supporting streaming for large files
 */

interface RemoteLoadOptions {
  url: string;
  chunkSize?: number; // default: 1MB (1024 * 1024)
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

interface RemoteLoadResult {
  content: string;
  totalSize: number;
  chunkCount: number;
}

/**
 * Check if a URL supports Range requests
 */
export async function checkRangeSupport(url: string): Promise<{ supported: boolean; totalSize: number }> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const acceptRanges = response.headers.get('accept-ranges');
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    return {
      supported: acceptRanges === 'bytes',
      totalSize: contentLength,
    };
  } catch {
    return { supported: false, totalSize: 0 };
  }
}

/**
 * Load a file from URL using Range requests (streaming)
 * Falls back to full fetch if Range is not supported
 */
export async function loadFileFromUrl(options: RemoteLoadOptions): Promise<RemoteLoadResult> {
  const { url, chunkSize = 1024 * 1024, onProgress, signal } = options;

  // First check Range support
  const { supported, totalSize } = await checkRangeSupport(url);

  if (!supported || totalSize === 0) {
    // Fallback: full fetch
    const response = await fetch(url, { signal });
    const content = await response.text();
    onProgress?.(content.length, content.length);
    return { content, totalSize: content.length, chunkCount: 1 };
  }

  // Streaming with Range requests. Chunks are tracked in bytes and decoded once
  // at the end: decoding each slice with response.text() would advance `loaded`
  // by UTF-16 code units while ranges are byte-based, drifting the offsets and
  // corrupting any multi-byte (non-ASCII) content.
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let loaded = 0;
  let chunkIndex = 0;

  while (loaded < totalSize) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const start = loaded;
    const end = Math.min(start + chunkSize - 1, totalSize - 1);

    const response = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` },
      signal,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      // Server returned no bytes for a valid range — avoid an infinite loop.
      throw new Error('Server returned no data for the requested byte range');
    }
    chunks.push(new Uint8Array(buffer));
    loaded += buffer.byteLength;
    chunkIndex++;

    onProgress?.(loaded, totalSize);
  }

  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    content: decoder.decode(combined),
    totalSize,
    chunkCount: chunkIndex,
  };
}

/**
 * Load a file from URL as ArrayBuffer using Range requests
 */
export async function loadFileFromUrlAsBuffer(options: RemoteLoadOptions): Promise<{ buffer: ArrayBuffer; totalSize: number; chunkCount: number }> {
  const { url, chunkSize = 1024 * 1024, onProgress, signal } = options;

  const { supported, totalSize } = await checkRangeSupport(url);

  if (!supported || totalSize === 0) {
    const response = await fetch(url, { signal });
    const buffer = await response.arrayBuffer();
    onProgress?.(buffer.byteLength, buffer.byteLength);
    return { buffer, totalSize: buffer.byteLength, chunkCount: 1 };
  }

  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let chunkIndex = 0;

  while (loaded < totalSize) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const start = loaded;
    const end = Math.min(start + chunkSize - 1, totalSize - 1);

    const response = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` },
      signal,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const buffer = await response.arrayBuffer();
    chunks.push(new Uint8Array(buffer));
    loaded += buffer.byteLength;
    chunkIndex++;

    onProgress?.(loaded, totalSize);
  }

  // Combine all chunks
  const combined = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    buffer: combined.buffer,
    totalSize,
    chunkCount: chunkIndex,
  };
}