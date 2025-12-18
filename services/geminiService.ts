import { GoogleGenAI, Type, Modality } from "@google/genai";
import { MemeSegment, BoundingBox } from "../types";

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found in environment variables");
  }
  return new GoogleGenAI({ apiKey });
};

// Helper for consistency with local logic, though implemented simply here to avoid circular dep issues in this context
const calculateDuration = (text: string): number => {
    if (!text || text.length < 2) return 1.0;
    const wordCount = text.trim().split(/\s+/).length;
    const readingTime = wordCount * 0.3; 
    const duration = readingTime + 0.3;
    return Math.max(1.0, Math.ceil(duration * 2) / 2);
};

export const analyzeMemeImage = async (base64Image: string): Promise<MemeSegment[]> => {
  const ai = getClient();
  
  // Define schema for structured output
  const segmentSchema = {
    type: Type.OBJECT,
    properties: {
      segments: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: "The text content of this specific segment/panel." },
            ymin: { type: Type.NUMBER, description: "Top coordinate (0-1000)" },
            xmin: { type: Type.NUMBER, description: "Left coordinate (0-1000)" },
            ymax: { type: Type.NUMBER, description: "Bottom coordinate (0-1000)" },
            xmax: { type: Type.NUMBER, description: "Right coordinate (0-1000)" },
          },
          required: ["text", "ymin", "xmin", "ymax", "xmax"],
        },
      },
    },
    required: ["segments"],
  };

  const prompt = `
    Analyze this meme image. Break it down into logical narration segments based on the flow of reading (usually top to bottom, or panel by panel).
    
    For each segment:
    1. Extract the text exactly as it appears (OCR). If there is no text in a panel but it's a visual reveal, describe the action briefly in brackets like [Character reacts].
    2. Provide the 2D bounding box for that specific segment (text bubble or panel).
    
    Ensure the order follows the comedic timing of the meme.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          parts: [
            { inlineData: { mimeType: "image/png", data: base64Image } },
            { text: prompt }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: segmentSchema,
        temperature: 0.2, // Low temperature for more accurate OCR
      }
    });

    const jsonText = response.text || "{}";
    const parsed = JSON.parse(jsonText);
    
    if (!parsed.segments) return [];

    return parsed.segments.map((seg: any, index: number) => ({
      id: `seg-${index}-${Date.now()}`,
      text: seg.text,
      box: {
        ymin: seg.ymin,
        xmin: seg.xmin,
        ymax: seg.ymax,
        xmax: seg.xmax,
      },
      duration: calculateDuration(seg.text)
    }));
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
};

export const generateSpeechForSegment = async (text: string): Promise<{ audioBase64: string, audioType: 'pcm' }> => {
  const ai = getClient();
  
  // Clean text of brackets for speech
  const speechText = text.replace(/\[.*?\]/g, "").trim();
  
  if (!speechText) {
      // Return silent audio or handle empty
      return { audioBase64: "", audioType: 'pcm' }; 
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [
        { parts: [{ text: speechText }] }
      ],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Fenrir" } // Deep, slightly comedic/serious voice good for memes
          }
        }
      }
    });

    const audioPart = response.candidates?.[0]?.content?.parts?.[0];
    if (audioPart && audioPart.inlineData && audioPart.inlineData.data) {
      return { audioBase64: audioPart.inlineData.data, audioType: 'pcm' };
    }
    
    console.warn(`No audio data for text: "${speechText}". Response:`, response);
    throw new Error("No audio data received");
  } catch (error) {
    console.error("Gemini TTS Error:", error);
    throw error;
  }
};