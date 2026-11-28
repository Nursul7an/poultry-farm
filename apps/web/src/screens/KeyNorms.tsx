import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AA_NORMS, mergeNorms, type NormCode, type Norms } from '@farm/core';
import { useLive, useOnline, useSignedIn } from '../app';
import { TopBar } from '../ui/parts';
import { errText } from '../ui/people';
import { fmtNum, parseNum } from '../ui/format';

/**
 * Director: the 6 norms the app warns by, in plain words, next to the Arbor Acres value.
 * Everything else (temperature tables, light, ventilation…) is read-only in «Справочник».
 */
interface Field { key: string; code: NormCode; label: string; unit: string; get: (n: Norms) => number; set: (n: Norms, v: number) => Norms }
const FIELDS: Field[] = [
  { key: 'daily', code: 'mortality', label: 'Падёж за сутки, не больше', unit: '%', get: (n) => n.mortality.daily_max_pct, set: (n, v) => ({ ...n, mortality: { ...n.mortality, daily_max_pct: v } }) },
  { key: 'week1', code: 'mortality', label: 'Отход за 1-ю неделю: внимание', unit: '%', get: (n) => n.mortality.week1_warn_pct, set: (n, v) => ({ ...n, mortality: { ...n.mortality, week1_warn_pct: v } }) },
  { key: 'week1c', code: 'mortality', label: 'Отход за 1-ю неделю: тревога', unit: '%', get: (n) => n.mortality.week1_crit_pct, set: (n, v) => ({ ...n, mortality: { ...n.mortality, week1_crit_pct: v } }) },
  { key: 'temp', code: 'temp_by_age', label: 'Допуск температуры от цели', unit: '±°C', get: (n) => n.temp_by_age.tolerance, set: (n, v) => ({ ...n, temp_by_age: { ...n.temp_by_age, tolerance: v } }) },
  { key: 'wfLo', code: 'water_feed', label: 'Вода : корм, от (ниппели)', unit: 'л/кг', get: (n) => n.water_feed.nipple, set: (n, v) => ({ ...n, water_feed: { ...n.water_feed, nipple: v, nipple_cup: Math.round(((v + n.water_feed.bell) / 2) * 100) / 100 } }) },
  { key: 'wfHi', code: 'water_feed', label: 'Вода : корм, до (колокольные)', unit: 'л/кг', get: (n) => n.water_feed.bell, set: (n, v) => ({ ...n, water_feed: { ...n.water_feed, bell: v, nipple_cup: Math.round(((n.water_feed.nipple + v) / 2) * 100) / 100 } }) },
  { key: 'cv', code: 'weighing', label: 'Однородность (CV), не больше', unit: '%', get: (n) => n.weighing.cv_max, set: (n, v) => ({ ...n, weighing: { ...n.weighing, cv_max: v } }) },
  { key: 'fwLo', code: 'catch', label: 'Снять корм до отлова, от', unit: 'ч', get: (n) => n.catch.feed_withdrawal_h[0]!, set: (n, v) => ({ ...n, catch: { ...n.catch, feed_withdrawal_h: [v, n.catch.feed_withdrawal_h[1]!] } }) },
  { key: 'fwHi', code: 'catch', label: 'Снять корм до отлова, до', unit: 'ч', get: (n) => n.catch.feed_withdrawal_h[1]!, set: (n, v) => ({ ...n, catch: { ...n.catch, feed_withdrawal_h: [n.catch.feed_withdrawal_h[0]!, v] } }) },
];
/** 10 → «10», 0.1 → «0,1», 1.75 → «1,75» (trailing zeros only after the comma). */
export const show = (v: number) => (Number.isInteger(v) ? String(v) : fmtNum(v, 2).replace(/0+$/, '').replace(/,$/, ''));

export default function KeyNorms() {
  const { api, db, sync } = useSignedIn();
  const online = useOnline();
  const farmRows = useLive(() => db.norms.where('key').startsWith('farm:').toArray(), [db], []);
  const current = useMemo(() => mergeNorms(Object.fromEntries(farmRows.map((r) => [r.code as NormCode, r.data]))), [farmRows]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const value = (f: Field) => draft[f.key] ?? show(f.get(current));
  const changedFromAA = (f: Field) => { const v = parseNum(value(f)); return v != null && !Number.isNaN(v) && Math.abs(v - f.get(AA_NORMS)) > 1e-9; };
  const bad = FIELDS.filter((f) => { const v = parseNum(value(f)); return v == null || Number.isNaN(v) || v < 0; });

  async function save() {
    if (bad.length) { setMsg({ ok: false, text: `Проверьте: ${bad.map((f) => f.label).join(', ')}` }); return; }
    setBusy(true); setMsg(null);
    let next = current;
    for (const f of FIELDS) next = f.set(next, parseNum(value(f))!);
    try {
      for (const code of new Set(FIELDS.map((f) => f.code))) {
        const same = JSON.stringify(next[code]) === JSON.stringify(AA_NORMS[code]);
        const hasFarm = farmRows.some((r) => r.code === code);
        if (same && hasFarm) await api.resetNorm(code);
        else if (!same && JSON.stringify(next[code]) !== JSON.stringify(current[code])) await api.setNorm(code, next[code]);
      }
      await sync.refreshKnowledge();
      setDraft({});
      setMsg({ ok: true, text: 'Сохранено. Телефоны получат нормы при синхронизации.' });
    } catch (e) { setMsg({ ok: false, text: errText(e) }); }
    finally { setBusy(false); }
  }

  return (
    <>
      <TopBar title="Ключевые нормы" sub="Настройки фермы" back="/more" />
      <main className="content" style={{ paddingBottom: 120 }}>
        {!online && <div className="banner warn">Нет сети. Нормы меняются только онлайн.</div>}
        {msg && <div className={`banner ${msg.ok ? 'ok' : 'bad'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
        <p className="pad small muted" style={{ margin: 0 }}>По этим числам приложение предупреждает вас и работников. Рядом — значение Arbor Acres.</p>
        <div className="section">
          {FIELDS.map((f) => (
            <label key={f.key} className="row" style={{ gap: 12, background: changedFromAA(f) ? '#FFF8F1' : undefined }}>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 500 }}>{f.label}</span>
                <span className={`small ${changedFromAA(f) ? 'warn-t' : 'muted'}`}>
                  {changedFromAA(f) ? 'Изменено · ' : ''}Arbor Acres: {show(f.get(AA_NORMS))} {f.unit}
                  {changedFromAA(f) && <> · <button type="button" className="linkbtn" onClick={(e) => { e.preventDefault(); setDraft({ ...draft, [f.key]: show(f.get(AA_NORMS)) }); }}>вернуть</button></>}
                </span>
              </span>
              <input className="input" style={{ width: 88, fontSize: 18, textAlign: 'right' }} inputMode="decimal" aria-label={f.label} value={value(f)} onChange={(e) => { setMsg(null); setDraft({ ...draft, [f.key]: e.target.value }); }} />
              <span className="small muted" style={{ width: 36 }}>{f.unit}</span>
            </label>
          ))}
        </div>
        <Link to="/handbook" className="row" style={{ margin: '0 0', background: 'var(--color-bg-surface)' }}>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}><span style={{ fontWeight: 500 }}>Все таблицы Arbor Acres</span><span className="small muted">Температура по дням, свет, вентиляция, плотность — в «Справочнике»</span></span>
          <span aria-hidden="true">›</span>
        </Link>
      </main>
      <div className="sticky-save">
        <button className="btn primary big block" disabled={busy || !online || !Object.keys(draft).length} onClick={() => void save()}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
      </div>
    </>
  );
}
