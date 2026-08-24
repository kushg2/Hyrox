# Pushing to github.com/kushg2/Hyrox

The remote is already set and there are two commits on `main`. Unzip, `cd` in,
and run:

```bash
git push -u origin main
```

If GitHub already put a README or .gitignore in the repo when you created it,
that push will be rejected as non-fast-forward. Either force it (the repo is
new, nothing to lose):

```bash
git push -u origin main --force
```

...or rebase onto what's there:

```bash
git pull --rebase origin main && git push -u origin main
```

To use SSH instead of HTTPS:

```bash
git remote set-url origin git@github.com:kushg2/Hyrox.git
```

---

# Then deploy

## Option A — Vercel (recommended)

1. vercel.com -> **Add New -> Project** -> import `kushg2/Hyrox`.
2. Vercel detects Vite. Leave the build settings alone.
3. Add two environment variables before deploying:
   - `VITE_SUPABASE_URL` = `https://<your-project-id>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your publishable (`sb_publishable_...`) or legacy anon key
4. Deploy.

Leave `VITE_BASE` unset — it defaults to `/`, which is what Vercel wants.
Works with a private repo.

## Option B — GitHub Pages

`.github/workflows/deploy.yml` is ready and derives the base path from the
repo name, so it will build for `/Hyrox/` automatically.

1. **Settings -> Secrets and variables -> Actions -> New repository secret**:
   add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. **Settings -> Pages -> Source** -> **GitHub Actions**.
3. Push to `main`, or run the workflow from the Actions tab.

Lands at `https://kushg2.github.io/Hyrox/`.

Pages needs a **public** repo unless you're on a paid plan. The bundle will
contain your Supabase URL and publishable key — that is by design, they are
client-side values — but your sync ID never leaves your devices, and that is
what actually guards the data.

---

# Database

Run `supabase-schema.sql` once in the Supabase SQL editor before expecting
sync to work. Without it the app still runs, just device-only.

# Skipping sync for now

Deploy with no environment variables at all. Everything saves to localStorage
and the app is fully functional — you just won't get phone/laptop sync.
Adding Supabase later is two env vars and a redeploy.
