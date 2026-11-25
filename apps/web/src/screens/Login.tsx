import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../app';
import { DEMO_ACCOUNTS, DemoApi } from '../api/demo';
import { ApiError } from '../api/types';
import { PIN_RE } from '../api/phone';

export default function Login() {
  const { api, setSession } = useApp();
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(p = phone, k = pin) {
    setErr(null);
    if (!PIN_RE.test(k)) { setErr('PIN — 6 цифр'); return; }
    setBusy(true);
    try {
      const s = await api.signIn(p, k);
      setSession(s);
      nav(s.role === 'head' ? '/farm' : '/today', { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Не удалось войти');
    } finally { setBusy(false); }
  }

  return (
    <div className="shell">
      <main className="content pad" style={{ justifyContent: 'center', gap: 16, paddingBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Птичник</h1>
        <p className="muted" style={{ margin: 0 }}>Вход по номеру телефона и PIN, который дал руководитель.</p>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="field"><span>Номер телефона</span>
            <input className="input text" type="tel" inputMode="tel" autoComplete="tel" placeholder="+996 700 000 000" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </label>
          <label className="field"><span>PIN (6 цифр)</span>
            <input className="input" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required />
          </label>
          {err && <div className="err-text" role="alert">{err}</div>}
          <button className="btn primary big" disabled={busy}>{busy ? 'Вход…' : 'Войти'}</button>
        </form>
        {api.mode === 'demo' && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <strong>Демо-режим</strong>
            <span className="small muted">Сервер не подключён: данные хранятся только в этом браузере. Войти как:</span>
            {DEMO_ACCOUNTS.map((a) => (
              <button key={a.phone} className="btn" type="button" onClick={() => { setPhone(a.phone); setPin(a.pin); void submit(a.phone, a.pin); }}>
                {a.label}
              </button>
            ))}
            <button className="btn" type="button" style={{ fontWeight: 400, fontSize: 14 }} onClick={() => { DemoApi.reset(); location.reload(); }}>Сбросить демо-данные</button>
          </div>
        )}
      </main>
    </div>
  );
}
