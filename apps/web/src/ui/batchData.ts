/** One batch's records from the server (director screens; works for closed batches too). */
import { useCallback, useEffect, useState } from 'react';
import { batchResult } from '@farm/core';
import { useOnline, useSignedIn } from '../app';
import type { BatchRow, LogRecord, OpsBundle } from '../api/types';
import { errText } from './people';

export function useBatchRecords(batch: BatchRow | null | undefined) {
  const { api } = useSignedIn();
  const online = useOnline();
  const [data, setData] = useState<{ logs: LogRecord[]; ops: OpsBundle } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hb = batch?.houseBatchId;
  const load = useCallback(async () => {
    if (!hb) return;
    try {
      const [logs, ops] = await Promise.all([api.recentLogs([hb], '2000-01-01'), api.ops([hb])]);
      setData({ logs, ops }); setError(null);
    } catch (e) { setError(errText(e)); }
  }, [api, hb]);
  useEffect(() => { setData(null); void load(); }, [load, online]);
  const result = batch && data ? batchResult({ placedOn: batch.placedOn, placed: batch.placed, logs: data.logs, handovers: data.ops.handovers }) : null;
  return { data, result, error, reload: load };
}
