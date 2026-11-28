/** Blocks (кашары) and their batches: cards for the director's «Ферма» and the worker's «Сегодня». */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { dayOfAge } from '@farm/core';
import { useOnline, useSignedIn, useSyncStatus } from '../app';
import type { BlockInfo, HouseToday } from '../api/types';
import { SELECTED_HOUSE_KEY } from '../screens/useHouses';
import { fmtDayShort, fmtInt, fmtNum, fmtTime } from './format';

/** Blocks from the server, the last result cached per user so the cards also show offline. */
export function useBlocks() {
  const { api, session } = useSignedIn();
  const online = useOnline();
  const key = `farm-blocks-${session.userId}`;
  const [blocks, setBlocks] = useState<BlockInfo[] | null>(() => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } });
  const reload = useCallback(async () => {
    try { const b = await api.blocks(); setBlocks(b); try { localStorage.setItem(key, JSON.stringify(b)); } catch { /* full */ } }
    catch { /* offline: keep the cached list */ }
  }, [api, key]);
  // Reload after each sync too, so a batch started on this phone shows as soon as it reaches the server.
  const st = useSyncStatus();
  useEffect(() => { void reload(); }, [reload, online, st?.lastSyncAt]);
  return { blocks, reload };
}

export function BlockCards({ blocks, today, rows }: { blocks: BlockInfo[]; today: string; rows?: HouseToday[] | null }) {
  const nav = useNavigate();
  const { session } = useSignedIn();
  const head = session.role === 'head';
  const open = (houseBatchId: string) => { try { localStorage.setItem(SELECTED_HOUSE_KEY, houseBatchId); } catch { /* */ } nav('/today'); };
  return (
    <div className="block-grid pad">
      {blocks.filter((b) => b.active || b.open).map((b) => {
        const r = b.open ? rows?.find((x) => x.houseBatchId === b.open!.houseBatchId) : undefined;
        const day = b.open ? dayOfAge(b.open.placedOn, today) : 0;
        return (
          <article key={b.houseId} className="block-card" aria-label={b.name}>
            <div className="block-head">
              <span className={`block-badge${b.open ? '' : ' empty'}`} aria-hidden="true">{b.code}</span>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}><b style={{ fontSize: 17 }}>{b.name}</b>
                <span className="small muted">{b.open ? `Партия ${b.open.number}` : 'Пустой'}{` · ${fmtInt(b.areaM2)} м²`}</span></span>
            </div>
            {b.open ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span style={{ fontSize: 28, fontWeight: 700 }}>День {day}</span><span className="small muted">с {fmtDayShort(b.open.placedOn)}</span></div>
                <div className="block-progress" aria-hidden="true"><div style={{ width: `${Math.min(100, Math.round((day / 42) * 100))}%` }} /></div>
                <div className="block-stats small muted">
                  <span>Живых<br /><b>{fmtInt(r?.liveBirds ?? b.open.placed)}</b></span>
                  <span>Сохр.<br /><b>{r ? `${fmtNum((r.liveBirds / r.placed) * 100)}%` : '—'}</b></span>
                  <span>Журнал<br /><b className={r?.today ? 'ok-t' : 'warn-t'}>{r?.today ? fmtTime(r.today.loggedAt) : 'нет'}</b></span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn" style={{ flex: 1 }} onClick={() => open(b.open!.houseBatchId)}>Открыть блок</button>
                  {head && <Link className="btn" to={`/batch/${b.open.batchId}/close`}>Закрыть партию</Link>}
                </div>
              </>
            ) : (
              <>
                <span className="small muted">{b.last ? `Прошлая партия ${b.last.number}${b.last.closedAt ? ` закрыта ${fmtDayShort(b.last.closedAt.slice(0, 10))}` : ''}` : 'Партий ещё не было'}</span>
                {b.last?.result && (
                  <div className="block-stats small muted" aria-label={`Итог ${b.last.number}`}>
                    <span>Сохр.<br /><b>{b.last.result.survivalPct != null ? `${fmtNum(b.last.result.survivalPct)}%` : '—'}</b></span>
                    <span>Вес<br /><b>{b.last.result.avgWeightKg != null ? `${fmtNum(b.last.result.avgWeightKg, 2)} кг` : '—'}</b></span>
                    <span>FCR<br /><b>{b.last.result.fcr != null ? fmtNum(b.last.result.fcr, 2) : '—'}</b></span>
                  </div>
                )}
                <Link className="btn primary block" to={`/batch/new/${b.houseId}`}>+ Новая партия {b.nextNumber}</Link>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
