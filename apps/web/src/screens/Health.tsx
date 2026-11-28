import { useState } from 'react';
import { daysBetween, earliestSlaughter, localParts } from '@farm/core';
import { useSignedIn } from '../app';
import type { HealthEvent } from '../api/types';
import { TopBar } from '../ui/parts';
import { fmtDayShort } from '../ui/format';
import { HouseSwitch } from './HouseSwitch';
import { useHouseOps, useHouses } from './useHouses';

type Tab = 'treatment' | 'vaccination' | 'post_mortem';
const FINDINGS = ['Энтерит', 'Кокцидиоз', 'Асцит', 'Респираторное', 'Ноги', 'Без изменений'];
const METHODS = ['с водой', 'спрей', 'инъекция', 'в глаз'];

export function catchDay(catchAt: string | null | undefined, tz: string): string | null {
  if (!catchAt) return null;
  const p = localParts(new Date(catchAt), tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
export function activeTreatments(health: HealthEvent[], day: string) {
  return health.filter((e) => e.kind === 'treatment' && e.courseDays && e.eventOn <= day && daysBetween(e.eventOn, day) < e.courseDays)
    .map((e) => ({ e, dayN: daysBetween(e.eventOn, day) + 1 }));
}

/** Worker: vaccinations, treatments with withdrawal, post-mortems. The director is notified (FR-12). */
export default function Health() {
  const { sync, today, session } = useSignedIn();
  const { houses, current, select } = useHouses();
  const { health } = useHouseOps(current?.houseBatchId);
  const [tab, setTab] = useState<Tab>('treatment');
  const [f, setF] = useState({ product: '', dose: '', lot: '', method: 'с водой', course: 5, withdrawal: 7, birds: 8, finding: 'Энтерит', notes: '' });
  const [msg, setMsg] = useState<string | null>(null);
  if (!current) return <><TopBar title="Здоровье" /><main className="content"><p className="pad muted">Нет блоков с партией</p></main></>;

  const day = today();
  const tz = session.farm.tz;
  const es = earliestSlaughter(day, f.course, f.withdrawal);
  const plan = catchDay(current.catchAt, tz);
  const active = activeTreatments(health, day);
  const list = health.filter((e) => e.kind === tab).sort((a, b) => b.eventOn.localeCompare(a.eventOn));
  const set = (patch: Partial<typeof f>) => { setMsg(null); setF({ ...f, ...patch }); };

  async function save() {
    const base = { id: crypto.randomUUID(), houseBatchId: current!.houseBatchId, eventOn: day, kind: tab, createdBy: session.userId };
    if (tab !== 'post_mortem' && !f.product.trim()) { setMsg('Укажите препарат или вакцину'); return; }
    const rec: HealthEvent = tab === 'treatment'
      ? { ...base, kind: 'treatment', product: f.product.trim(), dose: f.dose || null, lot: f.lot || null, method: f.method, courseDays: f.course, withdrawalDays: f.withdrawal, earliestSlaughter: es }
      : tab === 'vaccination'
        ? { ...base, kind: 'vaccination', product: f.product.trim(), lot: f.lot || null, method: f.method }
        : { ...base, kind: 'post_mortem', birdsExamined: f.birds, findings: [f.finding, f.notes.trim()].filter(Boolean).join(' · ') };
    await sync.saveOp('health', rec);
    setF({ ...f, product: '', dose: '', lot: '', notes: '' });
    setMsg(tab === 'treatment' ? `Сохранено. Убой не ранее ${fmtDayShort(es)}. Директор уведомлён.` : 'Сохранено. Директор видит запись.');
  }

  const stepper = (label: string, v: number, k: 'course' | 'withdrawal', max: number) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>{label}</span>
      <div className="stepper" style={{ width: 200 }}>
        <button type="button" aria-label={`${label} минус`} onClick={() => set({ [k]: Math.max(k === 'course' ? 1 : 0, v - 1) } as any)}>−</button>
        <input aria-label={label} inputMode="numeric" value={v} onChange={(e) => set({ [k]: Math.min(max, Number(e.target.value.replace(/\D/g, '') || 0)) } as any)} style={{ fontSize: 24 }} />
        <button type="button" aria-label={`${label} плюс`} onClick={() => set({ [k]: Math.min(max, v + 1) } as any)}>+</button>
      </div>
    </div>
  );

  return (
    <>
      <TopBar title={`Здоровье · ${current.houseName}`} />
      <main className="content">
        <HouseSwitch houses={houses} current={current} select={select} />
        {active.map(({ e, dayN }) => (
          <section key={e.id} className="card" style={{ margin: '0 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="small muted">Идёт лечение</span>
            <b>{e.product} · день {dayN} из {e.courseDays}</b>
            <span className="small muted">{[e.dose, e.method].filter(Boolean).join(' · ')}</span>
            <span className="small bad-t">Убой не ранее {fmtDayShort(e.earliestSlaughter!)}</span>
          </section>
        ))}
        <div className="seg pad" role="group" aria-label="Раздел">
          {([['treatment', 'Лечение'], ['vaccination', 'Вакцинация'], ['post_mortem', 'Вскрытие']] as const).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} aria-pressed={tab === k} onClick={() => { setTab(k); setMsg(null); }}>{l}</button>
          ))}
        </div>
        <section className="formrow" style={{ borderBottom: '1px solid var(--color-border)' }}>
          {tab !== 'post_mortem' && (
            <>
              <label className="field"><span>{tab === 'treatment' ? 'Препарат' : 'Вакцина'}</span><input className="input text" value={f.product} onChange={(e) => set({ product: e.target.value })} /></label>
              <div className="grid2">
                {tab === 'treatment' && <label className="field"><span>Доза</span><input className="input text" value={f.dose} onChange={(e) => set({ dose: e.target.value })} placeholder="1 г / 1 л" /></label>}
                <label className="field"><span>Серия</span><input className="input text" value={f.lot} onChange={(e) => set({ lot: e.target.value })} /></label>
              </div>
              <div className="chips" role="group" aria-label="Способ">{METHODS.map((m) => <button key={m} type="button" className={`chip${f.method === m ? ' on' : ''}`} aria-pressed={f.method === m} onClick={() => set({ method: m })}>{m}</button>)}</div>
            </>
          )}
          {tab === 'treatment' && (
            <>
              {stepper('Курс, дней', f.course, 'course', 60)}
              {stepper('Ожидание, дней', f.withdrawal, 'withdrawal', 120)}
              <div className={`banner ${plan && plan < es ? 'bad' : 'ok'}`} style={{ margin: 0 }}>
                Убой не ранее {fmtDayShort(es)}{plan ? (plan < es ? ` — позже плана отлова ${fmtDayShort(plan)}! Директор увидит это сразу.` : ` — план отлова ${fmtDayShort(plan)} в порядке`) : ''}
              </div>
            </>
          )}
          {tab === 'post_mortem' && (
            <>
              <label className="field"><span>Голов вскрыто</span><input className="input" inputMode="numeric" value={f.birds} onChange={(e) => set({ birds: Number(e.target.value.replace(/\D/g, '') || 0) })} /></label>
              <div className="chips" role="group" aria-label="Что нашли">{FINDINGS.map((x) => <button key={x} type="button" className={`chip${f.finding === x ? ' on' : ''}`} aria-pressed={f.finding === x} onClick={() => set({ finding: x })}>{x}</button>)}</div>
              <label className="field"><span>Заметка</span><input className="input text" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
            </>
          )}
          {msg && <div role="status" className={msg.startsWith('Сохранено') ? 'ok-t' : 'err-text'}>{msg}</div>}
          <button className="btn primary block" onClick={() => void save()}>{tab === 'treatment' ? 'Сохранить лечение' : tab === 'vaccination' ? 'Сохранить вакцинацию' : 'Сохранить вскрытие'}</button>
        </section>
        <div className="section">
          {list.map((e) => (
            <div className="row" key={e.id}>
              <span className="num" style={{ width: 56 }}>{fmtDayShort(e.eventOn)}</span>
              <span style={{ flex: 1 }}>{e.kind === 'post_mortem' ? `${e.birdsExamined ?? ''} гол. · ${e.findings ?? ''}` : `${e.product}${e.method ? ` · ${e.method}` : ''}`}</span>
              {e.earliestSlaughter && <span className="small bad-t">до {fmtDayShort(e.earliestSlaughter)}</span>}
            </div>
          ))}
          {!list.length && <div className="row muted">Записей нет</div>}
        </div>
      </main>
    </>
  );
}

