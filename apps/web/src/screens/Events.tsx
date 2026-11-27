import { useCallback, useEffect, useState } from 'react';
import { addDays } from '@farm/core';
import { useOnline, useSignedIn } from '../app';
import type { FarmEvent } from '../api/types';
import { ApiError } from '../api/types';
import { TopBar } from '../ui/parts';
import { fmtDayShort, fmtTime } from '../ui/format';
import { eventText } from './eventText';

const FILTERS = [['all', 'Все'], ['important', 'Важное'], ['ops', 'Записи']] as const;

/** Director: everything the workers recorded, newest first (no approvals; this is the notification feed). */
export default function Events() {
  const { api, today } = useSignedIn();
  const online = useOnline();
  const [rows, setRows] = useState<FarmEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<(typeof FILTERS)[number][0]>('all');
  const load = useCallback(async () => {
    try { setRows(await api.events(new Date(addDays(today(), -7) + 'T00:00:00Z').toISOString())); setErr(null); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Ошибка'); }
  }, [api, today]);
  useEffect(() => { void load(); }, [load, online]);

  const list = (rows ?? []).filter((e) => f === 'all' || (f === 'important' ? ['health_treatment', 'catch_override', 'placement', 'handover'].includes(e.kind) || (e.kind === 'weighing' && Number(e.data.cv) > 10) : e.kind !== 'log'));
  return (
    <>
      <TopBar title="События" sub="Последние 7 дней · все птичники" />
      <main className="content">
        {err && <div className="banner warn">{err}</div>}
        <div className="chips pad" role="group" aria-label="Фильтр">
          {FILTERS.map(([k, l]) => <button key={k} className={`chip${f === k ? ' on' : ''}`} aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>)}
        </div>
        {rows === null && !err && <p className="pad muted">Загрузка…</p>}
        <div className="section">
          {list.map((e) => {
            const t = eventText(e);
            const d = e.at.slice(0, 10);
            return (
              <div className="row" key={e.kind + e.refId + e.at} style={{ alignItems: 'flex-start' }}>
                <span className="num small muted" style={{ width: 60, flex: 'none', paddingTop: 2 }}>{d === today() ? fmtTime(e.at) : fmtDayShort(d)}</span>
                <span className={t.cls} style={{ width: 12, flex: 'none' }} aria-hidden="true">{t.mark}</span>
                <span style={{ flex: 1, fontSize: 14, lineHeight: 1.4 }}><b>{e.houseName}</b> · {e.who ?? '—'}<br /><span className="muted">{t.text}</span></span>
              </div>
            );
          })}
          {rows && !list.length && <div className="row muted">Нет событий</div>}
        </div>
      </main>
    </>
  );
}
