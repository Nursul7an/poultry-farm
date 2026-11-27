import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSignedIn } from '../app';
import { TopBar } from '../ui/parts';
import { AddHouses, FarmForm, fmtPhone, PinCard, useRun, WorkerForm, type NewWorker } from '../ui/people';
import { usePeople } from './People';

export const SETUP_STEP_KEY = 'farm-setup-step';
export const SETUP_DONE_KEY = 'farm-setup-done';
const readStep = () => { try { return Math.min(3, Math.max(1, Number(localStorage.getItem(SETUP_STEP_KEY) ?? 1))) as 1 | 2 | 3; } catch { return 1; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** First sign-in of the director on an empty farm: farm → houses → workers (spec v2.2 FR-D1). */
export default function Setup() {
  const { api, session, setSession, sync } = useSignedIn();
  const nav = useNavigate();
  const { houses, workers, reload, online } = usePeople();
  const { run, busy, banner } = useRun();
  const [step, setStepState] = useState<1 | 2 | 3>(readStep);
  const [pin, setPin] = useState<{ name: string; phone: string; pin: string } | null>(null);
  const setStep = (s: 1 | 2 | 3) => { setStepState(s); save(SETUP_STEP_KEY, String(s)); };
  const active = (houses ?? []).filter((h) => h.active !== false);
  const people = (workers ?? []).filter((w) => w.active);

  async function addWorker(w: NewWorker) {
    const ok = await run(() => api.inviteWorker(w));
    if (ok) { setPin({ name: w.displayName.trim(), phone: w.phone.replace(/\s/g, ''), pin: w.pin }); await reload(); }
    return ok;
  }
  function finish() {
    save(SETUP_DONE_KEY, '1'); save(SETUP_STEP_KEY, '1');
    void sync.refresh().catch(() => {});
    nav('/farm', { replace: true, state: { setupDone: true } });
  }

  return (
    <>
      <TopBar title="Настройка фермы" sub={`Шаг ${step} из 3 · ${['Ферма', 'Птичники', 'Работники'][step - 1]}`} />
      <main className="content">
        <div className="seg pad" role="group" aria-label="Шаги">
          {(['Ферма', 'Птичники', 'Работники'] as const).map((t, i) => (
            <button key={t} className={step === i + 1 ? 'on' : ''} aria-pressed={step === i + 1} disabled={i + 1 > 1 && !active.length && i + 1 > step} onClick={() => setStep((i + 1) as 1 | 2 | 3)}>{i + 1}. {t}</button>
          ))}
        </div>
        {!online && <div className="banner warn">Нет сети. Настройка работает только онлайн — введённое не потеряется.</div>}
        {banner}

        {step === 1 && (
          <>
            <p className="pad small muted" style={{ margin: 0 }}>Проверьте название и когда начинаются производственные сутки (обычно в 8:00 — с утреннего обхода).</p>
            <FarmForm farm={session.farm} busy={busy || !online} submit="Дальше"
              onSave={(f) => void run(async () => { const farm = await api.updateFarm(f); setSession({ ...session, farm }); }).then((ok) => ok && setStep(2))} />
          </>
        )}

        {step === 2 && (
          <>
            <div className="section">
              {active.map((h) => <div className="row" key={h.id}><span style={{ flex: 1, fontWeight: 500 }}>{h.name}</span><span className="small muted">{h.areaM2} м² · {h.hasWaterMeter ? 'счётчик' : 'без счётчика'}</span></div>)}
              {houses && !active.length && <div className="row muted">Птичников пока нет — добавьте ниже</div>}
            </div>
            <AddHouses existing={houses ?? []} busy={busy || !online}
              onAdd={(names, areaM2, meter) => void run(async () => { for (const name of names) await api.createHouse({ name, areaM2, hasWaterMeter: meter, drinkerType: null, feederType: null }); }, `Добавлены: ${names.join(', ')}`).then(reload)} />
            <div className="pad"><button className="btn primary big block" disabled={!active.length} onClick={() => setStep(3)}>Дальше: работники</button></div>
          </>
        )}

        {step === 3 && (
          <>
            {pin && <PinCard {...pin} onClose={() => setPin(null)} />}
            {!!people.length && (
              <div className="section">
                {people.map((w) => <div className="row" key={w.id}><span style={{ flex: 1, fontWeight: 500 }}>{w.displayName}</span><span className="small muted num">{fmtPhone(w.phone)} · {w.houseIds.map((id) => houses?.find((h) => h.id === id)?.name).filter(Boolean).join(', ')}</span></div>)}
              </div>
            )}
            {!pin && <WorkerForm houses={houses ?? []} busy={busy || !online} onAdd={addWorker} />}
            <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn primary big block" onClick={finish}>{people.length ? 'Готово' : 'Пропустить — добавлю позже'}</button>
              <span className="small muted">Работников можно добавить и потом: «Ещё → Ферма и люди».</span>
            </div>
          </>
        )}
        <p className="pad small muted"><Link to="/farm" onClick={() => save(SETUP_DONE_KEY, '1')}>Закрыть настройку</Link></p>
      </main>
    </>
  );
}
