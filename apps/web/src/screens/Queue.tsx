import { useEffect, useState } from 'react';
import { useLive, useOnline, useSignedIn, useSyncStatus } from '../app';
import { TopBar } from '../ui/parts';
import { SignOutButton } from '../ui/account';
import { fmtDayShort, fmtTime } from '../ui/format';
import { PIN_RE } from '../api/phone';
import { ApiError } from '../api/types';

const KIND_RU: Record<string, string> = { log: 'Журнал', feed: 'Поставка корма', health: 'Здоровье', weighing: 'Взвешивание', handover: 'Сдача', placement: 'Посадка', phase: 'Смена рациона', catch: 'План отлова' };
/** One line describing any queued record (logs and every other operation). */
function describe(kind: string, p: any, name: (hb: string) => string) {
  const hb = p?.houseBatchId ?? p?.id ?? '';
  const day = p?.productionDay ?? p?.deliveredOn ?? p?.eventOn ?? p?.weighedOn ?? p?.handedOn ?? p?.placedOn ?? p?.since ?? null;
  return `${KIND_RU[kind] ?? kind} ${name(hb)}${day ? ` · ${fmtDayShort(day)}` : ''}`;
}

/** Sync queue + device diagnostics (the T-02 spike checklist reads these values). */
export default function Queue() {
  const { db, sync, session, api } = useSignedIn();
  const online = useOnline();
  const st = useSyncStatus();
  const items = useLive(() => db.outbox.orderBy('seq').toArray(), [db], []);
  const houses = useLive(() => db.houseBatches.toArray(), [db], []);
  const [pin, setPin] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);
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
                  <span style={{ fontWeight: 500 }}>{describe(o.kind, o.payload, name)}</span>
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
        <form className="card" style={{ margin: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!PIN_RE.test(pin)) { setPinMsg('PIN — 6 цифр'); return; }
            try { await api.changePin(pin); setPin(''); setPinMsg('PIN изменён'); }
            catch (err) { setPinMsg(err instanceof ApiError ? err.message : 'Не удалось изменить PIN'); }
          }}>
          <strong>Сменить PIN</strong>
          <input className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} aria-label="Новый PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          {pinMsg && <span className="small" role="status">{pinMsg}</span>}
          <button className="btn" disabled={!online}>Сохранить новый PIN</button>
        </form>
        <div className="pad">
          <SignOutButton className="btn block" label={`Выйти (${session.displayName})`} />
        </div>
      </main>
    </>
  );
}
