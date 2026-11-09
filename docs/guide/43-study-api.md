---
title: Study data API
group: Reference
summary: Let a dashboard or another app, like Plain, read your study time and how it went. Read-only, and off until you turn it on.
---
Tide logs your study time by itself: lessons, reading, practice, review, chat and exams, each against what you were studying. The study data API lets other apps read it, so you can see your study hours in a dashboard, a widget or a spreadsheet.

1. **Turn it on.** **Settings → Tools → Study data API**, then **Share my study data**.
2. **Copy the token.** Every request but `/v1/health` needs it, as `Authorization: Bearer <token>` (or `?token=` where a header isn't possible).
3. **Point your app at it.** `http://127.0.0.1:47820/v1` while Tide is open.

```bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:47820/v1/today
```

> [!info] Private by default
> It only answers apps on this Mac. Turn on **Other devices on my network** to reach it from your phone or another computer on the same Wi-Fi. It's read-only: nothing can change Tide through it. **New token** stops anything using the old one.

## Endpoints

| Endpoint | Gives you |
| --- | --- |
| `GET /v1/health` | `{ ok, app, version }`, no token needed |
| `GET /v1/today` | Minutes today and this week, the streak, sessions and cards today, and what's being studied right now |
| `GET /v1/summary?days=30` | Everything a dashboard needs for the last 1–366 days (below) |
| `GET /v1/sessions?from=2026-11-01&to=2026-11-09` | Every study session in that range. Filter with `activity=lesson` or `notebook=Mathematics` |

## What the summary holds

| Field | What it is |
| --- | --- |
| `totals` | Minutes `today`, `thisWeek` (from Monday), `thisMonth` and `inRange`; `sessions`, `studyDays`, `averagePerStudyDay`, `streak` and `longestStreak` (days) |
| `days` | One entry per day: `date`, `minutes`, `sessions`, `cards` reviewed, `answers` given and their `accuracy` |
| `activities` | Minutes and sessions per kind: `lesson`, `reading`, `practice`, `review`, `chat`, `exam`, `study` |
| `notebooks` | Minutes per notebook |
| `topics` | The ten things you spent longest on |
| `hours` | Minutes started in each hour of the day, 0 to 23: when you study |
| `flashcards` | Cards reviewed, and how many were again, hard, good and easy |
| `answers` | Answers in lessons and quizzes: right, partly right, wrong and the average score |
| `now` | What's being studied right now, when Tide is open on something |

Days are your Mac's local days. Times in sessions are ISO 8601.

## A session

```json
{
  "start": "2026-11-09T10:02:00.000Z",
  "end": "2026-11-09T10:27:00.000Z",
  "minutes": 25,
  "activity": "lesson",
  "label": "teach: The invention of zero",
  "notebook": "Mathematics",
  "path": "Mathematics/The invention of zero.md"
}
```

## Using it from a browser

The API sends CORS headers, so a dashboard page can call it with `fetch`:

```js
const res = await fetch('http://127.0.0.1:47820/v1/summary?days=30', { headers: { Authorization: 'Bearer <token>' } })
const summary = await res.json()
```
