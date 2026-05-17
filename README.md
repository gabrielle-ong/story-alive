# StoryAlive: Ghibli Journey 🍃

StoryAlive is a real-time, multimodal storytelling application that weaves a dynamic, magical narrative inspired by the whimsical art style of Studio Ghibli. It leverages Google's Gemini Developer SDK to create a highly immersive, low-latency conversational experience where the world visually evolves as you interact with it.

## Demo Video
https://cap.so/s/wfq0x44fxc5n086

## ✨ Core Features

* **Real-Time Voice Conversation:** Speak naturally with the AI storyteller. The application supports full-duplex audio, meaning you can interrupt the story at any time to change its direction and the AI will adapt instantly.
* **Dynamic Scenery Generation:** As the story unfolds, the AI automatically generates breathtaking Ghibli-style landscapes reflecting the current narrative.
* **Multimodal Interactivity:** Don't just talk—show! You can upload an image or take a photo, and the AI will immediately incorporate its visual themes, characters, or elements into the ongoing story in real time.

## 🛠️ Technical Details & APIs

This application relies on a backend-first architecture, utilizing two primary Gemini models to handle the conversational flow and visual generation separately but harmoniously.

### 1. The Gemini Live API
* **Model:** `gemini-3.1-flash-live-preview`
* **Architecture:** A persistent WebSocket connection established via `ai.live.connect()`.
* **Input Handling:** 
  * Voice audio is sampled at 16kHz by an `AudioWorklet` and streamed as base64 PCM chunks using `session.sendRealtimeInput({ audio: ... })`.
  * Uploaded images are injected directly into the active conversational stream as a "vision" frame using `session.sendRealtimeInput({ video: { data: base64, mimeType: 'image/jpeg' } })`. This highly efficient method bypasses heavy turn-based text processing and allows the model to "see" the image instantly.
* **Modality:** Configured to strictly return `[Modality.AUDIO]`.

### 2. Image Generation with Nano Banana 2 / Gemini 3.1 Flash Image
* **Model:** `gemini-3.1-flash-image-preview`
* **Tool Calling Integration:** The Live API model is equipped with a `generate_scenery_image` function declaration. When the story dictates a visual change, the Live model emits this tool call.
* **Asynchronous Non-Blocking Execution:** The Express backend intercepts the tool call and instantly returns `{ success: true }` to the Live model so it can continue speaking without stuttering. Meanwhile, it asynchronously hits the `image-preview` model to generate the scenery.
* **Configuration:** Enforces `imageSize: "512"`, `aspectRatio: "16:9"`, and `numberOfImages: 1` to optimize for generation speed and minimize payload latency.

## ⚖️ Tradeoffs & Future Work

During development, several architectural decisions were made to prioritize real-time performance:

* **Did not use Thought Signatures:** While thought signatures provide excellent reasoning traces for complex logic, they inherently increase the time-to-first-byte (TTFB) latency before the audio stream begins. I opted to disable them to guarantee a snappy, ultra-responsive conversational experience.
* **Did not use Interactions API:** I bypassed the stateful Interactions API because the Live API's persistent WebSocket connection natively maintains the conversational context. Piping all multimodal inputs (voice, text, and photos) directly through a single Live socket significantly simplified the architecture and prevented the overhead of maintaining two separate session states.
* **Frontend State Management (Future Work):** While the massive monolithic React components were refactored into custom hooks (`useStoryteller` and `useMicrophone`), future work could further decouple the WebSocket transport layer from the React UI state layer (e.g., using a Redux or Context dispatch pattern) to make the UI completely mockable and easier to test without a live server.

## 🚀 Getting Started

1. Ensure you have Node.js installed.
2. Create a `.env.local` file in the root directory and add your `GEMINI_API_KEY=your_key_here`.
3. Run `npm install` to install dependencies.
4. Run `npm run dev` to boot up the Express backend and Vite frontend.
5. Navigate to the local port, grant microphone permissions, and start building your world!

## Initial AI Studio App (Image Generation without Live API)
https://aistudio.google.com/u/1/apps/1f79a53d-4d15-449e-a0bf-d5225404479c?showAssistant=true&project=gen-lang-client-0171436551&showPreview=true
