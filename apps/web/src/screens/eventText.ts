import { FEED_TYPE_RU } from '@farm/core';
import type { FarmEvent } from '../api/types';
import { fmtDayShort, fmtInt, fmtNum } from '../ui/format';

/** Human text for a farm event (director's feed). Money never appears here: the event view has none. */
export function eventText(e: FarmEvent): { mark: '■' | '▲' | '●' | '·'; cls: string; text: string } {
  const d = e.data;
  switch (e.kind) {
    case 'log': return { mark: '·', cls: 'muted', text: `Журнал ${fmtDayShort(d.day)}: падёж ${d.deaths}+${d.culls}, корм ${fmtInt(d.feed_kg)} кг${d.water_l != null ? `, вода ${fmtInt(d.water_l)} л` : ''}` };
    case 'feed': return { mark: '●', cls: 'info-t', text: `Поставка корма: ${FEED_TYPE_RU[d.feed_type as 'grower'] ?? d.feed_type} ${fmtNum(Number(d.tonnes))} т` };
    case 'health_treatment': return { mark: '●', cls: 'bad-t', text: `Лечение: ${d.product}, ${d.course_days} дн., ожидание ${d.withdrawal_days} дн. → убой не ранее ${fmtDayShort(d.earliest_slaughter)}` };
    case 'health_vaccination': return { mark: '·', cls: 'muted', text: `Вакцинация: ${d.product}` };
    case 'health_post_mortem': return { mark: '●', cls: 'info-t', text: `Вскрытие: ${d.findings ?? ''}` };
    case 'weighing': return { mark: d.cv != null && Number(d.cv) > 10 ? '▲' : '·', cls: d.cv != null && Number(d.cv) > 10 ? 'warn-t' : 'muted', text: `Взвешивание: ${fmtInt(Number(d.mean_g))} г, ${d.n} гол.${d.cv != null ? `, CV ${fmtNum(Number(d.cv))}%` : ''}` };
    case 'handover': return { mark: '●', cls: 'info-t', text: `Сдача: ${d.buyer}, ${fmtInt(d.birds)} гол., ${fmtInt(Number(d.kg))} кг` };
    case 'placement': return { mark: '●', cls: 'info-t', text: `Посадка: ${fmtInt(d.placed)} цыплят, пало в дороге ${d.transport_dead ?? 0}` };
    case 'catch_override': return { mark: '■', cls: 'bad-t', text: `Отлов в срок ожидания (до ${fmtDayShort(d.earliest_slaughter)}). Причина: ${d.reason}` };
    default: return { mark: '·', cls: 'muted', text: e.kind };
  }
}
