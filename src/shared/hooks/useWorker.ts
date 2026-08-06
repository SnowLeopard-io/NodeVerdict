import { useCallback, useEffect, useRef, useState } from 'react';
import { createWorkerClient } from '../workers/worker-factory';
import type { WorkerHandler } from '../workers/worker-factory';

interface UseWorkerOptions {
  /** Whether to keep the worker alive between calls (default: true) */
  persistent?: boolean;
  /** Milliseconds before an in-flight call rejects with a timeout error (default: 60000) */
  timeoutMs?: number;
}

interface UseWorkerState<TInput, TOutput> {
  loading: boolean;
  error: string | null;
  result: TOutput | null;
}

/**
 * Creates a Web Worker from a constructor URL and exposes a callable
 * `execute` function that runs work off the main thread.
 */
export function useWorker<TInput, TOutput>(
  workerUrl: string,
  options: UseWorkerOptions = {},
) {
  const { persistent = true, timeoutMs = 60_000 } = options;
  const clientRef = useRef<ReturnType<typeof createWorkerClient<TInput, TOutput>> | null>(null);
  const [state, setState] = useState<UseWorkerState<TInput, TOutput>>({
    loading: false,
    error: null,
    result: null,
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      const worker = new Worker(new URL(workerUrl, import.meta.url), { type: 'module' });
      clientRef.current = createWorkerClient<TInput, TOutput>(worker, timeoutMs);
    }
    return clientRef.current;
  }, [workerUrl, timeoutMs]);

  const execute = useCallback(async (input: TInput): Promise<TOutput> => {
    setState({ loading: true, error: null, result: null });
    try {
      const client = getClient();
      const result = await client.execute(input);
      setState({ loading: false, error: null, result });
      return result;
    } catch (err) {
      const msg = (err as Error).message;
      setState({ loading: false, error: msg, result: null });
      throw err;
    }
  }, [getClient]);

  const terminate = useCallback(() => {
    clientRef.current?.terminate();
    clientRef.current = null;
    setState({ loading: false, error: null, result: null });
  }, []);

  return { ...state, execute, terminate };
}

export type { UseWorkerState };