import { NavAccount } from './account';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useApp, useOnline, useSyncStatus } from '../app';

const paths: Record<string, string> = {
  today: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
  log: 'M6 3h9l3 3v15H6zM9 10h6M9 14h6M9 18h4',
  queue: 'M4 12h10M10 6l6 6-6 6M20 5v14',
  farm: 'M3 11l9-7 9 7v9H3z',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2M18 12h2M12 4v2M12 18v2',
  back: 'M15 5l-7 7 7 7',
  check: 'M5 12l5 5L20 7',
  offline: 'M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M3 3l18 18',
  warn: 'M12 3l10 18H2L12 3zM12 10v5M12 18v.5',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
  feed: 'M6 4h12l-2 6H8zM8 10v9h8v-9',
  health: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10zM9 11h6M12 8v6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  events: 'M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0',
  money: 'M4 7h16v12H4zM8 7V5h8v2M12 11v4M10 13h4',
  houses: 'M3 11l9-7 9 7v9H3zM9 20v-6h6v6',
};
export function Icon({ name, size = 24 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

/** Always-visible sync state (states-and-data: offline indicator must not be a 2-second toast). */
export function SyncChip() {
  const s = useSyncStatus();
  const online = useOnline();
  if (!s) return null;
  if (s.rejected) return <NavLink to="/queue" className="sync bad"><Icon name="warn" size={14} />Не принято: {s.rejected}</NavLink>;
  if (!online) return <NavLink to="/queue" className="sync wait"><Icon name="offline" size={14} />Нет сети{s.pending ? ` · ${s.pending} ждут` : ''}</NavLink>;
  if (s.pending || s.syncing) return <NavLink to="/queue" className="sync wait">Отправка… {s.pending || ''}</NavLink>;
  return <NavLink to="/queue" className="sync ok"><Icon name="check" size={14} />Отправлено</NavLink>;
}

/** The farm's clock: day 0 → ~42 with the age milestones (design signature element). */
export function AgeRuler({ day, total = 42 }: { day: number; total?: number }) {
  const pct = (d: number) => `${Math.max(0, Math.min(100, (d / total) * 100))}%`;
  const marks: [number, string, boolean][] = [[7, '7', false], [10, '10', false], [18, '18', false], [25, '25 финиш', true]];
  return (
    <div className="ruler" role="img" aria-label={`Линейка возраста: день ${day} из ${total}`}>
      <div className="track" />
      <div className="fill" style={{ width: pct(day) }} />
      {marks.map(([d, l, w]) => (
        <span key={d}><span className={`tick${w ? ' warn' : ''}`} style={{ left: pct(d) }} /><span className={`lab${w ? ' warn-t' : ''}`} style={{ left: pct(d) }}>{l}</span></span>
      ))}
      <span className="lab" style={{ left: 'auto', right: 0, transform: 'none' }}>отлов</span>
      <span className="now" style={{ left: pct(day) }} />
    </div>
  );
}

export function BottomNav() {
  const { session } = useApp();
  const s = useSyncStatus();
  const n = (s?.pending ?? 0) + (s?.rejected ?? 0);
  const badge = n ? <span className={`badge${s?.rejected ? ' red' : ''}`}>{n}</span> : null;
  if (session?.role === 'head') {
    return (
      <nav className="bottomnav" aria-label="Основное меню">
        <NavLink to="/farm"><Icon name="farm" />Ферма</NavLink>
        <NavLink to="/events"><Icon name="events" />События</NavLink>
        <NavLink to="/money"><Icon name="money" />Деньги</NavLink>
        <NavLink to="/today"><Icon name="houses" />Птичники</NavLink>
        <NavLink to="/more"><Icon name="more" />Ещё {badge}</NavLink>
        <NavAccount />
      </nav>
    );
  }
  return (
    <nav className="bottomnav" aria-label="Основное меню">
      <NavLink to="/today"><Icon name="today" />Сегодня</NavLink>
      <NavLink to="/history"><Icon name="log" />Журнал</NavLink>
      <NavLink to="/feed"><Icon name="feed" />Корм</NavLink>
      <NavLink to="/health"><Icon name="health" />Здоровье</NavLink>
      <NavLink to="/more"><Icon name="more" />Ещё {badge}</NavLink>
      <NavAccount />
    </nav>
  );
}

export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function TopBar({ title, sub, back, right }: { title: string; sub?: string; back?: string; right?: ReactNode }) {
  return (
    <header className="topbar">
      {back && <NavLink to={back} aria-label="Назад" className="btn" style={{ width: 44, padding: 0, border: 0 }}><Icon name="back" /></NavLink>}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {sub && <span className="small muted">{sub}</span>}
        <h1>{title}</h1>
      </div>
      {right ?? <SyncChip />}
    </header>
  );
}
