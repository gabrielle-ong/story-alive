import { useState, useRef, useEffect } from 'react';
import { pcmToBase64 } from '../lib/audioUtils';

export function useMicrophone(sendMessage: (msg: any) => void) {
  const [isMicActive, setIsMicActive] = useState<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
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

      await audioCtx.audioWorklet.addModule('/audio-processor.js');

      const source = audioCtx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioCtx, 'audio-recorder-processor');
      workletNodeRef.current = workletNode;

      source.connect(workletNode);
      // We intentionally do not connect the worklet to audioCtx.destination to avoid mic feedback!

      workletNode.port.onmessage = (e) => {
        const float32Data = e.data;
        const base64 = pcmToBase64(float32Data);
        sendMessageRef.current({ audio: base64 });
      };
      
      setIsMicActive(true);
    } catch (err) {
      console.error("Failed to start microphone", err);
    }
  };

  const stopMic = () => {
    if (workletNodeRef.current) workletNodeRef.current.disconnect();
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
