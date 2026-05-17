import React, { useState, useRef, useEffect } from 'react';
import { Camera, Mic, Square, Play, Image as ImageIcon, CheckCircle, Send } from 'lucide-react';
import { pcmToBase64 } from './lib/audioUtils';
import { AudioStreamingPlayer } from './lib/AudioStreamingPlayer';
import { motion, AnimatePresence } from 'motion/react';

type PlayPhase = 'setup' | 'playing';

interface ChatMessage {
   id: string;
   source: 'user' | 'model' | 'system';
   text: string;
   isInterrupted?: boolean;
}

const ART_STYLES = [
   'Studio Ghibli',
   'Action Hero/Comic Book',
   'Line Cartoon',
   'Watercolor',
   'Cyberpunk',
   'Dark Fantasy',
   'Classic Oil Painting'
];

export default function App() {
   const [phase, setPhase] = useState<PlayPhase>('setup');

   // Setup Phase State
   const [artStyle, setArtStyle] = useState<string>('Studio Ghibli');
   const [characterName, setCharacterName] = useState<string>('');
   const [backstory, setBackstory] = useState<string>('');
   const [tone, setTone] = useState<string>('Whimsical');
   const [setting, setSetting] = useState<string>('Fantasy World');
   const [conflict, setConflict] = useState<string>('Find the lost artifact');
   const [characterImageBase64, setCharacterImageBase64] = useState<string | null>(null);

   // Live Session State
   const [socket, setSocket] = useState<WebSocket | null>(null);
   const socketRef = useRef<WebSocket | null>(null);
   const [messages, setMessages] = useState<ChatMessage[]>([]);
   const [currentSceneImage, setCurrentSceneImage] = useState<string | null>(null);
   const [currentSceneDesc, setCurrentSceneDesc] = useState<string | null>(null);
   const [isMicActive, setIsMicActive] = useState<boolean>(false);
   const [textInput, setTextInput] = useState('');

   const [isSpeaking, setIsSpeaking] = useState<boolean>(false); // for model

   const audioPlayerRef = useRef<AudioStreamingPlayer | null>(null);
   const audioCtxRef = useRef<AudioContext | null>(null);
   const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
   const mediaStreamRef = useRef<MediaStream | null>(null);
   const messagesEndRef = useRef<HTMLDivElement>(null);

   // Scroll to bottom
   useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
   }, [messages]);

   const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
         const reader = new FileReader();
         reader.onload = async (ev) => {
            const base64 = ev.target?.result as string;
            setCharacterImageBase64(base64);
            try {
               const res = await fetch('/api/extract-character', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ imageBase64: base64 })
               });
               const data = await res.json();
               if (data.description) {
                  setBackstory(prev => prev ? `${prev} ${data.description}` : data.description);
               }
            } catch (err) {
               console.error("Failed to extract characteristics");
            }
         };
         reader.readAsDataURL(file);
      }
   };

   const startAdventure = () => {
      if (!characterName) return alert("Please enter a character name");

      // Connect WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const config = JSON.stringify({
         artStyle, characterName, backstory, tone, setting, conflict
      });
      const wsUrl = `${protocol}//${window.location.host}/live?config=${encodeURIComponent(config)}`;
      const ws = new WebSocket(wsUrl);
      setSocket(ws);
      socketRef.current = ws;

      const player = new AudioStreamingPlayer(24000);
      audioPlayerRef.current = player;

      ws.onmessage = (event) => {
         const data = JSON.parse(event.data);

         if (data.type === 'audio') {
            setIsSpeaking(true);
            player.playAudioChunk(data.audio);
            // simple timeout to reset speaking logic (could be more robust with onended in player)
            setTimeout(() => setIsSpeaking(false), 500);
         }
         else if (data.type === 'transcription') {
            setMessages(prev => {
               const last = prev[prev.length - 1];
               // aggregate parts if same source and not interrupted
               if (last && last.source === data.source && !last.isInterrupted) {
                  return [...prev.slice(0, -1), { ...last, text: last.text + data.text }];
               }
               return [...prev, { id: Math.random().toString(), source: data.source, text: data.text }];
            });
         }
         else if (data.type === 'interrupted') {
            player.stopAllAndClear();
            // mark last model message as interrupted
            setMessages(prev => {
               const last = prev[prev.length - 1];
               if (last && last.source === 'model') {
                  return [...prev.slice(0, -1), { ...last, text: last.text + ' ...', isInterrupted: true }];
               }
               return prev;
            });
         }
         else if (data.type === 'illustration') {
            setCurrentSceneImage(data.imageUrl);
            setCurrentSceneDesc(data.description);
         }
         else if (data.type === 'error' || data.type === 'system') {
            setMessages(prev => [...prev, { id: Math.random().toString(), source: 'system', text: data.message }]);
         }
      };

      setPhase('playing');
   };

   const endAdventure = () => {
      socket?.close();
      setSocket(null);
      socketRef.current = null;
      stopMic();
      audioPlayerRef.current?.close();
      audioPlayerRef.current = null;
      setPhase('setup');
      setMessages([]);
      setCurrentSceneImage(null);
      setCurrentSceneDesc(null);
   };

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

   const stopResponse = () => {
      if (socket && socket.readyState === WebSocket.OPEN) {
         socket.send(JSON.stringify({ command: 'stop' }));
      }
   };

   const sendText = (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!textInput.trim() || !socket) return;
      socket.send(JSON.stringify({ text: textInput.trim() }));
      setMessages(prev => [...prev, { id: Math.random().toString(), source: 'user', text: textInput.trim() }]);
      setTextInput('');
   };

   if (phase === 'setup') {
      return (
         <div className="min-h-screen bg-[var(--color-surface)] text-[var(--color-text)] font-sans p-6 overflow-y-auto">
            <div className="max-w-4xl mx-auto space-y-8 pb-20">
               <header className="text-center space-y-2 pt-10">
                  <h1 className="text-5xl tracking-tight font-bold text-[var(--color-secondary)] uppercase">StoryAlive</h1>
                  <p className="text-[var(--color-text)] opacity-70 font-mono text-sm uppercase tracking-wider">Real-Time Collaborative CYOA Storyteller</p>
               </header>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Left Column */}
                  <div className="space-y-6">
                     <section className="bg-white p-6 rounded-none border-2 border-[var(--color-secondary)] shadow-[4px_4px_0_0_var(--color-secondary)]">
                        <h2 className="text-xl font-bold font-sans uppercase tracking-wide mb-4 flex items-center gap-2 text-[var(--color-secondary)]"><ImageIcon className="w-5 h-5 text-[var(--color-primary)]" /> Art Style Picker</h2>
                        <div className="grid grid-cols-2 gap-3">
                           {ART_STYLES.map(style => (
                              <button
                                 key={style}
                                 onClick={() => setArtStyle(style)}
                                 className={`p-3 border-2 text-sm text-left font-medium transition-all ${style === artStyle ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-[var(--color-secondary)]/20 hover:border-[var(--color-secondary)] hover:bg-[var(--color-secondary)]/5'}`}
                              >
                                 <div className="flex justify-between items-center">
                                    {style}
                                    {style === artStyle && <CheckCircle className="w-4 h-4" />}
                                 </div>
                              </button>
                           ))}
                        </div>
                     </section>

                     <section className="bg-white p-6 rounded-none border-2 border-[var(--color-secondary)] shadow-[4px_4px_0_0_var(--color-secondary)]">
                        <h2 className="text-xl font-bold font-sans uppercase tracking-wide mb-4 text-[var(--color-secondary)]">Story Anchors</h2>
                        <div className="space-y-4">
                           <div>
                              <label className="block text-xs font-mono font-bold text-[var(--color-secondary)] uppercase tracking-widest mb-1 shadow-none">Tone</label>
                              <input type="text" value={tone} onChange={e => setTone(e.target.value)} placeholder="e.g. Dark, Whimsical, Gritty" className="w-full bg-white border-2 border-[var(--color-secondary)] p-3 text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] placeholder-[var(--color-secondary)]/40 font-mono text-sm" />
                           </div>
                           <div>
                              <label className="block text-xs font-mono font-bold text-[var(--color-secondary)] uppercase tracking-widest mb-1">Setting</label>
                              <input type="text" value={setting} onChange={e => setSetting(e.target.value)} placeholder="e.g. Sci-Fi Cyberpunk city" className="w-full bg-white border-2 border-[var(--color-secondary)] p-3 text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] placeholder-[var(--color-secondary)]/40 font-mono text-sm" />
                           </div>
                           <div>
                              <label className="block text-xs font-mono font-bold text-[var(--color-secondary)] uppercase tracking-widest mb-1">Core Conflict</label>
                              <input type="text" value={conflict} onChange={e => setConflict(e.target.value)} placeholder="e.g. Rebellion against the AI overlord" className="w-full bg-white border-2 border-[var(--color-secondary)] p-3 text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] placeholder-[var(--color-secondary)]/40 font-mono text-sm" />
                           </div>
                        </div>
                     </section>
                  </div>

                  {/* Right Column */}
                  <div className="space-y-6">
                     <section className="bg-white p-6 rounded-none border-2 border-[var(--color-secondary)] shadow-[4px_4px_0_0_var(--color-secondary)]">
                        <h2 className="text-xl font-bold font-sans uppercase tracking-wide mb-4 text-[var(--color-secondary)]">Character Blueprint</h2>
                        <div className="space-y-4">
                           <div>
                              <label className="block text-xs font-mono font-bold text-[var(--color-secondary)] uppercase tracking-widest mb-1">Main Character Name *</label>
                              <input type="text" value={characterName} onChange={e => setCharacterName(e.target.value)} placeholder="Hero's name" className="w-full bg-white border-2 border-[var(--color-secondary)] p-3 text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] placeholder-[var(--color-secondary)]/40 font-mono text-sm" />
                           </div>

                           <div>
                              <label className="block text-xs font-mono font-bold text-[var(--color-secondary)] uppercase tracking-widest mb-1">Extract Features from Image</label>
                              <div className="flex items-center gap-4">
                                 <label className="cursor-pointer bg-white hover:bg-[var(--color-secondary)]/5 border-2 border-[var(--color-secondary)] py-2 px-4 flex items-center gap-2 transition-colors text-[var(--color-secondary)] font-mono font-bold text-xs uppercase">
                                    <Camera className="w-4 h-4" />
                                    <span>Upload Photo</span>
                                    <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                                 </label>
                                 {characterImageBase64 && <div className="text-xs text-[var(--color-primary)] font-mono font-bold uppercase flex items-center gap-1"><CheckCircle className="w-4 h-4" /> Image loaded</div>}
                              </div>
                           </div>

                           <div>
                              <label className="block text-xs font-mono font-bold text-[var(--color-secondary)] uppercase tracking-widest mb-1">Backstory & Traits</label>
                              <textarea value={backstory} onChange={e => setBackstory(e.target.value)} rows={5} placeholder="Orphaned at birth, possesses a mysterious glowing amulet..." className="w-full bg-white border-2 border-[var(--color-secondary)] p-3 text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] resize-none font-mono text-sm placeholder-[var(--color-secondary)]/40" />
                           </div>
                        </div>
                     </section>

                     <button
                        onClick={startAdventure}
                        disabled={!characterName}
                        className="w-full py-4 bg-[var(--color-primary)] text-white font-bold font-sans text-xl uppercase tracking-widest flex justify-center items-center gap-3 border-2 border-[var(--color-secondary)] shadow-[4px_4px_0_0_var(--color-secondary)] disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_var(--color-secondary)] active:translate-y-[4px] active:shadow-none"
                     >
                        <Play className="w-5 h-5 fill-current" />
                        Begin Adventure
                     </button>
                  </div>
               </div>
            </div>
         </div>
      );
   }

   // Playing Phase - Split Screen viewport
   return (
      <div className="bg-[var(--color-surface)] text-[var(--color-text)] font-sans h-screen w-full flex flex-col md:grid md:grid-cols-[400px_1fr] md:grid-rows-[64px_1fr] overflow-hidden">

         {/* Header - spans top row */}
         <header className="md:col-span-2 flex items-center justify-between px-6 border-b-2 border-[var(--color-secondary)] bg-white shrink-0 h-16">
            <div className="flex items-center gap-4">
               <h1 className="text-xl font-sans font-bold tracking-tight text-[var(--color-secondary)] uppercase">StoryAlive</h1>
               <div className="border-2 border-[var(--color-secondary)] px-3 py-1 text-xs font-mono font-bold uppercase tracking-wider text-[var(--color-secondary)] bg-[var(--color-secondary)]/5 shadow-[2px_2px_0_0_var(--color-secondary)]">
                  Live Session
               </div>
            </div>

            <div className={`flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest ${isMicActive ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
               <span className={`w-3 h-3 rounded-none border-2 ${isMicActive ? 'bg-[#16A34A] animate-pulse border-[#16A34A]' : 'bg-[#DC2626] border-[#DC2626]'}`}></span>
               {isMicActive ? 'Gemini Live Active' : 'Gemini Live Inactive'}
            </div>

            <div className="flex items-center gap-3">
               <div className="border-2 border-[var(--color-primary)] px-3 py-1 text-xs font-mono font-bold uppercase tracking-wider text-[var(--color-primary)] bg-[var(--color-primary)]/5 shadow-[2px_2px_0_0_var(--color-primary)]">
                  Style: {artStyle}
               </div>
               <button onClick={endAdventure} className="p-2 border-2 border-[var(--color-secondary)] bg-[var(--color-secondary)]/10 text-red-500 hover:bg-red-500 hover:text-white transition-colors shadow-[2px_2px_0_0_var(--color-secondary)]">
                  <Square className="w-4 h-4 fill-current" />
               </button>
            </div>
         </header>

         {/* Left Control Panel / Feed */}
         <aside className="md:col-start-1 md:row-start-2 flex flex-col border-r-2 border-[var(--color-secondary)] bg-white p-4 gap-4 z-10 overflow-hidden">

            {/* Character Card */}
            <div className="p-4 bg-white border-2 border-[var(--color-secondary)] shadow-[4px_4px_0_0_var(--color-secondary)] shrink-0">
               <div className="flex gap-3 items-center">
                  <div className="w-12 h-12 bg-[var(--color-primary)] border-2 border-[var(--color-secondary)] flex items-center justify-center font-sans font-bold text-xl text-white">
                     {characterName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                     <div className="text-xs font-mono font-bold text-[var(--color-secondary)] uppercase tracking-widest mb-0.5">Protagonist</div>
                     <div className="text-sm font-bold font-sans">{characterName}</div>
                  </div>
               </div>
            </div>

            {/* Chat feed */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-2 scrollbar-thin">
               <AnimatePresence>
                  {messages.length === 0 && (
                     <div className="text-center font-mono font-bold text-[var(--color-secondary)]/50 mt-10 text-sm uppercase">
                        Connecting to the storyteller...<br />Get ready to begin.
                     </div>
                  )}
                  {messages.map((m, i) => (
                     <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        key={m.id}
                        className={`px-4 py-3 border-2 border-[var(--color-secondary)] text-sm font-medium leading-relaxed max-w-[90%] shadow-[2px_2px_0_0_var(--color-secondary)] ${m.source === 'user'
                           ? 'bg-[var(--color-primary)] text-white self-end'
                           : m.source === 'system'
                              ? 'bg-white text-[var(--color-secondary)] text-xs font-mono font-bold tracking-wider uppercase self-center'
                              : 'bg-white text-[var(--color-text)] self-start'
                           } ${m.isInterrupted ? 'opacity-70 border-dashed' : ''}`}
                     >
                        {m.isInterrupted && m.source === 'model' && (
                           <span className="text-[10px] font-mono font-bold text-[var(--color-primary)] mb-1 block uppercase">Interrupted</span>
                        )}
                        {m.text}
                     </motion.div>
                  ))}
               </AnimatePresence>
               <div ref={messagesEndRef} />
            </div>

            {/* Bottom Input Area */}
            <div className="pt-2 shrink-0 space-y-3">
               {/* Telemetry Visualizer Placeholder */}
               <div className="h-10 flex items-center justify-center gap-1 opacity-80">
                  {isSpeaking && Array.from({ length: 12 }).map((_, i) => (
                     <motion.div key={i} animate={{ height: [8, Math.random() * 24 + 8, 8] }} transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.05 }} className="w-1.5 bg-[var(--color-secondary)] border border-white" />
                  ))}
               </div>

               <div className="flex items-center gap-2">
                  <button
                     onClick={toggleMic}
                     className={`p-3 transition-all border-2 border-[var(--color-secondary)] ${isMicActive ? 'bg-[var(--color-primary)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]' : 'bg-white hover:bg-[var(--color-secondary)]/10 shadow-[2px_2px_0_0_var(--color-secondary)]'}`}
                  >
                     <Mic className={`w-5 h-5 ${isMicActive ? 'text-white' : 'text-[var(--color-secondary)]'}`} />
                  </button>
                  <button
                     onClick={stopResponse}
                     title="Interrupt Model"
                     className="p-3 transition-all border-2 border-[var(--color-secondary)] bg-white hover:bg-red-500 hover:text-white hover:border-red-500 text-red-500 shadow-[2px_2px_0_0_var(--color-secondary)]"
                  >
                     <Square className="w-5 h-5 fill-current" />
                  </button>
                  <form onSubmit={sendText} className="flex-1 relative">
                     <input
                        type="text"
                        value={textInput}
                        onChange={e => setTextInput(e.target.value)}
                        placeholder="Or type your action..."
                        className="w-full bg-white border-2 border-[var(--color-secondary)] p-3 pr-12 text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] placeholder-[var(--color-secondary)]/40 text-sm font-mono shadow-[2px_2px_0_0_var(--color-secondary)]"
                     />
                     <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary)]/80 transition-colors border-2 border-[var(--color-primary)] hover:border-[var(--color-secondary)]">
                        <Send className="w-4 h-4" />
                     </button>
                  </form>
               </div>
            </div>
         </aside>

         {/* Right Canvas Panel */}
         <main className="hidden md:flex md:col-start-2 md:row-start-2 p-6 flex-col gap-6 overflow-hidden bg-[var(--color-surface)]">
            <div className="flex-1 overflow-hidden relative border-4 border-[var(--color-secondary)] shadow-[8px_8px_0_0_var(--color-secondary)] bg-white">
               <AnimatePresence mode="wait">
                  {currentSceneImage ? (
                     <motion.div
                        key={currentSceneImage}
                        initial={{ opacity: 0, filter: 'blur(10px)', scale: 1.05 }}
                        animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
                        exit={{ opacity: 0, transition: { duration: 0.5 } }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="absolute inset-0"
                     >
                        <img src={currentSceneImage} className="w-full h-full object-cover" alt="Scene" />

                        {/* Image Overlay */}
                        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[var(--color-secondary)] via-[var(--color-secondary)]/60 to-transparent flex justify-between items-end">
                           <div className="max-w-xl">
                              <div className="text-xs font-mono font-bold text-[var(--color-primary)] uppercase tracking-widest mb-2 shadow-black drop-shadow-md">Current Scene</div>
                              <p className="text-xl md:text-3xl font-sans font-medium leading-tight text-white drop-shadow-md pb-1">{currentSceneDesc}</p>
                           </div>
                           <div className="flex gap-2 shrink-0">
                              <div className="bg-white border-2 border-[var(--color-secondary)] px-3 py-1 text-xs font-mono font-bold uppercase tracking-wider text-[var(--color-secondary)] shadow-[2px_2px_0_0_var(--color-secondary)]">
                                 Gemini 3.1 Image
                              </div>
                           </div>
                        </div>
                     </motion.div>
                  ) : (
                     <div className="absolute inset-0 flex flex-col justify-center items-center text-[var(--color-secondary)]/40 space-y-4">
                        <ImageIcon className="w-16 h-16 opacity-50" />
                        <p className="tracking-widest uppercase font-mono font-bold text-sm opacity-60">Awaiting scene rendering...</p>
                     </div>
                  )}
               </AnimatePresence>
            </div>

            <div className="shrink-0 flex justify-between items-center px-2">
               <div className="flex gap-8">
                  <div className="flex flex-col">
                     <span className="text-xs font-mono font-bold text-[var(--color-secondary)] uppercase tracking-widest mb-1">Input Mode</span>
                     <span className="text-sm font-medium text-[var(--color-text)]">Multimodal Audio</span>
                  </div>
                  <div className="flex flex-col">
                     <span className="text-xs font-mono font-bold text-[var(--color-secondary)] uppercase tracking-widest mb-1">World Anchor</span>
                     <span className="text-sm font-medium text-[var(--color-text)]">{setting}</span>
                  </div>
               </div>
            </div>
         </main>
      </div>
   );
}
