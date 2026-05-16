import { useState, useRef, useEffect } from 'react';
import { pcmToBase64 } from '../lib/audioUtils';

export function useMicrophone(sendMessage: (msg: any) => void) {
  const [isMicActive, setIsMicActive] = useState<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

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
        const base64 = pcmToBase64(e.inputBuffer.getChannelData(0));
        sendMessageRef.current({ audio: base64 });
      };
      
      setIsMicActive(true);
    } catch (err) {
      console.error("Failed to start microphone", err);
    }
  };

  const stopMic = () => {
    if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => { });
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
    setIsMicActive(false);
  };

  const toggleMic = async () => {
    if (isMicActive) {
      stopMic();
    } else {
      await startMic();
    }
  };

  useEffect(() => {
    return () => {
      stopMic();
    };
  }, []);

  return {
    isMicActive,
    toggleMic
  };
}
