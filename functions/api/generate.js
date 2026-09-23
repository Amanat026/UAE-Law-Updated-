import { GoogleGenAI } from "@google/genai";

/**
 * Cloudflare Pages Function — mirrors api/generate.js (Vercel version).
 * Smart fallback & model rotation + Google Search grounding.
 * Served at /api/generate when deployed on Cloudflare Pages.
 */
const MODEL_POOL = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
];

const RETRY_DELAY_MS = 2500;
const ATTEMPTS_PER_MODEL = 2;
const MODEL_TIMEOUT_MS = 45000;

const SYSTEM_INSTRUCTION = [
  "You are an expert AI legal assistant specializing in UAE Laws.",
  "Users ask questions in English or Bangla about UAE laws, MOHRE labor rules, and Dubai regulations.",
  "You have Google Search enabled: ALWAYS use it to verify facts against up-to-date sources,",
  "preferring Khaleej Times (khaleejtimes.com), Gulf News (gulfnews.com), MOHRE (mohre.gov.ae) and Dubai Now.",
  "When the user asks about news, updates, or recent changes, search specifically khaleejtimes.com and gulfnews.com and summarize what you find, naming the source.",
  "Keep answers extremely concise, structured, and strictly within 3 to 5 lines (maximum 10 lines), optimized for mobile reading.",
].join(" ");

function explainFailure(message) {
  const m = (message || "").toLowerCase();
  if (m.includes("resource_exhausted") || m.includes("429") || m.includes("quota"))
    return "The AI's free daily usage limit was reached. It resets automatically — please try again in a little while.";
  if (m.includes("unavailable") || m.includes("503") || m.includes("high demand") || m.includes("overload"))
    return "The AI service is temporarily overloaded on Google's side. Please try again in a few minutes.";
  if (m.includes("safety") || m.includes("blocked") || m.includes("block_reason") || m.includes("harm"))
    return "The question was blocked by the AI's safety filters, so it cannot be answered. Please rephrase it.";
  if (m.includes("unauthenticated") || m.includes("401") || m.includes("permission_denied") || m.includes("403"))
    return "The AI service key was rejected (configuration issue). The site owner needs to renew the API key.";
  if (m.includes("not_found") || m.includes("404") || m.includes("no longer available"))
    return "The AI model version is unavailable right now. Please try again shortly.";
  if (m.includes("fetch") || m.includes("network") || m.includes("econn") || m.includes("timeout") || m.includes("model_timeout"))
    return "The connection to the AI service timed out. Check your internet connection and try again.";
  return "The AI could not answer this time due to a temporary technical issue. Please try again.";
}

function classify(message) {
  const m = (message || "").toLowerCase();
  if (m.includes("resource_exhausted") || m.includes("429")) return "quota";
  if (m.includes("unavailable") || m.includes("503") || m.includes("high demand")) return "overload";
  if (m.includes("not_found") || m.includes("404") || m.includes("no longer available")) return "retired";
  if (m.includes("unauthenticated") || m.includes("401") || m.includes("permission_denied") || m.includes("403")) return "auth";
  if (m.includes("safety") || m.includes("block_reason")) return "safety";
  if (message === "MODEL_TIMEOUT") return "timeout";
  return "other";
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("MODEL_TIMEOUT")), ms)),
  ]);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Missing prompt" }, 400);
  }
  const { prompt } = body || {};
  if (!prompt || typeof prompt !== "string") {
    return json({ error: "Missing prompt" }, 400);
  }
  if (!env.GEMINI_API_KEY) {
    return json({ error: "The AI service key is not configured on this deployment (GEMINI_API_KEY missing)." }, 500);
  }

  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const attempts = [];

  for (const model of MODEL_POOL) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              tools: [{ googleSearch: {} }],
            },
          }),
          MODEL_TIMEOUT_MS
        );

        const candidate = response?.candidates?.[0];
        const blocked = candidate?.finishReason === "SAFETY" || response?.promptFeedback?.blockReason;
        const text = response?.text;

        if (!blocked && text) {
          const chunks = candidate?.groundingMetadata?.groundingChunks || [];
          const sources = chunks
            .map((c) => ({ title: c?.web?.title, uri: c?.web?.uri }))
            .filter((s) => s.uri);
          return json({ text, model, sources });
        }
        attempts.push(model + ": " + (blocked ? "safety block" : "empty response"));
        break;
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        const kind = classify(message);
        attempts.push(model + ": " + kind);

        if (kind === "auth") {
          return json({ error: explainFailure(message) }, 500);
        }
        if (kind === "safety") {
          return json({ text: explainFailure(message), degraded: true, reason: "safety" });
        }
        if (attempt < ATTEMPTS_PER_MODEL - 1 && (kind === "quota" || kind === "overload" || kind === "timeout")) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        break;
      }
    }
  }

  const lastKind = attempts.length ? attempts[attempts.length - 1].split(": ")[1] : "other";
  return json({ text: explainFailure(lastKind), degraded: true, reason: lastKind });
}
