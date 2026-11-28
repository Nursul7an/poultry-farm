import { Link, useLocation } from 'react-router-dom';
import { addDays, daysBetween } from '@farm/core';
import { useLive, useSignedIn } from '../app';
import { AgeRuler, Icon, TopBar } from '../ui/parts';
import { fmtDayLong, fmtInt, fmtNum, fmtTime } from '../ui/format';
import { houseFigures, useHouseLogs, useHouseOps, useHouses } from './useHouses';
import { feedDueTask } from './Feed';
import { activeTreatments, catchDay } from './Health';
import { BlockCards, useBlocks } from '../ui/blocks';

export default function Today() {
  const { session, db, today } = useSignedIn();
  const { houses, current, select } = useHouses();
  const logs = useHouseLogs(current?.houseBatchId);
  const ops = useHouseOps(current?.houseBatchId);
  const outbox = useLive(() => db.outbox.toArray(), [db], []);
  const day = today();
  const { blocks } = useBlocks();
  const loc = useLocation();
  const started = (loc.state as { started?: string } | null)?.started;
  // Own blocks without a batch: offer to start one (a worker records the arrival of chicks).
  const empty = (blocks ?? []).filter((b) => b.active && !b.open && !houses.some((h) => h.houseId === b.houseId));
  const emptyCards = empty.length ? <><h2 className="pad" style={{ margin: 0, fontSize: 16 }}>Пустые блоки</h2><BlockCards blocks={empty} today={day} /></> : null;

  if (!houses.length) {
    return (
      <>
        <TopBar title="Сегодня" sub={session.displayName} />
        <main className="content">
          {empty.length ? emptyCards : (
            <div className="banner info" role="status">
              <strong>Нет блоков с партией</strong><br />
              {blocks?.length === 0 ? 'Директор ещё не назначил вам блок.' : 'Журнал откроется, когда в вашем блоке начнут новую партию. Если партия уже идёт — подключитесь к сети, чтобы загрузить данные.'}
            </div>
          )}
        </main>
      </>
    );
  }
  if (!current) return null;

  const { day: age, live } = houseFigures(current, logs, day);
  const todayLog = logs.find((l) => l.productionDay === day);
  const y = logs.find((l) => l.productionDay === addDays(day, -1));
  const pending = todayLog && outbox.some((o) => o.logId === todayLog.id);
  const missing = [1, 2].map((n) => addDays(day, -n)).filter((d) => d >= current.placedOn && !logs.some((l) => l.productionDay === d));
  const ratio = y?.waterL != null && y.feedKg ? y.waterL / y.feedKg : null;

  // Today's tasks come from what is recorded for the house (treatments, feed phase, weighing, catch plan).
  const tasks: { to: string; title: string; sub: string }[] = [];
  for (const { e, dayN } of activeTreatments(ops.health, day)) tasks.push({ to: '/health', title: `Лечение: ${e.product}, день ${dayN} из ${e.courseDays}`, sub: [e.dose, e.method].filter(Boolean).join(' · ') || 'по назначению ветврача' });
  const fd = feedDueTask(current.feedPhase, age, day);
  if (fd) tasks.push({ to: '/feed', ...fd });
  const lastW = [...ops.weighings].sort((a, b) => b.weighedOn.localeCompare(a.weighedOn))[0];
  if (age >= 7 && age % 7 <= 1 && (!lastW || daysBetween(lastW.weighedOn, day) > 3)) tasks.push({ to: '/weighing', title: `Взвешивание, день ${age}`, sub: age < 21 ? 'Группой, 100 гол. или 1%' : 'По одной, для CV%' });
  const cd = catchDay(current.catchAt, session.farm.tz);
  if (cd) {
    const left = daysBetween(day, cd);
    if (left === 3) tasks.push({ to: '/catch', title: 'Свет 23 ч до отлова', sub: `Отлов ${cd.slice(8, 10)}.${cd.slice(5, 7)}` });
    if (left === 2) tasks.push({ to: '/catch', title: 'Убрать цельное зерно', sub: 'За 2 дня до отлова' });
    if (left === 0) tasks.push({ to: '/catch', title: 'Сегодня отлов: снять корм вовремя', sub: 'Вода без ограничений' });
  }

  return (
    <>
      <TopBar title={current.houseName} sub={`${session.displayName} · ${fmtDayLong(day)}`} />
      <main className="content">
        {started && <div className="banner ok" role="status">Партия {started} начата. Через 2 и 24 часа проверьте наполнение зоба («Ещё → Посадка»).</div>}
        {houses.length > 1 && (
          <div className="seg pad" role="group" aria-label="Мои блоки">
            {houses.map((h) => (
              <button key={h.houseBatchId} className={h.houseBatchId === current.houseBatchId ? 'on' : ''} aria-pressed={h.houseBatchId === current.houseBatchId} onClick={() => select(h.houseBatchId)}>{h.houseName}</button>
            ))}
          </div>
        )}
        <section className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px 8px', flexWrap: 'wrap' }}>
            <span className="num" style={{ fontSize: 40, fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap' }}>День {age}</span>
            <span className="muted num">{fmtInt(live)} птиц · партия {current.batchName}</span>
          </div>
          <AgeRuler day={age} />
        </section>

        {missing.map((d) => (
          <Link key={d} to={`/log/${current.houseBatchId}/${d}`} className="banner warn" style={{ textDecoration: 'none' }}>
            Не заполнен день {fmtDayLong(d)} — заполнить (можно до 48 ч)
          </Link>
        ))}

        <div className="pad">
          {todayLog ? (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{pending ? 'Записано, ждёт отправки' : 'Записано и отправлено'} · {fmtTime(todayLog.updatedAt ?? todayLog.createdAt)}</span>
              <span className="muted num">Падёж {todayLog.deaths} + брак {todayLog.culls} · корм {fmtInt(todayLog.feedKg)} кг{todayLog.waterL != null ? ` · вода ${fmtInt(todayLog.waterL)} л` : ''}</span>
              <Link to={`/log/${current.houseBatchId}/${day}`} className="btn block"><Icon name="edit" size={20} />Исправить</Link>
            </div>
          ) : (
            <Link to={`/log/${current.houseBatchId}/${day}`} className="btn primary big block"><Icon name="edit" />Записать день · {current.houseName}</Link>
          )}
        </div>

        {tasks.length > 0 && (
          <section className="section" aria-label="Задачи на сегодня">
            {tasks.map((t) => (
              <Link key={t.title} to={t.to} className="row"><span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}><span style={{ fontWeight: 500 }}>{t.title}</span><span className="small muted">{t.sub}</span></span><span aria-hidden="true">›</span></Link>
            ))}
          </section>
        )}

        <section className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className="muted" style={{ margin: 0, fontSize: 15 }}>Вчера, день {age - 1}</h2>
          {y ? (
            <div className="grid2">
              <div className="tile"><div className="l">Падёж + брак</div><div className="v">{y.deaths} + {y.culls}</div></div>
              <div className="tile"><div className="l">Корм</div><div className="v">{fmtInt(y.feedKg)} кг</div><div className="small muted num">{y.feedKg ? `${fmtInt((y.feedKg / live) * 1000)} г/гол` : ''}</div></div>
              <div className="tile"><div className="l">Вода</div><div className="v">{y.waterL != null ? `${fmtInt(y.waterL)} л` : '—'}</div><div className="small muted num">{ratio != null ? `вода:корм ${fmtNum(ratio, 2)}` : ''}</div></div>
              <div className="tile"><div className="l">t мин / макс</div><div className="v">{fmtNum(y.tMin)} / {fmtNum(y.tMax)}°</div></div>
            </div>
          ) : <span className="muted">Нет записи за вчера</span>}
        </section>
        {emptyCards}
      </main>
    </>
  );
}
