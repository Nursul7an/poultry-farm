import { Link } from 'react-router-dom';
import { addDays, dayOfAge } from '@farm/core';
import { useLive, useSignedIn } from '../app';
import { TopBar } from '../ui/parts';
import { fmtDayShort, fmtInt } from '../ui/format';
import { useHouseLogs, useHouses } from './useHouses';

export default function History() {
  const { db, today } = useSignedIn();
  const { houses, current, select } = useHouses();
  const logs = useHouseLogs(current?.houseBatchId);
  const outbox = useLive(() => db.outbox.toArray(), [db], []);
  if (!current) return <><TopBar title="Журнал" /><main className="content"><p className="pad muted">Нет птичников</p></main></>;
  const day = today();
  const days: string[] = [];
  for (let d = day; d >= current.placedOn && days.length < 45; d = addDays(d, -1)) days.push(d);

  return (
    <>
      <TopBar title={`Журнал · ${current.houseName}`} />
      <main className="content">
        {houses.length > 1 && (
          <div className="seg pad" role="group" aria-label="Птичник">
            {houses.map((h) => <button key={h.houseBatchId} className={h.houseBatchId === current.houseBatchId ? 'on' : ''} onClick={() => select(h.houseBatchId)}>{h.houseName}</button>)}
          </div>
        )}
        <div className="section">
          {days.map((d) => {
            const l = logs.find((x) => x.productionDay === d);
            const o = l && outbox.find((x) => x.logId === l.id);
            const status = !l ? <span className="warn-t">нет записи</span>
              : o?.status === 'rejected' ? <span className="bad-t">не принято</span>
              : o ? <span className="info-t">ждёт отправки</span>
              : <span className="ok-t">отправлено</span>;
            return (
              <Link key={d} to={`/log/${current.houseBatchId}/${d}`} className="row">
                <span className="num" style={{ width: 64 }}>{fmtDayShort(d)}</span>
                <span className="muted num" style={{ width: 56 }}>д. {dayOfAge(current.placedOn, d)}</span>
                <span className="num" style={{ flex: 1 }}>{l ? `${l.deaths}+${l.culls} · ${fmtInt(l.feedKg)} кг` : ''}</span>
                <span className="small">{status}</span>
              </Link>
            );
          })}
        </div>
      </main>
    </>
  );
}
