import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLive, useOnline, useSignedIn } from '../app';
import type { House, Worker } from '../api/types';
import { TopBar } from '../ui/parts';
import { AddHouses, FarmForm, fmtPhone, isKgPhone, newPin, PinCard, TIMEZONES, useRun, WorkerForm, type NewWorker } from '../ui/people';
import { fmtDayShort, parseNum } from '../ui/format';

/** Houses and workers from the server (director only; needs a connection). */
export function usePeople() {
  const { api } = useSignedIn();
  const online = useOnline();
  const [houses, setHouses] = useState<House[] | null>(null);
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { const [h, w] = await Promise.all([api.listHouses(), api.listWorkers()]); setHouses(h); setWorkers(w); setError(null); }
    catch { setError('Нет связи с сервером. Настройка фермы и людей работает только онлайн.'); }
  }, [api]);
  useEffect(() => { void reload(); }, [reload, online]);
  return { houses, workers, reload, error, online };
}

const NeedNet = () => <div className="banner warn">Нет сети. Настройка фермы и людей работает только онлайн — подключитесь.</div>;

/** «Ферма и люди»: the director's farm, houses and workers. */
export default function People() {
  const { api, session, setSession, sync } = useSignedIn();
  const { houses, workers, reload, error, online } = usePeople();
  const { run, busy, banner } = useRun();
  const [editFarm, setEditFarm] = useState(false);
  const [adding, setAdding] = useState<'houses' | 'worker' | null>(null);
  const [pin, setPin] = useState<{ name: string; phone: string; pin: string } | null>(null);
  const active = (workers ?? []).filter((w) => w.active), off = (workers ?? []).filter((w) => !w.active);
  const houseName = (id: string) => houses?.find((h) => h.id === id)?.name ?? '';
  const workersOf = (hid: string) => active.filter((w) => w.houseIds.includes(hid)).map((w) => w.displayName);

  async function addWorker(w: NewWorker) {
    const ok = await run(() => api.inviteWorker(w));
    if (ok) { setPin({ name: w.displayName.trim(), phone: w.phone.replace(/\s/g, ''), pin: w.pin }); setAdding(null); await reload(); }
    return ok;
  }

  return (
    <>
      <TopBar title="Ферма и люди" sub={session.farm.name} back="/more" />
      <main className="content">
        {!online && <NeedNet />}
        {error && online && <div className="banner bad">{error}</div>}
        {banner}
        {pin && <PinCard {...pin} onClose={() => setPin(null)} />}

        <h2 className="pad" style={{ margin: 0, fontSize: 17 }}>Ферма</h2>
        {editFarm
          ? <FarmForm farm={session.farm} busy={busy || !online} onSave={(f) => void run(async () => { const farm = await api.updateFarm(f); setSession({ ...session, farm }); }, 'Ферма сохранена').then((ok) => ok && setEditFarm(false))} />
          : (
            <button className="row" style={{ width: '100%', background: 'var(--color-bg-surface)', border: 0, textAlign: 'left', font: 'inherit' }} onClick={() => setEditFarm(true)} aria-label="Изменить ферму">
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}><b style={{ fontWeight: 500 }}>{session.farm.name}</b>
                <span className="small muted">Сутки с {String(session.farm.dayStartHour).padStart(2, '0')}:00 · {TIMEZONES.find(([v]) => v === session.farm.tz)?.[1] ?? session.farm.tz}</span></span>
              <span aria-hidden="true">›</span>
            </button>
          )}

        <h2 className="pad" style={{ margin: '8px 0 0', fontSize: 17 }}>Блоки {houses ? `· ${houses.filter((h) => h.active !== false).length}` : ''}</h2>
        <div className="section">
          {houses?.map((h) => (
            <Link key={h.id} to={`/people/house/${h.id}`} className="row">
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 500 }}>{h.name}{h.active === false ? ' · отключён' : ''}</span>
                <span className="small muted">{h.areaM2} м² · {h.hasWaterMeter ? 'есть водосчётчик' : 'без счётчика'} · {workersOf(h.id).join(', ') || <span className="warn-t">нет работника</span>}</span>
              </span>
              <span aria-hidden="true">›</span>
            </Link>
          ))}
          {houses && !houses.length && <div className="row muted">Блоков пока нет</div>}
        </div>
        {adding === 'houses'
          ? <AddHouses existing={houses ?? []} busy={busy || !online} onAdd={(names, areaM2, meter) => void run(async () => { for (const name of names) await api.createHouse({ name, areaM2, hasWaterMeter: meter, drinkerType: null, feederType: null }); await sync.refresh(); }, `Добавлены: ${names.join(', ')}`).then(async (ok) => { if (ok) setAdding(null); await reload(); })} />
          : <div className="pad"><button className="btn block" disabled={!online} onClick={() => setAdding('houses')}>+ Добавить блоки</button></div>}

        <h2 className="pad" style={{ margin: '8px 0 0', fontSize: 17 }}>Работники {workers ? `· ${active.length}` : ''}</h2>
        <div className="section">
          {active.map((w) => (
            <Link key={w.id} to={`/people/worker/${w.id}`} className="row">
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 500 }}>{w.displayName}</span>
                <span className="small muted num">{fmtPhone(w.phone)} · {w.houseIds.map(houseName).filter(Boolean).join(', ') || 'нет блоков'}</span>
              </span>
              <span aria-hidden="true">›</span>
            </Link>
          ))}
          {workers && !active.length && <div className="row muted">Работников пока нет</div>}
        </div>
        {adding === 'worker'
          ? <WorkerForm houses={houses ?? []} busy={busy || !online} onAdd={addWorker} />
          : <div className="pad"><button className="btn block" disabled={!online || !houses?.length} onClick={() => { setPin(null); setAdding('worker'); }}>+ Добавить работника</button></div>}

        {!!off.length && (
          <>
            <h2 className="pad" style={{ margin: '8px 0 0', fontSize: 17 }}>Отключены</h2>
            <div className="section">
              {off.map((w) => <Link key={w.id} to={`/people/worker/${w.id}`} className="row"><span style={{ flex: 1 }} className="muted">{w.displayName} · {fmtPhone(w.phone)}</span><span aria-hidden="true">›</span></Link>)}
            </div>
          </>
        )}
      </main>
    </>
  );
}

export function WorkerCard() {
  const { id = '' } = useParams();
  const { api, db } = useSignedIn();
  const { houses, workers, reload, online } = usePeople();
  const { run, busy, banner } = useRun();
  const [pin, setPin] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ name: string; phone: string } | null>(null);
  const [confirm, setConfirm] = useState<'pin' | 'off' | null>(null);
  const w = workers?.find((x) => x.id === id);
  const lastLog = useLive(() => db.logs.filter((l) => l.createdBy === id).toArray().then((l) => l.reduce<string | null>((m, x) => (!m || x.productionDay > m ? x.productionDay : m), null)), [db, id], null);
  if (!w) return <><TopBar title="Работник" back="/people" /><main className="content">{workers ? <p className="pad muted">Работник не найден</p> : <p className="pad muted">Загрузка…</p>}</main></>;

  const toggle = (hid: string) => void run(() => api.setWorkerHouses(w.id, w.houseIds.includes(hid) ? w.houseIds.filter((x) => x !== hid) : [...w.houseIds, hid]), 'Блоки обновлены').then(reload);
  async function saveEdit() {
    if (!edit) return;
    const ok = await run(async () => {
      if (edit.name.trim() && edit.name.trim() !== w!.displayName) await api.renameWorker(w!.id, edit.name.trim());
      if (edit.phone.replace(/\s/g, '') !== w!.phone) await api.setWorkerPhone(w!.id, edit.phone);
    }, 'Сохранено');
    if (ok) { setEdit(null); await reload(); }
  }

  return (
    <>
      <TopBar title={w.displayName} sub={w.active ? 'Работник' : 'Отключён'} back="/people" />
      <main className="content">
        {!online && <NeedNet />}
        {banner}
        {pin && <PinCard name={w.displayName} phone={w.phone} pin={pin} onClose={() => setPin(null)} />}
        {edit ? (
          <form className="formrow" onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}>
            <label className="field"><span>Имя</span><input className="input text" value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="field"><span>Телефон (это логин)</span><input className="input" type="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
            {edit.phone.replace(/\s/g, '') !== w.phone && <span className="small warn-t">После смены телефона работник входит с новым номером и тем же PIN — сообщите ему.</span>}
            <button className="btn primary block" disabled={busy || !online || !edit.name.trim() || !isKgPhone(edit.phone)}>Сохранить</button>
            <button type="button" className="btn block" onClick={() => setEdit(null)}>Отмена</button>
          </form>
        ) : (
          <div className="section">
            <div className="row"><span style={{ flex: 1 }} className="muted">Телефон</span><span className="num">{fmtPhone(w.phone)}</span></div>
            <div className="row"><span style={{ flex: 1 }} className="muted">Последний журнал</span><span className="num">{lastLog ? fmtDayShort(lastLog) : '—'}</span></div>
            <button className="row" style={{ width: '100%', border: 0, background: 'var(--color-bg-surface)', font: 'inherit', color: 'var(--color-accent)' }} disabled={!online} onClick={() => setEdit({ name: w.displayName, phone: fmtPhone(w.phone) })}>Изменить имя или телефон</button>
          </div>
        )}

        {w.active && (
          <>
            <h2 className="pad" style={{ margin: '8px 0 0', fontSize: 17 }}>Блоки</h2>
            <div className="chips pad" role="group" aria-label="Блоки работника">
              {houses?.filter((h) => h.active !== false).map((h) => <button key={h.id} className={`chip${w.houseIds.includes(h.id) ? ' on' : ''}`} aria-pressed={w.houseIds.includes(h.id)} disabled={busy || !online} onClick={() => toggle(h.id)}>{h.name}</button>)}
            </div>
          </>
        )}

        <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {w.active && (confirm === 'pin'
            ? <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span>Старый PIN перестанет работать сразу, телефон работника выйдет из приложения.</span>
                <button className="btn primary block" disabled={busy || !online} onClick={() => { const p = newPin(); void run(() => api.resetWorkerPin(w.id, p)).then((ok) => { if (ok) { setPin(p); setConfirm(null); } }); }}>Выдать новый PIN</button>
                <button className="btn block" onClick={() => setConfirm(null)}>Отмена</button>
              </div>
            : <button className="btn primary block" disabled={!online} onClick={() => { setPin(null); setConfirm('pin'); }}>Новый PIN</button>)}
          {w.active
            ? (confirm === 'off'
              ? <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span>{w.displayName} не сможет войти. Все его записи останутся и будут подписаны его именем.</span>
                  <button className="btn danger block" disabled={busy || !online} onClick={() => void run(() => api.setWorkerActive(w.id, false), `${w.displayName} отключён`).then(async (ok) => { if (ok) { setConfirm(null); await reload(); } })}>Да, отключить</button>
                  <button className="btn block" onClick={() => setConfirm(null)}>Отмена</button>
                </div>
              : <button className="btn block" disabled={!online} onClick={() => setConfirm('off')}>Отключить работника</button>)
            : <button className="btn primary block" disabled={busy || !online} onClick={() => void run(() => api.setWorkerActive(w.id, true), `${w.displayName} снова может войти с прежним PIN`).then(reload)}>Вернуть доступ</button>}
        </div>
      </main>
    </>
  );
}

export function HouseCard() {
  const { id = '' } = useParams();
  const { api, sync } = useSignedIn();
  const nav = useNavigate();
  const { houses, workers, reload, online } = usePeople();
  const { run, busy, banner } = useRun();
  const h = houses?.find((x) => x.id === id);
  const [f, setF] = useState<{ name: string; area: string; meter: boolean } | null>(null);
  useEffect(() => { if (h && !f) setF({ name: h.name, area: String(h.areaM2).replace('.', ','), meter: h.hasWaterMeter }); }, [h, f]);
  if (!h || !f) return <><TopBar title="Блок" back="/people" /><main className="content"><p className="pad muted">{houses ? 'Блок не найден' : 'Загрузка…'}</p></main></>;
  const area = parseNum(f.area);
  const ok = f.name.trim() && area != null && !Number.isNaN(area) && area > 0;
  const people = (workers ?? []).filter((w) => w.active && w.houseIds.includes(h.id)).map((w) => w.displayName);

  return (
    <>
      <TopBar title={h.name} sub={h.active === false ? 'Отключён' : 'Блок'} back="/people" />
      <main className="content">
        {!online && <NeedNet />}
        {banner}
        <form className="formrow" onSubmit={(e) => { e.preventDefault(); if (ok) void run(async () => { await api.updateHouse(h.id, { name: f.name.trim(), areaM2: area!, hasWaterMeter: f.meter }); await sync.refresh(); }, 'Сохранено').then(reload); }}>
          <div className="grid2">
            <label className="field"><span>Название</span><input className="input text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="field"><span>Площадь, м²</span><input className="input" inputMode="decimal" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></label>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.meter} onChange={(e) => setF({ ...f, meter: e.target.checked })} /> Есть водосчётчик</label>
          <span className="small muted">Работники: {people.join(', ') || 'нет'} (назначаются в карточке работника)</span>
          <button className="btn primary block" disabled={!ok || busy || !online}>Сохранить</button>
        </form>
        <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {h.active === false
            ? <button className="btn block" disabled={busy || !online} onClick={() => void run(() => api.updateHouse(h.id, { active: true }), 'Блок снова в работе').then(reload)}>Включить блок</button>
            : <button className="btn block" disabled={busy || !online} onClick={() => void run(() => api.updateHouse(h.id, { active: false }), 'Блок отключён: в нём нельзя начать новую партию').then(reload)}>Отключить блок</button>}
          <button className="btn danger block" disabled={busy || !online} onClick={() => void run(() => api.deleteHouse(h.id)).then((done) => { if (done) nav('/people', { replace: true }); })}>Удалить блок</button>
          <span className="small muted">Удалить можно только блок без истории партий; иначе — отключить.</span>
        </div>
      </main>
    </>
  );
}
