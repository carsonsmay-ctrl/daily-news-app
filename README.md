# Daily Briefing

A personal, ad-free morning news app for iPhone. It's a small installable web app (PWA): one screen with today's date and five sections of headlines. Each story has a one-line summary, the source, and a link to the full article.

1. **Software deals**: acquirers and roll-ups, driven by an editable watchlist (Bending Spoons, ESW Capital). This section always appears, even on slow days.
2. **Distressed deals & M&A**: bankruptcies, wind-downs, shutdowns, plus notable acquisitions.
3. **Regenerative ag & grazing**
4. **Cattle & ag markets**
5. **Ag tech & startups**

A scheduled job runs every morning at about 7:15 AM Central. It pulls the last 24–36 hours of stories from free RSS feeds and Google News searches, removes duplicates and low-value items, ranks what's left, and keeps 3–7 per section. If an API key is set, Claude writes the summaries. The job saves the briefing as JSON, and the app keeps 30 days so you can scroll back.

Everything runs on free tiers: GitHub Actions for the daily job, and GitHub Pages or Cloudflare Pages for hosting. The only optional cost is the Claude API, at a few cents a day.

---

## Quick start (local)

Requires Node.js 20+.

```bash
npm install
npm run fetch      # builds today's briefing → public/data/YYYY-MM-DD.json
npm run serve      # open http://localhost:8080
npm test           # unit tests for parsing / ranking / dedupe
```

`npm run fetch` works without an API key. In that case it uses each article's own snippet as the summary. Note: Google News results don't include a usable snippet, so many items will show only the headline and source.

To get AI-written one-line summaries plus smarter filtering of low-value stories:

```bash
export ANTHROPIC_API_KEY=sk-ant-...      # never commit this
npm run fetch
```

or put `ANTHROPIC_API_KEY=...` in a `.env` file (already git-ignored) and run `node --env-file=.env scripts/fetch.mjs`.

Other options:

| Command | What it does |
|---|---|
| `npm run fetch` | Build (or rebuild) today's briefing |
| `node scripts/fetch.mjs --no-llm` | Use feed snippets even if a key is set |
| `node scripts/fetch.mjs --date 2026-11-20` | Label the output with a specific date |
| `node scripts/fetch.mjs --if-needed --not-before 7` | What the scheduler runs: skip if today's file exists or it's before 7:00 local |
| `BRIEFING_MODEL=claude-haiku-5-5 npm run fetch` | Use a cheaper/faster model (default: `claude-opus-5-5`) |
| `npm run icons` | Regenerate the app icons |

---

## Add it to your iPhone home screen

1. Open the deployed URL (see **Deploy** below) in **Safari** on the iPhone.
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. Launch it from the home screen. It opens full-screen with no browser bars.

Using the app:
- Tap a section chip at the top to jump to it. Tap any story to open the full article.
- **‹ / ›** move between days (the last 30 are kept).
- Offline, the app shows the most recent briefings you've opened.
- When you return to the app on a new morning it loads the new briefing automatically. **Refresh** at the bottom forces a reload.

---

## Edit topics and the watchlist

### Software-deals watchlist: `config/watchlist.txt`

Put one company per line. Lines starting with `#` are ignored. Add search aliases after a `|`:

```
Bending Spoons
ESW Capital | Trilogy International | IgniteTech
Constellation Software | Volaris | Jonas Software
```

Each line becomes its own Google News search. Stories that mention any name or alias are boosted to the top of **Software deals** and tagged **Watchlist**. The file includes some commented-out suggestions.

### Sections, searches, and feeds: `config/sections.json`

Each entry in `sections` controls one section, in display order:

| Field | Meaning |
|---|---|
| `title` | Heading shown in the app |
| `googleNewsQueries` | Google News searches (normal search syntax: `"exact phrase"`, `OR`, `-exclude`) |
| `feeds` | Extra RSS/Atom feed URLs |
| `keywords` | Term → weight. Higher weights rank stories higher. A story must match at least one keyword (or a watchlist name) to be kept. |
| `mustMatchAny` | Optional. The story must contain one of these words. Use it to keep off-topic search noise out. |
| `minItems` / `maxItems` | How many stories to show (default 3–7) |
| `hoursBack` | Look-back window in hours (default 36; 72 for the slower regen-ag and ag-tech topics) |
| `alwaysShow` | Never hide the section. On a slow day the window widens to the past week. |
| `useWatchlist` | Include the watchlist searches and boost |
| `llmFocus` | One sentence telling the AI what matters for this section (used for relevance scoring) |

Global settings in the same file:
- `blockedSources`: outlets to drop completely, such as auto-generated stock or quote sites.
- `preferredSources`: outlets that get a small ranking boost.
- `lowValuePatterns`: headline regexes to drop (price targets, listicles, ticker pages, and so on).
- `archiveDays`: how many days to keep.
- `timezone`: the timezone used to date the briefing.

After editing, run `npm run fetch` to check the result, then commit and push. The next scheduled run uses your changes.

---

## Change the run time

The schedule is in `.github/workflows/daily-briefing.yml`. GitHub cron runs in **UTC** and doesn't adjust for daylight saving time, so the workflow schedules runs for both CDT and CST:

```yaml
schedule:
  - cron: "15 12 * * *"   # 7:15 CDT (summer)
  - cron: "45 12 * * *"   # 7:45 CDT backup
  - cron: "15 13 * * *"   # 7:15 CST (winter)
  - cron: "45 13 * * *"   # 7:45 CST backup
```

and the job runs `node scripts/fetch.mjs --if-needed --not-before 7`. Any run before 7:00 Central, or after today's briefing already exists, exits right away. Only one run per day does the work.

To change the time, say to **6:00 AM Central**:
1. Shift the crons: `0 11`, `30 11`, `0 12`, `30 12`. Central time is UTC−5 in summer and UTC−6 in winter.
2. Change `--not-before 7` to `--not-before 6`.

GitHub can delay scheduled runs by 5–30 minutes under load, which is why there's a backup run and a ~45-minute buffer before 8:00. You can also run it any time from the **Actions** tab → **Daily briefing** → **Run workflow**. A manual run always rebuilds today's briefing.

---

## Deploy

The repo is ready to deploy as-is. Pick one option.

### Option A: GitHub Actions + GitHub Pages (simplest)

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions:**
   - Add a **secret** named `ANTHROPIC_API_KEY` (optional; without it the app uses feed snippets).
   - Optional: add a **variable** named `BRIEFING_MODEL` (e.g. `claude-haiku-5-5`) to override the model.
4. **Actions** tab → **Daily briefing** → **Run workflow** to build the first briefing and deploy it.
5. Your app is at `https://<your-username>.github.io/<repo-name>/`. Open that on your iPhone and add it to the home screen.

Each morning the workflow fetches the news, commits the new JSON to `public/data/` (the archive lives in git), and deploys `public/` to Pages.

> On a free GitHub account, Pages requires the repo to be **public**. That means your config and briefings are publicly visible, but your API key stays private as a secret. If you want a private repo, use Option B.

### Option B: GitHub Actions + Cloudflare Pages (works with private repos, free)

1. Push to a (private) GitHub repo and add the `ANTHROPIC_API_KEY` secret as above.
2. In `.github/workflows/daily-briefing.yml`, delete the `upload-pages-artifact` step and the entire `deploy` job. The workflow then only fetches and commits.
3. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, then pick the repo.
   - Build command: *(leave empty)*
   - Build output directory: `public`
4. Cloudflare redeploys automatically whenever the workflow commits a new briefing. Your app is at `https://<project>.pages.dev`.

Vercel works the same way: import the repo, set Framework to **Other**, leave the build command empty, and set the output directory to `public`. Vercel's free Hobby plan is for personal, non-commercial use.

### Cost

- GitHub Actions: each run takes about 1 minute. That's well under the free 2,000 min/month for private repos, and Actions are unlimited for public repos.
- Pages / Cloudflare Pages: free.
- Claude API (optional): 5 short requests a day. With the default `claude-opus-5-5` that's roughly a few cents a day. Set `BRIEFING_MODEL=claude-haiku-5-5` to make it cheaper still.

---

## How it works

```
config/sections.json, config/watchlist.txt
        │
scripts/fetch.mjs ──► Google News RSS searches + RSS feeds (scripts/lib/rss.mjs)
        │           ► score: keywords, watchlist, source, freshness; drop blocked/low-value/off-topic (scripts/lib/rank.mjs)
        │           ► dedupe within and across sections (same URL, similar headline, shared names)
        │           ► Claude: one-line summary + 0–10 relevance per story; drop < 4 (scripts/lib/summarize.mjs)
        ▼
public/data/YYYY-MM-DD.json, latest.json, index.json (last 30 days)
        ▼
public/index.html + app.js (static PWA) · sw.js caches app shell + briefings for offline
```

- **No API key, or the API call fails:** the summary falls back to the article's description, and ranking is heuristic only. The app always works.
- **Story placement:** a story appears in only one section, the first one it qualifies for.
- **Model:** the summarizer uses `claude-opus-5-5` at low effort with structured JSON output. It also enables Anthropic's server-side fallback, so a rare safety decline is retried on another model. Override the model with `BRIEFING_MODEL`.

## Project layout

```
config/            sections.json (topics, searches, feeds, filters) · watchlist.txt
scripts/fetch.mjs  daily job / local fetch
scripts/lib/       rss.mjs · rank.mjs · summarize.mjs
scripts/serve.mjs  local static server
scripts/make-icons.mjs  generates public/icons/*
public/            the PWA (index.html, app.js, styles.css, sw.js, manifest, icons, data/)
test/              node:test unit tests
.github/workflows/daily-briefing.yml  schedule + deploy
```

## Troubleshooting

- **A feed shows `failed (HTTP 4xx/5xx)` in the fetch output.** Feeds fail occasionally and the rest of the briefing still builds. If one keeps failing, remove it from `feeds`.
- **A section is full of junk from one site.** Add the outlet to `blockedSources` or add a headline pattern to `lowValuePatterns`.
- **The iPhone shows yesterday's briefing.** Pull it up from the background or tap **Refresh**. Also check that the Action ran (Actions tab).
- **The service worker won't register locally on a phone.** Service workers need HTTPS, except on `localhost`. Test offline mode on the deployed site.
