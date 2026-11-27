import { useNavigate } from 'react-router-dom';
import { useApp, useSyncStatus } from '../app';

export const ROLE_RU = { head: 'Директор', worker: 'Работник' } as const;

/** Sign out, warning first when records are still waiting to be sent (they stay on the phone). */
export function useSignOut() {
  const { api, setSession } = useApp();
  const st = useSyncStatus();
  const nav = useNavigate();
  return async () => {
    if (st?.pending && !confirm(`Не отправлено записей: ${st.pending}. Они останутся на этом телефоне и отправятся после следующего входа. Выйти?`)) return;
    try { await api.signOut(); } catch { /* offline: the local session is still cleared below */ }
    setSession(null);
    nav('/login', { replace: true });
  };
}

/** Who is signed in + «Выйти». In the desktop sidebar it sits at the bottom; on phones it is hidden there (shown in «Ещё»). */
export function NavAccount() {
  const { session } = useApp();
  const signOut = useSignOut();
  if (!session) return null;
  return (
    <div className="nav-account">
      <span className="nav-account-name">{session.displayName}<br /><small>{ROLE_RU[session.role]}</small></span>
      <button type="button" className="nav-account-exit" onClick={() => void signOut()}>Выйти</button>
    </div>
  );
}
