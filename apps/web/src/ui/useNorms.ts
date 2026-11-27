import { mergeNorms, type NormCode, type Norms } from '@farm/core';
import { useLive, useSignedIn } from '../app';

/** Arbor Acres defaults with the farm's overrides, from the phone's cache (works offline). */
export function useNorms(): Norms {
  const { db } = useSignedIn();
  const rows = useLive(() => db.norms.where('key').startsWith('farm:').toArray(), [db], []);
  return mergeNorms(Object.fromEntries(rows.map((r) => [r.code as NormCode, r.data])));
}
