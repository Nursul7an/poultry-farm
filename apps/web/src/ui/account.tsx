import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApp, useSyncStatus } from '../app';

export const ROLE_RU = { head: 'Директор', worker: 'Работник' } as const;

function useDoSignOut() {
  const { api, setSession } = useApp();
  const nav = useNavigate();
  return async () => {
    try { await api.signOut(); } catch { /* the local session is cleared anyway */ }
    setSession(null);
    nav('/login', { replace: true });
  };
}

/**
 * «Выйти». Signs out at once; if records are still waiting to be sent, asks first inside the app
 * (no browser pop-up: installed apps may block them). Unsent records stay on the phone.
 */
export function SignOutButton({ className = 'btn', label = 'Выйти' }: { className?: string; label?: string }) {
  const st = useSyncStatus();
  const doSignOut = useDoSignOut();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); await doSignOut(); };
  const pending = (st?.pending ?? 0) + (st?.rejected ?? 0);
  if (ask) {
    return (
      <span role="alertdialog" aria-label="Выйти?" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="small">Не отправлено записей: {pending}. Они останутся на этом телефоне и отправятся после следующего входа.</span>
        <button type="button" className="btn danger" disabled={busy} onClick={() => void go()}>{busy ? 'Выход…' : 'Всё равно выйти'}</button>
        <button type="button" className="btn" onClick={() => setAsk(false)}>Отмена</button>
      </span>
    );
  }
  return (
    <button type="button" className={className} disabled={busy} onClick={() => (pending ? setAsk(true) : void go())}>{busy ? 'Выход…' : label}</button>
  );
}

/** Who is signed in + «Выйти». Shown at the bottom of the desktop sidebar; hidden on phones (they use the card in «Ещё»). */
export function NavAccount() {
  const { session } = useApp();
  if (!session) return null;
  return (
    <div className="nav-account">
      <span className="nav-account-name">{session.displayName}<br /><small>{ROLE_RU[session.role]} · {session.farm.name}</small></span>
      {session.role === 'head' && <NavLink to="/farms" className="nav-account-farms">Мои фермы</NavLink>}
      <SignOutButton className="nav-account-exit" />
    </div>
  );
}

/** Version line + manual update check (helps when a phone keeps an old version). */
export function AppVersion() {
  const [state, setState] = useState<'idle' | 'checking' | 'latest'>('idle');
  async function check() {
    setState('checking');
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
      if (reg?.waiting || reg?.installing) { location.reload(); return; }
    } catch { /* offline */ }
    setState('latest');
  }
  const built = new Date(__APP_BUILT__);
  return (
    <p className="pad small muted" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>Версия {__APP_VERSION__} · {built.toLocaleDateString('ru-RU')} {built.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
      <button type="button" className="btn" style={{ minHeight: 36 }} disabled={state === 'checking'} onClick={() => void check()}>
        {state === 'checking' ? 'Проверяю…' : state === 'latest' ? 'Последняя версия ✔' : 'Проверить обновление'}
      </button>
    </p>
  );
}
