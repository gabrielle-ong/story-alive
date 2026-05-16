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
CRITICAL RULE: EVERY SINGLE TIME the user speaks or adds an element, you MUST call the 'generate_scenery_image' tool to visually render the new scene. DO NOT skip this. You must generate a new image prompt for every user turn.`;

    let session: any = null;
    let isConnected = false;

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
               clientWs.send(JSON.stringify({ type: 'transcription', source: 'user', text: inputTranscription.text }));
            }

            const outputTranscription = (message.serverContent as any)?.outputTranscription;
            if (outputTranscription?.text) {
               clientWs.send(JSON.stringify({ type: 'transcription', source: 'model', text: outputTranscription.text }));
            }

            // Fallback for model text if outputTranscription is not used
            const modelTurnParts = message.serverContent?.modelTurn?.parts;
            if (modelTurnParts && !outputTranscription?.text) {
              const textParts = modelTurnParts.filter((p: any) => !!p.text);
              if (textParts.length > 0) {
                 const fullText = textParts.map((p: any) => p.text).join("");
                 clientWs.send(JSON.stringify({ type: 'transcription', source: 'model', text: fullText }));
              }
            }

            // Handle tool calls
            const toolCall = message.toolCall;
            if (toolCall) {
              for (const call of toolCall.functionCalls || []) {
                if (call.name === 'generate_scenery_image') {
                  const args = call.args as Record<string, any>;
                  console.log("Generating illustration for prompt:", args.prompt);
                  clientWs.send(JSON.stringify({ type: 'system', message: 'Generating scenery...' }));

                  // Immediate non-blocking response back to Live model
                  try {
                    await session.sendToolResponse({
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: { success: true }
                        }
                      ]
                    });
                  } catch (e) {
                     console.error("Failed to send immediate tool response:", e);
                  }

                  // Async generation in the background
                  (async () => {
                    try {
                      const startTime = Date.now();
                      const prompt = `A beautiful, peaceful studio ghibli style anime landscape. ${args.prompt}. Masterpiece, highly detailed.`;
                      const imgResponse = await ai.models.generateContent({
                        model: 'gemini-3.1-flash-image-preview',
                        contents: [{ role: 'user', parts: [{ text: prompt }] }],
                        config: {
                          imageConfig: {
                            aspectRatio: "16:9"
                          }
                        }
                      });

                      const base64Bytes = imgResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                      if (base64Bytes) {
                        const latency = ((Date.now() - startTime) / 1000).toFixed(1);
                        const imageUrl = `data:image/jpeg;base64,${base64Bytes}`;
                        clientWs.send(JSON.stringify({ type: 'illustration', imageUrl, latency }));
                      }
                    } catch (e) {
                      console.error("Failed to generate image asynchronously:", e);
                    }
                  })();
                }
              }
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
          systemInstruction: systemInstructionText,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "generate_scenery_image",
                  description: "Generates a real-time image representing the current scene state.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      prompt: { type: Type.STRING, description: "Highly descriptive image generation prompt emphasizing the scene, lighting, weather, and key objects." }
                    },
                    required: ["prompt"]
                  }
                }
              ]
            }
          ]
        },
      });
      isConnected = true;
      clientWs.send(JSON.stringify({ type: 'system', message: 'Connected to storyteller.' }));
    } catch(e) {
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

  app.use(express.json({limit: '50mb'}));

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
