import { useCallback, useEffect, useState } from 'react';
import { addDays } from '@farm/core';
import { useOnline, useSignedIn } from '../app';
import type { FarmEvent, StaffEvent } from '../api/types';
import { ApiError } from '../api/types';
import { TopBar } from '../ui/parts';
import { fmtDayShort, fmtTime } from '../ui/format';
import { eventText } from './eventText';

const FILTERS = [['all', 'Все'], ['important', 'Важное'], ['ops', 'Записи'], ['people', 'Люди']] as const;
const STAFF_TEXT: Record<StaffEvent['kind'], string> = {
  created: 'добавлен работник', pin_reset: 'выдан новый PIN', deactivated: 'доступ закрыт', reactivated: 'доступ возвращён', phone_changed: 'изменён телефон',
};

/** Director: everything the workers recorded, newest first (no approvals; this is the notification feed). */
export default function Events() {
  const { api, today } = useSignedIn();
  const online = useOnline();
  const [rows, setRows] = useState<FarmEvent[] | null>(null);
  const [staff, setStaff] = useState<StaffEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<(typeof FILTERS)[number][0]>('all');
  const load = useCallback(async () => {
    try {
      const since = new Date(addDays(today(), -7) + 'T00:00:00Z').toISOString();
      const [ev, st] = await Promise.all([api.events(since), api.staffEvents().catch(() => [])]);
      setRows(ev); setStaff(st.filter((x) => x.at >= since)); setErr(null);
    }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Ошибка'); }
  }, [api, today]);
  useEffect(() => { void load(); }, [load, online]);

  const ops = f === 'people' ? [] : (rows ?? []).filter((e) => f === 'all' || (f === 'important' ? ['health_treatment', 'catch_override', 'placement', 'handover'].includes(e.kind) || (e.kind === 'weighing' && Number(e.data.cv) > 10) : e.kind !== 'log'));
  const people = f === 'all' || f === 'people' ? staff : f === 'important' ? staff.filter((x) => x.kind === 'deactivated' || x.kind === 'pin_reset') : [];
  type Item = { at: string; key: string; title: string; who: string | null; text: string; cls: string; mark: string };
  const list: Item[] = [
    ...ops.map((e) => { const t = eventText(e); return { at: e.at, key: e.kind + e.refId + e.at, title: e.houseName, who: e.who, text: t.text, cls: t.cls, mark: t.mark }; }),
    ...people.map((x) => ({ at: x.at, key: 'staff' + x.at + x.userName + x.kind, title: 'Люди', who: x.actorName, text: `${x.userName}: ${STAFF_TEXT[x.kind]}`, cls: x.kind === 'deactivated' ? 'warn-t' : 'muted', mark: '●' })),
  ].sort((a, b) => b.at.localeCompare(a.at));
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
            const d = e.at.slice(0, 10);
            return (
              <div className="row" key={e.key} style={{ alignItems: 'flex-start' }}>
                <span className="num small muted" style={{ width: 60, flex: 'none', paddingTop: 2 }}>{d === today() ? fmtTime(e.at) : fmtDayShort(d)}</span>
                <span className={e.cls} style={{ width: 12, flex: 'none' }} aria-hidden="true">{e.mark}</span>
                <span style={{ flex: 1, fontSize: 14, lineHeight: 1.4 }}><b>{e.title}</b> · {e.who ?? '—'}<br /><span className="muted">{e.text}</span></span>
              </div>
            );
          })}
          {rows && !list.length && <div className="row muted">Нет событий</div>}
        </div>
      </main>
    </>
  );
}
