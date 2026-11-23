#!/usr/bin/env node
// Build today's briefing: fetch feeds → filter/rank/dedupe → summarize → write public/data/*.json
//
// Usage:
//   npm run fetch                 # build (or rebuild) today's briefing
//   node scripts/fetch.mjs --if-needed --not-before 7
//                                 # used by the scheduled job: skip if today's file already exists
//                                 # or if it's earlier than 7:00 in the configured timezone
//   node scripts/fetch.mjs --no-llm   # force snippet summaries even if a key is set
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchText, parseFeed, googleNewsUrl } from "./lib/rss.mjs";
import { parseWatchlist, scoreItem, dedupe, snippetSummary } from "./lib/rank.mjs";
import { hasLlmKey, summarizeSection, describeLlmError, DEFAULT_MODEL } from "./lib/summarize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "public", "data");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function localParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

async function pool(tasks, limit = 6) {
  const results = new Array(tasks.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (i < tasks.length) {
        const idx = i++;
        results[idx] = await tasks[idx]();
      }
    }),
  );
  return results;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const config = JSON.parse(await fs.readFile(path.join(ROOT, "config", "sections.json"), "utf8"));
  const watchlist = parseWatchlist(await fs.readFile(path.join(ROOT, "config", "watchlist.txt"), "utf8").catch(() => ""));
  const tz = config.timezone || "America/Chicago";
  const now = new Date();
  const local = localParts(now, tz);
  const day = opt("--date") || local.date;

  const outFile = path.join(DATA_DIR, `${day}.json`);
  if (flag("--if-needed") && !flag("--force")) {
    const notBefore = Number(opt("--not-before") ?? 0);
    if (local.hour < notBefore) {
      console.log(`It's ${local.hour}:xx in ${tz}; not before ${notBefore}:00 — skipping.`);
      return;
    }
    if (await exists(outFile)) {
      console.log(`Briefing for ${day} already exists — skipping.`);
      return;
    }
  }

  const useLlm = hasLlmKey() && !flag("--no-llm");
  console.log(`Building briefing for ${day} (${tz}). Summaries: ${useLlm ? `Claude (${process.env.BRIEFING_MODEL || DEFAULT_MODEL})` : "feed snippets (no ANTHROPIC_API_KEY)"}`);

  const used = []; // items already placed in an earlier section
  const sectionsOut = [];
  const warnings = [];

  for (const section of config.sections) {
    const hoursBack = section.hoursBack ?? config.hoursBack ?? 36;
    const minItems = section.minItems ?? config.defaultMinItems ?? 3;
    const maxItems = section.maxItems ?? config.defaultMaxItems ?? 7;

    const collect = async (hours) => {
      const days = Math.max(1, Math.ceil(hours / 24));
      const queries = [...(section.googleNewsQueries || [])];
      if (section.useWatchlist) {
        for (const w of watchlist) queries.unshift(w.aliases.map((a) => `"${a}"`).join(" OR "));
      }
      const sources = [
        ...queries.map((q) => ({ url: googleNewsUrl(q, config.googleNews, days), isGoogleNews: true, label: `GN: ${q}` })),
        ...(section.feeds || []).map((u) => ({ url: u, isGoogleNews: false, label: u })),
      ];
      const lists = await pool(
        sources.map((s) => async () => {
          try {
            return parseFeed(await fetchText(s.url), { feedUrl: s.url, isGoogleNews: s.isGoogleNews });
          } catch (err) {
            warnings.push(`${section.id}: ${s.label} failed (${err.message})`);
            return [];
          }
        }),
      );
      const scored = [];
      for (const item of lists.flat()) {
        const r = scoreItem(item, section, { config, watchlist, now, hoursBack: hours });
        if (r) scored.push({ ...item, score: r.score, reasons: r.reasons });
      }
      return dedupe(scored, { seen: used, watchlist });
    };

    let candidates = await collect(hoursBack);
    let widened = false;
    if (section.alwaysShow && candidates.length < minItems) {
      // Slow day: widen the window so the section is never empty.
      const wider = await collect(Math.max(hoursBack, 24 * 7));
      const have = new Set(candidates.map((c) => c.link));
      for (const c of wider) if (!have.has(c.link)) candidates.push({ ...c, older: true });
      candidates = dedupe(candidates, { seen: used, watchlist }).sort((a, b) => (a.older === b.older ? b.score - a.score : a.older ? 1 : -1));
      widened = true;
    }

    // Send a few extra candidates to the LLM so it can discard the weak ones.
    let picked = candidates.slice(0, Math.max(maxItems * 2, 10));
    picked.forEach((it, i) => (it.id = `${section.id}-${i}`));

    if (useLlm && picked.length) {
      try {
        const res = await summarizeSection({ title: section.title, focus: section.llmFocus || section.title }, picked);
        for (const it of picked) {
          const r = res.get(it.id);
          if (r) {
            it.summary = r.summary;
            it.relevance = r.relevance;
          }
        }
        const good = picked.filter((it) => (it.relevance ?? 5) >= 4);
        // keep at least minItems if we have them, so "always show" sections stay populated
        picked = good.length >= minItems ? good : [...good, ...picked.filter((it) => !good.includes(it))].slice(0, Math.max(minItems, good.length));
        picked.sort((a, b) => (a.older === b.older ? (b.relevance ?? 0) - (a.relevance ?? 0) || b.score - a.score : a.older ? 1 : -1));
      } catch (err) {
        warnings.push(`${section.id}: LLM summaries failed (${describeLlmError(err)}); using snippets`);
      }
    }

    picked = picked.slice(0, maxItems);
    used.push(...picked);

    const items = picked.map((it) => ({
      title: it.title,
      summary: it.summary || snippetSummary(it),
      source: it.source,
      url: it.link,
      published: it.published ? it.published.toISOString() : null,
      ...(it.older ? { older: true } : {}),
      ...(it.reasons?.some((r) => r.startsWith("watchlist")) ? { watchlist: true } : {}),
    }));

    if (items.length || section.alwaysShow) {
      sectionsOut.push({
        id: section.id,
        title: section.title,
        items,
        ...(widened ? { note: items.length ? "Slow day — includes stories from the past week." : "No software-deal headlines found this week." } : {}),
      });
    }
    console.log(`  ${section.title}: ${items.length} item(s)${widened ? " (window widened)" : ""}`);
  }

  const briefing = {
    date: day,
    generatedAt: now.toISOString(),
    timezone: tz,
    summarizer: useLlm ? process.env.BRIEFING_MODEL || DEFAULT_MODEL : "snippets",
    sections: sectionsOut,
  };

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(briefing, null, 2) + "\n");
  await fs.writeFile(path.join(DATA_DIR, "latest.json"), JSON.stringify(briefing, null, 2) + "\n");

  // archive index + pruning
  const keepDays = config.archiveDays ?? 30;
  const files = (await fs.readdir(DATA_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
  const keep = files.slice(0, keepDays);
  for (const f of files.slice(keepDays)) await fs.unlink(path.join(DATA_DIR, f));
  const dates = keep.map((f) => f.replace(".json", ""));
  await fs.writeFile(path.join(DATA_DIR, "index.json"), JSON.stringify({ latest: dates[0], dates }, null, 2) + "\n");

  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
  console.log(`\nWrote ${path.relative(ROOT, outFile)} (${sectionsOut.reduce((n, s) => n + s.items.length, 0)} stories).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
