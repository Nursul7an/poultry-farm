import { useState } from 'react';
import { dayOfAge, liveBirds, sampleTarget, weighingStats } from '@farm/core';
import { useSignedIn } from '../app';
import { TopBar } from '../ui/parts';
import { fmtDayShort, fmtInt, fmtNum, parseNum } from '../ui/format';
import { HouseSwitch } from './HouseSwitch';
import { useHouseLogs, useHouseOps, useHouses } from './useHouses';

/** Worker: weekly weighing — individual samples (CV%) or group crates (average only). */
export default function Weighing() {
  const { sync, today, session } = useSignedIn();
  const { houses, current, select } = useHouses();
  const logs = useHouseLogs(current?.houseBatchId);
  const { weighings } = useHouseOps(current?.houseBatchId);
  const [method, setMethod] = useState<'individual' | 'group'>('individual');
  const [samples, setSamples] = useState<number[]>([]);
  const [entry, setEntry] = useState('');
  const [group, setGroup] = useState({ kg: '', birds: '' });
  const [msg, setMsg] = useState<string | null>(null);
  if (!current) return <><TopBar title="Взвешивание" back="/more" /><main className="content"><p className="pad muted">Нет птичников с партией</p></main></>;

  const day = today();
  const age = dayOfAge(current.placedOn, day);
  const target = sampleTarget(liveBirds(current.placed, logs));
  const st = weighingStats(samples);
  const add = () => { const g = parseNum(entry); if (g && g > 20 && g < 6000) { setSamples([...samples, g]); setEntry(''); } };
  const history = [...weighings].sort((a, b) => b.weighedOn.localeCompare(a.weighedOn));

  async function save() {
    const base = { id: crypto.randomUUID(), houseBatchId: current!.houseBatchId, weighedOn: day, createdBy: session.userId };
    if (method === 'individual') {
      if (samples.length < 2) { setMsg('Нужно хотя бы 2 взвешивания'); return; }
      await sync.saveOp('weighing', { ...base, method, samplesG: samples, n: st.n, meanG: st.mean, sdG: st.sd, cv: st.cv });
    } else {
      const kg = parseNum(group.kg), birds = parseNum(group.birds);
      if (!kg || !birds) { setMsg('Укажите общий вес и число птиц'); return; }
      await sync.saveOp('weighing', { ...base, method, samplesG: [], groupTotalG: kg * 1000, groupBirds: birds, n: birds, meanG: (kg * 1000) / birds });
    }
    setSamples([]); setGroup({ kg: '', birds: '' }); setMsg('Сохранено');
  }

  return (
    <>
      <TopBar title={`Взвешивание · ${current.houseName}`} sub={`День ${age} · выборка ≥ ${target} гол.`} back="/more" />
      <main className="content">
        <HouseSwitch houses={houses} current={current} select={select} />
        <div className="seg pad" role="group" aria-label="Способ">
          <button className={method === 'individual' ? 'on' : ''} onClick={() => setMethod('individual')}>По одной</button>
          <button className={method === 'group' ? 'on' : ''} onClick={() => setMethod('group')}>Группой (до 21 дня)</button>
        </div>
        {method === 'individual' ? (
          <section className="formrow" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="grid3">
              <div className="tile"><div className="l">Птиц</div><div className="v">{st.n} / {target}</div></div>
              <div className="tile"><div className="l">Средняя, г</div><div className="v">{st.n ? fmtInt(st.mean) : '—'}</div></div>
              <div className="tile"><div className="l">CV%</div><div className={`v ${st.cv != null && st.cv > 10 ? 'bad-t' : ''}`}>{fmtNum(st.cv)}</div></div>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); add(); }} style={{ display: 'flex', gap: 8 }}>
              <input className="input" aria-label="Вес, г" inputMode="numeric" placeholder="г" value={entry} onChange={(e) => setEntry(e.target.value.replace(/\D/g, ''))} />
              <button className="btn primary">Добавить</button>
            </form>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {samples.slice().reverse().slice(0, 40).map((g, i) => <span key={i} className="num small" style={{ padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: 6, color: st.n > 2 && Math.abs(g - st.mean) > st.mean * 0.15 ? 'var(--color-status-critical)' : undefined }}>{g}</span>)}
            </div>
            {samples.length > 0 && <button className="btn" onClick={() => setSamples(samples.slice(0, -1))}>Убрать последнее</button>}
          </section>
        ) : (
          <section className="formrow" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="grid2">
              <label className="field"><span>Общий вес, кг</span><input className="input" inputMode="decimal" value={group.kg} onChange={(e) => setGroup({ ...group, kg: e.target.value })} /></label>
              <label className="field"><span>Птиц в ящиках</span><input className="input" inputMode="numeric" value={group.birds} onChange={(e) => setGroup({ ...group, birds: e.target.value })} /></label>
            </div>
          </section>
        )}
        {msg && <div className={`banner ${msg === 'Сохранено' ? 'ok' : 'bad'}`} role="status">{msg}</div>}
        <div className="pad"><button className="btn primary big block" onClick={() => void save()}>Сохранить взвешивание</button></div>
        <div className="section">
          {history.map((w) => (
            <div className="row" key={w.id}><span className="num" style={{ width: 56 }}>{fmtDayShort(w.weighedOn)}</span><span className="num" style={{ flex: 1 }}>{fmtInt(w.meanG)} г · {w.n} гол.</span><span className={`num small ${w.cv != null && w.cv > 10 ? 'bad-t' : 'muted'}`}>{w.cv != null ? `CV ${fmtNum(w.cv)}%` : 'группой'}</span></div>
          ))}
        </div>
      </main>
    </>
  );
}
