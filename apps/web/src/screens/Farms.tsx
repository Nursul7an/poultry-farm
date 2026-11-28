import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnline, useSignedIn } from '../app';
import type { FarmSummary } from '../api/types';
import { TopBar } from '../ui/parts';
import { FarmForm, useRun } from '../ui/people';
import { fmtInt } from '../ui/format';

/** Director: his farms — switch the active one, or create another (it then opens its own setup). */
export default function Farms() {
  const { api, session, setSession } = useSignedIn();
  const online = useOnline();
  const nav = useNavigate();
  const { run, busy, banner } = useRun();
  const [farms, setFarms] = useState<FarmSummary[] | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => { api.myFarms().then(setFarms).catch(() => setFarms(null)); }, [api, online]);

  async function switchTo(id: string) {
    let s = session;
    if (await run(async () => { s = await api.switchFarm(id); })) { setSession(s); nav('/farm', { replace: true }); }
  }

  return (
    <>
      <TopBar title="Мои фермы" sub={`Сейчас: ${session.farm.name}`} back="/more" />
      <main className="content">
        {!online && <div className="banner warn">Нет сети. Переключать и создавать фермы можно только онлайн.</div>}
        {banner}
        <div className="section">
          {farms?.map((f) => (
            <div key={f.id} className="row" style={{ gap: 12 }}>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <b style={{ fontWeight: 600 }}>{f.name}{f.isCurrent ? ' · открыта' : ''}</b>
                <span className="small muted">{[f.region, f.address].filter(Boolean).join(', ') || 'адрес не указан'}</span>
                <span className="small muted num">Блоков {f.blocks} · {fmtInt(f.areaM2)} м² · вместимость ≈ {fmtInt(f.areaM2 * f.birdsPerM2)} гол</span>
              </span>
              {!f.isCurrent && <button className="btn" disabled={busy || !online} onClick={() => void switchTo(f.id)}>Открыть</button>}
            </div>
          ))}
          {farms === null && <div className="row muted">{online ? 'Загрузка…' : 'Список ферм доступен онлайн'}</div>}
        </div>
        {adding ? (
          <>
            <h2 className="pad" style={{ margin: 0, fontSize: 17 }}>Новая ферма</h2>
            <FarmForm farm={{ name: '', tz: session.farm.tz, dayStartHour: session.farm.dayStartHour, birdsPerM2: 17 }} busy={busy || !online} submit="Создать ферму"
              onSave={(f) => { let s = session; void run(async () => { s = await api.createFarm(f); }).then((ok) => { if (ok) { setSession(s); nav('/setup', { replace: true }); } }); }} />
            <div className="pad"><button className="btn block" onClick={() => setAdding(false)}>Отмена</button></div>
          </>
        ) : (
          <div className="pad"><button className="btn primary block" disabled={!online} onClick={() => setAdding(true)}>+ Новая ферма</button></div>
        )}
        <p className="pad small muted">У каждой фермы свои блоки, работники, склад кормов и деньги. Работник видит только свою ферму.</p>
      </main>
    </>
  );
}
