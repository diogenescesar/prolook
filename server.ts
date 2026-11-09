/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";

const model = "gemini-2.5-flash-image";

const handleApiResponse = (response: GenerateContentResponse): string => {
  if (response.promptFeedback?.blockReason) {
    const { blockReason, blockReasonMessage } = response.promptFeedback;
    throw new Error(`Request was blocked. Reason: ${blockReason}. ${blockReasonMessage || ""}`);
  }

  for (const candidate of response.candidates ?? []) {
    const imagePart = candidate.content?.parts?.find((part) => part.inlineData);
    if (imagePart?.inlineData) {
      const { mimeType, data } = imagePart.inlineData;
      return `data:${mimeType};base64,${data}`;
    }
  }

  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== "STOP") {
    throw new Error(
      `Image generation stopped unexpectedly. Reason: ${finishReason}. This often relates to safety settings.`
    );
  }
  const textFeedback = response.text?.trim();
  throw new Error(
    `The AI model did not return an image. ` +
      (textFeedback
        ? `The model responded with text: "${textFeedback}"`
        : "This can happen due to safety filters or if the request is too complex. Please try a different image.")
  );
};

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/generate-model", async (req, res): Promise<any> => {
    try {
      const { userImagePart } = req.body || {};
      if (!userImagePart?.inlineData?.data) {
        return res.status(400).json({ error: "Missing userImagePart." });
      }
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      const prompt =
        "You are an expert fashion photographer AI. Transform the person in this image into a full-body fashion model photo suitable for an e-commerce website. The background must be a clean, neutral studio backdrop (light gray, #f0f0f0). The person should have a neutral, professional model expression. Preserve the person's identity, unique features, and body type, but place them in a standard, relaxed standing model pose. The final image must be photorealistic. Return ONLY the final image.";
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [userImagePart, { text: prompt }] },
        config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
      });
      return res.json({ url: handleApiResponse(response) });
    } catch (error: any) {
      console.error("[Backend] /api/generate-model error:", error);
      return res.status(500).json({ error: error.message || "Failed to generate model image." });
    }
  });

  app.post("/api/virtual-try-on", async (req, res): Promise<any> => {
    try {
      const { modelImagePart, garmentImagePart } = req.body || {};
      if (!modelImagePart?.inlineData?.data || !garmentImagePart?.inlineData?.data) {
        return res.status(400).json({ error: "Missing modelImagePart or garmentImagePart." });
      }
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are an expert virtual try-on AI. You will be given a 'model image' and a 'garment image'. Your task is to create a new photorealistic image where the person from the 'model image' is wearing the clothing from the 'garment image'.

**Crucial Rules:**
1.  **Complete Garment Replacement:** You MUST completely REMOVE and REPLACE the clothing item worn by the person in the 'model image' with the new garment. No part of the original clothing (e.g., collars, sleeves, patterns) should be visible in the final image.
2.  **Preserve the Model:** The person's face, hair, body shape, and pose from the 'model image' MUST remain unchanged.
3.  **Preserve the Background:** The entire background from the 'model image' MUST be preserved perfectly.
4.  **Apply the Garment:** Realistically fit the new garment onto the person. It should adapt to their pose with natural folds, shadows, and lighting consistent with the original scene.
5.  **Output:** Return ONLY the final, edited image. Do not include any text.`;
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [modelImagePart, garmentImagePart, { text: prompt }] },
        config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
      });
      return res.json({ url: handleApiResponse(response) });
    } catch (error: any) {
      console.error("[Backend] /api/virtual-try-on error:", error);
      return res.status(500).json({ error: error.message || "Failed to generate virtual try-on image." });
    }
  });

  app.post("/api/pose-variation", async (req, res): Promise<any> => {
    try {
      const { tryOnImagePart, poseInstruction } = req.body || {};
      if (!tryOnImagePart?.inlineData?.data || !poseInstruction) {
        return res.status(400).json({ error: "Missing tryOnImagePart or poseInstruction." });
      }
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are an expert fashion photographer AI. Take this image and regenerate it from a different perspective. The person, clothing, and background style must remain identical. The new perspective should be: "${poseInstruction}". Return ONLY the final image.`;
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [tryOnImagePart, { text: prompt }] },
        config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
      });
      return res.json({ url: handleApiResponse(response) });
    } catch (error: any) {
      console.error("[Backend] /api/pose-variation error:", error);
      return res.status(500).json({ error: error.message || "Failed to generate pose variation." });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Backend] Server running on http://localhost:${PORT}`);
  });
}

startServer();
