import { useState } from 'react';
import { AA_NORMS, NORM_CODES, type NormCode } from '@farm/core';
import { useLive, useOnline, useSignedIn } from '../app';
import { ApiError } from '../api/types';
import { TopBar } from '../ui/parts';
import { parseNum } from '../ui/format';

/** Field names in the norm JSON → Russian labels for the editor. */
const LABEL: Record<string, string> = {
  day: 'день', whole: 'весь птичник', spot_edge: 'край брудера', spot_2m: '2 м от брудера', tolerance: 'допуск ±°C', t: 't при ОВ 40/50/60/70/80%',
  min_until_day: 'мин. ОВ до дня', min_pct: 'мин. ОВ %', max_from_day: 'макс. ОВ с дня', max_pct: 'макс. ОВ %', placement_pct: 'ОВ при посадке %',
  hours: 'часов', min: 'мин. %', cloacal_min: 't клоаки от', cloacal_max: 't клоаки до', air_c: 'воздух °C', floor_c: 'пол °C', litter_cm: 'подстилка см',
  paper_feed_g: 'корм на бумагу г/гол', day7_weight_x: 'масса 7 дн × суточная', from_day: 'с дня', to_day: 'по день', pellet_from_day: 'гранула с дня',
  whole_wheat_stop_days_before_catch: 'зерно стоп за дней до отлова', bell: 'колокольные', nipple_cup: 'ниппель с чашкой', nipple: 'ниппель',
  ref_temp: 'при t °C', per_degree: 'прибавка на 1 °C', water_c: 't воды °C', week1_warn_pct: '1 неделя: внимание %', week1_crit_pct: '1 неделя: тревога %',
  daily_max_pct: 'отход за сутки до %', spike_factor: 'скачок ×', sample_min: 'мин. выборка гол', sample_pct: 'выборка %', cv_good: 'CV хорошо до %',
  cv_max: 'CV предел %', group_until_day: 'групповое до дня', dark_h: 'темнота ч', lux: 'лк', before_catch_days: 'за дней до отлова',
  before_catch_light_h: 'свет ч', dark_lux_max: 'темнота макс. лк', nh3_ppm: 'NH₃ ppm', co2_ppm: 'CO₂ ppm', co_ppm: 'CO ppm', rh_pct: 'ОВ %',
  eu: 'ЕС', eu_high: 'ЕС повыш.', eu_max: 'ЕС макс.', hot_controlled: 'жаркий климат, закрытые', hot_open: 'жаркий климат, открытые',
  feed_withdrawal_h: 'снятие корма ч', rows: 'Таблица', rh: 'ОВ, %', light_before_days: 'свет за дней', kg: 'масса кг', m3h: 'м³/ч на гол', phase: 'рацион',
};
const SKIP = new Set(['title', 'note', '_source']);

type J = any;
function setAt(obj: J, path: (string | number)[], v: J): J {
  if (!path.length) return v;
  const [k, ...rest] = path;
  const copy = Array.isArray(obj) ? [...obj] : { ...obj };
  copy[k as any] = setAt(obj[k as any], rest, v);
  return copy;
}

/** A number (or null) input that keeps the text while typing. */
function NumIn({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  const [t, setT] = useState(value == null ? '' : String(value).replace('.', ','));
  return <input className="input" aria-label={label} inputMode="decimal" style={{ width: 72, fontSize: 16, padding: '4px 8px', minHeight: 40, height: 40 }} value={t}
    onChange={(e) => { setT(e.target.value); const n = parseNum(e.target.value); if (n === null || !Number.isNaN(n)) onChange(n); }} />;
}

function Value({ v, path, set, label }: { v: J; path: (string | number)[]; set: (p: (string | number)[], v: J) => void; label: string }) {
  if (typeof v === 'number' || v === null) return <NumIn value={v} label={label} onChange={(n) => set(path, n)} />;
  if (typeof v === 'string') return <span className="num">{v}</span>;
  if (Array.isArray(v) && v.every((x) => typeof x === 'number')) {
    return <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{v.map((x, i) => <NumIn key={i} value={x} label={`${label} ${i + 1}`} onChange={(n) => set([...path, i], n)} />)}</span>;
  }
  if (Array.isArray(v)) {
    const cols = Object.keys(v[0] ?? {});
    return (
      <div className="md-table"><table style={{ borderCollapse: 'collapse' }}>
        <thead><tr>{cols.map((c) => <th key={c} className="small muted" style={{ textAlign: 'left', padding: 4 }}>{LABEL[c] ?? c}</th>)}</tr></thead>
        <tbody>{v.map((row: J, i: number) => <tr key={i}>{cols.map((c) => <td key={c} style={{ padding: 2 }}><Value v={row[c]} path={[...path, i, c]} set={set} label={`${label}, строка ${i + 1}, ${LABEL[c] ?? c}`} /></td>)}</tr>)}</tbody>
      </table></div>
    );
  }
  return null;
}

/** Director: the farm's norms. Defaults are Arbor Acres; a change applies to every phone's checks after sync. */
export default function NormsEdit() {
  const { api, db, sync } = useSignedIn();
  const online = useOnline();
  const farmRows = useLive(() => db.norms.where('key').startsWith('farm:').toArray(), [db], []);
  const [open, setOpen] = useState<NormCode | null>(null);
  const [draft, setDraft] = useState<J>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = new Set(farmRows.map((r) => r.code));
  const current = (c: NormCode) => farmRows.find((r) => r.code === c)?.data ?? (AA_NORMS as J)[c];

  async function run(fn: () => Promise<void>, ok: string) {
    setMsg(null);
    try { await fn(); await sync.refreshKnowledge(); setMsg({ ok: true, text: ok }); setOpen(null); }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Ошибка' }); }
  }

  return (
    <>
      <TopBar title="Нормы фермы" sub="По умолчанию Arbor Acres" back="/handbook" />
      <main className="content">
        {!online && <div className="banner warn">Нет сети. Нормы меняются только онлайн.</div>}
        {msg && <div className={`banner ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
        <p className="pad small muted" style={{ margin: 0 }}>По этим числам телефон проверяет журнал дня у всех работников. Меняйте, если ваш кросс, климат или ветврач требуют других значений.</p>
        <div className="section">
          {NORM_CODES.map((c) => {
            const d = (AA_NORMS as J)[c];
            return (
              <div key={c}>
                <button className="row" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', font: 'inherit' }} aria-expanded={open === c}
                  onClick={() => { setMsg(null); if (open === c) setOpen(null); else { setOpen(c); setDraft(structuredClone(current(c))); } }}>
                  <span style={{ flex: 1, fontWeight: 500 }}>{d.title}</span>
                  {changed.has(c) && <span className="small warn-t">изменено</span>}
                  <span aria-hidden="true">{open === c ? '▾' : '›'}</span>
                </button>
                {open === c && draft && (
                  <div className="formrow" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {d.note && <span className="small muted">{d.note}</span>}
                    {Object.entries(draft).filter(([k]) => !SKIP.has(k)).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', flexDirection: Array.isArray(v) && typeof (v as J[])[0] === 'object' ? 'column' : 'row', gap: 8, justifyContent: 'space-between', alignItems: Array.isArray(v) && typeof (v as J[])[0] === 'object' ? 'stretch' : 'center' }}>
                        <span>{LABEL[k] ?? k}</span>
                        <Value v={v} path={[k]} label={LABEL[k] ?? k} set={(p, val) => setDraft((x: J) => setAt(x, p, val))} />
                      </div>
                    ))}
                    <button className="btn primary block" disabled={!online} onClick={() => void run(() => api.setNorm(c, draft), 'Норма сохранена. Телефоны получат её при синхронизации.')}>Сохранить для фермы</button>
                    {changed.has(c) && <button className="btn block" disabled={!online} onClick={() => void run(() => api.resetNorm(c), 'Возвращено значение Arbor Acres')}>Вернуть Arbor Acres</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}
