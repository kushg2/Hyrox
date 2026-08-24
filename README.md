# Split Sheet — HYROX Dallas

A 13-week training, nutrition and metrics app for one athlete and one race
(Men's Doubles, Dallas, 22 November 2026). Installs to your phone's home
screen, works with no signal, and syncs across devices.

---

## Quick start (local)

```bash
npm install
npm run dev
```

Open http://localhost:5173. With no environment variables set, everything
saves to that browser's localStorage — fine for trying it out, but the data
won't follow you to your phone.

---

## Getting it on your phone, with sync

Two pieces: a **host** for the site and a **database** for the data. Both
have free tiers that comfortably cover one user.

### 1. Database — Supabase (~5 minutes)

1. Create a project at [supabase.com](https://supabase.com). Any region;
   `us-east-1` is closest to Austin.
2. Open **SQL Editor**, paste the contents of `supabase-schema.sql`, run it.
3. Go to **Project Settings → API** and copy two values:
   - Project URL
   - `anon` `public` key

### 2. Host — Vercel (~3 minutes)

1. Push this folder to a GitHub repo.
2. At [vercel.com](https://vercel.com), **Add New → Project**, import the repo.
   Vercel detects Vite automatically; don't change the build settings.
3. Before deploying, add two environment variables:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Project URL |
   | `VITE_SUPABASE_ANON_KEY` | your `anon` key |

4. Deploy. You'll get a URL like `hyrox-splitsheet.vercel.app`.

> Environment variables are read at **build** time, so if you add or change
> them later you must redeploy for the change to take effect.

### 3. Pair your phone

1. Open the site on your laptop.
2. Go to **Metrics → Sync**, tap **Copy sync link**.
3. Send it to yourself and open it on your phone once.

Both devices now read and write the same row. Anything you log at the track
is on your laptop by the time you get home.

### 4. Install it to the home screen

- **iPhone:** open in Safari (not Chrome — iOS only allows Safari to install
  web apps), Share → **Add to Home Screen**.
- **Android:** Chrome will offer **Install app**, or use the ⋮ menu.

It then launches full-screen with no browser chrome and runs offline. First
load caches everything; after that the only network call is the data sync.

---

## Deploying to GitHub Pages instead

Already wired up. `.github/workflows/deploy.yml` builds with:

```js
base: process.env.VITE_BASE || "/",   // the workflow sets VITE_BASE
```

Then add `.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push: { branches: [main] }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/deploy-pages@v4
```

Add the two values as repository secrets under **Settings → Secrets and
variables → Actions**, and switch **Settings → Pages → Source** to
*GitHub Actions*.

Vercel is less fiddly, but this keeps everything on the account you already
use for `kushg2.github.io`.

---

## How the data works

The app is **local-first**. Every tap writes to localStorage immediately and
returns — nothing waits on the network. A background push to Supabase follows
on a 1.5-second debounce.

On launch, and whenever the app comes back to the foreground, it compares
timestamps and takes whichever copy is newer. That's last-write-wins, which
is the correct amount of machinery for one person on two devices. The failure
mode to know about: if you edit on your phone in airplane mode *and* on your
laptop at the same time, the later save overwrites the earlier one. In
practice that never comes up.

If Supabase is unreachable, the app keeps working from localStorage and shows
"Offline — saved here, will sync when you're back."

### Locking it down

The default policy lets the anon role read and write any row, so your
40-character sync ID is what protects your data — a capability token, like an
unlisted URL. Nobody can enumerate rows without knowing the ID, and there's
nothing sensitive in a training log.

If you'd rather have real auth, enable Supabase Auth with a magic link, add
a `user_id uuid references auth.users` column, and replace the policies with
`using (auth.uid() = user_id)`. That's maybe an hour of work and means signing
in on each device.

---

## Changing the plan

Everything is data at the top of `src/App.jsx`:

| What | Where |
|---|---|
| Interval, easy, long and circuit sessions | `INTERVALS`, `EASY`, `LONG`, `CIRCUIT` |
| Strength templates by phase | `STRENGTH_A`, `STRENGTH_B` |
| Swap-in alternatives | `ALTS` |
| Meals, macros and shopping quantities | `MEALS` |
| Grocery aisles and pack sizes | `ITEMS`, `STAPLES` |
| Week 1's shopping-week schedule | `WEEK1_FIXED` |
| Daily macro targets | `TARGETS` |
| Race date and week 1 start | `RACE`, `W1_START` |

Paces are derived, not stored — they all come from your current 5K time,
which you update in Metrics.

## Layout

```
src/App.jsx      the whole app: plan data, meals, views, styles
src/storage.js   local-first persistence and sync
src/main.jsx     entry point
public/          PWA icons
supabase-schema.sql
```
