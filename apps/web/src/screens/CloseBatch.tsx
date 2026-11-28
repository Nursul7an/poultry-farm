import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useOnline, useSignedIn } from '../app';
import type { BatchResultJson, BatchRow } from '../api/types';
import { TopBar } from '../ui/parts';
import { useBatchRecords } from '../ui/batchData';
import { errText } from '../ui/people';
import { fmtDayShort, fmtInt, fmtNum } from '../ui/format';

/** Director: the batch is over — see its result, then close it. The block becomes empty and gets a new number next time. */
export default function CloseBatch() {
  const { batchId = '' } = useParams();
  const { api, sync } = useSignedIn();
  const online = useOnline();
  const nav = useNavigate();
  const [batch, setBatch] = useState<BatchRow | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.batches().then((b) => setBatch(b.find((x) => x.id === batchId) ?? null)).catch((e) => setErr(errText(e))); }, [api, batchId, online]);
  const { result, error } = useBatchRecords(batch);

  if (batch === undefined && !err) return <><TopBar title="Закрыть партию" back="/farm" /><main className="content"><p className="pad muted">Загрузка…</p></main></>;
  if (!batch) return <><TopBar title="Закрыть партию" back="/farm" /><main className="content"><div className="banner bad">{err ?? 'Партия не найдена'}</div></main></>;
  if (batch.status === 'closed') return <><TopBar title={`Партия ${batch.number}`} back="/farm" /><main className="content"><div className="banner info">Партия уже закрыта{batch.closedAt ? ` ${fmtDayShort(batch.closedAt.slice(0, 10))}` : ''}.</div></main></>;

  const r = result;
  const noHandover = r && !r.handedBirds;
  const rows: [string, string, string?][] = r ? [
    ['Посажено', `${fmtInt(r.placed)} гол`],
    ['Падёж и брак за партию', `${fmtInt(r.losses)} гол`],
    ['Сдано', r.handedBirds ? `${fmtInt(r.handedBirds)} гол · ${fmtInt(r.handedKg)} кг` : 'сдачи нет', r.handedBirds ? undefined : 'warn-t'],
    ['Сохранность', r.survivalPct != null ? `${fmtNum(r.survivalPct)}%` : '—'],
    ['Средний вес', r.avgWeightKg != null ? `${fmtNum(r.avgWeightKg, 2)} кг` : '—'],
    ['Корма скормлено', `${fmtNum(r.feedKg / 1000)} т`],
    ['Конверсия корма (FCR)', r.fcr != null ? fmtNum(r.fcr, 2) : '—'],
    ['Дней выращивания', r.days != null ? String(r.days) : '—'],
    ['Индекс эффективности (EPEF)', r.epef != null ? fmtInt(r.epef) : '—'],
  ] : [];

  async function close() {
    if (!r) return;
    setBusy(true); setErr(null);
    try {
      const stored: BatchResultJson = { ...r };
      await api.closeBatch(batch!.id, stored);
      await sync.refresh();
      nav('/farm', { replace: true, state: { closed: batch!.number } });
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }

  return (
    <>
      <TopBar title={`Закрыть партию ${batch.number}`} sub={`${batch.houseName} · посадка ${fmtDayShort(batch.placedOn)}`} back="/farm" />
      <main className="content" style={{ paddingBottom: 120 }}>
        {!online && <div className="banner warn">Нет сети. Закрыть партию можно только онлайн.</div>}
        {(error || err) && <div className="banner bad" role="alert">{err ?? error}</div>}
        {!r && !error && <p className="pad muted">Считаю итог…</p>}
        {r && (
          <>
            <h2 className="pad" style={{ margin: 0, fontSize: 17 }}>Итог партии</h2>
            <div className="section">
              {rows.map(([k, v, cls]) => <div className="row" key={k}><span style={{ flex: 1 }}>{k}</span><span className={`num ${cls ?? ''}`}>{v}</span></div>)}
            </div>
            {noHandover && <div className="banner warn">Сдача птицы не записана — вес, конверсия и выручка не посчитаются. Запишите сдачу («Ещё → Отлов и сдача») или закройте, если партия списана.</div>}
            {r.unaccounted != null && r.unaccounted !== 0 && (
              <div className="banner warn">Не сходится на {fmtInt(Math.abs(r.unaccounted))} гол: посажено − падёж − сдано = {fmtInt(r.unaccounted)}. Проверьте журналы и сдачи.</div>
            )}
            <p className="pad small muted" style={{ margin: 0 }}>После закрытия записи этой партии нельзя менять, а блок станет пустым — можно начинать новую партию. Итог сохранится в карточке блока и в «Деньгах».</p>
          </>
        )}
      </main>
      <div className="sticky-save">
        <button className="btn primary big block" disabled={busy || !online || !r} onClick={() => void close()}>{busy ? 'Закрываю…' : `Закрыть партию ${batch.number}`}</button>
      </div>
    </>
  );
}
