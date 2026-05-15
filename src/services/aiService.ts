import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  imageData?: { mimeType: string; data: string }; // base64
  isInterrupted?: boolean;
}

interface AIResponse {
  assistantReply: string;
  backgroundPrompt: string;
}

export async function processUserMessage(
  history: ChatMessage[],
  newMessage: string,
  imageFile?: File
): Promise<AIResponse> {
  const parts: any[] = [];

  if (imageFile) {
    const base64Data = await fileToBase64(imageFile);
    parts.push({
      inlineData: {
        mimeType: imageFile.type,
        data: base64Data.split(',')[1]
      }
    });
  }

  if (newMessage) {
    parts.push({ text: newMessage });
  }

  // Format history for the prompt
  // Since we are creating a unique background based on the entire context
  let contextText = "Conversation history:\n";
  history.forEach(msg => {
    contextText += `${msg.role}: ${msg.text}\n`;
  });

  const promptText = `
You are an AI visual co-creator generating an evolving, expressive landscape (inspired by Studio Ghibli anime art). 
The user is adding elements, vibes, or themes to this world.

Based on the conversation history and the user's latest message (and optionally their uploaded image or camera photo), you need to:
1. Provide a VERY BRIEF, punchy reply (1-2 sentences). Acknowledge the addition, and optionally ask ONE short, inspiring question to prompt their next idea (e.g. "What time of day?", "Any creatures lurking?", "What's in the sky?"). Do not act as a roleplaying guide, just a creative partner.
2. Create a prompt for an image generation model to create the next visual segment. 
   - The scenery prompt MUST remain in the beautiful Studio Ghibli background art style.
   - It MUST immediately feature the elements, themes, or colors the user requested.
   - IMPORTANT: If the user uploads a photo of a HUMAN, embed them as an anime character in the scenery! Translate their appearance (clothing, hair, pose) into the Studio Ghibli style alongside the environment.
   - The prompt should be highly descriptive (e.g., lighting, weather, key objects).

Latest User Message: ${newMessage}
${imageFile ? "(User also attached an image. Please look at the image and incorporate its core visual themes, objects, colors, or any humans into the beautiful anime scenery.)" : ""}

Return a JSON object:
{
  "assistantReply": "...",
  "backgroundPrompt": "..."
}
  `;

  parts.push({ text: promptText });

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: { parts },
    config: {
      systemInstruction: "You are an AI visual co-creator for an evolving generative UI canvas. Keep replies brief. Ask questions. Return valid JSON.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          assistantReply: { type: Type.STRING },
          backgroundPrompt: { type: Type.STRING }
        },
        required: ["assistantReply", "backgroundPrompt"]
      }
    }
  });

  const text = response.text || "{}";
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse JSON AI response", text);
    return {
      assistantReply: "I'm having trouble seeing the path ahead. Could you try again?",
      backgroundPrompt: "A beautiful, peaceful studio ghibli style anime landscape, rolling green hills, fluffy clouds, blue sky."
    };
  }
}

export async function generateSceneryImage(prompt: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: {
      parts: [{ text: prompt }]
    },
    config: {
      imageConfig: {
        aspectRatio: "16:9",
        imageSize: "1K"
      }
    }
  });

  // Find the image part
  const candidates = response.candidates;
  if (candidates && candidates.length > 0) {
    const parts = candidates[0].content.parts;
    const imagePart = parts?.find((p: any) => p.inlineData);
    if (imagePart && imagePart.inlineData) {
      return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
    }
  }

  throw new Error("No image generated");
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
}
