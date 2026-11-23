// One-line summaries + relevance scores via the Claude API.
// Only used when ANTHROPIC_API_KEY is set; otherwise the fetch script falls back to feed snippets.
import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-opus-5-5";

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          summary: { type: "string" },
          relevance: { type: "integer" },
        },
        required: ["id", "summary", "relevance"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const SYSTEM = `You write a personal morning news briefing for a reader who follows software acquisitions and roll-ups, distressed businesses and M&A, regenerative agriculture and grazing, cattle and ag markets, and ag tech.

For each story you are given, return:
- summary: ONE plain sentence (max ~25 words) saying what happened and why it matters to this reader. Use only facts present in the headline and snippet; do not invent numbers, names, or outcomes. Don't repeat the headline verbatim and don't start with "This article".
- relevance: integer 0-10 for how useful the story is for the section focus given. 0-3 = off-topic, clickbait, stock-tip noise, listicles, press-release fluff or a duplicate of another story in the list; 4-6 = relevant but minor; 7-10 = important.

Return every id you were given exactly once.`;

export function hasLlmKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client;
function getClient() {
  client ??= new Anthropic({ maxRetries: 3, timeout: 120_000 });
  return client;
}

/**
 * @param {{title:string, focus:string}} section
 * @param {Array<{id:string,title:string,source:string,description:string}>} items
 * @returns {Promise<Map<string,{summary:string,relevance:number}>>}
 */
export async function summarizeSection(section, items) {
  if (!items.length) return new Map();
  const model = process.env.BRIEFING_MODEL || DEFAULT_MODEL;
  const listing = items
    .map((it) => `id: ${it.id}\nheadline: ${it.title}\nsource: ${it.source}\nsnippet: ${it.description || "(none)"}`)
    .join("\n\n");

  const response = await getClient().beta.messages.create({
    model,
    max_tokens: 8000,
    system: SYSTEM,
    // Re-run on a fallback model if a safety classifier declines (rare for news summaries).
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `Section: ${section.title}\nSection focus: ${section.focus}\n\nStories:\n\n${listing}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("model declined the request");
  if (response.stop_reason === "max_tokens") throw new Error("response truncated (max_tokens)");
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("no text in response");
  const parsed = JSON.parse(textBlock.text);

  const out = new Map();
  for (const r of parsed.items || []) {
    if (typeof r.id === "string") out.set(r.id, { summary: String(r.summary || "").trim(), relevance: Number(r.relevance) || 0 });
  }
  return out;
}

export function describeLlmError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "invalid ANTHROPIC_API_KEY";
  if (err instanceof Anthropic.RateLimitError) return "rate limited";
  if (err instanceof Anthropic.BadRequestError) return `bad request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "could not reach the API";
  if (err instanceof Anthropic.APIError) return `API error ${err.status}: ${err.message}`;
  return err?.message || String(err);
}
