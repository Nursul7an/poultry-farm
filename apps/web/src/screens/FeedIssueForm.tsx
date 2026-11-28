import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSignedIn } from '../app';
import type { FeedIssue } from '../api/types';
import { TopBar } from '../ui/parts';
import { errText } from '../ui/people';
import { fmtDayShort, fmtInt, fmtNum, parseNum } from '../ui/format';
import { expiryState, FEED_KIND_RU, fifo, useWarehouse } from '../ui/feedStock';
import { useHouses } from './useHouses';

/** «Выдать корм в блок»: from a warehouse delivery (oldest expiry first) to a block's running batch. Works offline. */
export default function FeedIssueForm() {
  const { sync, today, session } = useSignedIn();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { houses } = useHouses();
  const { lots } = useWarehouse();
  const [hb, setHb] = useState<string | null>(params.get('hb'));
  const [lotId, setLotId] = useState<string | null>(params.get('lot'));
  const [mode, setMode] = useState<'bags' | 'kg'>('bags');
  const [qty, setQty] = useState('');
  const [on, setOn] = useState(today());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const block = houses.find((h) => h.houseBatchId === hb) ?? (houses.length === 1 ? houses[0] : undefined);
  const phase = block?.feedPhase ?? 'starter';
  // Matching feed type first, then the rest; each group oldest expiry first. Expired lots are not offered.
  const usable = lots.filter((l) => l.left > 0.05 && expiryState(l, today()) !== 'expired');
  const options = [...fifo(usable.filter((l) => l.feedType === phase)), ...fifo(usable.filter((l) => l.feedType !== phase))];
  const lot = options.find((l) => l.id === lotId) ?? options[0];
  const n = parseNum(qty);
  const byBags = mode === 'bags' && !!lot?.bagKg;
  const kg = n == null || Number.isNaN(n) ? null : byBags ? n * lot!.bagKg! : n;

  async function save() {
    if (!block) { setErr('Выберите блок'); return; }
    if (!lot) { setErr('На складе нет корма для выдачи'); return; }
    if (!kg || kg <= 0) { setErr('Укажите, сколько выдать'); return; }
    if (kg > lot.left + 0.05) { setErr(`В этой поставке осталось ${fmtInt(lot.left)} кг`); return; }
    if (!on || on > today() || on < block.placedOn) { setErr('Проверьте дату'); return; }
    setBusy(true);
    const issue: FeedIssue = { id: crypto.randomUUID(), lotId: lot.id, houseBatchId: block.houseBatchId, issuedOn: on, kg, note: null, createdBy: session.userId };
    try { await sync.saveOp('feed_issue', issue); nav('/feed', { replace: true }); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  }

  return (
    <>
      <TopBar title={`Выдать корм${block ? ` · ${block.houseName}` : ''}`} sub="Со склада в бункер блока" back="/feed" />
      <main className="content" style={{ paddingBottom: 130 }}>
        {!houses.length && <div className="banner info">Нет блоков с идущей партией.</div>}
        <section className="formrow">
          {houses.length > 1 && (
            <>
              <span className="lbl">Блок</span>
              <div className="chips" role="group" aria-label="Блок">
                {houses.map((h) => <button type="button" key={h.houseBatchId} className={`chip${block?.houseBatchId === h.houseBatchId ? ' on' : ''}`} aria-pressed={block?.houseBatchId === h.houseBatchId} onClick={() => { setHb(h.houseBatchId); setLotId(null); setErr(null); }}>{h.houseName}</button>)}
              </div>
            </>
          )}
          <span className="lbl">Из какой поставки</span>
          <div role="radiogroup" aria-label="Поставка" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {options.map((l, i) => {
              const st = expiryState(l, today());
              return (
                <label key={l.id} className={`lot-option${lot?.id === l.id ? ' on' : ''}`}>
                  <input type="radio" name="lot" checked={lot?.id === l.id} onChange={() => { setLotId(l.id); setErr(null); }} style={{ marginTop: 4 }} />
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <b style={{ fontWeight: 600 }}>{l.product ?? FEED_KIND_RU[l.feedType]} <span className={`kind-chip kind-${l.feedType}`}>{FEED_KIND_RU[l.feedType]}</span></b>
                    <span className="small num">
                      <span className="muted">Осталось {fmtInt(l.left)} кг · {l.storage ?? 'место не указано'} · </span>
                      <span className={st === 'soon' ? 'warn-t' : 'muted'}>{l.expiresOn ? `годен до ${fmtDayShort(l.expiresOn)}` : 'срок не указан'}</span>
                    </span>
                    {i === 0 && <span className="small ok-t">Выдавать первым{l.feedType === phase ? ` · подходит к рациону «${FEED_KIND_RU[phase]}»` : ''}</span>}
                    {l.feedType !== phase && block && <span className="small warn-t">Блок на рационе «{FEED_KIND_RU[phase]}»</span>}
                  </span>
                </label>
              );
            })}
            {!options.length && <div className="muted">Нет корма на складе (просроченный не предлагается).</div>}
          </div>

          <div className="seg" role="group" aria-label="Как считать">
            <button type="button" className={mode === 'bags' ? 'on' : ''} aria-pressed={mode === 'bags'} disabled={!lot?.bagKg} onClick={() => setMode('bags')}>Мешками{lot?.bagKg ? ` по ${fmtNum(lot.bagKg, 0)} кг` : ''}</button>
            <button type="button" className={mode === 'kg' || !lot?.bagKg ? 'on' : ''} aria-pressed={mode === 'kg' || !lot?.bagKg} onClick={() => setMode('kg')}>Килограммами</button>
          </div>
          <div className="grid2">
            <label className="field"><span>{byBags ? 'Мешков' : 'Кг'}</span><input className="input" inputMode="decimal" value={qty} onChange={(e) => { setQty(e.target.value); setErr(null); }} /></label>
            <label className="field"><span>Дата</span><input className="input text" type="date" max={today()} value={on} onChange={(e) => setOn(e.target.value)} /></label>
          </div>
          <span className="num" aria-live="polite">{kg ? <>Выдать: <b>{fmtInt(kg)} кг</b>{lot ? ` · останется ${fmtInt(Math.max(0, lot.left - kg))} кг` : ''}</> : <span className="muted">Выдать: —</span>}</span>
          {err && <div className="err-text" role="alert">{err}</div>}
        </section>
      </main>
      <div className="sticky-save">
        <button className="btn primary big block" disabled={busy || !lot || !block} onClick={() => void save()}>Выдать{kg ? ` ${fmtInt(kg)} кг` : ''}{block ? ` в ${block.houseName}` : ''}</button>
      </div>
    </>
  );
}
