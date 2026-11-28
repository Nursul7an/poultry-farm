import { useState } from 'react';
import { addDays, binStock, dayOfAge, FEED_TYPE_RU, type FeedType } from '@farm/core';
import { useSignedIn } from '../app';
import { Sheet, TopBar } from '../ui/parts';
import { fmtDayShort, fmtNum, parseNum } from '../ui/format';
import { HouseSwitch } from './HouseSwitch';
import { useHouseLogs, useHouseOps, useHouses } from './useHouses';

const TYPES: FeedType[] = ['starter', 'grower', 'finisher'];
/** Arbor Acres feeding program: starter to ~day 10, grower to ~day 24, finisher from day 25. */
const DUE: { from: FeedType; to: FeedType; day: number }[] = [{ from: 'starter', to: 'grower', day: 10 }, { from: 'grower', to: 'finisher', day: 25 }];

/** Worker: feed arriving into the bin, bin stock, feed phase. No prices here (FR-23). */
export default function Feed() {
  const { sync, today, session } = useSignedIn();
  const { houses, current, select } = useHouses();
  const logs = useHouseLogs(current?.houseBatchId);
  const { feed } = useHouseOps(current?.houseBatchId);
  const [sheet, setSheet] = useState(false);
  const [type, setType] = useState<FeedType>('grower');
  const [tonnes, setTonnes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  if (!current) return <><TopBar title="Корм" /><main className="content"><p className="pad muted">Нет блоков с партией</p></main></>;

  const day = today();
  const age = dayOfAge(current.placedOn, day);
  const last3 = logs.filter((l) => l.productionDay < day).slice(0, 3).map((l) => l.feedKg);
  const bin = binStock(feed.map((f) => f.tonnes), logs.map((l) => l.feedKg), last3);
  const phase = current.feedPhase ?? 'starter';
  const due = DUE.find((d) => d.from === phase && age >= d.day - 1);
  const sorted = [...feed].sort((a, b) => b.deliveredOn.localeCompare(a.deliveredOn));

  async function save() {
    const t = parseNum(tonnes);
    if (t == null || Number.isNaN(t) || t <= 0 || t > 60) { setErr('Укажите тонны по накладной (например 8,5)'); return; }
    await sync.saveOp('feed', { id: crypto.randomUUID(), houseBatchId: current!.houseBatchId, deliveredOn: day, feedType: type, tonnes: t, note: null, createdBy: session.userId });
    setSheet(false); setTonnes(''); setErr(null); setSaved(`Записано: ${FEED_TYPE_RU[type]} ${fmtNum(t)} т`);
  }

  return (
    <>
      <TopBar title={`Корм · ${current.houseName}`} sub={`День ${age}`} />
      <main className="content">
        <HouseSwitch houses={houses} current={current} select={select} />
        {saved && <div className="banner ok" role="status">{saved}</div>}
        <section className="card" style={{ margin: '0 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="small muted">В бункере {current.houseName}</span>
          <span className="num" style={{ fontSize: 34, fontWeight: 600 }}>{fmtNum(Math.max(0, bin.stockT))} т</span>
          <span className={`num ${bin.daysLeft != null && bin.daysLeft < 2 ? 'warn-t' : 'ok-t'}`}>
            {bin.daysLeft != null ? `хватит на ${fmtNum(bin.daysLeft)} дн. · расход ${fmtNum(bin.perDayT, 2)} т/сут` : 'расход ещё не известен'}
          </span>
          {bin.stockT < 0 && <span className="small warn-t">Выдано больше, чем записано поставок — проверьте поставки.</span>}
        </section>
        <section className="card" style={{ margin: '0 16px', display: 'flex', flexDirection: 'column', gap: 8, borderColor: due ? '#E7B98C' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Рацион сейчас</span><b>{FEED_TYPE_RU[phase]}{current.feedPhaseSince ? ` с ${fmtDayShort(current.feedPhaseSince)}` : ''}</b></div>
          {due && <span className="small warn-t">По норме AA {FEED_TYPE_RU[due.to].toLowerCase()} с {due.day}-го дня. Отметьте, когда начнёте давать.</span>}
          <div className="chips" role="group" aria-label="Сменить рацион">
            {TYPES.slice(TYPES.indexOf(phase) + 1).map((t) => (
              <button key={t} className="chip" onClick={() => void sync.saveOp('phase', { houseBatchId: current.houseBatchId, phase: t, since: day })}>Перешли на {FEED_TYPE_RU[t].toLowerCase()}</button>
            ))}
          </div>
        </section>
        <div className="pad"><button className="btn primary big block" onClick={() => { setType(phase); setSheet(true); }}>Записать поставку</button></div>
        <h2 className="pad muted" style={{ margin: 0, fontSize: 15 }}>Поставки в {current.houseName}</h2>
        <div className="section">
          {sorted.map((f) => (
            <div className="row" key={f.id}>
              <span className="num" style={{ width: 56 }}>{fmtDayShort(f.deliveredOn)}</span>
              <span style={{ flex: 1 }}>{FEED_TYPE_RU[f.feedType]}</span>
              <span className="num">{fmtNum(f.tonnes)} т</span>
            </div>
          ))}
          {!sorted.length && <div className="row muted">Поставок пока нет</div>}
        </div>
        <p className="pad small muted">Цену корма вносит директор.</p>
      </main>
      {sheet && (
        <Sheet title={`Поставка корма · ${current.houseName}`} onClose={() => setSheet(false)}>
          <span className="small muted">Рацион</span>
          <div className="chips">{TYPES.map((t) => <button key={t} className={`chip${type === t ? ' on' : ''}`} aria-pressed={type === t} onClick={() => setType(t)}>{FEED_TYPE_RU[t]}</button>)}</div>
          <label className="field"><span>Тонн по накладной</span><input className="input" inputMode="decimal" value={tonnes} onChange={(e) => setTonnes(e.target.value)} autoFocus /></label>
          {err && <div className="err-text" role="alert">{err}</div>}
          <button className="btn primary block" onClick={() => void save()}>Сохранить поставку</button>
          <button className="btn block" onClick={() => setSheet(false)}>Отмена</button>
        </Sheet>
      )}
    </>
  );
}

export const feedDueTask = (phase: FeedType | undefined, age: number, today: string) => {
  const d = DUE.find((x) => x.from === (phase ?? 'starter') && age >= x.day - 1);
  return d ? { title: `${FEED_TYPE_RU[d.to]} с ${d.day}-го дня`, sub: age >= d.day ? 'Пора переходить — отметьте в «Корм»' : `Завтра, ${fmtDayShort(addDays(today, 1))}` } : null;
};
