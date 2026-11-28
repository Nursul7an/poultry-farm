import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addDays, withinWorkerEditWindow } from '@farm/core';
import { useLive, useSignedIn } from '../app';
import type { FeedKind, FeedLot } from '../api/types';
import { TopBar } from '../ui/parts';
import { errText } from '../ui/people';
import { fmtDayShort, fmtInt, fmtNum, parseNum } from '../ui/format';
import { FEED_KIND_RU, useWarehouse } from '../ui/feedStock';

const KINDS: FeedKind[] = ['starter', 'grower', 'finisher', 'other'];
const SHELF = [30, 60, 90, 120];

/** «Поступление корма» on the farm warehouse: what came, how much, dates, where it is stored. Works offline. */
export default function FeedLotForm() {
  const { id } = useParams();
  const { db } = useSignedIn();
  // Wait for the phone's copy of the lot before filling the form (editing).
  const raw = useLive(() => (id ? db.feedLots.get(id).then((x) => x ?? null) : Promise.resolve(null)), [db, id], undefined as FeedLot | null | undefined);
  if (raw === undefined) return <><TopBar title="Поставка корма" back="/feed" /><main className="content"><p className="pad muted">Загрузка…</p></main></>;
  if (id && !raw) return <><TopBar title="Поставка корма" back="/feed" /><main className="content"><p className="pad muted">Поставка не найдена</p></main></>;
  return <LotForm key={id ?? 'new'} lot={raw ?? undefined} />;
}

function LotForm({ lot }: { lot?: FeedLot }) {
  const { session, sync, today } = useSignedIn();
  const nav = useNavigate();
  const { lots } = useWarehouse();
  // Stock left comes from the warehouse view (all blocks); the form itself starts from the loaded lot.
  const existing = lot ? { ...lot, left: lots.find((l) => l.id === lot.id)?.left ?? lot.kg - (lot.issuedKg ?? 0) } : undefined;
  const head = session.role === 'head';
  const products = useMemo(() => [...new Set(lots.map((l) => l.product).filter(Boolean) as string[])], [lots]);
  const storages = useMemo(() => [...new Set(['Склад 1', ...lots.map((l) => l.storage).filter(Boolean) as string[]])], [lots]);

  const [f, setF] = useState(() => ({
    receivedOn: existing?.receivedOn ?? today(), feedType: (existing?.feedType ?? 'grower') as FeedKind, product: existing?.product ?? '',
    mode: (existing?.bagKg || !existing ? 'bags' : 'kg') as 'bags' | 'kg', bags: existing?.bags != null ? String(existing.bags) : '', bagKg: existing?.bagKg != null ? String(existing.bagKg).replace('.', ',') : '40',
    kg: existing ? String(existing.kg).replace('.', ',') : '', producedOn: existing?.producedOn ?? '', expiresOn: existing?.expiresOn ?? '',
    storage: existing?.storage ?? 'Склад 1', note: existing?.note ?? '', editReason: '',
  }));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const locked = !!existing?.createdAt && !withinWorkerEditWindow(new Date(existing.createdAt), new Date());
  const readOnly = locked && !head;
  const needReason = locked && head;
  const bags = parseNum(f.bags), bagKg = parseNum(f.bagKg), kgTyped = parseNum(f.kg);
  const kg = f.mode === 'bags' ? (bags != null && bagKg != null && !Number.isNaN(bags) && !Number.isNaN(bagKg) ? bags * bagKg : null) : kgTyped;
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setErr(null); setF({ ...f, [k]: v }); };
  const issued = existing ? existing.kg - existing.left : 0;

  async function save() {
    if (!kg || Number.isNaN(kg) || kg <= 0) { setErr(f.mode === 'bags' ? 'Укажите мешки и вес мешка' : 'Укажите количество, кг'); return; }
    if (kg < issued) { setErr(`Из этой поставки уже выдано ${fmtInt(issued)} кг`); return; }
    if (f.producedOn && f.expiresOn && f.expiresOn < f.producedOn) { setErr('«Годен до» раньше даты производства'); return; }
    if (!f.receivedOn || f.receivedOn > today()) { setErr('Проверьте дату поступления'); return; }
    if (needReason && !f.editReason.trim()) { setErr('Прошло больше 48 часов — укажите причину исправления'); return; }
    setBusy(true);
    const lot: FeedLot = {
      id: existing?.id ?? crypto.randomUUID(), receivedOn: f.receivedOn, feedType: f.feedType, product: f.product.trim() || null, kg,
      bags: f.mode === 'bags' ? bags : null, bagKg: f.mode === 'bags' ? bagKg : null, producedOn: f.producedOn || null, expiresOn: f.expiresOn || null,
      storage: f.storage.trim() || null, note: f.note.trim() || null, editReason: needReason ? f.editReason.trim() : null,
      createdAt: existing?.createdAt, createdBy: existing?.createdBy ?? session.userId,
    };
    try { await sync.saveOp('feed_lot', lot); nav('/feed', { replace: true }); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  }
  const shelf = (days: number) => set('expiresOn', addDays(f.producedOn || f.receivedOn, days));

  return (
    <>
      <TopBar title={existing ? (existing.product ?? 'Поставка корма') : 'Поступление корма'} sub={existing ? `Пришёл ${fmtDayShort(existing.receivedOn)} · выдано ${fmtInt(issued)} кг` : 'На склад фермы'} back="/feed" />
      <main className="content" style={{ paddingBottom: 130 }}>
        {readOnly && <div className="banner info">Прошло больше 48 часов — исправить может только директор.</div>}
        <fieldset className="formrow" disabled={readOnly} style={{ border: 0, margin: 0 }}>
          <span className="lbl">Тип корма</span>
          <div className="chips" role="group" aria-label="Тип корма">
            {KINDS.map((k) => <button type="button" key={k} className={`chip${f.feedType === k ? ' on' : ''}`} aria-pressed={f.feedType === k} onClick={() => set('feedType', k)}>{FEED_KIND_RU[k]}</button>)}
          </div>
          <label className="field"><span>Производитель, марка</span>
            <input className="input text" list="feed-products" value={f.product} placeholder="Агрокорм ПК-6 Рост" onChange={(e) => set('product', e.target.value)} />
            <datalist id="feed-products">{products.map((p) => <option key={p} value={p} />)}</datalist>
          </label>

          <span className="lbl">Количество</span>
          <div className="seg" role="group" aria-label="Как считать">
            <button type="button" className={f.mode === 'bags' ? 'on' : ''} aria-pressed={f.mode === 'bags'} onClick={() => set('mode', 'bags')}>Мешками</button>
            <button type="button" className={f.mode === 'kg' ? 'on' : ''} aria-pressed={f.mode === 'kg'} onClick={() => set('mode', 'kg')}>Килограммами (насыпью)</button>
          </div>
          {f.mode === 'bags' ? (
            <div className="grid2">
              <label className="field"><span>Мешков</span><input className="input" inputMode="numeric" value={f.bags} onChange={(e) => set('bags', e.target.value)} /></label>
              <label className="field"><span>Вес мешка, кг</span><input className="input" inputMode="decimal" value={f.bagKg} onChange={(e) => set('bagKg', e.target.value)} /></label>
            </div>
          ) : (
            <label className="field"><span>Всего, кг</span><input className="input" inputMode="decimal" value={f.kg} onChange={(e) => set('kg', e.target.value)} /></label>
          )}
          <span className="num" aria-live="polite">{kg && !Number.isNaN(kg) ? <>Итого: <b>{fmtInt(kg)} кг</b> ({fmtNum(kg / 1000, 2)} т)</> : <span className="muted">Итого: —</span>}</span>

          <div className="grid2">
            <label className="field"><span>Дата поступления</span><input className="input text" type="date" max={today()} value={f.receivedOn} onChange={(e) => set('receivedOn', e.target.value)} /></label>
            <label className="field"><span>Дата производства</span><input className="input text" type="date" value={f.producedOn} onChange={(e) => set('producedOn', e.target.value)} /></label>
          </div>
          <label className="field"><span>Годен до</span><input className="input text" type="date" value={f.expiresOn} onChange={(e) => set('expiresOn', e.target.value)} /></label>
          <div className="chips" aria-label="Срок хранения">
            {SHELF.map((d) => <button type="button" key={d} className="chip" onClick={() => shelf(d)}>{d} дн. от {f.producedOn ? 'производства' : 'поступления'}</button>)}
          </div>

          <label className="field"><span>Где хранится</span><input className="input text" value={f.storage} onChange={(e) => set('storage', e.target.value)} /></label>
          <div className="chips" aria-label="Места хранения">{storages.map((s) => <button type="button" key={s} className={`chip${f.storage === s ? ' on' : ''}`} onClick={() => set('storage', s)}>{s}</button>)}</div>
          <label className="field"><span>Примечание</span><input className="input text" value={f.note} placeholder="№ накладной, поставщик, состояние мешков…" onChange={(e) => set('note', e.target.value)} /></label>
          {needReason && <label className="field"><span>Причина исправления</span><input className="input text" value={f.editReason} onChange={(e) => set('editReason', e.target.value)} /></label>}
          {head && <span className="small muted">Цену за тонну укажите в «Деньги» — работники её не видят.</span>}
          {err && <div className="err-text" role="alert">{err}</div>}
        </fieldset>
      </main>
      {!readOnly && (
        <div className="sticky-save">
          <button className="btn primary big block" disabled={busy} onClick={() => void save()}>{existing ? 'Сохранить изменения' : 'Записать поступление'}</button>
          <span className="small muted">Без сети сохранится на телефоне и отправится позже.</span>
        </div>
      )}
    </>
  );
}
