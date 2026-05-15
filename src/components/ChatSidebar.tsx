import React, { useState, useRef, useEffect } from 'react';
import { Send, Image as ImageIcon, Loader2, Maximize2, Minimize2, Camera, X, Mic } from 'lucide-react';
import type { ChatMessage } from '../services/aiService';

interface ChatSidebarProps {
  messages: ChatMessage[];
  onSendMessage: (text: string, file?: File) => void;
  isGenerating: boolean;
  isMicActive: boolean;
  onToggleMic: () => void;
  isSpeaking: boolean;
}

const QUICK_PROMPTS = [
  { icon: '🌅', label: 'Sunset' },
  { icon: '🌌', label: 'Night Sky' },
  { icon: '🌧️', label: 'Rainy' },
  { icon: '🏰', label: 'Castle' },
  { icon: '🌸', label: 'Blossoms' },
  { icon: '✨', label: 'Magic' },
];

export function ChatSidebar({ messages, onSendMessage, isGenerating, isMicActive, onToggleMic, isSpeaking }: ChatSidebarProps) {
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isMinimal, setIsMinimal] = useState(false);
  
  // Camera state
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const startCamera = async () => {
    setIsCameraOpen(true);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error("Camera error", err);
      alert("Could not access camera. Make sure you gave browser permissions.");
      setIsCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    setStream(null);
    setIsCameraOpen(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
            setSelectedImage(file);
            setImagePreview(URL.createObjectURL(file));
            stopCamera();
          }
        }, 'image/jpeg');
      }
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (!isMinimal) {
      scrollToBottom();
    }
  }, [messages, isGenerating, isMinimal]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedImage(file);
      const url = URL.createObjectURL(file);
      setImagePreview(url);
    }
  };

  const handleSend = () => {
    if ((!inputText.trim() && !selectedImage) || isGenerating) return;
    
    onSendMessage(inputText, selectedImage || undefined);
    setInputText('');
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="w-full h-full flex flex-col justify-end">
      {/* History Panel */}
      <div 
        className={`flex flex-col bg-black/20 text-white border-l border-white/10 shadow-2xl backdrop-blur-xl transition-all duration-300 ${
          isMinimal ? 'h-0 opacity-0 overflow-hidden border-none' : 'h-full opacity-100'
        }`}
      >
        <div className="p-4 border-b border-white/10 bg-white/5 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-serif text-amber-100 drop-shadow-md">Travel Log</h2>
            <p className="text-xs text-white/70">Your journey dictates the world.</p>
          </div>
          <button onClick={() => setIsMinimal(true)} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/70 hover:text-white" title="Hide History">
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className="text-xs text-white/60 mb-1 px-1 drop-shadow-sm">
                {msg.role === 'user' ? 'You' : 'Canvas AI'}
              </span>
              <div 
                className={`max-w-[85%] rounded-2xl p-3 shadow-md backdrop-blur-md border border-white/10 relative ${
                  msg.role === 'user' 
                    ? 'bg-white/20 rounded-tr-sm text-white' 
                    : 'bg-black/30 rounded-tl-sm text-white/90'
                } ${msg.isInterrupted ? 'opacity-70 border-dashed border-white/30' : ''}`}
              >
                {msg.isInterrupted && msg.role === 'assistant' && (
                  <span className="absolute -top-5 right-0 text-[10px] font-mono font-bold text-amber-500 mb-1 uppercase tracking-wider">Interrupted</span>
                )}
                {msg.imageData && (
                  <img 
                    src={`data:${msg.imageData.mimeType};base64,${msg.imageData.data}`} 
                    alt="Attached" 
                    className="rounded-lg mb-2 max-w-full h-auto object-cover max-h-48"
                  />
                )}
                {msg.text && (
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                )}
              </div>
            </div>
          ))}

          {isGenerating && (
            <div className="flex flex-col items-start">
              <span className="text-xs text-white/60 mb-1 px-1 drop-shadow-sm">Canvas AI</span>
              <div className="bg-black/30 backdrop-blur-md border border-white/10 rounded-2xl rounded-tl-sm p-4 shadow-md flex items-center space-x-2">
                <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                <span className="text-sm text-white/80 font-mono">Drawing the world...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Actions and Input Panel */}
      <div className={`relative p-4 transition-colors duration-300 ${
        isMinimal ? 'bg-gradient-to-t from-black/80 via-black/40 to-transparent pb-6' : 'bg-black/20 border-t border-l border-white/10 backdrop-blur-xl'
      }`}>
        {/* Camera Modal Overlay */}
        {isCameraOpen && (
          <div className="absolute bottom-full left-0 w-full p-4 z-50">
            <div className="bg-black/80 border border-white/20 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-xl flex flex-col">
              <div className="flex justify-between items-center p-3 border-b border-white/10">
                <span className="text-white font-medium pl-1">Take Photo</span>
                <button onClick={stopCamera} className="p-1 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="relative bg-black aspect-[4/3] w-full max-h-[40vh] flex items-center justify-center">
                {!stream && <Loader2 className="w-6 h-6 animate-spin text-white/50" />}
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  className={`w-full h-full object-cover transition-opacity duration-300 ${stream ? 'opacity-100' : 'opacity-0'}`} 
                />
              </div>
              <div className="p-4 flex justify-center">
                <button 
                  onClick={capturePhoto} 
                  disabled={!stream}
                  className="bg-amber-600 hover:bg-amber-500 text-white rounded-full p-3 shadow-lg disabled:opacity-50 transition-colors"
                >
                  <Camera className="w-6 h-6" />
                </button>
              </div>
              <canvas ref={canvasRef} className="hidden" />
            </div>
          </div>
        )}

        {isMinimal && (
           <div className="absolute -top-12 right-2">
              <button onClick={() => setIsMinimal(false)} className="p-2 bg-black/40 hover:bg-black/60 rounded-full transition-colors text-white/70 hover:text-white backdrop-blur-md" title="Show History">
                <Maximize2 className="w-4 h-4" />
              </button>
           </div>
        )}

        {/* Quick Prompts Row */}
        <div className="flex space-x-2 overflow-x-auto pb-3 scrollbar-hide no-scrollbar items-center">
           {QUICK_PROMPTS.map((prompt, i) => (
             <button
                key={i}
                onClick={() => onSendMessage(prompt.label)}
                disabled={isGenerating}
                className="whitespace-nowrap flex items-center space-x-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/10 rounded-full text-xs font-medium text-white/90 backdrop-blur-md transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 shadow-sm"
             >
                <span>{prompt.icon}</span>
                <span>{prompt.label}</span>
             </button>
           ))}
        </div>

        {imagePreview && (
          <div className="mb-3 relative inline-block group">
            <img src={imagePreview} alt="Preview" className="h-20 w-auto rounded-lg border border-white/20 shadow-lg object-cover" />
            <button 
              onClick={() => { setSelectedImage(null); setImagePreview(null); }}
              className="absolute -top-2 -right-2 bg-red-500/80 hover:bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex items-end space-x-2 bg-white/10 backdrop-blur-xl rounded-xl p-2 border border-white/20 focus-within:border-white/40 transition-colors shadow-inner">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-white/60 hover:text-white transition-colors rounded-lg hover:bg-white/10"
            disabled={isGenerating}
            title="Upload Image"
          >
            <ImageIcon className="w-5 h-5 drop-shadow-sm" />
          </button>
          <button 
            onClick={onToggleMic}
            className={`p-2 transition-colors rounded-lg shadow-sm ${isMicActive ? 'bg-amber-500 text-white animate-pulse' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
            disabled={isGenerating}
            title={isMicActive ? "Stop Mic" : "Start Mic"}
          >
            <Mic className="w-5 h-5 drop-shadow-sm" />
          </button>
          <button 
            onClick={startCamera}
            className="p-2 text-white/60 hover:text-white transition-colors rounded-lg hover:bg-white/10"
            disabled={isGenerating}
            title="Take Photo"
          >
            <Camera className="w-5 h-5 drop-shadow-sm" />
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImageSelect}
            accept="image/*"
            className="hidden" 
          />
          
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type an element or theme..."
            disabled={isGenerating}
            className="flex-1 max-h-32 min-h-[40px] bg-transparent resize-none outline-none py-2 px-1 text-white placeholder-white/50"
            rows={1}
          />
          
          <button 
            onClick={handleSend}
            disabled={(!inputText.trim() && !selectedImage) || isGenerating}
            className="p-2 bg-white/20 text-white rounded-lg hover:bg-white/30 disabled:opacity-30 disabled:hover:bg-white/20 transition-colors border border-white/20 shadow-sm"
          >
            <Send className="w-5 h-5 drop-shadow-sm" />
          </button>
        </div>
      </div>
    </div>
  );
}
