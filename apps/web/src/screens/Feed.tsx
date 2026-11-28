import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, dayOfAge, daysBetween, FEED_TYPE_RU, type FeedType } from '@farm/core';
import { useLive, useSignedIn } from '../app';
import type { FeedIssue, LogRecord } from '../api/types';
import { TopBar } from '../ui/parts';
import { fmtDayShort, fmtInt, fmtNum } from '../ui/format';
import { binOfBlock, expiryState, FEED_KIND_RU, fifo, useWarehouse } from '../ui/feedStock';
import { useHouses } from './useHouses';

const t = (kg: number) => `${fmtNum(kg / 1000)} т`;
const NEXT: Partial<Record<FeedType, FeedType>> = { starter: 'grower', grower: 'finisher' };

/** «Склад кормов»: the farm warehouse (deliveries with expiry), what each block has in its bin, and issuing feed. */
export default function Feed() {
  const { db, today, sync } = useSignedIn();
  const day = today();
  const { lots } = useWarehouse();
  const { houses } = useHouses();
  const issues = useLive(() => db.feedIssues.toArray(), [db], [] as FeedIssue[]);
  const logs = useLive(() => db.logs.toArray(), [db], [] as LogRecord[]);
  const [showUsed, setShowUsed] = useState(false);

  const inStock = fifo(lots.filter((l) => l.left > 0.05));
  const used = lots.filter((l) => l.left <= 0.05).sort((a, b) => b.receivedOn.localeCompare(a.receivedOn));
  const byKind = (['starter', 'grower', 'finisher', 'other'] as const).map((k) => ({ k, kg: inStock.filter((l) => l.feedType === k).reduce((a, l) => a + l.left, 0) })).filter((x) => x.kg > 0);
  const expired = inStock.filter((l) => expiryState(l, day) === 'expired');
  const soon = inStock.filter((l) => expiryState(l, day) === 'soon');

  return (
    <>
      <TopBar title="Склад кормов" sub={`На складе ${t(inStock.reduce((a, l) => a + l.left, 0))}`} />
      <main className="content">
        {expired.map((l) => <div key={l.id} className="banner bad" role="alert">Просрочен: {l.product ?? FEED_KIND_RU[l.feedType]} — {fmtInt(l.left)} кг, срок до {fmtDayShort(l.expiresOn!)}. Не выдавать без решения ветврача.</div>)}
        {soon.map((l) => <div key={l.id} className="banner warn">Скоро истекает: {l.product ?? FEED_KIND_RU[l.feedType]} — {fmtInt(l.left)} кг до {fmtDayShort(l.expiresOn!)} ({daysBetween(day, l.expiresOn!)} дн.). Выдавайте первым.</div>)}

        <div className="grid2 pad">
          {byKind.map(({ k, kg }) => <div key={k} className="tile"><div className="l">{FEED_KIND_RU[k]}</div><div className="v">{t(kg)}</div></div>)}
          {!byKind.length && <div className="tile" style={{ gridColumn: '1 / -1' }}><div className="l">Склад пуст</div><div className="small muted">Запишите поступление корма.</div></div>}
        </div>
        <div className="pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, paddingTop: 0 }}>
          <Link className="btn primary big" to="/feed/lot/new">+ Поступление</Link>
          <Link className={`btn big${inStock.length ? '' : ' disabled'}`} to="/feed/issue" aria-disabled={!inStock.length}>Выдать в блок</Link>
        </div>

        <h2 className="pad" style={{ margin: 0, fontSize: 17 }}>На складе · первым выдавать сверху</h2>
        <div className="section">
          {inStock.map((l) => {
            const st = expiryState(l, day);
            return (
              <Link key={l.id} to={`/feed/lot/${l.id}`} className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                <span className={`kind-chip kind-${l.feedType}`}>{FEED_KIND_RU[l.feedType]}</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <b style={{ fontWeight: 600 }}>{l.product ?? 'Без названия'}</b>
                  <span className="small muted num">Осталось {fmtInt(l.left)} из {fmtInt(l.kg)} кг{l.bagKg ? ` · ≈ ${fmtInt(l.left / l.bagKg)} мешк. по ${fmtNum(l.bagKg, 0)} кг` : ''}</span>
                  <span className="small num">
                    <span className={st === 'expired' ? 'bad-t' : st === 'soon' ? 'warn-t' : 'muted'}>{l.expiresOn ? `годен до ${fmtDayShort(l.expiresOn)}` : 'срок не указан'}</span>
                    <span className="muted"> · {l.storage ?? 'место не указано'} · пришёл {fmtDayShort(l.receivedOn)}{l.pending ? ' · ждёт отправки' : ''}</span>
                  </span>
                  <span className="stock-bar" aria-hidden="true"><span style={{ width: `${Math.round((l.left / l.kg) * 100)}%` }} /></span>
                </span>
                <span aria-hidden="true">›</span>
              </Link>
            );
          })}
          {!inStock.length && <div className="row muted">Нет корма на складе</div>}
        </div>

        {!!houses.length && (
          <>
            <h2 className="pad" style={{ margin: 0, fontSize: 17 }}>В бункерах блоков</h2>
            <div className="section">
              {houses.map((h) => {
                const bin = binOfBlock(issues.filter((i) => i.houseBatchId === h.houseBatchId), logs.filter((l) => l.houseBatchId === h.houseBatchId), day);
                return (
                  <div key={h.houseBatchId} className="row" style={{ gap: 12 }}>
                    <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <b style={{ fontWeight: 600 }}>{h.houseName}</b>
                      <span className="small muted">Рацион: {FEED_TYPE_RU[(h.feedPhase ?? 'starter') as FeedType]}</span>
                    </span>
                    <span className="num" style={{ textAlign: 'right' }}>
                      <b className={bin.left < 0 ? 'warn-t' : ''}>{fmtInt(Math.max(0, bin.left))} кг</b><br />
                      <span className={`small ${bin.daysLeft != null && bin.daysLeft < 2 ? 'warn-t' : 'muted'}`}>{bin.daysLeft != null ? `на ${fmtNum(Math.max(0, bin.daysLeft))} дн.` : '—'}</span>
                    </span>
                    {NEXT[(h.feedPhase ?? 'starter') as FeedType] && feedDueTask(h.feedPhase as FeedType | undefined, dayOfAge(h.placedOn, day), day) && (
                      <button className="btn" onClick={() => void sync.saveOp('phase', { houseBatchId: h.houseBatchId, phase: NEXT[(h.feedPhase ?? 'starter') as FeedType], since: day })}>
                        → {FEED_TYPE_RU[NEXT[(h.feedPhase ?? 'starter') as FeedType]!]}
                      </button>
                    )}
                    <Link className="btn" to={`/feed/issue?hb=${h.houseBatchId}`}>Выдать</Link>
                  </div>
                );
              })}
            </div>
            <p className="pad small muted" style={{ margin: 0 }}>В бункере = выдано со склада − скормлено по журналам дня.</p>
          </>
        )}

        {!!used.length && (
          <>
            <button className="row" style={{ width: '100%', border: 0, background: 'none', font: 'inherit', textAlign: 'left' }} aria-expanded={showUsed} onClick={() => setShowUsed(!showUsed)}>
              <span style={{ flex: 1 }} className="muted">Израсходованные поставки · {used.length}</span><span aria-hidden="true">{showUsed ? '▾' : '›'}</span>
            </button>
            {showUsed && (
              <div className="section">
                {used.map((l) => <Link key={l.id} to={`/feed/lot/${l.id}`} className="row muted"><span style={{ flex: 1 }}>{l.product ?? FEED_KIND_RU[l.feedType]} · {fmtInt(l.kg)} кг</span><span className="small">{fmtDayShort(l.receivedOn)}</span></Link>)}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

/** Reminder on «Сегодня» when the Arbor Acres feeding programme says it is time for the next feed. */
const DUE: { from: FeedType; to: FeedType; day: number }[] = [{ from: 'starter', to: 'grower', day: 10 }, { from: 'grower', to: 'finisher', day: 25 }];
export const feedDueTask = (phase: FeedType | undefined, age: number, today: string) => {
  const d = DUE.find((x) => x.from === (phase ?? 'starter') && age >= x.day - 1);
  return d ? { title: `${FEED_TYPE_RU[d.to]} с ${d.day}-го дня`, sub: age >= d.day ? 'Пора переходить — отметьте смену рациона в блоке' : `Завтра, ${fmtDayShort(addDays(today, 1))}` } : null;
};
