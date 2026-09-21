import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing prompt" });
  }
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are an expert AI legal assistant specializing in UAE Laws. Users can ask questions in English or Bangla regarding UAE laws, labor rules (MOHRE), and Dubai regulations. Cross-verify information using up-to-date sources like Khaleej Times, Gulf News, Dubai Now, and MOHRE. Keep answers extremely concise, structured, and strictly within 3 to 5 lines (maximum 10 lines) optimized for mobile reading.",
      },
    });
    return res.status(200).json({ text: response.text });
  } catch (error) {
    console.error("Gemini API Error:", error);
    return res.status(500).json({ error: "AI request failed" });
  }
}
