# Nightly Knowledge

A minimalist, deliberately finite nightly learning feed. It seeds the curated YouTube channels from our list, lets you browse by topic, and makes one persisted random “rabbit hole” pick per local calendar day.

## Stack

- Node.js + Express
- Neon Postgres
- Plain HTML/CSS/JS (zero frontend framework overhead)
- Render web service
- GitHub → Render auto-deploy

## Local run

```bash
cp .env.example .env
# add your Neon pooled connection string to DATABASE_URL
npm install
npm start
```

Then open `http://localhost:3000`.

If `DATABASE_URL` is omitted, the app still runs with in-memory data for UI testing, but the daily pick will reset when the process restarts.

## Neon

Create/use a Neon project and copy its **pooled connection string** into `DATABASE_URL`. Keep `sslmode=require` in the URL.

The server automatically creates and seeds these tables on startup:

- `channels`
- `daily_picks`

No manual migration step is required for the initial deploy. `db/schema.sql` is included for inspection/manual setup.

## Render

This repository includes `render.yaml`.

Create a Render Web Service from the GitHub repo, or use the Blueprint. Set:

- `DATABASE_URL` → your Neon pooled connection string (secret)
- Build → `npm install`
- Start → `npm start`
- Health check → `/api/health`

The Express server binds to `0.0.0.0` and respects Render's `PORT` environment variable.

## Product behavior

- **Pick my rabbit hole** randomly selects a topic, then a channel in that topic.
- The selection is stored by `YYYY-MM-DD`, using the browser's local date.
- Refreshing does not create a new pick.
- **Reroll** intentionally overwrites that day's choice.
- Clicking a topic filters the feed.
- Every channel card links directly to its YouTube channel.

## API

- `GET /api/health`
- `GET /api/topics`
- `GET /api/channels?topic=Science`
- `GET /api/today?date=2026-10-05`
- `POST /api/pick` with `{ "date": "2026-10-05", "reroll": false }`

## Suggested next features

1. Add a “watched” state and lightweight history.
2. Add individual video recommendations instead of only channel links.
3. Add a 30/45/60-minute time-budget filter.
4. Add a tiny weekly recap: topics explored + channels watched.
5. Optional GitHub OAuth if you want this to become multi-user.
