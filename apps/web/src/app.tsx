import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { liveQuery } from 'dexie';
import { productionDay } from '@farm/core';
import type { Api, Session } from './api/types';
import { DemoApi } from './api/demo';
import { SupabaseApi } from './api/supabase';
import { dbForUser, type LocalDb } from './db/local';
import { SyncEngine, type SyncStatus } from './sync/engine';

export function createApi(): Api {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && key ? new SupabaseApi(url, key) : new DemoApi();
}

interface Ctx {
  api: Api;
  session: Session | null;
  db: LocalDb | null;
  sync: SyncEngine | null;
  today: () => string;
  setSession: (s: Session | null) => void;
}
const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ api, children }: { api: Api; children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { api.restore().then((s) => { setSession(s); setReady(true); }); }, [api]);

  const value = useMemo<Ctx>(() => {
    const today = () => (session ? productionDay(new Date(), session.farm.tz, session.farm.dayStartHour) : '');
    const db = session ? dbForUser(session.userId) : null;
    const sync = session && db ? new SyncEngine(db, api, today) : null;
    return { api, session, db, sync, today, setSession };
  }, [api, session]);

  useEffect(() => {
    if (!value.sync) return;
    value.sync.start();
    // Ask the browser not to evict offline data (result shown on the Отправка screen).
    void navigator.storage?.persist?.();
    return () => value.sync?.stop();
  }, [value.sync]);

  if (!ready) return <div className="content pad muted">Загрузка…</div>;
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppProvider missing');
  return c;
}

/** Signed-in context; screens below the auth gate use this. */
export function useSignedIn() {
  const c = useApp();
  if (!c.session || !c.db || !c.sync) throw new Error('not signed in');
  return c as Ctx & { session: Session; db: LocalDb; sync: SyncEngine };
}

/** Re-renders when the IndexedDB data behind `fn` changes. */
export function useLive<T>(fn: () => Promise<T>, deps: unknown[], initial: T): T {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: setV, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

export function useSyncStatus(): SyncStatus | null {
  const { sync } = useApp();
  const [s, setS] = useState<SyncStatus | null>(sync?.getStatus() ?? null);
  useEffect(() => (sync ? sync.subscribe(setS) : undefined), [sync]);
  return s;
}

export function useOnline(): boolean {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener('online', a); window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}
