import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOnline, useSignedIn } from '../app';
import type { HouseToday } from '../api/types';
import { ApiError } from '../api/types';
import { AgeRuler, TopBar } from '../ui/parts';
import { fmtDayLong, fmtInt, fmtNum, fmtTime } from '../ui/format';

const CACHE = 'farm-today-cache';

/** Head: all houses today (T-13). Online-first with the last result cached for offline viewing. */
export default function Farm() {
  const { api, today, session } = useSignedIn();
  const online = useOnline();
  const [rows, setRows] = useState<HouseToday[] | null>(() => { try { return JSON.parse(localStorage.getItem(CACHE) ?? 'null')?.rows ?? null; } catch { return null; } });
  const [at, setAt] = useState<string | null>(() => { try { return JSON.parse(localStorage.getItem(CACHE) ?? 'null')?.at ?? null; } catch { return null; } });
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.houseToday();
      const now = new Date().toISOString();
      setRows(r); setAt(now); setErr(null);
      try { localStorage.setItem(CACHE, JSON.stringify({ rows: r, at: now })); } catch { /* ignore */ }
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Ошибка загрузки'); }
  }, [api]);
  useEffect(() => { void load(); const t = setInterval(() => { if (navigator.onLine) void load(); }, 60_000); return () => clearInterval(t); }, [load, online]);

  const day = today();
  const totals = rows?.reduce((a, r) => ({ placed: a.placed + r.placed, live: a.live + r.liveBirds }), { placed: 0, live: 0 });
  const age = rows?.[0]?.dayOfAge ?? 0;

  return (
    <>
      <TopBar title={`День ${age} · все птичники`} sub={`${session.farm.name} · ${fmtDayLong(day)}`} />
      <main className="content">
        {(err || !online) && <div className="banner warn" role="status">{!online ? 'Нет сети.' : err} {at ? `Показаны данные за ${fmtTime(at)}.` : ''}</div>}
        {rows === null && !err && <p className="pad muted">Загрузка…</p>}
        {rows?.length === 0 && <div className="banner info">Нет открытой партии. Партия открывается в фазе 3; сейчас её создаёт администратор.</div>}
        {rows && rows.length > 0 && (
          <>
            <div className="pad"><AgeRuler day={age} /></div>
            <div className="grid3 pad">
              <div className="tile"><div className="l">Живых</div><div className="v">{fmtInt(totals!.live)}</div></div>
              <div className="tile"><div className="l">Сохранность</div><div className="v">{fmtNum((totals!.live / totals!.placed) * 100)}%</div></div>
              <div className="tile"><div className="l">Журналы сегодня</div><div className="v">{rows.filter((r) => r.today).length} из {rows.length}</div></div>
            </div>
            <div className="pad">
              <div className="scroll-x">
                <table className="data">
                  <thead><tr>
                    <th>Птичник</th><th>Живых</th><th>Сохр., %</th><th>Падёж сег. / вчера</th><th>Корм, г/гол</th><th>Вода, л</th><th>Вода:корм</th><th>t мин/макс</th><th>ОВ</th><th>Журнал</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const t = r.today;
                      const ratio = t?.waterL != null && t.feedKg ? t.waterL / t.feedKg : null;
                      return (
                        <tr key={r.houseBatchId}>
                          <td><Link to={`/log/${r.houseBatchId}/${day}`} style={{ color: 'inherit', textDecoration: 'none', display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}><b>{r.houseName}</b><span className="small muted">{r.workers ?? 'нет работника'}</span></Link></td>
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
            <p className="pad small muted">Предупреждения по нормам Arbor Acres (падёж, вода, температура) — фаза 2. Нажмите на птичник, чтобы открыть или исправить журнал.</p>
          </>
        )}
      </main>
    </>
  );
}
