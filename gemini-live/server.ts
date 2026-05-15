import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";

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
    // Parse URL parameters for initial config
    let configStr = '';
    const queryIdx = req.url?.indexOf('?');
    if (req.url && queryIdx && queryIdx !== -1) {
      const qs = new URLSearchParams(req.url.substring(queryIdx));
      configStr = qs.get('config') || '';
    }
    
    let userConfig = { artStyle: '', characterName: '', backstory: '', tone: '', setting: '', conflict: '' };
    try {
      if (configStr) userConfig = JSON.parse(decodeURIComponent(configStr));
    } catch(e) {
      console.error("Error parsing config", e);
    }
    
    console.log("Starting Live session with config", userConfig);

    // Concurrently trigger initial scene image generation
    (async () => {
      try {
        clientWs.send(JSON.stringify({ type: 'system', message: 'Generating initial scene illustration...' }));
        const prompt = `Art style: ${userConfig.artStyle || 'Concept art'}. Initial scene for setting: ${userConfig.setting || 'Fantasy'}. Tone: ${userConfig.tone}. Character: ${userConfig.characterName}, ${userConfig.backstory}.`;
        const imgResponse = await ai.models.generateContent({
          model: 'gemini-3.1-flash-image-preview',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });
        const base64Bytes = imgResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Bytes) {
          const imageUrl = `data:image/jpeg;base64,${base64Bytes}`;
          clientWs.send(JSON.stringify({ type: 'illustration', imageUrl, description: `Welcome to ${userConfig.setting || 'the world'}!` }));
        }
      } catch(e) {
        console.error("Initial illustration failed", e);
      }
    })();

    const systemInstructionText = `You are a master collaborative CYOA storyteller. 
The user selected the following art style: ${userConfig.artStyle || 'Default'}. 
The main character is described as: Name: ${userConfig.characterName || 'Hero'}, Backstory: ${userConfig.backstory || 'A brave adventurer'}. 
Settings: Tone: ${userConfig.tone || 'Neutral'}, Theme: ${userConfig.setting || 'Fantasy'}, Core Conflict: ${userConfig.conflict || 'Survive and thrive'}. 
CRITICAL RULE: Keep your narration extremely concise, STRICTLY ONE sentence maximum before jumping immediately straight into 2 or 3 choose-your-own-adventure options for the user. Do not give any exposition, just a single sentence of action or context, then the options.
CRITICAL RULE: You MUST call 'generate_story_illustration' strictly after every 2 to 3 user turns or prompts to visually render the current scene context.`;

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
            // Forward transcription
            const modelTurnParts = message.serverContent?.modelTurn?.parts;
            if (modelTurnParts) {
              const textParts = modelTurnParts.filter(p => !!p.text);
              if (textParts.length > 0) {
                 const fullText = textParts.map(p => p.text).join("");
                 clientWs.send(JSON.stringify({ type: 'transcription', source: 'model', text: fullText }));
              }
            }

            // Handle tool calls
            const toolCall = message.toolCall;
            if (toolCall) {
              for (const call of toolCall.functionCalls || []) {
                if (call.name === 'generate_story_illustration') {
                  const args = call.args as Record<string, any>;
                  console.log("Generating illustration for:", args);
                  clientWs.send(JSON.stringify({ type: 'system', message: 'Generating scene illustration...' }));

                  try {
                    // Call image generation model
                    const prompt = `Art style: ${userConfig.artStyle || 'Concept art'}. ${args.prompt}. ${args.scene_description}. Character: ${userConfig.characterName || 'the protagonist'}, ${userConfig.backstory || ''}`;
                    const imgResponse = await ai.models.generateContent({
                      model: 'gemini-3.1-flash-image-preview',
                      contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    });

                    const base64Bytes = imgResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                    if (base64Bytes) {
                      const imageUrl = `data:image/jpeg;base64,${base64Bytes}`;
                      clientWs.send(JSON.stringify({ type: 'illustration', imageUrl, description: args.scene_description }));
                    }

                    // Send successful response back to Live model
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
                    console.error("Failed to generate image:", e);
                    // Inform the model of the failure
                    await session.sendToolResponse({
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: { success: false, error: String(e) }
                        }
                      ]
                    });
                  }
                }
              }
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO], // Only receive audio natively, though transcript can be handled? Wait, Live API doesn't include text transcription in the same way by default unless configured.
          // oh wait, we need text in the UI too. Let's ask for text output transcription
          outputAudioTranscription: {}, 
          inputAudioTranscription: {}, // To get user speech-to-text
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: systemInstructionText,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "generate_story_illustration",
                  description: "Generates a real-time image representing the current scene state.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      prompt: { type: Type.STRING, description: "Detailed image generation prompt emphasizing the scene action." },
                      scene_description: { type: Type.STRING, description: "Brief context summary for the image canvas." }
                    },
                    required: ["prompt", "scene_description"]
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
          // If the user chooses to type instead
          // Live API allows sending text through sendRealtimeInput or parts in clientContent
          // Though it's safer to just send text parts if supported by SDK. We can try clientContent
          session.sendRealtimeInput({
             text: msg.text
          })
        }
        if (msg.command === "stop") {
           session.sendClientContent({ turnComplete: true });
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

  // API Route for camera feature extraction (optional, but requested in PRD)
  app.use(express.json({limit: '50mb'}));
  app.post('/api/extract-character', async (req, res) => {
    try {
      const { imageBase64 } = req.body; // e.g. "data:image/jpeg;base64,..."
      if (!imageBase64) return res.status(400).json({ error: "Missing image" });

      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: {
          parts: [
            { text: "Describe the visual characteristics of the person or character in this image briefly (1-2 sentences). Focus on hair, facial features, clothing, and overall vibe." },
            { inlineData: { data: base64Data, mimeType: 'image/jpeg' } }
          ]
        }
      });
      res.json({ description: response.text });
    } catch (e) {
      console.error("Error extracting character", e);
      res.status(500).json({ error: String(e) });
    }
  });

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
