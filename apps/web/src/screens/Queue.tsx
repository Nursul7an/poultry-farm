import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useLive, useOnline, useSignedIn, useSyncStatus } from '../app';
import { TopBar } from '../ui/parts';
import { fmtDayShort, fmtTime } from '../ui/format';

/** Sync queue + device diagnostics (the T-02 spike checklist reads these values). */
export default function Queue() {
  const { db, sync, session, api } = useSignedIn();
  const { setSession } = useApp();
  const nav = useNavigate();
  const online = useOnline();
  const st = useSyncStatus();
  const items = useLive(() => db.outbox.orderBy('seq').toArray(), [db], []);
  const houses = useLive(() => db.houseBatches.toArray(), [db], []);
  const [diag, setDiag] = useState<{ persisted?: boolean; usage?: number; quota?: number }>({});
  useEffect(() => {
    void (async () => {
      const persisted = await navigator.storage?.persisted?.();
      const est = await navigator.storage?.estimate?.();
      setDiag({ persisted, usage: est?.usage, quota: est?.quota });
    })();
  }, []);
  const name = (hb: string) => houses.find((h) => h.houseBatchId === hb)?.houseName ?? '';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;

  return (
    <>
      <TopBar title="Отправка" sub={online ? 'Сеть есть' : 'Нет сети'} />
      <main className="content">
        <div className="pad">
          <button className="btn primary block" disabled={!online || !!st?.syncing} onClick={() => void sync.syncNow().then(() => sync.refresh())}>
            {st?.syncing ? 'Отправка…' : 'Отправить и обновить сейчас'}
          </button>
        </div>
        {st?.lastError && <div className="banner warn">{st.lastError}. Повторим автоматически.</div>}
        {!items.length && <p className="pad muted">Всё отправлено{st?.lastSyncAt ? ` · ${fmtTime(st.lastSyncAt)}` : ''}.</p>}
        {items.length > 0 && (
          <div className="section">
            {items.map((o) => (
              <div className="row" key={o.seq}>
                <span className={`dot`} style={{ background: o.status === 'rejected' ? 'var(--color-status-critical)' : 'var(--color-status-info)', borderRadius: o.status === 'rejected' ? 2 : '50%' }} aria-hidden="true" />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 500 }}>Журнал {name(o.payload.houseBatchId)} · {fmtDayShort(o.payload.productionDay)}</span>
                  <span className={`small ${o.status === 'rejected' ? 'bad-t' : 'muted'}`}>{o.status === 'rejected' ? `Не принято: ${o.error}` : `ждёт связи · попыток ${o.attempts}`}</span>
                </div>
                {o.status === 'rejected' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn" style={{ minHeight: 44, fontSize: 14 }} onClick={() => void sync.retry(o.seq!)}>Повторить</button>
                    <button className="btn" style={{ minHeight: 44, fontSize: 14 }} onClick={() => { if (confirm('Удалить эту запись с телефона? Она не попала на сервер.')) void sync.discard(o.seq!); }}>Удалить</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <section className="card" style={{ margin: '0 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <strong>Телефон</strong>
          <span className="small">Хранение без удаления браузером: {diag.persisted == null ? 'неизвестно' : diag.persisted ? 'да' : 'нет'}</span>
          <span className="small">Занято: {diag.usage != null ? `${Math.round(diag.usage / 1024)} КБ` : '—'}{diag.quota ? ` из ${Math.round(diag.quota / 1048576)} МБ` : ''}</span>
          <span className="small">Установлено как приложение: {standalone ? 'да' : 'нет'}</span>
          <span className="small">Режим: {api.mode === 'demo' ? 'демо (без сервера)' : 'сервер'}</span>
        </section>
        <div className="pad">
          <button className="btn block" onClick={async () => {
            if (st?.pending && !confirm('Есть неотправленные записи. Они останутся на телефоне и отправятся после следующего входа. Выйти?')) return;
            await api.signOut(); setSession(null); nav('/login', { replace: true });
          }}>Выйти ({session.displayName})</button>
        </div>
      </main>
    </>
  );
}
