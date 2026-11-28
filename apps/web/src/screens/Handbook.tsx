import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { dayOfAge, FEED_TYPE_RU, feedPhaseFor, targetTemp, waterFeedRange, type Norms } from '@farm/core';
import { useLive, useSignedIn } from '../app';
import type { Article } from '../api/types';
import { searchArticles, stem } from '../api/search';
import { Markdown } from '../ui/Markdown';
import { useNorms } from '../ui/useNorms';
import { TopBar } from '../ui/parts';
import { fmtNum } from '../ui/format';
import { HouseSwitch } from './HouseSwitch';
import { useHouses } from './useHouses';

function useArticles(): Article[] | null {
  const { db } = useSignedIn();
  return useLive(() => db.articles.toArray().then((a) => a.sort((x, y) => x.sort - y.sort)), [db], null);
}
const markFor = (q: string) => {
  const ws = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3).map(stem);
  return ws.length ? new RegExp(`(${ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu') : undefined;
};

/** What the norms say for this house today: the numbers a worker checks on the round. */
export function TodayNorms({ n, day }: { n: Norms; day: number }) {
  const light = n.light.rows.find((r) => day >= r.from_day && (r.to_day == null || day < r.to_day));
  const [lo, hi] = waterFeedRange(n, null);
  const rows: [string, string][] = [
    ['Температура воздуха', `${fmtNum(targetTemp(n, day))} °C (±${fmtNum(n.temp_by_age.tolerance)})`],
    ['Рацион', FEED_TYPE_RU[feedPhaseFor(n, day)]],
    ['Вода : корм при 21 °C', `${fmtNum(lo, 2)}–${fmtNum(hi, 2)} л/кг`],
    ['Влажность', day < n.humidity.min_until_day ? `не ниже ${n.humidity.min_pct}%` : day >= n.humidity.max_from_day ? `не выше ${n.humidity.max_pct}%` : `${n.air.rh_pct[0]}–${n.air.rh_pct[1]}%`],
    ['Отход за сутки', `до ${fmtNum(n.mortality.daily_max_pct, 2)}%`],
  ];
  if (light) rows.push(['Свет', `темнота ${light.dark_h} ч · ${light.lux} лк`]);
  return (
    <div className="section">
      {rows.map(([k, v]) => <div className="row" key={k}><span style={{ flex: 1 }}>{k}</span><span className="num">{v}</span></div>)}
    </div>
  );
}

/** «Справочник»: Arbor Acres handbook and the farm's norms, cached on the phone (works offline). */
export default function Handbook() {
  const { session, today } = useSignedIn();
  const articles = useArticles();
  const norms = useNorms();
  const { houses, current, select } = useHouses();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [open, setOpen] = useState<string | null>(null);
  const hits = useMemo(() => (articles && q.trim() ? searchArticles(articles, q) : null), [articles, q]);
  const sections = useMemo(() => [...new Set((articles ?? []).map((a) => a.section))], [articles]);
  const head = session.role === 'head';

  return (
    <>
      <TopBar title="Справочник" sub="Arbor Acres · нормы фермы" back="/more" />
      <main className="content">
        <form className="pad" role="search" onSubmit={(e) => { e.preventDefault(); setParams(q ? { q } : {}, { replace: true }); }}>
          <input className="input text" type="search" aria-label="Поиск по справочнику" placeholder="Поиск: падёж, температура, вакцина…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <div className="pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 0 }}>
          <Link className="chip" to={`/ask${q ? `?q=${encodeURIComponent(q)}` : ''}`}>Спросить помощника</Link>
          {head && <Link className="chip" to="/norms">Ключевые нормы</Link>}
        </div>
        {articles === null && <p className="pad muted">Загрузка…</p>}
        {articles?.length === 0 && <p className="pad muted">Справочник ещё не загружен. Подключитесь к сети один раз — дальше он работает без связи.</p>}

        {hits && (
          <>
            <h2 className="pad" style={{ margin: 0, fontSize: 17 }}>{hits.length ? `Найдено: ${hits.length}` : 'Ничего не найдено'}</h2>
            <ArticleList list={hits.slice(0, 30)} q={q} />
          </>
        )}

        {!hits && current && (
          <>
            <HouseSwitch houses={houses} current={current} select={select} />
            <h2 className="pad" style={{ margin: 0, fontSize: 17 }}>Нормы на сегодня · {current.houseName}, день {dayOfAge(current.placedOn, today())}</h2>
            <TodayNorms n={norms} day={dayOfAge(current.placedOn, today())} />
          </>
        )}

        {!hits && sections.map((s) => (
          <section key={s}>
            <button className="row" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', font: 'inherit' }} aria-expanded={open === s} onClick={() => setOpen(open === s ? null : s)}>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 16 }}>{s}</span>
              <span className="small muted">{articles!.filter((a) => a.section === s).length}</span>
              <span aria-hidden="true">{open === s ? '▾' : '›'}</span>
            </button>
            {open === s && <ArticleList list={articles!.filter((a) => a.section === s)} />}
          </section>
        ))}
        <p className="pad small muted">Источник: Arbor Acres Broiler Handbook (Aviagen). Числа — ориентиры; при болезни решения принимает ветврач.</p>
      </main>
    </>
  );
}

function ArticleList({ list, q }: { list: Article[]; q?: string }) {
  return (
    <div className="section">
      {list.map((a) => (
        <Link key={a.id} to={`/handbook/${a.id}${q ? `?q=${encodeURIComponent(q)}` : ''}`} className="row">
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 500 }}>{a.title}</span>
            {q && <span className="small muted">{a.section}</span>}
          </span>
          <span aria-hidden="true">›</span>
        </Link>
      ))}
    </div>
  );
}

export function HandbookArticle() {
  const { id = '' } = useParams();
  const articles = useArticles();
  const a = articles?.find((x) => x.id === id);
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  return (
    <>
      <TopBar title={a?.title ?? 'Справочник'} sub={a?.section} back="/handbook" />
      <main className="content">
        {articles && !a && <p className="pad muted">Статья не найдена</p>}
        {a && <Markdown md={a.bodyMd} mark={q ? markFor(q) : undefined} />}
        {a?.source && <p className="pad small muted">{a.source}</p>}
      </main>
    </>
  );
}
