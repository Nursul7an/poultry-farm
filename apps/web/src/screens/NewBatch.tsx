import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useOnline, useSignedIn } from '../app';
import type { Placement } from '../api/types';
import { TopBar } from '../ui/parts';
import { useBlocks } from '../ui/blocks';
import { errText } from '../ui/people';
import { fmtDayShort, fmtInt, fmtNum, parseNum } from '../ui/format';
import { SELECTED_HOUSE_KEY } from './useHouses';

/** «Новая партия» in an empty block: the number is automatic (director may change it). Works offline. */
export default function NewBatch() {
  const { houseId = '' } = useParams();
  const { session, sync, today } = useSignedIn();
  const online = useOnline();
  const nav = useNavigate();
  const { blocks } = useBlocks();
  const block = blocks?.find((b) => b.houseId === houseId);
  const head = session.role === 'head';
  const [f, setF] = useState({ placedOn: today(), waybill: '', dead: '0', hatchery: '', parent: '', w0: '' });
  const [number, setNumber] = useState<string | null>(null);
  const [editNo, setEditNo] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!blocks) return <><TopBar title="Новая партия" back="/today" /><main className="content"><p className="pad muted">Загрузка…</p></main></>;
  if (!block) return <><TopBar title="Новая партия" back="/today" /><main className="content"><p className="pad muted">Блок не найден</p></main></>;
  if (block.open) {
    return (
      <><TopBar title={`Новая партия · ${block.name}`} back="/today" />
        <main className="content"><div className="banner warn">В {block.name} уже идёт партия {block.open.number}. Новую можно начать после того, как директор закроет текущую.</div></main></>
    );
  }

  const waybill = parseNum(f.waybill), dead = parseNum(f.dead) ?? 0;
  const placed = waybill != null && !Number.isNaN(waybill) ? waybill - (Number.isNaN(dead) ? 0 : dead) : null;
  const shownNo = number ?? block.nextNumber;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => { setErr(null); setF({ ...f, [k]: e.target.value }); };

  async function save() {
    if (!placed || placed <= 0) { setErr('Укажите, сколько цыплят по накладной'); return; }
    if (!f.placedOn || f.placedOn > today()) { setErr('Проверьте дату посадки'); return; }
    setBusy(true);
    const p: Placement = {
      id: crypto.randomUUID(), houseId, placedOn: f.placedOn, hatchery: f.hatchery.trim() || null, waybillCount: waybill, transportDead: Number.isNaN(dead) ? 0 : dead,
      placed, parentAgeWeeks: parseNum(f.parent), day0WeightG: parseNum(f.w0), cloacalT: null, cropFill: {},
      batchNumber: head && number && number !== block!.nextNumber ? number.trim() : null,
    };
    try {
      await sync.saveOp('placement', p);
      try { localStorage.setItem(SELECTED_HOUSE_KEY, p.id); } catch { /* */ }
      nav('/today', { replace: true, state: { started: shownNo } });
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }

  const input = (k: keyof typeof f, label: string, mode: 'numeric' | 'decimal' | 'text' = 'numeric') => (
    <label className="field"><span>{label}</span><input className={`input${mode === 'text' ? ' text' : ''}`} inputMode={mode === 'text' ? undefined : mode} value={f[k]} onChange={set(k)} /></label>
  );

  return (
    <>
      <TopBar title={`Новая партия · ${block.name}`} sub={block.last ? `Прошлая ${block.last.number}${block.last.closedAt ? ` · закрыта ${fmtDayShort(block.last.closedAt.slice(0, 10))}` : ''}` : 'Первая партия в этом блоке'} back="/today" />
      <main className="content" style={{ paddingBottom: 120 }}>
        <div className="batch-number">
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <span className="small muted">Номер партии{online ? ' — присвоен автоматически' : ' — окончательный присвоится при отправке'}</span>
            {editNo ? <input className="input text" aria-label="Номер партии" value={shownNo} onChange={(e) => setNumber(e.target.value)} autoFocus /> : <b>{shownNo}</b>}
          </span>
          {head && !editNo && <button type="button" className="btn" onClick={() => setEditNo(true)}>Изменить</button>}
        </div>
        <section className="formrow">
          <div className="grid2">
            <label className="field"><span>Дата посадки</span><input className="input text" type="date" value={f.placedOn} max={today()} onChange={set('placedOn')} /></label>
            {input('hatchery', 'Инкубаторий', 'text')}
          </div>
          <div className="grid2">{input('waybill', 'Цыплят по накладной')}{input('dead', 'Пали в дороге')}</div>
          <span className="num" aria-live="polite">{placed && placed > 0 ? <>Посажено: <b>{fmtInt(placed)}</b> · {fmtNum(placed / block.areaM2)} гол/м²</> : <span className="muted">Посажено: —</span>}</span>
          <details>
            <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>Ещё: возраст родительского стада, масса суточного</summary>
            <div className="grid2" style={{ paddingTop: 8 }}>{input('parent', 'Возраст стада, нед.')}{input('w0', 'Масса суточного, г', 'decimal')}</div>
          </details>
          {err && <div className="err-text" role="alert">{err}</div>}
        </section>
      </main>
      <div className="sticky-save">
        <button className="btn primary big block" disabled={busy} onClick={() => void save()}>Начать партию {shownNo}</button>
        <span className="small muted">Без сети сохранится на телефоне и отправится позже. Наполнение зоба отметьте в «Посадка» через 2–24 ч.</span>
      </div>
    </>
  );
}
