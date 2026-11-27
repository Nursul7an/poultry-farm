import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { addDays, dayOfAge, liveBirds, plausibilityIssues, validationErrors, waterLitres, withinWorkerEditWindow, type CullReason, type PlausibilityIssue } from '@farm/core';
import { useLive, useSignedIn } from '../app';
import type { LogRecord } from '../api/types';
import { Sheet, TopBar } from '../ui/parts';
import { CULL_REASONS, fmtDayLong, fmtInt, fmtNum, parseNum } from '../ui/format';
import { useHouseLogs } from './useHouses';

interface Form {
  deaths: number; culls: number; cullReason: CullReason | null;
  feedMode: 'kg' | 'bags'; feed: string; bags: string; bagKg: string;
  meter: string; newMeter: boolean; tMin: string; tMax: string; rh: string; note: string; editReason: string;
}
const BAG_KEY = 'farm-bag-kg';
const empty = (): Form => ({
  deaths: 0, culls: 0, cullReason: null, feedMode: 'kg', feed: '', bags: '', bagKg: (() => { try { return localStorage.getItem(BAG_KEY) ?? '40'; } catch { return '40'; } })(),
  meter: '', newMeter: false, tMin: '', tMax: '', rh: '', note: '', editReason: '',
});
const s = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));
const fromLog = (l: LogRecord): Form => ({ ...empty(), deaths: l.deaths, culls: l.culls, cullReason: l.cullReason, feed: s(l.feedKg), meter: s(l.waterMeter), newMeter: l.newMeter, tMin: s(l.tMin), tMax: s(l.tMax), rh: s(l.rh), note: l.note ?? '' });

export default function DailyLog() {
  const { hb = '', day = '' } = useParams();
  const { session, db, sync, today } = useSignedIn();
  const house = useLive(() => db.houseBatches.get(hb), [db, hb], undefined);
  const logs = useHouseLogs(hb);
  const existing = logs.find((l) => l.productionDay === day);
  const [form, setForm] = useState<Form | null>(null);
  const [confirm, setConfirm] = useState<PlausibilityIssue[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const outbox = useLive(() => db.outbox.toArray(), [db], []);
  const draftKey = `${hb}|${day}`;

  // Load: the stored log, else an autosaved draft, else empty.
  useEffect(() => {
    if (form || !house) return;
    if (existing) { setForm(fromLog(existing)); return; }
    db.drafts.get(draftKey).then((d) => setForm(d ? { ...empty(), ...(d.values as Partial<Form>) } : empty()));
  }, [house, existing, form, db, draftKey]);

  const set = (patch: Partial<Form>) => setForm((f) => {
    const next = { ...f!, ...patch };
    if (!existing) void db.drafts.put({ key: draftKey, houseBatchId: hb, productionDay: day, values: next, savedAt: new Date().toISOString() });
    return next;
  });

  const prevWithMeter = useMemo(() => logs.filter((l) => l.productionDay < day && l.waterMeter != null).sort((a, b) => b.productionDay.localeCompare(a.productionDay))[0], [logs, day]);
  const history = useMemo(() => logs.filter((l) => l.productionDay < day).slice(0, 7).map((l) => ({ deaths: l.deaths, culls: l.culls, feedKg: l.feedKg, waterL: l.waterL })), [logs, day]);

  if (!house || !form) return <><TopBar title="Журнал дня" back="/today" /><main className="content"><p className="pad muted">Загрузка…</p></main></>;

  const isHead = session.role === 'head';
  const todayD = today();
  const age = dayOfAge(house.placedOn, day);
  const live = liveBirds(house.placed, logs.filter((l) => l.productionDay < day));
  const tooOld = !existing && !isHead && day < addDays(todayD, -2);
  const future = day > todayD;
  const lockedForWorker = !!existing?.createdAt && !withinWorkerEditWindow(new Date(existing.createdAt), new Date());
  const readOnly = future || tooOld || (lockedForWorker && !isHead);
  const needReason = lockedForWorker && isHead;

  const feedKg = form.feedMode === 'kg' ? parseNum(form.feed) : (() => { const b = parseNum(form.bags), k = parseNum(form.bagKg); return b == null || k == null ? null : b * k; })();
  const meter = parseNum(form.meter);
  const water = house.hasWaterMeter ? waterLitres(prevWithMeter?.waterMeter ?? null, meter, form.newMeter) : { litres: null, needsNewMeterConfirm: false };
  const ratio = water.litres != null && feedKg ? water.litres / feedKg : null;

  function buildRecord(): LogRecord | null {
    const nums = { feedKg, meter, tMin: parseNum(form!.tMin), tMax: parseNum(form!.tMax), rh: parseNum(form!.rh) };
    const errs: string[] = [];
    if (Object.values(nums).some((v) => Number.isNaN(v))) errs.push('Проверьте числа: только цифры и запятая');
    const input = { deaths: form!.deaths, culls: form!.culls, cullReason: form!.cullReason, feedKg: nums.feedKg, waterMeter: house!.hasWaterMeter ? nums.meter : null, newMeter: form!.newMeter, tMin: nums.tMin, tMax: nums.tMax, rh: nums.rh };
    errs.push(...validationErrors(input));
    if (water.needsNewMeterConfirm) errs.push('Показание меньше прошлого. Если счётчик заменили — отметьте «Новый счётчик»');
    if (needReason && !form!.editReason.trim()) errs.push('Прошло больше 48 часов — укажите причину исправления');
    setErrors(errs);
    if (errs.length) return null;
    return {
      id: existing?.id ?? crypto.randomUUID(), houseBatchId: hb, productionDay: day, ...input,
      cullReason: input.culls > 0 ? input.cullReason ?? null : null, waterL: water.litres, note: form!.note.trim() || null,
      editReason: needReason ? form!.editReason.trim() : null, createdAt: existing?.createdAt, updatedAt: new Date().toISOString(), createdBy: existing?.createdBy ?? session.userId,
    };
  }

  async function save(force = false) {
    const rec = buildRecord();
    if (!rec) return;
    if (!force) {
      const issues = plausibilityIssues(rec, water.litres, history);
      if (issues.length) { setConfirm(issues); return; }
    }
    setConfirm(null);
    if (form!.feedMode === 'bags') try { localStorage.setItem(BAG_KEY, form!.bagKg); } catch { /* ignore */ }
    await sync.saveLog(rec);
    setSavedId(rec.id);
  }

  const back = isHead ? '/farm' : '/today';
  const title = `Журнал · ${house.houseName} · день ${age}`;

  if (savedId) {
    const o = outbox.find((x) => x.logId === savedId);
    const stored = logs.find((l) => l.productionDay === day);
    return (
      <>
        <TopBar title={title} sub={fmtDayLong(day)} back={back} />
        <main className="content">
          <div className={`banner ${o?.status === 'rejected' ? 'bad' : o ? 'info' : 'ok'}`} role="status" aria-live="polite">
            <strong style={{ fontSize: 18 }}>{o?.status === 'rejected' ? 'Не принято сервером' : o ? 'Сохранено на телефоне' : 'Журнал сохранён и отправлен'}</strong><br />
            {o?.status === 'rejected' ? o.error : o ? 'Отправится автоматически, когда появится связь.' : 'Директор видит данные.'}
          </div>
          {stored && (
            <div className="section">
              <div className="row"><span style={{ flex: 1 }}>Падёж + брак</span><span className="num">{stored.deaths} + {stored.culls}</span></div>
              <div className="row"><span style={{ flex: 1 }}>Корм</span><span className="num">{fmtInt(stored.feedKg)} кг{stored.feedKg ? ` · ${fmtInt((stored.feedKg / live) * 1000)} г/гол` : ''}</span></div>
              {house.hasWaterMeter && <div className="row"><span style={{ flex: 1 }}>Вода</span><span className="num">{stored.waterL != null ? `${fmtInt(stored.waterL)} л` : '—'}{ratio != null ? ` · вода:корм ${fmtNum(ratio, 2)}` : ''}</span></div>}
              <div className="row"><span style={{ flex: 1 }}>t мин / макс · ОВ</span><span className="num">{fmtNum(stored.tMin)} / {fmtNum(stored.tMax)} · {fmtNum(stored.rh, 0)}%</span></div>
            </div>
          )}
          <p className="pad small muted">Проверка по нормам Arbor Acres появится в фазе 2.</p>
          <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Link className="btn primary block" to={back}>Готово</Link>
            <button className="btn block" onClick={() => { setSavedId(null); setForm(null); }}>Изменить</button>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar title={title} sub={`${fmtDayLong(day)} · поголовье ${fmtInt(live)}`} back={back} />
      <main className="content" style={{ gap: 0 }}>
        {readOnly && (
          <div className="banner warn" style={{ margin: '0 16px 12px' }} role="status">
            {future ? 'Этот день ещё не наступил.' : tooOld ? 'Старые дни заполняет директор.' : 'Прошло больше 48 часов — исправить может только директор.'}
          </div>
        )}
        <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="formrow" style={{ borderTop: 0 }}>
            <span className="lbl" id="deaths-l">Падёж, голов</span>
            <div className="stepper">
              <button type="button" aria-label="Падёж минус один" onClick={() => set({ deaths: Math.max(0, form.deaths - 1) })}>−</button>
              <input aria-labelledby="deaths-l" inputMode="numeric" value={form.deaths} onChange={(e) => set({ deaths: Number(e.target.value.replace(/\D/g, '') || 0) })} />
              <button type="button" aria-label="Падёж плюс один" onClick={() => set({ deaths: form.deaths + 1 })}>+</button>
            </div>
          </div>
          <div className="formrow">
            <span className="lbl" id="culls-l">Выбраковка, голов</span>
            <div className="stepper">
              <button type="button" aria-label="Брак минус один" onClick={() => set({ culls: Math.max(0, form.culls - 1) })}>−</button>
              <input aria-labelledby="culls-l" inputMode="numeric" value={form.culls} onChange={(e) => set({ culls: Number(e.target.value.replace(/\D/g, '') || 0) })} />
              <button type="button" aria-label="Брак плюс один" onClick={() => set({ culls: form.culls + 1 })}>+</button>
            </div>
            {form.culls > 0 && (
              <div className="chips" role="group" aria-label="Причина выбраковки">
                {CULL_REASONS.map((r) => <button type="button" key={r.value} className={`chip${form.cullReason === r.value ? ' on' : ''}`} aria-pressed={form.cullReason === r.value} onClick={() => set({ cullReason: r.value })}>{r.label}</button>)}
              </div>
            )}
          </div>
          <div className="formrow">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="lbl">Корм выдан</span>
              <div className="seg" style={{ width: 160 }}>
                <button type="button" className={form.feedMode === 'kg' ? 'on' : ''} onClick={() => set({ feedMode: 'kg' })}>кг</button>
                <button type="button" className={form.feedMode === 'bags' ? 'on' : ''} onClick={() => set({ feedMode: 'bags' })}>мешки</button>
              </div>
            </div>
            {form.feedMode === 'kg' ? (
              <input className="input" aria-label="Корм, кг" inputMode="decimal" placeholder="кг" value={form.feed} onChange={(e) => set({ feed: e.target.value })} />
            ) : (
              <div className="grid2">
                <label className="field"><span>Мешков</span><input className="input" inputMode="numeric" value={form.bags} onChange={(e) => set({ bags: e.target.value })} /></label>
                <label className="field"><span>кг в мешке</span><input className="input" inputMode="decimal" value={form.bagKg} onChange={(e) => set({ bagKg: e.target.value })} /></label>
              </div>
            )}
            <span className="small muted num">{feedKg ? `${fmtInt(feedKg)} кг · ${fmtInt((feedKg / live) * 1000)} г на голову` : ''}</span>
          </div>
          {house.hasWaterMeter && (
            <div className="formrow">
              <label className="field"><span className="lbl" style={{ color: 'inherit' }}>Водосчётчик, м³</span>
                <input className={`input${water.needsNewMeterConfirm && !form.newMeter ? ' err' : ''}`} inputMode="decimal" value={form.meter} onChange={(e) => set({ meter: e.target.value })} />
              </label>
              <span className="small muted num">
                {prevWithMeter ? `Прошлое показание ${fmtNum(prevWithMeter.waterMeter, 2)}` : 'Первое показание в партии'}
                {water.litres != null ? ` → расход ${fmtInt(water.litres)} л${ratio != null ? ` · вода:корм ${fmtNum(ratio, 2)}` : ''}` : ''}
              </span>
              {(water.needsNewMeterConfirm || form.newMeter) && (
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}>
                  <input type="checkbox" checked={form.newMeter} onChange={(e) => set({ newMeter: e.target.checked })} style={{ width: 24, height: 24 }} />
                  Новый счётчик (заменили или сбросили)
                </label>
              )}
            </div>
          )}
          <div className="formrow">
            <span className="lbl">Микроклимат</span>
            <div className="grid3">
              <label className="field"><span>t мин, °C</span><input className="input" inputMode="decimal" value={form.tMin} onChange={(e) => set({ tMin: e.target.value })} /></label>
              <label className="field"><span>t макс, °C</span><input className="input" inputMode="decimal" value={form.tMax} onChange={(e) => set({ tMax: e.target.value })} /></label>
              <label className="field"><span>ОВ, %</span><input className="input" inputMode="decimal" value={form.rh} onChange={(e) => set({ rh: e.target.value })} /></label>
            </div>
          </div>
          <div className="formrow">
            <label className="field"><span className="lbl" style={{ color: 'inherit' }}>Заметка</span>
              <textarea className="input text" style={{ height: 72, paddingTop: 10 }} value={form.note} onChange={(e) => set({ note: e.target.value })} />
            </label>
          </div>
          {needReason && (
            <div className="formrow">
              <label className="field"><span className="lbl" style={{ color: 'inherit' }}>Причина исправления (прошло больше 48 ч)</span>
                <input className="input text" value={form.editReason} onChange={(e) => set({ editReason: e.target.value })} />
              </label>
            </div>
          )}
        </fieldset>
        {errors.length > 0 && <div className="banner bad" role="alert" style={{ margin: '12px 16px 0' }}>{errors.map((e) => <div key={e}>{e}</div>)}</div>}
        {!readOnly && (
          <div className="pad" style={{ paddingTop: 16 }}>
            <button className="btn primary big block" onClick={() => void save()}>Сохранить журнал</button>
          </div>
        )}
      </main>

      {confirm && (
        <Sheet title="Это верно?" onClose={() => setConfirm(null)}>
          {confirm.map((i) => <div key={i.field + i.kind} style={{ fontSize: 15, lineHeight: 1.45 }}>{i.message}</div>)}
          <button className="btn danger block" onClick={() => void save(true)}>Да, верно — сохранить</button>
          <button className="btn block" onClick={() => setConfirm(null)}>Исправить</button>
        </Sheet>
      )}
    </>
  );
}
