import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import * as dotenv from "dotenv";

dotenv.config({ path: '.env.local' });
dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/live' });

  wss.on("connection", async (clientWs: WebSocket, req) => {
    console.log("Starting Live session");

    const systemInstructionText = `You are a cinematic storyteller generating an evolving, expressive landscape (inspired by Studio Ghibli anime art). 
The user is adding elements, vibes, or themes to this world via voice and text.
Keep your vocal replies VERY BRIEF and poetic (1-2 sentences max). Instead of constantly asking what the user wants next, simply weave their requested elements into a continuous, magical narrative about the unfolding scene. Let the story naturally guide the visuals.
34: CRITICAL RULE: DO NOT focus on asking questions. Just tell the story visually.`;

    let session: any = null;
    let isConnected = false;

    // State for speculative generation
    let currentUserTranscription = "";
    let isGeneratingImage = false;
    let lastImageResponseParts: any[] | null = null;

    try {
      session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: async (message: LiveServerMessage) => {
            // Forward audio to client
            const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audio) {
              clientWs.send(JSON.stringify({ type: 'audio', audio }));
            }
            // Forward interruption
            if (message.serverContent?.interrupted) {
              clientWs.send(JSON.stringify({ type: 'interrupted', interrupted: true }));
            }
            // Forward transcriptions based on input/output transcription config
            const inputTranscription = (message.serverContent as any)?.inputTranscription;
            if (inputTranscription?.text) {
              currentUserTranscription += inputTranscription.text;
              clientWs.send(JSON.stringify({ type: 'transcription', source: 'user', text: inputTranscription.text }));
            }

            const outputTranscription = (message.serverContent as any)?.outputTranscription;
            if (outputTranscription?.text) {
              clientWs.send(JSON.stringify({ type: 'transcription', source: 'model', text: outputTranscription.text }));
            }

            // Fallback for model text if outputTranscription is not used
            const modelTurnParts = message.serverContent?.modelTurn?.parts;
            if (modelTurnParts && !outputTranscription?.text) {

              // Trigger speculative generation right as the model begins its turn!
              if (currentUserTranscription.trim() && !isGeneratingImage) {
                const promptText = currentUserTranscription.trim();
                currentUserTranscription = ""; // reset for next turn
                isGeneratingImage = true;

                (async () => {
                  clientWs.send(JSON.stringify({ type: 'system', message: 'Generating scenery...' }));
                  try {
                    const prompt = `A beautiful, peaceful studio ghibli style anime landscape. ${promptText}. Masterpiece, highly detailed.`;
                    const contents = [];

                    // Pass previous thought signature / generation parts for context
                    if (lastImageResponseParts) {
                      contents.push({ role: 'model', parts: lastImageResponseParts });
                    }
                    contents.push({ role: 'user', parts: [{ text: prompt }] });

                    const imgResponse = await ai.models.generateContent({
                      model: 'gemini-3.1-flash-image-preview',
                      contents: contents,
                      config: {
                        imageConfig: { aspectRatio: "16:9" }
                      }
                    });

                    // Save parts for next turn's thought signature
                    if (imgResponse.candidates?.[0]?.content?.parts) {
                      lastImageResponseParts = imgResponse.candidates[0].content.parts;
                    }

                    const base64Bytes = imgResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                    if (base64Bytes) {
                      const imageUrl = `data:image/jpeg;base64,${base64Bytes}`;
                      clientWs.send(JSON.stringify({ type: 'illustration', imageUrl }));
                    }
                  } catch (e) {
                    console.error("Failed speculative image generation:", e);
                  } finally {
                    isGeneratingImage = false;
                  }
                })();
              }

              const textParts = modelTurnParts?.filter((p: any) => !!p.text);
              if (textParts && textParts.length > 0) {
                const fullText = textParts.map((p: any) => p.text).join("");
                clientWs.send(JSON.stringify({ type: 'transcription', source: 'model', text: fullText }));
              }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: systemInstructionText
        },
      });
      isConnected = true;
      clientWs.send(JSON.stringify({ type: 'system', message: 'Connected to storyteller.' }));
    } catch (e) {
      console.error("Failed to connect to Live API", e);
      clientWs.send(JSON.stringify({ type: 'error', message: 'Failed to connect to AI' }));
    }

    clientWs.on("message", (data) => {
      if (!isConnected || !session) return;
      try {
        const msg = JSON.parse(data.toString());
        if (msg.audio) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" },
          });
        }
        if (msg.text) {
          session.sendRealtimeInput({
            text: msg.text
          })
        }
        if (msg.command === "stop") {
          session.sendClientContent({ turnComplete: true });
        }
        if (msg.image) {
          // Wait, if we send an image directly via clientContent
          const base64Data = msg.image.replace(/^data:image\/\w+;base64,/, "");
          session.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [
                  { text: msg.imageText || "I've uploaded an image. Please incorporate its core visual themes or any characters into our Ghibli scenery." },
                  { inlineData: { data: base64Data, mimeType: 'image/jpeg' } }
                ]
              }
            ],
            turnComplete: true
          });
        }
      } catch (e) {
        console.error("Error processing client message", e);
      }
    });

    clientWs.on("close", () => {
      console.log("Client disconnected");
      session?.close();
    });
  });

  app.use(express.json({ limit: '50mb' }));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
