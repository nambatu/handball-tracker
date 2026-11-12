# Handover: move the Handball Tracker to GitHub Pages + Supabase

Written 12 Nov 2026 at the end of a planning chat that will not be continued.
Everything the next session needs is in this file and in `CLAUDE.md`.

## The owner and how to work with him

- **Julian** (GitHub: `nambatu`). Not a programmer by training. Plain words, short answers,
  commands he can copy. He writes in English or German; answer in the language he uses.
- He is on a Claude plan with usage limits. **One focused, tested piece per session**, say the
  size before starting anything big, then stop and report.
- He decided on 12 Nov: **no paid hosting.** The tracker moves to GitHub Pages + Supabase,
  the same setup as his other project CIRCArt (`nambatu/circart-preview`, see its `CLAUDE.md`
  and `src/supabase/migrations/` for patterns he already knows).

## Goal

`tracker.langschwerts.de` serves the app from GitHub Pages. Accounts, game state, archives,
teams, avatars and the ticker outbox live in Supabase. `server.js` is no longer needed in
production. The Raspberry Pi keeps running only the WhatsApp gateway.

Nothing of this is built yet. The plan below is a proposal from reading the code, not tested.

## Where things stand today

- Production runs on a Raspberry Pi at Julian's home: PM2 processes `handball-tracker`,
  `wa-gateway`, `ngrok-tunnel`. Reachable through ngrok (free plan, warning page, no own domain).
- The Pi sits on a poor mobile line behind CGNAT. Nothing can connect *into* it. On 18 Oct a
  ticker message was dropped because the line was down. That is the reason for the move.
- **The Pi stays untouched until the new setup has carried one real match.** Rollback = keep
  using the ngrok address.
- `main` on GitHub is current (commit `43c44fa` + this file). Julian's PC copy under OneDrive
  is one commit behind; before his next `git pull` there: `git checkout lib/outbox.js`.
- `deploy/setup_vps.sh` exists as a fallback for a rented server. Untested on a real machine.
  Not the chosen path.

## What the server does today (everything that needs a new home)

Data is JSON files under `DATA_DIR`, one folder per user:
`users.json` (bcrypt hashes), `<user>/state.json`, `teams.json`, `archives/*.json`,
`avatars/*`, `ticker.json` (ticker settings and rules), `ticker-merk.json` (ids already
ticked), and one global `ticker-outbox.json` (queue + `seq` counter).

| Endpoint | What it does | Notes for the move |
|---|---|---|
| `POST /api/register`, `/api/login`, `GET /api/me` | Username + password, JWT cookie, invitation code (`REGISTRATION_CODE`), rate limit | Supabase Auth is email based. See "Accounts" below. |
| `GET/POST /api/state` | Whole game state per user. `POST` rejects with **409 + server state** when the server `rev` is higher | The 409 contract is what `public/js/sync.js` merges against. Keep it exactly. |
| `GET /api/archives`, `POST /api/archive`, `GET/DELETE/PATCH /api/archive/:filename` | Finished matches | One table, JSON column. |
| `GET/POST /api/teams`, `DELETE /api/teams/:id` | Saved squads | One table. |
| `POST /api/upload-avatar`, `GET /api/avatars/:user/:file` | Images, 2 MB, MIME whitelist, random file name | Supabase Storage. |
| `GET/PUT /api/ticker/config`, `POST /api/ticker/preview` | Ticker settings, rules, live preview | Preview runs the rule engine; it can run in the browser. |
| `GET /api/ticker/chats` | Group list from the gateway | Already dead when tracker and gateway are apart. Drop it; group id is typed by hand. |
| `GET /api/ticker/outbox?since=&wait=25`, `POST /api/ticker/ack` | The gateway collects messages (long-poll, `TICKER_TOKEN`) | See "Ticker" below. This is the hard part. |
| `GET /healthz` | Health check | Not needed. |

The ticker runs **inside `POST /api/state`**, after the state is written, in its own `try`:
`lib/tickerlauf.js` compares the new state with `ticker-merk.json`, applies the rules from
`lib/ticker.js`, and puts messages into `lib/outbox.js`. At match end `lib/ki.js` asks Gemini
for a short analysis (secret `GEMINI_API_KEY`) and queues it as a second message.

## Proposed target design

**Frontend:** `public/` published by GitHub Pages (Julian's CIRCArt uses a `docs/` folder plus
a `CNAME` file). `fetch('/api/...')` calls are spread over `app.js`, `sync.js`, `store.js`,
`stats.js`, `report.js`, `timer.js`, `ui.js`, `whatsapp.js`. Suggestion: one new file
`public/js/api.js` that offers the same operations and talks to Supabase, so the other files
change little. The service worker (`sw.js`) caches by version string; raise it on every change.

**Database:** tables `states` (one row per user, `rev`, JSON), `archives`, `teams`,
`ticker_config`, `ticker_merk`, `ticker_outbox` (with a real sequence for `seq`). Row Level
Security on every table: a user sees only their own rows. Game state stays one JSON document
per user. Do not normalise it now; the merge logic in `sync.js` depends on its shape.

**State push:** a Postgres function or Edge Function `push_state(state)` that does the `rev`
check and the write in one transaction and returns either `ok` or `stale + current state`.
This replaces the 409 answer.

**Ticker:** the rule engine (`lib/ticker.js`, `lib/tickerlauf.js`, `lib/ki.js`) is plain
JavaScript with about 110 tests described in the project notes. Do not rewrite it in SQL.
Run it in a **Supabase Edge Function** that the app calls together with the state push
(same order as today: write state first, ticker afterwards, a ticker failure must never fail
the push). File access in those modules (`fs`, `writeJsonAtomic`) has to be swapped for
database reads and writes.

**Gateway side** (`nambatu/wa-gateway`, `src/outbox.js`, has tests): today it long-polls the
tracker. New source is Supabase. Two ways, pick after checking current Supabase limits:
1. An Edge Function that speaks the existing contract (`since`, `wait`, `ack`), so the gateway
   only gets a new URL and token. The function has to hold the request and look at the table
   every second or two; a 25 s hold means roughly 100k calls a month, the free plan allowed
   500k when this was written.
2. The gateway polls a database function every few seconds. Small change in the gateway,
   no long-poll.
Either way the gateway's regular polling also keeps the free project from being paused.

**Accounts:** only a handful of users exist (Julian, `nicolas_d4`, Jakob, maybe more; count
them in `users.json`). Simplest: usernames become made-up e-mail addresses internally, e-mail
confirmation off, and registration goes through an Edge Function that checks the invitation
code. Whether the old bcrypt hashes can be imported so nobody has to pick a new password is
unverified; if not, the few users register again and their data is attached by username.

## Rules from the existing system that must survive

- **Merge, never replace, on a sync conflict.** Players and actions are united by `id`, the
  merged `rev` is `max(local, remote) + 1`, then pushed again. A lost goal cannot be recovered
  after the match; a player that reappears is deleted in two seconds. (`public/js/sync.js`)
- **`seq` in the outbox must never restart at 1.** The gateway stores its last acknowledged
  number on disk; anything below it is dropped silently and the ticker is dead without an error.
  If the new outbox starts fresh, the gateway's stored position must be reset in the same step.
- **`since` is the highest seq seen, not the acknowledged one. Acknowledge only after sending.**
- **Entries older than 5 minutes expire; actions older than `TICKER_MAX_ALTER_MS` (120 s) are
  never ticked.** No catching up, no batches. Live means live.
- **Switching the ticker on works only forwards.** Actions are noted as seen even while it is off.
- **A marker id contains `state.spielId`**, otherwise time markers stop after the first match.
- **Undo removes a message that is still queued.**
- **Values put into templates are escaped for WhatsApp formatting; the template itself is not.**
- Sending to a wrong WhatsApp group id gives **no error**. Get the id from an incoming message.
- Do not move the DNS of `langschwerts.de` (Microsoft 365 mail). One record for `tracker.` only,
  set by the domain admin, not by Julian. For Pages this is a CNAME to `nambatu.github.io`.
- No secrets in the repo. It is public. The Supabase URL and publishable key are public by design;
  the service key, `GEMINI_API_KEY` and the gateway token are not.

## Open decisions for Julian (ask before building on them)

1. **Which Supabase project?** He has one, `rzptvdlejmdeaanhbbtd`, which is CIRCArt's *preview*
   database. The free plan allows two active projects. If CIRCArt gets its own production
   project later, the tracker would be a third. Options: share a project with CIRCArt in a
   separate schema, or decide now which two projects get the free slots.
2. **Shared login with CIRCArt or separate accounts?** He mentioned the existing player accounts
   as a reason for this setup. Sharing means one project and one user table for both apps.
   The tracker is invitation-only; CIRCArt is not.
3. **Old passwords:** import if possible, or let the few users register again?
4. **handball.net scraper** (`nambatu/handball.net-whatsapp-liveticker`): stopped on the Pi since
   September because two Chromium instances do not fit in its memory. Switching it to the
   gateway is still open and independent of this move.

## Free plan limits to design around

- A free project with too little activity for a week is paused and must be restored by hand.
  The gateway's polling normally prevents that; a Pi that is off for a week does not.
- No backups on the free plan. Build a small export (GitHub Action or a script on the Pi)
  early, before real match data lives only there.
- Check the current numbers on supabase.com/pricing before relying on any figure in this file.

## Suggested order, one session each

1. **Decisions 1 to 3 with Julian**, then schema as migration files, RLS, `push_state`, and
   tests for the `rev`/stale behaviour. Nothing user-visible yet.
2. **`api.js` + login**, app running from GitHub Pages on the `nambatu.github.io` address
   against Supabase, without ticker. Test the four sync scenarios (new player while server is
   ahead, actions on conflict, offline then online, normal case) with two browser windows.
3. **Archives, teams, avatars.**
4. **Ticker:** Edge Function with the existing rule engine, outbox table, ticker settings UI.
5. **Gateway:** new source, reset of its stored position, one test message into a test group.
6. **Data move from the Pi** (Julian runs `./scripts/backup.sh` there and provides the tarball),
   CNAME for `tracker.langschwerts.de`, one real match, then switch off ngrok and the old
   `handball-tracker` process (`pm2 delete ... && pm2 save`).

Julian can ask the domain admin for the CNAME at any time; it is the step with the longest wait.

## Tools and access

- A local Claude Code session on Julian's PC has a real terminal: git, and SSH to the Pi if he
  sets it up. The planning chat had neither (virtualisation is off on his PC, so the sandboxed
  shell there did not start).
- A Supabase connector was available in the planning chat and may be in the next session too.
  Follow the CIRCArt habit: schema changes are numbered migration files, not ad-hoc SQL.
- More background (in German) lives in the claude.ai project "Handball Tracker & Ticker":
  `deployment-pi.md`, `vps-umzug.md`, `whatsapp-gateway.md`, `ticker-tracker-seite.md`,
  `sync-konflikte.md`, `offline-und-heim-gast.md`, `court-view-layout.md`,
  `roadmap-code-review.md`, `markt-und-wettbewerb.md`. They are not in this repo. If a session
  cannot see them, ask Julian to paste the one that is needed.
