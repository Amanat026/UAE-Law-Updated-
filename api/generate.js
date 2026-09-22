import { GoogleGenAI } from "@google/genai";

const MODELS = ["gemini-2.0-flash", "gemini-2.0-flash-lite"];

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
  const config = {
    systemInstruction:
      "You are an expert AI legal assistant specializing in UAE Laws. Users can ask questions in English or Bangla regarding UAE laws, labor rules (MOHRE), and Dubai regulations. Cross-verify information using up-to-date sources like Khaleej Times, Gulf News, Dubai Now, and MOHRE. Keep answers extremely concise, structured, and strictly within 3 to 5 lines (maximum 10 lines) optimized for mobile reading.",
  };

  // Try models in order; on quota/rate-limit (429) or overload (503),
  // wait briefly and retry once, then fall through to the next model.
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config,
        });
        return res.status(200).json({ text: response.text });
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        const retryable = message.includes("429") || message.includes("503") || message.includes("RESOURCE_EXHAUSTED") || message.includes("UNAVAILABLE");
        if (retryable && attempt === 0) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        // Non-retryable or retries exhausted: try the next model, or fail if none left.
        if (model === MODELS[MODELS.length - 1]) {
          console.error("Gemini API Error:", error);
          return res.status(500).json({ error: "GEMINI_ERROR: " + message });
        }
        break; // try next model
      }
    }
  }
}
