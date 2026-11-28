/** Building blocks for the director's farm and people screens (setup wizard and «Ферма и люди»). */
import { useState } from 'react';
import type { FarmSettings, House } from '../api/types';
import { ApiError } from '../api/types';
import { normalizePhone } from '../api/phone';
import { nextBlockNames } from '../api/blocks';
import { fmtInt, parseNum } from './format';

export const TIMEZONES = [
  ['Asia/Bishkek', 'Бишкек (UTC+6)'], ['Asia/Almaty', 'Алматы (UTC+5)'], ['Asia/Tashkent', 'Ташкент (UTC+5)'],
  ['Asia/Dushanbe', 'Душанбе (UTC+5)'], ['Europe/Moscow', 'Москва (UTC+3)'],
] as const;

/** 6 random digits from the browser's secure generator. */
export function newPin(): string {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => String(x % 10)).join('');
}
export const fmtPhone = (p: string) => p.replace(/^\+996(\d{3})(\d{2})(\d{2})(\d{2})$/, '+996 $1 $2 $3 $4');
export const errText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Ошибка');
export const isKgPhone = (p: string) => /^\+996\d{9}$/.test(normalizePhone(p));

/** Run an action with a status line; returns true on success. */
export function useRun() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, ok?: string): Promise<boolean> {
    setBusy(true); setMsg(null);
    try { await fn(); if (ok) setMsg({ ok: true, text: ok }); return true; }
    catch (e) { setMsg({ ok: false, text: errText(e) }); return false; }
    finally { setBusy(false); }
  }
  const banner = msg && <div className={`banner ${msg.ok ? 'ok' : 'bad'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>;
  return { run, busy, banner, setMsg };
}

/** Link to the farm on a map (works on any phone without an API key). */
export const mapUrl = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`;

export function FarmForm({ farm, onSave, busy, submit = 'Сохранить', capacity }: {
  farm: FarmSettings; onSave: (f: FarmSettings) => void; busy?: boolean; submit?: string;
  /** Blocks and their total area, to show the farm's capacity. */
  capacity?: { blocks: number; areaM2: number };
}) {
  const [f, setF] = useState({ name: farm.name, tz: farm.tz, hour: String(farm.dayStartHour), region: farm.region ?? '', address: farm.address ?? '',
    lat: farm.lat ?? null as number | null, lng: farm.lng ?? null as number | null, density: String(farm.birdsPerM2 ?? 17).replace('.', ',') });
  const [gps, setGps] = useState<string | null>(null);
  const hour = Number(f.hour), density = parseNum(f.density);
  const ok = f.name.trim().length > 0 && f.name.trim().length <= 80 && Number.isInteger(hour) && hour >= 0 && hour <= 23 && density != null && !Number.isNaN(density) && density > 0 && density <= 40;
  function locate() {
    if (!navigator.geolocation) { setGps('Телефон не даёт местоположение'); return; }
    setGps('Определяю…');
    navigator.geolocation.getCurrentPosition(
      (p) => { setF((x) => ({ ...x, lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 })); setGps(null); },
      () => setGps('Не удалось определить. Разрешите доступ к местоположению или впишите адрес.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }
  return (
    <form className="formrow" aria-label="Ферма" onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ name: f.name.trim(), tz: f.tz, dayStartHour: hour, region: f.region.trim() || null, address: f.address.trim() || null, lat: f.lat, lng: f.lng, birdsPerM2: density! }); }}>
      <label className="field"><span>Название фермы</span><input className="input text" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <div className="grid2">
        <label className="field"><span>Область, район</span><input className="input text" value={f.region} placeholder="Чуйская обл., Аламединский р-н" onChange={(e) => setF({ ...f, region: e.target.value })} /></label>
        <label className="field"><span>Адрес</span><input className="input text" value={f.address} placeholder="с. Кант, ул. …" onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={locate}>Отметить, где я сейчас</button>
        {f.lat != null && f.lng != null
          ? <span className="small num">{f.lat}, {f.lng} · <a href={mapUrl(f.lat, f.lng)} target="_blank" rel="noreferrer">на карте</a> · <button type="button" className="linkbtn" onClick={() => setF({ ...f, lat: null, lng: null })}>убрать</button></span>
          : <span className="small muted">Точка на карте — нажмите, стоя на ферме</span>}
        {gps && <span className="small warn-t" role="status">{gps}</span>}
      </div>
      <div className="grid2">
        <label className="field"><span>Голов на м² (вместимость)</span><input className="input" inputMode="decimal" value={f.density} onChange={(e) => setF({ ...f, density: e.target.value })} /></label>
        <label className="field"><span>Сутки начинаются в (час)</span><input className="input" inputMode="numeric" value={f.hour} onChange={(e) => setF({ ...f, hour: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></label>
      </div>
      {capacity && (
        <span className="small num">Блоков: <b>{capacity.blocks}</b> · площадь <b>{fmtInt(capacity.areaM2)} м²</b> · вместимость ≈ <b>{fmtInt(capacity.areaM2 * (density && !Number.isNaN(density) ? density : 0))} голов</b> за партию</span>
      )}
      <label className="field"><span>Часовой пояс</span>
        <select className="input text" value={f.tz} onChange={(e) => setF({ ...f, tz: e.target.value })}>
          {TIMEZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {!TIMEZONES.some(([v]) => v === f.tz) && <option value={f.tz}>{f.tz}</option>}
        </select>
      </label>
      <span className="small muted">Журнал дня считается с {String(ok ? hour : 8).padStart(2, '0')}:00 до {String(ok ? hour : 8).padStart(2, '0')}:00 следующего дня.</span>
      <button className="btn primary block" disabled={!ok || busy}>{submit}</button>
    </form>
  );
}

/** Adds N blocks named «Блок A», «Блок B»… (skipping letters already used). */
export function AddHouses({ existing, onAdd, busy }: { existing: House[]; onAdd: (names: string[], areaM2: number, meter: boolean) => void; busy?: boolean }) {
  const [n, setN] = useState(existing.length ? 1 : 4);
  const [area, setArea] = useState('1000');
  const [meter, setMeter] = useState(true);
  const a = parseNum(area);
  const names = nextBlockNames(existing, n);
  const ok = n >= 1 && n <= 20 && a != null && !Number.isNaN(a) && a > 0;
  return (
    <form className="formrow" aria-label="Добавить блоки" onSubmit={(e) => { e.preventDefault(); if (ok) onAdd(names, a!, meter); }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1, fontWeight: 600 }}>{existing.length ? 'Добавить блоков' : 'Блоков (кашаров) на ферме'}</span>
        <div className="stepper" style={{ width: 160 }}>
          <button type="button" aria-label="Меньше" onClick={() => setN(Math.max(1, n - 1))}>−</button>
          <input aria-label="Сколько блоков" inputMode="numeric" value={n} onChange={(e) => setN(Math.min(20, Number(e.target.value.replace(/\D/g, '') || 1)))} style={{ fontSize: 22 }} />
          <button type="button" aria-label="Больше" onClick={() => setN(Math.min(20, n + 1))}>+</button>
        </div>
      </div>
      <div className="chips" aria-label="Будут добавлены">{names.map((x) => <span key={x} className="chip" style={{ cursor: 'default' }}>{x}</span>)}</div>
      <div className="grid2">
        <label className="field"><span>Площадь каждого, м²</span><input className="input" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', alignSelf: 'end', minHeight: 48 }}><input type="checkbox" checked={meter} onChange={(e) => setMeter(e.target.checked)} /> Есть водосчётчик</label>
      </div>
      <button className="btn primary block" disabled={!ok || busy}>Добавить: {names.join(', ')}</button>
      <span className="small muted">Название, площадь и счётчик каждого блока можно поменять потом. Партии начинают, когда привозят цыплят.</span>
    </form>
  );
}

export interface NewWorker { displayName: string; phone: string; pin: string; houseIds: string[] }
export function WorkerForm({ houses, onAdd, busy }: { houses: House[]; onAdd: (w: NewWorker) => Promise<boolean>; busy?: boolean }) {
  const blank = (): NewWorker => ({ displayName: '', phone: '+996 ', pin: newPin(), houseIds: [] });
  const [w, setW] = useState<NewWorker>(blank);
  const ok = w.displayName.trim().length > 0 && isKgPhone(w.phone) && /^\d{6}$/.test(w.pin);
  const toggle = (id: string) => setW({ ...w, houseIds: w.houseIds.includes(id) ? w.houseIds.filter((x) => x !== id) : [...w.houseIds, id] });
  return (
    <form className="formrow" aria-label="Новый работник" onSubmit={(e) => { e.preventDefault(); if (ok) void onAdd(w).then((done) => { if (done) setW(blank()); }); }}>
      <label className="field"><span>Имя</span><input className="input text" value={w.displayName} maxLength={60} onChange={(e) => setW({ ...w, displayName: e.target.value })} placeholder="Айгуль Т." /></label>
      <div className="grid2">
        <label className="field"><span>Телефон</span><input className="input" type="tel" inputMode="tel" value={w.phone} onChange={(e) => setW({ ...w, phone: e.target.value })} /></label>
        <label className="field"><span>PIN (6 цифр)</span><input className="input" inputMode="numeric" value={w.pin} onChange={(e) => setW({ ...w, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></label>
      </div>
      <span className="small muted">Блоки работника</span>
      <div className="chips" role="group" aria-label="Блоки работника">
        {houses.filter((h) => h.active !== false).map((h) => <button key={h.id} type="button" className={`chip${w.houseIds.includes(h.id) ? ' on' : ''}`} aria-pressed={w.houseIds.includes(h.id)} onClick={() => toggle(h.id)}>{h.name}</button>)}
      </div>
      {!w.houseIds.length && <span className="small warn-t">Без блоков работник ничего не увидит — отметьте хотя бы один.</span>}
      <button className="btn primary block" disabled={!ok || busy}>Добавить работника</button>
    </form>
  );
}

/** Shown once after creating a worker or setting a new PIN. */
export function PinCard({ name, phone, pin, onClose }: { name: string; phone: string; pin: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = location.origin + import.meta.env.BASE_URL;
  const text = `${name}, вход в приложение фермы:\n${link}\nТелефон: ${fmtPhone(phone)}\nPIN: ${pin}\nPIN можно поменять в «Ещё → Отправка и PIN».`;
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  }
  return (
    <section className="card" role="dialog" aria-label="Данные для входа" style={{ margin: '0 16px', display: 'flex', flexDirection: 'column', gap: 8, borderColor: 'var(--color-accent)' }}>
      <b>Данные для входа · {name}</b>
      <span className="num" style={{ fontSize: 20 }}>{fmtPhone(phone)}</span>
      <span className="num" style={{ fontSize: 34, fontWeight: 700, letterSpacing: 4 }} aria-label="PIN">{pin}</span>
      <span className="small muted">PIN показывается один раз. Передайте его работнику; если забудет — выдайте новый.</span>
      <button type="button" className="btn primary block" onClick={() => void copy()}>{copied ? 'Скопировано ✔' : 'Скопировать для WhatsApp'}</button>
      <button type="button" className="btn block" onClick={onClose}>Готово</button>
    </section>
  );
}
