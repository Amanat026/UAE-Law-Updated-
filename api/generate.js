import { GoogleGenAI } from "@google/genai";

/**
 * Smart Fallback & Model Rotation
 * --------------------------------
 * Models are tried in order. On quota/rate-limit (429), overload (503),
 * or a retired/missing model (404), the next model in the pool is used.
 * A per-attempt timeout prevents the function from hanging. If every model
 * fails, the client still receives a friendly answer (HTTP 200 with a
 * graceful message) instead of a crash.
 */
const MODEL_POOL = [
  "gemini-2.5-flash",        // primary free model
  "gemini-2.0-flash",        // backup 1 — large free quota (~1500 req/day)
  "gemini-3.5-flash-lite",   // backup 2 — lite variant, separate quota bucket
  "gemini-3.6-flash",        // backup 3 — newest, small free quota but fine as last resort
];

const RETRY_DELAY_MS = 2500;      // pause before retrying the same model
const ATTEMPTS_PER_MODEL = 2;     // one initial try + one retry per model
const MODEL_TIMEOUT_MS = 45000;   // abort a hung model call so we can rotate
const FALLBACK_MESSAGE =
  "The AI service is temporarily busy. Please wait a moment and ask your question again — your message was received.";

const SYSTEM_INSTRUCTION =
  "You are an expert AI legal assistant specializing in UAE Laws. Users can ask questions in English or Bangla regarding UAE laws, labor rules (MOHRE), and Dubai regulations. Cross-verify information using up-to-date sources like Khaleej Times, Gulf News, Dubai Now, and MOHRE. Keep answers extremely concise, structured, and strictly within 3 to 5 lines (maximum 10 lines) optimized for mobile reading.";

function classifyError(message) {
  const m = message || "";
  if (m.includes("429") || m.includes("RESOURCE_EXHAUSTED")) return "quota";
  if (m.includes("503") || m.includes("UNAVAILABLE") || m.includes("high demand")) return "overload";
  if (m.includes("404") || m.includes("NOT_FOUND") || m.includes("no longer available")) return "retired";
  if (m.includes("401") || m.includes("403") || m.includes("UNAUTHENTICATED") || m.includes("PERMISSION_DENIED")) return "auth";
  return "other";
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("MODEL_TIMEOUT")), ms)),
  ]);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing prompt" });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "SERVER_CONFIG: GEMINI_API_KEY env variable is not set on this Vercel project" });
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const errors = [];

  for (const model of MODEL_POOL) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model,
            contents: prompt,
            config: { systemInstruction: SYSTEM_INSTRUCTION },
          }),
          MODEL_TIMEOUT_MS
        );
        const text = response && response.text;
        if (text) {
          return res.status(200).json({ text, model });
        }
        // Empty answer — treat as a soft failure and rotate.
        errors.push(model + ": empty response");
        break;
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        const kind = message === "MODEL_TIMEOUT" ? "overload" : classifyError(message);
        errors.push(model + ": " + kind);

        // Auth problems won't be fixed by rotating — fail fast with a clear error.
        if (kind === "auth") {
          console.error("Gemini auth error:", message);
          return res.status(500).json({ error: "GEMINI_AUTH: " + message });
        }
        // Quota/overload/timeout: wait, then either retry same model or move on.
        if (attempt < ATTEMPTS_PER_MODEL - 1 && (kind === "quota" || kind === "overload")) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        break; // next model in the pool
      }
    }
  }

  // Every model failed: degrade gracefully instead of crashing.
  console.error("All Gemini models failed:", errors.join(" | "));
  return res.status(200).json({ text: FALLBACK_MESSAGE, degraded: true });
}
