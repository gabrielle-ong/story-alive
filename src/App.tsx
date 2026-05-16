import { useState, useEffect, useRef } from 'react';
import { SceneryViewer } from './components/SceneryViewer';
import { ChatSidebar } from './components/ChatSidebar';
import { ChatMessage, fileToBase64, generateSceneryImage } from './services/aiService';
import { AudioStreamingPlayer } from './lib/AudioStreamingPlayer';
import { pcmToBase64 } from './lib/audioUtils';

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sceneries, setSceneries] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(true);

  // Live Session State
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [isMicActive, setIsMicActive] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  const audioPlayerRef = useRef<AudioStreamingPlayer | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Initial prompt kick off & connect to live API
  useEffect(() => {
    let ws: WebSocket;
    const initWorld = async () => {
      try {
        const welcomeMessage: ChatMessage = {
          id: 'welcome',
          role: 'assistant',
          text: 'The canvas is ready. I am listening! Try speaking using the microphone, or type a prompt.',
        };
        setMessages([welcomeMessage]);

        // Connect WebSocket immediately so Live API can respond
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/live`;
        ws = new WebSocket(wsUrl);
        setSocket(ws);
        socketRef.current = ws;

        const player = new AudioStreamingPlayer(24000);
        audioPlayerRef.current = player;

        // Generate the very first scenery asynchronously without blocking the connection
        const initialPrompt = 'A pristine blank canvas of rolling green hills. Bright blue sky. Studio Ghibli style anime landscape. Masterpiece. Highly detailed';
        const start = Date.now();
        generateSceneryImage(initialPrompt).then((initialImageUrl) => {
          setSceneries([initialImageUrl]);
          const lat = ((Date.now() - start) / 1000).toFixed(1);
          setMessages(prev => [...prev, { id: 'latency-init', role: 'assistant', text: `⏱️ *Image generated in ${lat}s*` }]);
          setIsGenerating(false);
        }).catch((err) => {
          console.error("Initial image generation failed", err);
          setIsGenerating(false);
        });

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);

          if (data.type === 'audio') {
            setIsSpeaking(true);
            player.playAudioChunk(data.audio);
            setTimeout(() => setIsSpeaking(false), 500);
          }
          else if (data.type === 'transcription') {
            setMessages(prev => {
              const last = prev[prev.length - 1];
              const role = data.source === 'user' ? 'user' : 'assistant';
              const idPrefix = data.source === 'user' ? 'live-user' : 'live-model';

              if (last && last.role === role && last.id.startsWith(idPrefix)) {
                if (last.isInterrupted) {
                  return [...prev, { id: idPrefix + '-' + Math.random(), role, text: data.text }];
                }
                return [...prev.slice(0, -1), { ...last, text: last.text + data.text }];
              }
              return [...prev, { id: idPrefix + '-' + Math.random(), role, text: data.text }];
            });
          }
          else if (data.type === 'interrupted') {
            player.stopAllAndClear();
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last && last.role === 'assistant' && last.id.startsWith('live-model')) {
                return [...prev.slice(0, -1), { ...last, text: last.text + ' ...', isInterrupted: true }];
              }
              return prev;
            });
          }
          else if (data.type === 'illustration') {
            setSceneries(prev => [...prev, data.imageUrl]);
            if (data.latency) {
              setMessages(prev => [...prev, { id: 'latency-' + Math.random(), role: 'assistant', text: `⏱️ *Image generated in ${data.latency}s*` }]);
            }
            setIsGenerating(false);
          }
          else if (data.type === 'system' && data.message === 'Generating scenery...') {
            setIsGenerating(true);
          }
        };

      } catch (err: any) {
        console.error("Failed to initialize world", err);
        setIsGenerating(false);
      }
    };

    initWorld();

    return () => {
      ws?.close();
      audioPlayerRef.current?.close();
    }
  }, []);

  const toggleMic = async () => {
    if (isMicActive) {
      stopMic();
    } else {
      await startMic();
    }
  };

  const startMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;

      source.connect(processor);
      processor.connect(audioCtx.destination);

      processor.onaudioprocess = (e) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          const base64 = pcmToBase64(e.inputBuffer.getChannelData(0));
          socketRef.current.send(JSON.stringify({ audio: base64 }));
        }
      };
      setIsMicActive(true);
    } catch (err) {
      console.error("Microphone access denied", err);
      alert("Microphone access is required for voice chat.");
    }
  };

  const stopMic = () => {
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => { });
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
    }
    setIsMicActive(false);
  };

  const handleSendMessage = async (text: string, file?: File) => {
    const userMsgId = Date.now().toString();
    const newUserMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      text,
    };

    let base64Image: string | undefined;

    if (file) {
      try {
        base64Image = await fileToBase64(file);
        newUserMsg.imageData = {
          mimeType: file.type,
          data: base64Image.split(',')[1]
        };
      } catch (err) {
        console.error("Failed to read file", err);
      }
    }

    setMessages(prev => [...prev, newUserMsg]);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      if (base64Image) {
        socketRef.current.send(JSON.stringify({ image: base64Image, imageText: text }));
      } else if (text) {
        socketRef.current.send(JSON.stringify({ text }));
      }
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-stone-900 font-sans">
      <div className="flex-1 relative">
        <SceneryViewer sceneries={sceneries} />
      </div>
      <div className="w-96 border-l border-white/10 flex-shrink-0 relative z-10">
        <ChatSidebar
          messages={messages}
          onSendMessage={handleSendMessage}
          isGenerating={isGenerating}
          isMicActive={isMicActive}
          onToggleMic={toggleMic}
          isSpeaking={isSpeaking}
        />
      </div>
    </div>
  );
}
