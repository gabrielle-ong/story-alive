import { useState, useEffect, useRef, useCallback } from 'react';
import { ChatMessage } from '../types/chat';
import { AudioStreamingPlayer } from '../lib/AudioStreamingPlayer';

export function useStoryteller() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sceneries, setSceneries] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  
  const socketRef = useRef<WebSocket | null>(null);
  const audioPlayerRef = useRef<AudioStreamingPlayer | null>(null);

  useEffect(() => {
    let ws: WebSocket;
    let mounted = true;

    const initWorld = async () => {
      try {
        const welcomeMessage: ChatMessage = {
          id: 'welcome',
          role: 'assistant',
          text: 'The canvas is ready. I am listening! Try speaking using the microphone, or type a prompt.',
        };
        setMessages([welcomeMessage]);

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/live`;
        ws = new WebSocket(wsUrl);
        
        if (mounted) {
          socketRef.current = ws;
        }

        const player = new AudioStreamingPlayer(24000);
        audioPlayerRef.current = player;

        const initialPrompt = 'A pristine blank canvas of rolling green hills. Bright blue sky.';
        const start = Date.now();
        fetch('/api/initial-scene', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: initialPrompt })
        })
          .then(res => res.json())
          .then((data) => {
            if (!mounted) return;
            if (data.imageUrl) {
              setSceneries([data.imageUrl]);
              setMessages(prev => [...prev, { id: 'latency-init', role: 'assistant', text: `⏱️ *Image generated in ${data.latency}s*` }]);
            }
            setIsGenerating(false);
          })
          .catch((err) => {
            console.error("Initial image generation failed", err);
            if (mounted) setIsGenerating(false);
          });

        ws.onmessage = (event) => {
          if (!mounted) return;
          const data = JSON.parse(event.data);

          if (data.type === 'audio') {
            setIsSpeaking(true);
            player.playAudioChunk(data.audio);
            setTimeout(() => { if (mounted) setIsSpeaking(false) }, 500);
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
        if (mounted) setIsGenerating(false);
      }
    };

    initWorld();

    return () => {
      mounted = false;
      if (ws) ws.close();
      if (audioPlayerRef.current) audioPlayerRef.current.stopAllAndClear();
    };
  }, []);

  const sendMessage = useCallback((msg: any) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    }
  }, []);
  
  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  return {
    messages,
    sceneries,
    isGenerating,
    isSpeaking,
    sendMessage,
    addMessage
  };
}
