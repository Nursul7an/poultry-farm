import { useCallback, useEffect, useMemo, useState } from 'react';
import { batchMoney, COST_RU, FEED_TYPE_RU, splitSharedCosts, type CostCategory } from '@farm/core';
import { useOnline, useSignedIn } from '../app';
import type { BatchRow, Cost, Payment, Price } from '../api/types';
import { TopBar } from '../ui/parts';
import { useBatchRecords } from '../ui/batchData';
import { FEED_KIND_RU, useWarehouse } from '../ui/feedStock';
import { errText } from '../ui/people';
import { fmtDayShort, fmtInt, fmtNum, parseNum } from '../ui/format';

const CATS: CostCategory[] = ['energy', 'wages', 'litter', 'vet', 'transport', 'other'];

/**
 * Director only (FR-23): money per batch (one block's cycle). Prices for what workers recorded, the batch's own costs,
 * its share of shared farm costs (split by chicks placed), sales and payments. Server only, so it needs a connection.
 */
export default function Money() {
  const { api, today } = useSignedIn();
  const online = useOnline();
  const [batches, setBatches] = useState<BatchRow[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [prices, setPrices] = useState<Price[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [input, setInput] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<{ cat: CostCategory; amount: string; comment: string; shared: boolean }>({ cat: 'energy', amount: '', comment: '', shared: true });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, p, c, pay] = await Promise.all([api.batches(), api.prices(), api.costs(), api.payments()]);
      setBatches(b); setPrices(p); setCosts(c); setPayments(pay);
    } catch (e) { setMsg({ ok: false, text: errText(e) }); }
  }, [api]);
  useEffect(() => { void load(); }, [load, online]);

  const ordered = useMemo(() => [...(batches ?? [])].sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.placedOn.localeCompare(a.placedOn)), [batches]);
  const batch = ordered.find((b) => b.id === sel) ?? ordered[0] ?? null;
  const { data, result, reload } = useBatchRecords(batch);
  const { lots } = useWarehouse();

  const price = (kind: Price['kind'], id: string) => prices.find((p) => p.kind === kind && p.refId === id)?.unitPrice ?? null;
  const paidFor = (id: string) => payments.filter((p) => p.handoverId === id).reduce((a, p) => a + p.amount, 0);
  const shared = costs.filter((c) => c.batchId == null);
  const split = useMemo(() => splitSharedCosts(shared, (batches ?? []).map((b) => ({ id: b.id, placed: b.placed, from: b.placedOn, to: b.closedAt }))), [shared, batches]);
  const myShares = batch ? split.shares.get(batch.id) ?? [] : [];
  const own = costs.filter((c) => batch && c.batchId === batch.id);

  const feed = data?.ops.feed ?? [], issues = data?.ops.issues ?? [], treatments = (data?.ops.health ?? []).filter((e) => e.kind === 'treatment'), handovers = data?.ops.handovers ?? [];
  const money = batch ? batchMoney({
    chicks: [{ waybill: batch.waybill, price: price('chick', batch.id) }],
    // Feed: what was issued to this block from the warehouse, at each delivery's price (+ old per-block deliveries).
    feed: [...feed.map((f) => ({ tonnes: f.tonnes, pricePerT: price('feed', f.id) })), ...issues.map((i) => ({ tonnes: i.kg / 1000, pricePerT: price('feed', i.lotId) }))],
    medicine: treatments.map((t) => ({ price: price('medicine', t.id) })),
    costs: [...own.map((c) => ({ category: c.category, amount: c.amount })), ...myShares.map((s) => ({ category: s.cost.category as CostCategory, amount: s.amount }))],
    sales: handovers.map((h) => ({ kg: h.kg, pricePerKg: price('sale', h.id), paid: paidFor(h.id) })),
    placed: batch.placed,
  }) : null;

  type Pending = { key: string; kind: Price['kind']; refId: string; what: string; who: string; qty: number; unit: string };
  const pending: Pending[] = batch ? [
    ...(price('chick', batch.id) == null ? [{ key: 'chick', kind: 'chick' as const, refId: batch.id, what: `Цыплята ${batch.number}`, who: `${fmtInt(batch.waybill)} по накладной`, qty: batch.waybill, unit: 'за голову' }] : []),
    ...lots.filter((l) => price('feed', l.id) == null).map((l) => ({ key: l.id, kind: 'feed' as const, refId: l.id, what: `Склад · ${FEED_KIND_RU[l.feedType]} ${fmtNum(l.kg / 1000)} т${l.product ? ` · ${l.product}` : ''}`, who: `пришёл ${fmtDayShort(l.receivedOn)}`, qty: l.kg / 1000, unit: 'за тонну' })),
    ...feed.filter((f) => price('feed', f.id) == null).map((f) => ({ key: f.id, kind: 'feed' as const, refId: f.id, what: `Корм · ${FEED_TYPE_RU[f.feedType]} ${fmtNum(f.tonnes)} т`, who: fmtDayShort(f.deliveredOn), qty: f.tonnes, unit: 'за тонну' })),
    ...treatments.filter((t) => price('medicine', t.id) == null).map((t) => ({ key: t.id, kind: 'medicine' as const, refId: t.id, what: `Лечение · ${t.product}`, who: fmtDayShort(t.eventOn), qty: 1, unit: 'за курс' })),
    ...handovers.filter((h) => price('sale', h.id) == null).map((h) => ({ key: h.id, kind: 'sale' as const, refId: h.id, what: `Сдача · ${h.buyer} · ${fmtInt(h.kg)} кг`, who: fmtDayShort(h.handedOn), qty: h.kg, unit: 'за кг' })),
  ] : [];

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try { await fn(); await load(); await reload(); setMsg({ ok: true, text: ok }); return true; }
    catch (e) { setMsg({ ok: false, text: errText(e) }); return false; }
  }
  const sharedShare = myShares.reduce((a, s) => a + s.amount, 0);

  return (
    <>
      <TopBar title="Деньги" sub="Только директор · по партиям" />
      <main className="content">
        {!online && <div className="banner warn">Нет сети. Деньги хранятся только на сервере — подключитесь, чтобы смотреть и вносить.</div>}
        {msg && <div className={`banner ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
        {batches && !batches.length && <div className="banner info">Партий ещё нет. Деньги считаются по партиям: начните партию в блоке («Ферма» → «+ Новая партия»).</div>}

        {!!ordered.length && (
          <div className="chips pad" role="group" aria-label="Партия">
            {ordered.map((b) => (
              <button key={b.id} className={`chip${batch?.id === b.id ? ' on' : ''}`} aria-pressed={batch?.id === b.id} onClick={() => { setSel(b.id); setMsg(null); }}>
                {b.number} · {b.houseName}{b.status === 'closed' ? ' · закрыта' : ''}
              </button>
            ))}
          </div>
        )}

        {batch && money && (
          <>
            <div className="grid2 pad">
              <div className="tile"><div className="l">Затраты партии</div><div className="v">{fmtInt(money.totalCost)}</div><div className="small muted num">на голову {fmtInt(money.perBirdPlaced)}</div></div>
              <div className="tile"><div className="l">Выручка · долг</div><div className="v">{fmtInt(money.revenue)}</div><div className={`small num ${money.owed > 0 ? 'warn-t' : 'muted'}`}>долг {fmtInt(money.owed)}</div></div>
              <div className="tile"><div className="l">Прибыль на кг</div><div className="v">{money.profitPerKg != null ? fmtNum(money.profitPerKg) : '—'}</div><div className="small muted">{result?.handedKg ? `${fmtInt(result.handedKg)} кг сдано` : 'сдачи ещё нет'}</div></div>
              <div className="tile" style={money.unpriced ? { borderColor: '#E7B98C' } : undefined}><div className="l">Без цены</div><div className={`v ${money.unpriced ? 'warn-t' : ''}`}>{money.unpriced}</div></div>
            </div>

            <h2 className="pad" style={{ margin: 0, fontSize: 17 }}>Нужна цена</h2>
            <div className="section">
              {pending.map((p) => {
                const v = parseNum(input[p.key] ?? '');
                return (
                  <div className="row" key={p.key} style={{ flexWrap: 'wrap' }}>
                    <span style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column' }}><b style={{ fontWeight: 500 }}>{p.what}</b><span className="small muted">{p.who}{v ? ` · сумма ${fmtInt(v * p.qty)}` : ''}</span></span>
                    <input className="input" style={{ width: 130, fontSize: 17 }} inputMode="decimal" aria-label={`${p.what}: цена ${p.unit}`} placeholder={p.unit} value={input[p.key] ?? ''} onChange={(e) => setInput({ ...input, [p.key]: e.target.value })} />
                    <button className="btn primary" disabled={!v || !online} onClick={() => void run(() => api.setPrice({ kind: p.kind, refId: p.refId, unitPrice: v! }), 'Цена сохранена')}>OK</button>
                  </div>
                );
              })}
              {!pending.length && <div className="row ok-t">{data ? 'Всё оценено ✔' : 'Загрузка…'}</div>}
            </div>

            <h2 className="pad" style={{ margin: 0, fontSize: 17 }}>Затраты партии по статьям</h2>
            <div className="section">
              {Object.entries(money.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <div className="row" key={k}><span style={{ flex: 1 }}>{COST_RU[k as CostCategory]}</span><span className="num">{fmtInt(v)}</span></div>
              ))}
              {!!sharedShare && <div className="row small muted"><span style={{ flex: 1 }}>в т.ч. доля общих затрат фермы (по посаженным головам)</span><span className="num">{fmtInt(sharedShare)}</span></div>}
            </div>
          </>
        )}

        {!!batches?.length && (
          <form className="card" style={{ margin: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }} aria-label="Добавить затрату"
            onSubmit={(e) => {
              e.preventDefault();
              const a = parseNum(cost.amount);
              if (!a) return;
              void run(() => api.addCost({ batchId: cost.shared ? null : batch!.id, category: cost.cat, amount: a, spentOn: today(), comment: cost.comment || null }), cost.shared ? 'Общая затрата добавлена — делится между партиями по посаженным' : `Затрата добавлена в ${batch!.number}`)
                .then((ok) => ok && setCost({ ...cost, amount: '', comment: '' }));
            }}>
            <strong>Добавить затрату</strong>
            <div className="seg" role="group" aria-label="На что">
              <button type="button" className={cost.shared ? 'on' : ''} aria-pressed={cost.shared} onClick={() => setCost({ ...cost, shared: true })}>Общая (вся ферма)</button>
              <button type="button" className={!cost.shared ? 'on' : ''} aria-pressed={!cost.shared} disabled={!batch} onClick={() => setCost({ ...cost, shared: false })}>Только {batch?.number ?? 'партия'}</button>
            </div>
            <div className="chips">{CATS.map((c) => <button type="button" key={c} className={`chip${cost.cat === c ? ' on' : ''}`} aria-pressed={cost.cat === c} onClick={() => setCost({ ...cost, cat: c })}>{COST_RU[c]}</button>)}</div>
            <div className="grid2">
              <label className="field"><span>Сумма</span><input className="input" inputMode="decimal" value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })} /></label>
              <label className="field"><span>Комментарий</span><input className="input text" value={cost.comment} onChange={(e) => setCost({ ...cost, comment: e.target.value })} /></label>
            </div>
            <span className="small muted">{cost.shared ? 'Свет, газ, зарплата… делятся между партиями, которые идут в этот день, пропорционально посаженным цыплятам.' : 'Только для этой партии (например, подстилка в этот блок).'}</span>
            <button className="btn primary" disabled={!online}>Добавить</button>
          </form>
        )}
        {split.unallocated > 0 && <p className="pad small warn-t">Не распределено {fmtInt(split.unallocated)}: общие затраты в дни, когда ни одна партия не шла.</p>}

        {batch && (
          <>
            <h2 className="pad" style={{ margin: 0, fontSize: 17 }}>Сдачи и оплаты · {batch.number}</h2>
            <div className="section">
              {handovers.map((h) => {
                const pr = price('sale', h.id), sum = pr != null ? pr * h.kg : null, paid = paidFor(h.id), key = 'pay-' + h.id, v = parseNum(input[key] ?? '');
                return (
                  <div className="row" key={h.id} style={{ flexWrap: 'wrap' }}>
                    <span style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column' }}><b style={{ fontWeight: 500 }}>{h.buyer} · {fmtDayShort(h.handedOn)}</b>
                      <span className="small muted num">{fmtInt(h.kg)} кг · {sum != null ? `сумма ${fmtInt(sum)}, оплачено ${fmtInt(paid)}, долг ${fmtInt(sum - paid)}` : 'нет цены'}</span></span>
                    {sum != null && sum - paid > 0 && <>
                      <input className="input" style={{ width: 130, fontSize: 17 }} inputMode="decimal" aria-label="Оплата" placeholder="оплата" value={input[key] ?? ''} onChange={(e) => setInput({ ...input, [key]: e.target.value })} />
                      <button className="btn" disabled={!v || !online} onClick={() => void run(() => api.addPayment({ handoverId: h.id, amount: v!, paidOn: today(), comment: null }), 'Оплата записана')}>Оплата</button>
                    </>}
                  </div>
                );
              })}
              {data && !handovers.length && <div className="row muted">Сдач в этой партии пока нет</div>}
            </div>
          </>
        )}
      </main>
    </>
  );
}
