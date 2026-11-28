import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { SETUP_DONE_KEY } from './Setup';
import { BlockCards, useBlocks } from '../ui/blocks';
import { useOnline, useSignedIn } from '../app';
import type { HouseToday } from '../api/types';
import { ApiError } from '../api/types';
import { TopBar } from '../ui/parts';
import type { FarmEvent } from '../api/types';
import { eventText } from './eventText';
import { fmtDayLong, fmtInt, fmtNum, fmtTime } from '../ui/format';

const CACHE = 'farm-today-cache';

/** Head: all houses today (T-13). Online-first with the last result cached for offline viewing. */
export default function Farm() {
  const { api, today, session } = useSignedIn();
  const online = useOnline();
  const [rows, setRows] = useState<HouseToday[] | null>(() => { try { return JSON.parse(localStorage.getItem(CACHE) ?? 'null')?.rows ?? null; } catch { return null; } });
  const [at, setAt] = useState<string | null>(() => { try { return JSON.parse(localStorage.getItem(CACHE) ?? 'null')?.at ?? null; } catch { return null; } });
  const [err, setErr] = useState<string | null>(null);
  const [events, setEvents] = useState<FarmEvent[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await api.houseToday();
      const now = new Date().toISOString();
      setRows(r); setAt(now); setErr(null);
      setEvents(await api.events(new Date(Date.now() - 24 * 3_600_000).toISOString()));
      try { localStorage.setItem(CACHE, JSON.stringify({ rows: r, at: now })); } catch { /* ignore */ }
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Ошибка загрузки'); }
  }, [api]);
  useEffect(() => { void load(); const t = setInterval(() => { if (navigator.onLine) void load(); }, 60_000); return () => clearInterval(t); }, [load, online]);

  // Empty farm (no houses yet): first time → setup wizard; later → a button to it.
  const [houseCount, setHouseCount] = useState<number | null>(null);
  useEffect(() => { if (online && rows?.length === 0) api.listHouses().then((h) => setHouseCount(h.filter((x) => x.active !== false).length)).catch(() => {}); }, [api, online, rows]);
  const loc = useLocation();
  const { blocks } = useBlocks();
  const setupDone = (() => { try { return localStorage.getItem(SETUP_DONE_KEY) === '1'; } catch { return true; } })();
  if (houseCount === 0 && !setupDone) return <Navigate to="/setup" replace />;

  const day = today();
  const totals = rows?.reduce((a, r) => ({ placed: a.placed + r.placed, live: a.live + r.liveBirds }), { placed: 0, live: 0 });

  return (
    <>
      <TopBar title="Ферма" sub={`${session.farm.name} · ${fmtDayLong(day)}`} />
      <main className="content">
        {(err || !online) && <div className="banner warn" role="status">{!online ? 'Нет сети.' : err} {at ? `Показаны данные за ${fmtTime(at)}.` : ''}</div>}
        {rows === null && !err && <p className="pad muted">Загрузка…</p>}
        {(loc.state as { closed?: string } | null)?.closed && <div className="banner ok" role="status">Партия {(loc.state as { closed: string }).closed} закрыта. Блок пустой — можно начинать новую партию.</div>}
        {(loc.state as { setupDone?: boolean } | null)?.setupDone && <div className="banner ok" role="status">Ферма настроена. Передайте работникам телефон и PIN.</div>}
        {rows?.length === 0 && houseCount === 0 && (
          <div className="banner info" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span>На ферме ещё нет блоков.</span>
            <Link className="btn primary" to="/setup">Настроить ферму</Link>
          </div>
        )}
        {rows && rows.length > 0 && (
          <div className="grid3 pad">
            <div className="tile"><div className="l">Живых</div><div className="v">{fmtInt(totals!.live)}</div></div>
            <div className="tile"><div className="l">Сохранность</div><div className="v">{fmtNum((totals!.live / totals!.placed) * 100)}%</div></div>
            <div className="tile"><div className="l">Журналы сегодня</div><div className="v">{rows.filter((r) => r.today).length} из {rows.length}</div></div>
          </div>
        )}
        {!!blocks?.length && (
          <section aria-label="Блоки">
            <h2 className="pad" style={{ margin: '0 0 8px', fontSize: 17 }}>Блоки</h2>
            <BlockCards blocks={blocks} today={today()} rows={rows} />
          </section>
        )}
        {rows && rows.length > 0 && (
          <>
            <h2 className="pad" style={{ margin: '8px 0 0', fontSize: 17 }}>Сегодня по блокам</h2>
            <div className="pad">
              <div className="scroll-x">
                <table className="data">
                  <thead><tr>
                    <th>Блок</th><th>День</th><th>Живых</th><th>Сохр., %</th><th>Падёж сег. / вчера</th><th>Корм, г/гол</th><th>Вода, л</th><th>Вода:корм</th><th>t мин/макс</th><th>ОВ</th><th>Журнал</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const t = r.today;
                      const ratio = t?.waterL != null && t.feedKg ? t.waterL / t.feedKg : null;
                      return (
                        <tr key={r.houseBatchId}>
                          <td><Link to={`/log/${r.houseBatchId}/${day}`} style={{ color: 'inherit', textDecoration: 'none', display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}><b>{r.houseName}</b><span className="small muted">{r.workers ?? 'нет работника'}</span></Link></td>
                          <td>{r.dayOfAge}</td>
                          <td>{fmtInt(r.liveBirds)}</td>
                          <td>{fmtNum((r.liveBirds / r.placed) * 100)}</td>
                          <td>{t ? t.deaths + t.culls : '—'} / {r.yesterdayDeaths ?? '—'}</td>
                          <td>{t?.feedKg ? fmtInt((t.feedKg / r.liveBirds) * 1000) : '—'}</td>
                          <td>{fmtInt(t?.waterL)}</td>
                          <td>{fmtNum(ratio, 2)}</td>
                          <td>{t ? `${fmtNum(t.tMin)} / ${fmtNum(t.tMax)}` : '—'}</td>
                          <td>{t?.rh != null ? `${fmtNum(t.rh, 0)}%` : '—'}</td>
                          <td>{t ? <span className="ok-t">● {fmtTime(t.loggedAt)}</span> : <span className="warn-t">▲ нет записи</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><h2 style={{ margin: 0, fontSize: 17 }}>За сутки от работников</h2><Link to="/events">Все события</Link></div>
            <div className="section">
              {events.filter((e) => e.kind !== 'log').slice(0, 8).map((e) => { const t = eventText(e); return (
                <div className="row" key={e.kind + e.refId + e.at} style={{ alignItems: 'flex-start' }}><span className="num small muted" style={{ width: 48, flex: 'none' }}>{fmtTime(e.at)}</span><span className={t.cls} aria-hidden="true">{t.mark}</span><span style={{ flex: 1, fontSize: 14 }}><b>{e.houseName}</b> · {e.who ?? '—'} — {t.text}</span></div>
              ); })}
              {!events.some((e) => e.kind !== 'log') && <div className="row muted">Новых записей нет</div>}
            </div>
            <p className="pad small muted">Нажмите на блок в таблице, чтобы открыть или исправить журнал.</p>
          </>
        )}
      </main>
    </>
  );
}
