import { Link } from 'react-router-dom';
import { useSignedIn, useSyncStatus } from '../app';
import { TopBar } from '../ui/parts';
import { AppVersion, ROLE_RU, SignOutButton } from '../ui/account';
import { fmtPhone } from '../ui/people';

/** «Ещё»: less frequent operations, plus settings for the director. */
export default function More() {
  const { session } = useSignedIn();
  const st = useSyncStatus();
  const head = session.role === 'head';
  const n = (st?.pending ?? 0) + (st?.rejected ?? 0);
  const item = (to: string, title: string, sub: string) => (
    <Link to={to} className="row"><span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 16, fontWeight: 500 }}>{title}</span><span className="small muted">{sub}</span></span><span aria-hidden="true">›</span></Link>
  );
  return (
    <>
      <TopBar title="Ещё" sub={session.displayName} />
      <main className="content">
        <section className="card" aria-label="Аккаунт" style={{ margin: '0 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <b style={{ fontSize: 16 }}>{session.displayName}</b>
            <span className="small muted num">{ROLE_RU[session.role]} · {fmtPhone(session.phone)}</span>
          </span>
          <SignOutButton />
        </section>
        <div className="section">
          {head && item('/people', 'Ферма и люди', 'Блоки, работники, PIN, доступ')}
          {item('/placement', 'Посадка', 'Приёмка цыплят, проверка зоба')}
          {item('/weighing', 'Взвешивание', 'Выборка, средняя масса, однородность')}
          {item('/catch', 'Отлов и сдача', 'Дата отлова, снятие корма, сдача покупателю')}
          {item('/handbook', 'Справочник', 'Нормы Arbor Acres, работает без сети')}
          {item('/ask', 'Помощник', 'Вопрос по выращиванию — ответ из справочника')}
          {head && item('/norms', 'Ключевые нормы', '6 чисел, по которым приложение предупреждает')}
          {item('/queue', 'Отправка и смена PIN', n ? `Ждут отправки: ${n}` : 'Всё отправлено · сменить свой PIN')}
        </div>
        <AppVersion />
        {!head && <p className="pad small muted">Вы видите только свои блоки. Цены и деньги ведёт директор.</p>}
      </main>
    </>
  );
}
