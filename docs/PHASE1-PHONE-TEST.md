# T-02: Phone test on the workers' real phones

**Why:** the whole app depends on the browser keeping unsent logs on cheap Android phones. If this fails on your workers' phones, we switch the phone app to Flutter before going further.

**Setup:** the head opens the app's HTTPS address (after hosting, see README) on each worker's phone in **Chrome**, signs in as that worker, and taps Chrome menu → *Add to Home screen / Install app*.

## Checklist per phone (write the results down)

| # | Step | Expected | Result |
|---|---|---|---|
| 0 | Phone model, Android version, Chrome version, free storage | — | |
| 1 | Install to home screen, open from the icon | opens full screen, no browser bar | |
| 2 | Open **Отправка** → «Хранение без удаления браузером» | ideally **да** | |
| 3 | Turn on airplane mode. Open the app from the icon | app opens, shows the house | |
| 4 | Save today's log in airplane mode | «Сохранено на телефоне», chip «Нет сети · 1 ждут» | |
| 5 | Fill and save logs for 2–3 houses/days the worker may fill (repeat to reach ~20 saves over the test week) | each saved | |
| 6 | Close the app from recent apps, **reboot the phone**, open the app (still airplane mode) | still signed in; records show «ждёт отправки» | |
| 7 | Turn airplane mode off, open the app | within ~1 min chip becomes «Отправлено» | |
| 8 | Head checks the farm screen | every saved log arrived **exactly once** | |
| 9 | Inside the house (real signal), time how long one daily log takes | < 2 minutes | |

## Decision

- All phones pass 1, 3–8 → **continue with the web app (PWA)**.
- Data lost at step 6 or 8 on any phone, or 2 = «нет» and data disappears within the week → **switch the phone app to Flutter** (server and rules stay the same).

Write the outcome here:

> Date: · Phones tested: · Result: · Decision:
