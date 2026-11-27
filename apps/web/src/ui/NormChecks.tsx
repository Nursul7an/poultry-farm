import { Link } from 'react-router-dom';
import type { Check } from '@farm/core';

const MARK = { ok: '✔', warn: '!', crit: '!!' } as const;
/** Handbook search words for each check, so «Что делать?» opens the right articles. */
const TOPIC: Record<string, string> = { mortality: 'падёж', week1: 'отход первой недели', temp: 'температура', water_feed: 'вода корм', rh: 'влажность' };

/** Result of checking a day against the farm's norms (Arbor Acres unless the director changed them). */
export function NormChecks({ checks, house }: { checks: Check[]; house: string }) {
  const bad = checks.filter((c) => c.level !== 'ok');
  return (
    <section aria-label="Проверка по нормам">
      <h2 className="pad" style={{ margin: 0, fontSize: 17 }}>{bad.length ? `По нормам: ${bad.length} ${bad.length === 1 ? 'отклонение' : 'отклонения'}` : 'По нормам всё в порядке'}</h2>
      <div className="section">
        {checks.map((c) => (
          <div className="row" key={c.code} data-level={c.level} style={{ alignItems: 'flex-start' }}>
            <span aria-hidden="true" className={c.level === 'ok' ? 'ok-t' : c.level === 'warn' ? 'warn-t' : 'bad-t'} style={{ width: 22, fontWeight: 700 }}>{MARK[c.level]}</span>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <b style={{ fontWeight: 500 }}>{c.title}</b>
              <span className="small muted num">{c.detail}</span>
              {c.level !== 'ok' && (
                <span className="small" style={{ display: 'flex', gap: 12, marginTop: 2 }}>
                  <Link to={`/handbook?q=${encodeURIComponent(TOPIC[c.code] ?? c.title)}`}>Что делать?</Link>
                  <Link to={`/ask?q=${encodeURIComponent(`${house}: ${c.title.toLowerCase()} — ${c.detail}. Что проверить и что делать?`)}`}>Спросить помощника</Link>
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
