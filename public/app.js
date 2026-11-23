// Daily Briefing front end: reads data/index.json + data/<date>.json and renders one skimmable page.
const $ = (id) => document.getElementById(id);
const state = { dates: [], current: null };

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "#";
  } catch {
    return "#";
  }
}

function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

function timeAgo(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

async function getJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const fromCache = res.headers.get("x-sw-cache") === "1";
  return { data: await res.json(), fromCache };
}

function render(b, fromCache) {
  $("date").textContent = prettyDate(b.date);
  document.title = `Briefing · ${prettyDate(b.date)}`;

  const isLatest = b.date === state.dates[0];
  $("kicker").textContent = isLatest ? "Daily Briefing" : "Daily Briefing · archive";

  const banner = $("banner");
  if (fromCache || !navigator.onLine) {
    banner.hidden = false;
    banner.textContent = "Offline — showing your saved briefing.";
  } else {
    banner.hidden = true;
  }

  $("chips").innerHTML = b.sections
    .map((s) => `<a class="chip" href="#sec-${esc(s.id)}">${esc(s.title)}<span class="n">${s.items.length}</span></a>`)
    .join("");

  $("main").innerHTML = b.sections
    .map(
      (s) => `
    <section id="sec-${esc(s.id)}">
      <h2>${esc(s.title)}</h2>
      ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
      <ul class="list">
        ${
          s.items.length
            ? s.items
                .map(
                  (it) => `
          <li class="item">
            <a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">
              <div class="headline">${esc(it.title)}</div>
              ${it.summary ? `<div class="summary">${esc(it.summary)}</div>` : ""}
              <div class="meta">
                <span>${esc(it.source)}</span>
                ${it.published ? `<span>·</span><span>${esc(timeAgo(it.published))}</span>` : ""}
                ${it.watchlist ? `<span class="badge">Watchlist</span>` : ""}
                ${it.older ? `<span class="badge">Earlier</span>` : ""}
              </div>
            </a>
          </li>`,
                )
                .join("")
            : `<li class="empty">Nothing notable today.</li>`
        }
      </ul>
    </section>`,
    )
    .join("");

  const gen = new Date(b.generatedAt);
  $("foot").innerHTML = `Updated ${esc(gen.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}
    · summaries: ${esc(b.summarizer === "snippets" ? "feed snippets" : "AI")}<br/><button id="refresh">Refresh</button>`;
  $("refresh").onclick = () => load(state.current, true);

  const i = state.dates.indexOf(b.date);
  $("prev").disabled = i < 0 || i >= state.dates.length - 1;
  $("next").disabled = i <= 0;
}

async function load(date, scrollTop = false) {
  try {
    if (!state.dates.length || scrollTop) {
      const { data } = await getJSON("data/index.json");
      state.dates = data.dates || [];
    }
  } catch {
    /* index unavailable (offline & uncached) — fall back to latest.json */
  }
  const target = date && state.dates.includes(date) ? date : state.dates[0];
  try {
    const { data, fromCache } = await getJSON(target ? `data/${target}.json` : "data/latest.json");
    state.current = data.date;
    if (!state.dates.includes(data.date)) state.dates.unshift(data.date);
    history.replaceState(null, "", data.date === state.dates[0] ? location.pathname : `#${data.date}`);
    render(data, fromCache);
    if (scrollTop) window.scrollTo({ top: 0 });
  } catch (err) {
    $("date").textContent = "No briefing yet";
    $("main").innerHTML = `<div class="state">Couldn't load a briefing.<br/>Run <code>npm run fetch</code> or check your connection.</div>`;
    console.error(err);
  }
}

$("prev").onclick = () => {
  const i = state.dates.indexOf(state.current);
  if (i >= 0 && i < state.dates.length - 1) load(state.dates[i + 1], true);
};
$("next").onclick = () => {
  const i = state.dates.indexOf(state.current);
  if (i > 0) load(state.dates[i - 1], true);
};

// When the app comes back to the foreground on a new morning, pick up the new briefing.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.current === state.dates[0]) load(null);
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registration failed", e));
}

load(location.hash.slice(1) || null);
