# Waypoint

A personal goal + habit dashboard: onboarding turns a goal into metrics, habits, milestones, and an identity statement, then tracks daily progress against habit-formation research (identity-based habits, if-then planning, visible progress, consistency over intensity). Includes an outreach/pipeline tracker — log contacts by category (potential client, network, referral, friend/family, colleague), mark them reached-out and booked, and watch cumulative pipeline growth on a two-line chart.

Sign in with Google, and your goals, habits, milestones, and contacts are stored in Postgres (via Supabase) and synced across devices. (Google sign-in isn't wired up yet — see "Setting it up" below; until then, the app runs on an anonymous Supabase session per browser.)

## How it's built

Still a single self-contained `index.html` with no build step or npm dependencies — markup, styles, and app logic are split into a handful of plain `<script type="module">` files under `js/`, loaded straight from the filesystem/CDN in the browser:

- `js/config.js` — your Supabase project URL + anon key.
- `js/supabase-client.js` — creates the Supabase client (loaded from a CDN as an ES module).
- `js/auth.js` — Google sign-in, sign-out, session/auth-state helpers.
- `js/db.js` — data access layer: maps the app's in-memory goal/metric/habit/milestone/contact objects to and from Supabase tables.
- `js/app.js` — the app itself (rendering, event handling, mutators), adapted from the original prototype to read/write through `db.js` instead of `localStorage`.

The UI renders itself from an in-memory `state` object (`{ goals: [...] }`), the same way the original prototype did — each mutation still updates `state` and re-renders immediately (so the UI feels instant), and now also fires off the matching Supabase write in the background.

## Setting it up

### 1. Create a Supabase project

Sign up / log in at [supabase.com](https://supabase.com) and create a new project.

### 2. Create the database tables

In the Supabase dashboard, open **SQL Editor → New query**, paste in the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This creates the `goals`, `metrics`, `habits`, `milestones`, and `contacts` tables with Row Level Security policies that scope every row to the signed-in user.

### 3. Set up sign-in

**Option A — defer Google, use anonymous sessions for now (current default).** In Supabase, go to **Authentication → Sign In / Providers → Anonymous Sign-ins** and turn it on. With this on and no Google provider configured, the app automatically signs each visitor into an anonymous Supabase session on load (no button, no gate) — their `auth.uid()` is real, so the database and Row Level Security all work exactly as they will with Google. The catch: an anonymous session lives in that one browser's local storage, so a visitor who clears site data or switches devices gets a fresh, empty account.

**Option B — set up Google sign-in.**

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth 2.0 Client ID (Application type: **Web application**).
2. In Supabase, go to **Authentication → Sign In / Providers → Google** to find the callback URL Supabase expects (`https://<your-project-ref>.supabase.co/auth/v1/callback`) — add that as an **Authorized redirect URI** on the Google OAuth client.
3. Copy the Google Client ID and Client Secret into Supabase's Google provider settings and enable it.
4. In Supabase → **Authentication → URL Configuration**, add the URL(s) you'll serve this app from (e.g. `http://localhost:3000` for local dev, plus your deployed URL) to **Site URL** / **Redirect URLs**.

Once Google is set up, the natural next step is upgrading anonymous visitors in place with [`supabase.auth.linkIdentity()`](https://supabase.com/docs/guides/auth/auth-anonymous#link-an-anonymous-user-to-a-permanent-account) instead of just swapping in the Google button — that keeps the same `auth.uid()`, so anyone who already made goals as a guest keeps them after linking their Google account, rather than landing on an empty one. Ask for this when you're ready.

### 4. Fill in your config

Edit `js/config.js` with your project's URL and anon key (**Project Settings → API** in Supabase). The anon key is meant to be public — Row Level Security is what actually protects data, not secrecy of this key.

### 5. Run it

Serve the folder with anything static (it needs to be served over HTTP, not opened as a `file://` URL, for ES modules and OAuth redirects to work):

```bash
npx serve .
# or
python3 -m http.server
```

Then open the printed URL — you'll land straight in the app on an anonymous session (Option A), or on a Google sign-in gate (Option B).

## Deploying

Since it's still a static site with no build step, any static host works — Vercel, Netlify, GitHub Pages, Cloudflare Pages. If you set up Google sign-in, make sure the URL you deploy to is added to Supabase's Redirect URLs (step 3 above).

## Suggested next steps

- Wire the "suggest for me" onboarding buttons to a real LLM call (e.g. the Claude API) — they currently no-op outside of a claude.ai Artifact.
- Add a loading state while the initial goal list is fetched from Supabase.
- Consider Supabase Realtime if you ever want multi-tab/multi-device live sync instead of sync-on-mutation.
