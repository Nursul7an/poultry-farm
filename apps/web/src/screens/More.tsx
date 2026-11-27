import { Link } from 'react-router-dom';
import { useSignedIn, useSyncStatus } from '../app';
import { TopBar } from '../ui/parts';

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
        <div className="section">
          {head && item('/people', 'Ферма и люди', 'Птичники, работники, PIN, доступ')}
          {item('/placement', 'Посадка', 'Приёмка цыплят, проверка зоба')}
          {item('/weighing', 'Взвешивание', 'Выборка, средняя масса, однородность')}
          {item('/catch', 'Отлов и сдача', 'Дата отлова, снятие корма, сдача покупателю')}
          {item('/handbook', 'Справочник', 'Нормы Arbor Acres, работает без сети')}
          {item('/ask', 'Помощник', 'Вопрос по выращиванию — ответ из справочника')}
          {head && item('/norms', 'Нормы фермы', 'Изменить нормы, по которым проверяется журнал')}
          {item('/queue', 'Отправка и PIN', n ? `Ждут отправки: ${n}` : 'Всё отправлено')}
        </div>
        {!head && <p className="pad small muted">Вы видите только свои птичники. Цены и деньги ведёт директор.</p>}
      </main>
    </>
  );
}
