import { useEffect, useState } from 'react';
import { withdrawalUntil } from '@farm/core';
import { useSignedIn } from '../app';
import { TopBar } from '../ui/parts';
import { fmtDayShort, fmtInt, fmtNum, parseNum } from '../ui/format';
import { HouseSwitch } from './HouseSwitch';
import { catchDay } from './Health';
import { useHouseOps, useHouses } from './useHouses';

/** Local date + time in the farm's zone (Asia/Bishkek is UTC+6 without DST) → ISO instant. */
function toIso(date: string, time: string, tz: string) {
  const offset = tz === 'Asia/Bishkek' ? '+06:00' : 'Z';
  return new Date(`${date}T${time || '00:00'}:00${offset}`).toISOString();
}
function localTime(iso: string | null | undefined, tz: string) {
  return iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz }) : '';
}

/** Worker: catch plan with the withdrawal block (override with reason → director notified), and the handover. No prices. */
export default function Catch() {
  const { sync, today, session } = useSignedIn();
  const tz = session.farm.tz;
  const { houses, current, select } = useHouses();
  const { health, handovers } = useHouseOps(current?.houseBatchId);
  const [plan, setPlan] = useState({ date: '', time: '22:00', feedOff: '18:00', reason: '' });
  const [h, setH] = useState({ buyer: '', birds: '', kg: '', dead: '0' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setPlan({ date: catchDay(current?.catchAt, tz) ?? '', time: localTime(current?.catchAt, tz) || '22:00', feedOff: localTime(current?.feedOffAt, tz) || '18:00', reason: current?.catchOverrideReason ?? '' });
  }, [current?.houseBatchId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!current) return <><TopBar title="Отлов и сдача" back="/more" /><main className="content"><p className="pad muted">Нет блоков с партией</p></main></>;

  const until = withdrawalUntil(health.filter((e) => e.kind === 'treatment' && e.courseDays != null && e.withdrawalDays != null).map((e) => ({ startOn: e.eventOn, courseDays: e.courseDays!, withdrawalDays: e.withdrawalDays! })));
  const blocked = !!until && !!plan.date && plan.date < until;
  const birds = parseNum(h.birds), kg = parseNum(h.kg);

  async function savePlan() {
    if (!plan.date) { setMsg({ ok: false, text: 'Выберите дату отлова' }); return; }
    if (blocked && !plan.reason.trim()) { setMsg({ ok: false, text: `Срок ожидания до ${fmtDayShort(until!)}: перенесите дату или укажите причину` }); return; }
    await sync.saveOp('catch', { houseBatchId: current!.houseBatchId, catchAt: toIso(plan.date, plan.time, tz), feedOffAt: toIso(plan.date, plan.feedOff, tz), reason: blocked ? plan.reason.trim() : null });
    setMsg({ ok: true, text: blocked ? 'План сохранён. Директор уведомлён о причине.' : 'План отлова сохранён' });
  }
  async function saveHandover() {
    if (!h.buyer.trim() || !birds || !kg) { setMsg({ ok: false, text: 'Укажите покупателя, голов и кг' }); return; }
    await sync.saveOp('handover', { id: crypto.randomUUID(), houseBatchId: current!.houseBatchId, handedOn: today(), buyer: h.buyer.trim(), birds, kg, transportDead: parseNum(h.dead) ?? 0, createdBy: session.userId });
    setH({ buyer: h.buyer, birds: '', kg: '', dead: '0' });
    setMsg({ ok: true, text: 'Сдача записана' });
  }

  return (
    <>
      <TopBar title={`Отлов · ${current.houseName}`} back="/more" />
      <main className="content">
        <HouseSwitch houses={houses} current={current} select={select} />
        {msg && <div className={`banner ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
        <section className="formrow" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <span className="lbl">План отлова</span>
          {until && <span className={`small ${blocked ? 'bad-t' : 'muted'}`}>Срок ожидания после лечения: убой не ранее {fmtDayShort(until)}</span>}
          <div className="grid3">
            <label className="field"><span>Дата</span><input className="input text" type="date" value={plan.date} onChange={(e) => setPlan({ ...plan, date: e.target.value })} /></label>
            <label className="field"><span>Отлов</span><input className="input text" type="time" value={plan.time} onChange={(e) => setPlan({ ...plan, time: e.target.value })} /></label>
            <label className="field"><span>Снять корм</span><input className="input text" type="time" value={plan.feedOff} onChange={(e) => setPlan({ ...plan, feedOff: e.target.value })} /></label>
          </div>
          {blocked && (
            <div className="banner bad" role="alert" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <b>■ Отлов раньше конца срока ожидания</b>
              <button className="btn" type="button" onClick={() => setPlan({ ...plan, date: until! })}>Перенести на {fmtDayShort(until!)}</button>
              <label className="field"><span style={{ color: 'inherit' }}>Или причина (директор получит уведомление)</span><input className="input text" value={plan.reason} onChange={(e) => setPlan({ ...plan, reason: e.target.value })} /></label>
            </div>
          )}
          <span className="small muted">Корм снимают за 8–12 ч до убоя, вода без ограничений. За 3 дня — свет 23 ч, за 2 дня — без цельного зерна.</span>
          <button className="btn primary block" onClick={() => void savePlan()}>Сохранить план</button>
        </section>
        <section className="formrow" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <span className="lbl">Сдача покупателю</span>
          <label className="field"><span>Покупатель</span><input className="input text" value={h.buyer} onChange={(e) => setH({ ...h, buyer: e.target.value })} /></label>
          <div className="grid3">
            <label className="field"><span>Голов</span><input className="input" inputMode="numeric" value={h.birds} onChange={(e) => setH({ ...h, birds: e.target.value })} /></label>
            <label className="field"><span>Кг</span><input className="input" inputMode="decimal" value={h.kg} onChange={(e) => setH({ ...h, kg: e.target.value })} /></label>
            <label className="field"><span>Пало в дороге</span><input className="input" inputMode="numeric" value={h.dead} onChange={(e) => setH({ ...h, dead: e.target.value })} /></label>
          </div>
          {birds && kg ? <span className="num">Средняя масса {fmtNum(kg / birds, 3)} кг</span> : null}
          <button className="btn primary block" onClick={() => void saveHandover()}>Сохранить сдачу</button>
          <span className="small muted">Цену и оплату вносит директор.</span>
        </section>
        <div className="section">
          {handovers.map((x) => <div className="row" key={x.id}><span className="num" style={{ width: 56 }}>{fmtDayShort(x.handedOn)}</span><span style={{ flex: 1 }}>{x.buyer}</span><span className="num">{fmtInt(x.birds)} гол. · {fmtInt(x.kg)} кг</span></div>)}
        </div>
      </main>
    </>
  );
}
