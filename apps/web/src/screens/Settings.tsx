import { useCallback, useEffect, useState } from 'react';
import { useSignedIn } from '../app';
import type { House, Worker } from '../api/types';
import { ApiError } from '../api/types';
import { PIN_RE } from '../api/phone';
import { TopBar } from '../ui/parts';

/** Head: houses and workers (T-07). Needs a connection: settings are not edited offline. */
export default function Settings() {
  const { api, sync } = useSignedIn();
  const [houses, setHouses] = useState<House[] | null>(null);
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [nh, setNh] = useState({ name: '', area: '1000', meter: true });
  const [nw, setNw] = useState({ name: '', phone: '', pin: '', houseIds: [] as string[] });

  const load = useCallback(async () => {
    try { setHouses(await api.listHouses()); setWorkers(await api.listWorkers()); }
    catch (e) { setMsg({ kind: 'bad', text: e instanceof ApiError ? e.message : 'Ошибка' }); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ kind: 'ok', text: ok }); await load(); void sync.refresh().catch(() => {}); }
    catch (e) { setMsg({ kind: 'bad', text: e instanceof ApiError ? e.message : 'Ошибка' }); }
  };
  const toggle = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  return (
    <>
      <TopBar title="Настройки" sub="Птичники и работники" />
      <main className="content">
        {msg && <div className={`banner ${msg.kind}`} role="status">{msg.text}</div>}

        <h2 className="pad" style={{ margin: 0, fontSize: 17 }}>Птичники</h2>
        <div className="section">
          {houses?.map((h) => (
            <div className="row" key={h.id}>
              <b style={{ width: 56 }}>{h.name}</b>
              <span className="num" style={{ flex: 1 }}>{h.areaM2} м²</span>
              <span className={`small ${h.hasWaterMeter ? 'ok-t' : 'warn-t'}`}>{h.hasWaterMeter ? '● водосчётчик' : '▲ нет водосчётчика'}</span>
            </div>
          ))}
          {houses === null && <div className="row muted">Загрузка…</div>}
        </div>
        <form className="card" style={{ margin: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}
          onSubmit={(e) => { e.preventDefault(); void run(() => api.createHouse({ name: nh.name.trim(), areaM2: Number(nh.area), hasWaterMeter: nh.meter, drinkerType: null, feederType: null }), `Добавлен ${nh.name}`).then(() => setNh({ name: '', area: '1000', meter: true })); }}>
          <strong>Добавить птичник</strong>
          <div className="grid2">
            <label className="field"><span>Название</span><input className="input text" required value={nh.name} onChange={(e) => setNh({ ...nh, name: e.target.value })} placeholder="П-5" /></label>
            <label className="field"><span>Площадь, м²</span><input className="input" required inputMode="numeric" value={nh.area} onChange={(e) => setNh({ ...nh, area: e.target.value.replace(/\D/g, '') })} /></label>
          </div>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}><input type="checkbox" checked={nh.meter} onChange={(e) => setNh({ ...nh, meter: e.target.checked })} style={{ width: 24, height: 24 }} />Есть водосчётчик</label>
          <button className="btn primary">Добавить</button>
        </form>

        <h2 className="pad" style={{ margin: '8px 0 0', fontSize: 17 }}>Работники</h2>
        <div className="section">
          {workers?.map((w) => (
            <div className="row" key={w.id} style={{ flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column' }}><b>{w.displayName}</b><span className="small muted">{w.phone}</span></span>
              <div className="chips">
                {houses?.map((h) => (
                  <button key={h.id} type="button" className={`chip${w.houseIds.includes(h.id) ? ' on' : ''}`} aria-pressed={w.houseIds.includes(h.id)}
                    onClick={() => void run(() => api.setWorkerHouses(w.id, toggle(w.houseIds, h.id)), `${w.displayName}: птичники обновлены`)}>{h.name}</button>
                ))}
              </div>
            </div>
          ))}
          {workers?.length === 0 && <div className="row muted">Пока нет работников</div>}
        </div>
        <form className="card" style={{ margin: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!PIN_RE.test(nw.pin)) { setMsg({ kind: 'bad', text: 'PIN — 6 цифр' }); return; }
            void run(() => api.inviteWorker({ displayName: nw.name.trim(), phone: nw.phone, pin: nw.pin, houseIds: nw.houseIds }), `Добавлен ${nw.name}. Передайте ему номер и PIN.`).then(() => setNw({ name: '', phone: '', pin: '', houseIds: [] }));
          }}>
          <strong>Добавить работника</strong>
          <label className="field"><span>Имя</span><input className="input text" required value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} /></label>
          <div className="grid2">
            <label className="field"><span>Телефон</span><input className="input text" type="tel" required value={nw.phone} onChange={(e) => setNw({ ...nw, phone: e.target.value })} placeholder="+996 …" /></label>
            <label className="field"><span>PIN для входа (6 цифр)</span><input className="input" inputMode="numeric" maxLength={6} required value={nw.pin} onChange={(e) => setNw({ ...nw, pin: e.target.value.replace(/\D/g, '') })} /></label>
          </div>
          <span className="small muted">Птичники</span>
          <div className="chips">
            {houses?.map((h) => <button key={h.id} type="button" className={`chip${nw.houseIds.includes(h.id) ? ' on' : ''}`} aria-pressed={nw.houseIds.includes(h.id)} onClick={() => setNw({ ...nw, houseIds: toggle(nw.houseIds, h.id) })}>{h.name}</button>)}
          </div>
          <button className="btn primary">Добавить работника</button>
        </form>
      </main>
    </>
  );
}
