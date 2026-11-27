import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { dayOfAge, liveBirds } from '@farm/core';
import { useOnline, useSignedIn } from '../app';
import type { AskAnswer } from '../api/types';
import { ApiError } from '../api/types';
import { TopBar } from '../ui/parts';
import { fmtDayShort } from '../ui/format';
import { HouseSwitch } from './HouseSwitch';
import { useHouseLogs, useHouses } from './useHouses';

const EXAMPLES = ['Какая температура нужна на 10-й день?', 'Падёж вырос в 2 раза, что проверить?', 'Птица мало пьёт — причины?', 'Когда снимать корм перед отловом?'];

/** «Помощник»: questions answered from the handbook by AI, with links to the articles used. Needs a connection. */
export default function Ask() {
  const { api, today } = useSignedIn();
  const online = useOnline();
  const [params] = useSearchParams();
  const { houses, current, select } = useHouses();
  const logs = useHouseLogs(current?.houseBatchId);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [withHouse, setWithHouse] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [thread, setThread] = useState<{ q: string; a: AskAnswer }[]>([]);

  async function ask() {
    const question = q.trim();
    if (question.length < 5) { setErr('Напишите вопрос подробнее'); return; }
    setBusy(true); setErr(null);
    try {
      const day = today();
      const ctx = withHouse && current ? {
        houseName: current.houseName,
        dayOfAge: dayOfAge(current.placedOn, day),
        liveBirds: liveBirds(current.placed, logs.filter((l) => l.productionDay < day)),
        recent: logs.slice(0, 5).map((l) => `${fmtDayShort(l.productionDay)}: падёж ${l.deaths}+${l.culls}, корм ${l.feedKg ?? '—'} кг, вода ${l.waterL ?? '—'} л, t ${l.tMin ?? '—'}…${l.tMax ?? '—'}, ОВ ${l.rh ?? '—'}%`).join('\n'),
      } : null;
      const a = await api.ask(question, ctx);
      setThread([{ q: question, a }, ...thread]);
      setQ('');
    } catch (e) {
      setErr(e instanceof ApiError && e.code === 'NETWORK' ? 'Нет связи. Помощник работает только онлайн — справочник доступен и без сети.' : e instanceof Error && e.message ? e.message : 'Не удалось получить ответ');
    } finally { setBusy(false); }
  }

  return (
    <>
      <TopBar title="Помощник" sub="Ответы по справочнику Arbor Acres" back="/more" />
      <main className="content">
        {!online && <div className="banner warn">Нет сети. Помощник работает онлайн; <Link to="/handbook">справочник</Link> открывается и без связи.</div>}
        <form className="formrow" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
          <label className="field"><span>Вопрос</span>
            <textarea className="input text" rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Например: падёж на 5-й день 0,3%, что проверить?" style={{ resize: 'vertical', minHeight: 84 }} />
          </label>
          {current && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={withHouse} onChange={(e) => setWithHouse(e.target.checked)} />
              <span>Учесть данные {current.houseName} (возраст, последние журналы)</span>
            </label>
          )}
          {withHouse && <HouseSwitch houses={houses} current={current} select={select} />}
          {err && <div className="err-text" role="alert">{err}</div>}
          <button className="btn primary block" disabled={busy || !online}>{busy ? 'Думаю…' : 'Спросить'}</button>
        </form>
        {!thread.length && (
          <div className="chips pad" aria-label="Примеры вопросов">
            {EXAMPLES.map((x) => <button key={x} type="button" className="chip" onClick={() => setQ(x)}>{x}</button>)}
          </div>
        )}
        {thread.map((t, i) => (
          <section key={thread.length - i} className="card" style={{ margin: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }} aria-label="Ответ">
            <b>{t.q}</b>
            <div className="answer" style={{ padding: 0 }}>{t.a.answer}</div>
            {!!t.a.sources.length && (
              <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="muted">Источники:</span>
                {t.a.sources.map((s, k) => <Link key={s.id} to={`/handbook/${s.id}`}>[{k + 1}] {s.title}</Link>)}
              </div>
            )}
          </section>
        ))}
        <p className="pad small muted">Помощник отвечает по справочнику и может ошибаться. Лечение и препараты — только по назначению ветврача.</p>
      </main>
    </>
  );
}
