# Design brief: Broiler farm app
2026-11-24 · v0.1 · Platforms: **both**: Android phone (operator, vet, storekeeper, owner) and desktop web (manager) · Stack: TBD at the spec stage (React Native or Flutter + React web)
Input: `BLUEPRINT.md` (roles, journeys, screen inventory, alert rules). This brief does not repeat it.

**Surface type:** work app UI. Expert-UX rules lead; the visual direction serves clarity.

## 1. Users and context
| Role | Where / how | Today | Frequency |
|---|---|---|---|
| House operator | inside the house, dust, dim light at night, wet or dirty hands, one hand, weak signal | paper logbook | 1–2 logs/day, tasks several times/day |
| Manager | office (desktop, long sessions) + walking between houses (phone) | Excel + phone calls | dozens of checks/day |
| Vet | between houses, phone | notebook | several times/week |
| Storekeeper | feed area, phone | waybills | 2–3 deliveries/week |
| Owner | anywhere, phone, a few minutes | calls the manager | 1–2×/day |

## 2. Platform split
| Role | Main device | Mobile | Desktop | Why |
|---|---|---|---|---|
| Operator | phone | Today, daily log, weighing, tasks, placement checks | — | work happens inside the house |
| Manager | desktop + phone | alerts, house quick view | farm overview, house trends, calendar, catch plan, batch report, setup | compares 6 houses × many series, plans and reconciles |
| Vet | phone | treatment, post-mortem, withdrawal | (reads the manager's views) | at the house |
| Storekeeper | phone | delivery, bin stock | — | at the truck |
| Owner | phone | overview, batch report | report export | remote, short sessions |

## 3. Key scenarios
| # | Scenario | Platform | Frequency | Cost of error | Target time |
|---|---|---|---|---|---|
| 1 | Operator records the daily log | mobile, offline | daily × 6 houses | wrong FCR or missed alarm | **< 3 min** |
| 2 | Manager spots and handles an off-norm house | desktop | daily | dead birds | alert → action < 10 min |
| 3 | Weekly weighing → CV% | mobile | weekly | wrong feed or catch decisions | 100 birds in < 15 min |
| 4 | Vet logs a treatment; withdrawal guards the catch | mobile → desktop | per case | regulatory or buyer rejection | < 1 min entry |
| 5 | Manager closes the batch | desktop | per batch | wrong profit and FCR | < 15 min |

## 4. Assumptions (need confirmation)
- Same farm as the blueprint: 6 houses × ~19,800 birds; batch placed 01.11.2026, today is day 23.
- Weight targets in the mockups are **placeholders** until the Aviagen AA Performance Objectives are provided.
- UI in Russian; Kyrgyz added later.
- Operator phones: Android, 360–412 dp wide; mockups at 390×844.

## 5. Information architecture
- **Operator (mobile, bottom tabs):** Сегодня · Журнал · Взвешивание · Ещё. The home screen is Today, with one big action: "Заполнить журнал".
- **Vet (mobile):** Здоровье · Тревоги · Лечение · Птичники.
- **Storekeeper (mobile):** Корм · Поставки · Остатки.
- **Owner (mobile):** Обзор · Партии · Отчёты.
- **Manager (desktop, left sidebar):** Ферма · Тревоги · Календарь партии · Птичники · Отлов · Отчёты · Нормы · Настройки. Uses master–detail; the house page has charts plus an alert side panel.

## 6. Visual direction and tokens
**Concept: "a house instrument panel".** The look comes from the house itself: galvanized steel, water lines, heat lamps. The ground is cool neutral grey; one deep "water-line" blue marks actions; status colours are never decorative.

**The one memorable element: the *age ruler* (линейка возраста).** A 0–42 day strip appears on every batch and house screen. It shows today's position and the milestones (day 7 check, day 10 starter→grower, day 18 pellets, day 25 finisher, catch −3, −2, −12 h). It is the farm's real clock, and it replaces the generic progress bar.

**Principles**
1. A number is always shown beside its norm: value, then a norm band, then the difference. Never a bare number.
2. Status = colour + icon + word (норма / внимание / тревога). It is readable without colour.
3. The operator sees one action at a time, in the thumb zone; the manager sees all houses at once in a table.

| Token | Value | Use |
|---|---|---|
| `--color-bg-base` | #EEF1F3 | app ground (galvanized) |
| `--color-bg-surface` | #FFFFFF | panels, rows |
| `--color-text-primary` | #18212B | main text (15.9:1 on white) |
| `--color-text-secondary` | #52606D | labels (6.3:1 on white) |
| `--color-border` | #D5DBE0 | dividers |
| `--color-accent` | #0D5C7D | primary action, links (7.3:1 on white) |
| `--color-status-ok` | #1D7044 | норма |
| `--color-status-warning` | #A35200 | внимание (orange, separable from blue) |
| `--color-status-critical` | #B3202A | тревога |
| `--color-status-info` | #3A4FA0 | info / pending sync |
| `--color-norm-band` | #DCE9E2 | norm range band |

**Type:** IBM Plex Sans (Cyrillic, industrial, clear digits), tabular figures for every number. Mobile scale 13/15/17/20/28/40; desktop 12/14/16/20/24/32. Weights 400/500/600.
**Spacing:** 4/8 base; mobile margin 16; mobile row height 56; desktop table row 40 (compact 32).
**Radius:** 8 for controls, 12 for panels; no shadows on rows; panels separated by borders.
**Touch targets:** ≥ 48 dp on mobile, steppers 56 dp; ≥ 32 px on desktop.
**Motion:** 150 ms state changes only; no entrance animations.

## 7. Screens (states are drawn on the canvas)
Every screen has loading (skeleton), empty, error, offline/pending and no-permission states. The operator's offline state is a constant chip: "Нет сети · 2 записи ждут отправки".

## 8. Success metrics
| Metric | How | Target |
|---|---|---|
| Daily log time | app timing from open → save | < 3 min (p80) |
| Log completeness | house-days with a log / all house-days | ≥ 95% |
| Input correction rate | plausibility prompts that lead to a fix | tracked; < 5% |
| Alert → action | timestamp difference | median < 2 h |
| SUS (operators) | survey after 2 weeks | ≥ 75 |
