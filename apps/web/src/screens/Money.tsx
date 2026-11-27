import { useCallback, useEffect, useState } from 'react';
import { batchMoney, COST_RU, FEED_TYPE_RU, type CostCategory } from '@farm/core';
import { useLive, useOnline, useSignedIn } from '../app';
import type { BatchInfo, Cost, Payment, Price } from '../api/types';
import { ApiError } from '../api/types';
import { TopBar } from '../ui/parts';
import { fmtDayShort, fmtInt, fmtNum, parseNum } from '../ui/format';

const CATS: CostCategory[] = ['energy', 'wages', 'litter', 'vet', 'transport', 'other'];

/**
 * Director only: prices for what the workers recorded (chicks, feed, medicine, sales), other costs and payments.
 * Finance lives on the server only (FR-23), so this screen needs a connection.
 */
export default function Money() {
  const { api, db, today } = useSignedIn();
  const online = useOnline();
  const hbs = useLive(() => db.houseBatches.toArray(), [db], []);
  const feed = useLive(() => db.feed.toArray(), [db], []);
  const health = useLive(() => db.health.toArray(), [db], []);
  const handovers = useLive(() => db.handovers.toArray(), [db], []);
  const [batch, setBatch] = useState<BatchInfo | null>(null);
  const [prices, setPrices] = useState<Price[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [input, setInput] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<{ cat: CostCategory; amount: string; comment: string }>({ cat: 'energy', amount: '', comment: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await api.currentBatch();
      setBatch(b);
      const [p, c, pay] = await Promise.all([api.prices(), b ? api.costs(b.id) : Promise.resolve([]), api.payments()]);
      setPrices(p); setCosts(c); setPayments(pay);
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Ошибка загрузки' }); }
  }, [api]);
  useEffect(() => { void load(); }, [load, online]);

  const price = (kind: Price['kind'], id: string) => prices.find((p) => p.kind === kind && p.refId === id)?.unitPrice ?? null;
  const waybill = hbs.reduce((a, h) => a + (h.waybillCount ?? h.placed), 0);
  const placed = hbs.reduce((a, h) => a + h.placed, 0);
  const treatments = health.filter((e) => e.kind === 'treatment');
  const paidFor = (id: string) => payments.filter((p) => p.handoverId === id).reduce((a, p) => a + p.amount, 0);
  const house = (hb: string) => hbs.find((h) => h.houseBatchId === hb)?.houseName ?? '';

  const money = batchMoney({
    chicks: batch ? [{ waybill, price: price('chick', batch.id) }] : [],
    feed: feed.map((f) => ({ tonnes: f.tonnes, pricePerT: price('feed', f.id) })),
    medicine: treatments.map((t) => ({ price: price('medicine', t.id) })),
    costs: costs.map((c) => ({ category: c.category, amount: c.amount })),
    sales: handovers.map((h) => ({ kg: h.kg, pricePerKg: price('sale', h.id), paid: paidFor(h.id) })),
    placed,
  });

  type Pending = { key: string; kind: Price['kind']; refId: string; what: string; who: string; qty: number; unit: string };
  const pending: Pending[] = [
    ...(batch && price('chick', batch.id) == null ? [{ key: 'chick', kind: 'chick' as const, refId: batch.id, what: `Цыплята партии ${batch.name}`, who: `${fmtInt(waybill)} по накладным`, qty: waybill, unit: 'за голову' }] : []),
    ...feed.filter((f) => price('feed', f.id) == null).map((f) => ({ key: f.id, kind: 'feed' as const, refId: f.id, what: `Корм ${house(f.houseBatchId)} · ${FEED_TYPE_RU[f.feedType]} ${fmtNum(f.tonnes)} т`, who: fmtDayShort(f.deliveredOn), qty: f.tonnes, unit: 'за тонну' })),
    ...treatments.filter((t) => price('medicine', t.id) == null).map((t) => ({ key: t.id, kind: 'medicine' as const, refId: t.id, what: `Лечение ${house(t.houseBatchId)} · ${t.product}`, who: fmtDayShort(t.eventOn), qty: 1, unit: 'за курс' })),
    ...handovers.filter((h) => price('sale', h.id) == null).map((h) => ({ key: h.id, kind: 'sale' as const, refId: h.id, what: `Сдача ${house(h.houseBatchId)} · ${h.buyer} · ${fmtInt(h.kg)} кг`, who: fmtDayShort(h.handedOn), qty: h.kg, unit: 'за кг' })),
  ];

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try { await fn(); await load(); setMsg({ ok: true, text: ok }); }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Ошибка' }); }
  }

  return (
    <>
      <TopBar title="Деньги" sub={`${batch ? `Партия ${batch.name}` : 'Нет открытой партии'} · только директор`} />
      <main className="content">
        {!online && <div className="banner warn">Нет сети. Деньги хранятся только на сервере — подключитесь, чтобы смотреть и вносить.</div>}
        {msg && <div className={`banner ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
        <div className="grid2 pad">
          <div className="tile"><div className="l">Затраты</div><div className="v">{fmtInt(money.totalCost)}</div></div>
          <div className="tile"><div className="l">На посаженную голову</div><div className="v">{fmtInt(money.perBirdPlaced)}</div></div>
          <div className="tile"><div className="l">Выручка · долг</div><div className="v">{fmtInt(money.revenue)}</div><div className={`small num ${money.owed > 0 ? 'warn-t' : 'muted'}`}>долг {fmtInt(money.owed)}</div></div>
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
          {!pending.length && <div className="row ok-t">Всё оценено ✔</div>}
        </div>

        <h2 className="pad" style={{ margin: 0, fontSize: 17 }}>Затраты по статьям</h2>
        <div className="section">
          {Object.entries(money.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <div className="row" key={k}><span style={{ flex: 1 }}>{COST_RU[k as CostCategory]}</span><span className="num">{fmtInt(v)}</span></div>
          ))}
        </div>
        <form className="card" style={{ margin: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}
          onSubmit={(e) => { e.preventDefault(); const a = parseNum(cost.amount); if (!a || !batch) return; void run(() => api.addCost({ batchId: batch.id, category: cost.cat, amount: a, spentOn: today(), comment: cost.comment || null }), 'Затрата добавлена').then(() => setCost({ ...cost, amount: '', comment: '' })); }}>
          <strong>Добавить затрату</strong>
          <div className="chips">{CATS.map((c) => <button type="button" key={c} className={`chip${cost.cat === c ? ' on' : ''}`} aria-pressed={cost.cat === c} onClick={() => setCost({ ...cost, cat: c })}>{COST_RU[c]}</button>)}</div>
          <div className="grid2">
            <label className="field"><span>Сумма</span><input className="input" inputMode="decimal" value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })} /></label>
            <label className="field"><span>Комментарий</span><input className="input text" value={cost.comment} onChange={(e) => setCost({ ...cost, comment: e.target.value })} /></label>
          </div>
          <button className="btn primary" disabled={!online || !batch}>Добавить</button>
        </form>

        <h2 className="pad" style={{ margin: 0, fontSize: 17 }}>Сдачи и оплаты</h2>
        <div className="section">
          {handovers.map((h) => {
            const pr = price('sale', h.id), sum = pr != null ? pr * h.kg : null, paid = paidFor(h.id), key = 'pay-' + h.id, v = parseNum(input[key] ?? '');
            return (
              <div className="row" key={h.id} style={{ flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column' }}><b style={{ fontWeight: 500 }}>{house(h.houseBatchId)} · {h.buyer}</b>
                  <span className="small muted num">{fmtInt(h.kg)} кг · {sum != null ? `сумма ${fmtInt(sum)}, оплачено ${fmtInt(paid)}, долг ${fmtInt(sum - paid)}` : 'нет цены'}</span></span>
                {sum != null && sum - paid > 0 && <>
                  <input className="input" style={{ width: 130, fontSize: 17 }} inputMode="decimal" aria-label="Оплата" placeholder="оплата" value={input[key] ?? ''} onChange={(e) => setInput({ ...input, [key]: e.target.value })} />
                  <button className="btn" disabled={!v || !online} onClick={() => void run(() => api.addPayment({ handoverId: h.id, amount: v!, paidOn: today(), comment: null }), 'Оплата записана')}>Оплата</button>
                </>}
              </div>
            );
          })}
          {!handovers.length && <div className="row muted">Сдач в этой партии пока нет</div>}
        </div>
        {money.profitPerKg != null && <p className="pad num">Прибыль на кг живого веса: <b>{fmtNum(money.profitPerKg)}</b> (без учёта неоценённых записей: {money.unpriced})</p>}
      </main>
    </>
  );
}
