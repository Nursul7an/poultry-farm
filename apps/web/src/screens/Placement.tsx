import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLive, useSignedIn } from '../app';
import type { MyHouse, Placement as P } from '../api/types';
import { TopBar } from '../ui/parts';
import { fmtDayLong, fmtInt, parseNum } from '../ui/format';

const HOURS = ['2', '4', '8', '12', '24', '48'];
const NORM: Record<string, number> = { '2': 75, '4': 80, '8': 80, '12': 85, '24': 95, '48': 100 };

/** Placement details of the running batch (waybill, crop fill…). A new batch starts in «Новая партия». */
export default function Placement() {
  const { db, sync, today } = useSignedIn();
  const mine = useLive(() => db.myHouses.toArray().then((x) => x.sort((a, b) => a.houseName.localeCompare(b.houseName))), [db], [] as MyHouse[]);
  const hbs = useLive(() => db.houseBatches.toArray(), [db], []);
  const [houseId, setHouseId] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [crop, setCrop] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const house = mine.find((h) => h.houseId === houseId) ?? mine[0];
  const hb = hbs.find((x) => x.houseId === house?.houseId);

  useEffect(() => {
    if (!house) return;
    setF({ placedOn: hb?.placedOn ?? today(), hatchery: hb?.hatchery ?? '', waybill: hb?.waybillCount != null ? String(hb.waybillCount) : '', dead: String(hb?.transportDead ?? 0), parent: hb?.parentAgeWeeks != null ? String(hb.parentAgeWeeks) : '', w0: hb?.day0WeightG != null ? String(hb.day0WeightG).replace('.', ',') : '', ct: hb?.cloacalT != null ? String(hb.cloacalT).replace('.', ',') : '' });
    setCrop(Object.fromEntries(Object.entries(hb?.cropFill ?? {}).map(([k, v]) => [k, String(v)])));
    setMsg(null);
  }, [house?.houseId, hb?.houseBatchId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!house) return <><TopBar title="Посадка" back="/more" /><main className="content"><p className="pad muted">Нет назначенных блоков</p></main></>;
  const picker = mine.length > 1 && (
    <div className="seg pad" role="group" aria-label="Блок">
      {mine.map((h) => <button key={h.houseId} className={h.houseId === house.houseId ? 'on' : ''} aria-pressed={h.houseId === house.houseId} onClick={() => setHouseId(h.houseId)}>{h.houseName}</button>)}
    </div>
  );
  if (!hb) {
    return (
      <><TopBar title={`Посадка · ${house.houseName}`} sub="Блок пустой" back="/more" />
        <main className="content">{picker}
          <div className="banner info" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span>В {house.houseName} сейчас нет партии. Когда привезут цыплят, начните новую партию — номер присвоится сам.</span>
            <Link className="btn primary" to={`/batch/new/${house.houseId}`}>+ Новая партия</Link>
          </div>
        </main></>
    );
  }
  const waybill = parseNum(f.waybill ?? '');
  const dead = parseNum(f.dead ?? '') ?? 0;
  const placed = waybill != null && !Number.isNaN(waybill) ? waybill - dead : null;

  async function save() {
    if (!placed || placed <= 0 || !f.placedOn) { setMsg('Укажите количество по накладной'); return; }
    const p: P = {
      id: hb?.houseBatchId ?? crypto.randomUUID(), houseId: house!.houseId, placedOn: f.placedOn!, hatchery: f.hatchery || null,
      waybillCount: waybill, transportDead: dead, placed, parentAgeWeeks: parseNum(f.parent ?? '') , day0WeightG: parseNum(f.w0 ?? ''),
      cloacalT: parseNum(f.ct ?? ''), cropFill: Object.fromEntries(Object.entries(crop).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])),
    };
    try { await sync.saveOp('placement', p); setMsg(`Сохранено: посажено ${fmtInt(placed)}`); }
    catch (e) { setMsg(`Не сохранилось: ${String((e as Error)?.message ?? e)}`); }
  }
  const field = (k: string, label: string, mode: 'numeric' | 'decimal' | 'text' = 'numeric') => (
    <label className="field"><span>{label}</span><input className={`input${mode === 'text' ? ' text' : ''}`} inputMode={mode === 'text' ? undefined : mode} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );

  return (
    <>
      <TopBar title={`Посадка · ${house.houseName}`} sub={`Партия ${hb.batchName} · ${fmtDayLong(hb.placedOn)}`} back="/more" />
      <main className="content">
        {picker}
        <section className="formrow" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <label className="field"><span>Дата посадки</span><input className="input text" type="date" value={f.placedOn ?? ''} onChange={(e) => setF({ ...f, placedOn: e.target.value })} /></label>
          {field('hatchery', 'Инкубаторий', 'text')}
          <div className="grid2">{field('waybill', 'По накладной')}{field('dead', 'Пало в дороге')}</div>
          <div className="banner info" style={{ margin: 0 }}>Посажено: <b className="num">{placed != null && !Number.isNaN(placed) ? fmtInt(placed) : '—'}</b></div>
          <div className="grid3">{field('parent', 'Возраст РС, нед.')}{field('w0', 'Масса суток, г', 'decimal')}{field('ct', 'Клоачная t', 'decimal')}</div>
          <span className="small muted">Норма клоачной t 39,4–40,5 °C</span>
        </section>
        <section className="formrow" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <span className="lbl">Наполнение зоба, % (30–40 цыплят)</span>
          <div className="grid3">
            {HOURS.map((h) => {
              const v = parseNum(crop[h] ?? '');
              const low = v != null && !Number.isNaN(v) && v < NORM[h]!;
              return <label key={h} className="field"><span>{h} ч · норма ≥ {NORM[h]}</span><input className={`input${low ? ' err' : ''}`} inputMode="numeric" value={crop[h] ?? ''} onChange={(e) => setCrop({ ...crop, [h]: e.target.value.replace(/\D/g, '') })} /></label>;
            })}
          </div>
        </section>
        {msg && <div className={`banner ${msg.startsWith('Сохранено') ? 'ok' : 'bad'}`} role="status">{msg}</div>}
        <div className="pad"><button className="btn primary big block" onClick={() => void save()}>Сохранить посадку</button></div>
        <p className="pad small muted">Цену цыплят вносит директор.</p>
      </main>
    </>
  );
}
