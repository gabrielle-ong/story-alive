import { useState, useEffect } from 'react';
import { SceneryViewer } from './components/SceneryViewer';
import { ChatSidebar } from './components/ChatSidebar';
import { processUserMessage, generateSceneryImage, ChatMessage, fileToBase64 } from './services/aiService';

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sceneries, setSceneries] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(true); // initially true for the first generated scenery

  // Initial prompt kick off
  useEffect(() => {
    const initWorld = async () => {
      try {
        const welcomeMessage: ChatMessage = {
          id: 'welcome',
          role: 'assistant',
          text: 'The canvas is ready. I cannot generate direct GIF videos yet, but I have brought the scenery to life with cinematic camera pans and a magical particle system! Try tapping a quick-action button below or send your own idea!',
        };
        setMessages([welcomeMessage]);
        
        // Generate the very first scenery
        const initialPrompt = 'A beautiful, peaceful studio ghibli style anime landscape, a pristine blank canvas of rolling green hills, awaiting new creations, bright blue sky, masterpiece, highly detailed.';
        const initialImageUrl = await generateSceneryImage(initialPrompt);
        setSceneries([initialImageUrl]);
      } catch (err: any) {
        console.error("Failed to initialize world", err);
        const errorMessage = err?.message || 'Unknown error occurred.';
        setMessages(prev => [...prev, {
          id: 'error-init',
          role: 'assistant',
          text: `Hmm, I seem to be having trouble drawing our starting location. (Error: ${errorMessage})`
        }]);
      } finally {
        setIsGenerating(false);
      }
    };
    
    initWorld();
  }, []);

  const handleSendMessage = async (text: string, file?: File) => {
    // Optimistically add user message
    const userMsgId = Date.now().toString();
    const newUserMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      text,
    };
    
    if (file) {
      try {
        const base64 = await fileToBase64(file);
        newUserMsg.imageData = {
          mimeType: file.type,
          data: base64.split(',')[1]
        };
      } catch (err) {
        console.error("Failed to read file", err);
      }
    }

    setMessages(prev => [...prev, newUserMsg]);
    setIsGenerating(true);

    try {
      // 1. Get Assistant reply and the prompt for the next scenery
      const aiResponse = await processUserMessage(messages, text, file);
      
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: aiResponse.assistantReply
      };
      
      // We can show the assistant reply early while image is generating
      setMessages(prev => [...prev, assistantMsg]);

      // 2. Generate the background based on the prompt
      console.log("Generating background with prompt:", aiResponse.backgroundPrompt);
      const newImageUrl = await generateSceneryImage(aiResponse.backgroundPrompt);
      
      setSceneries(prev => [...prev, newImageUrl]);
    } catch (err: any) {
      console.error("Interaction failed", err);
      const errorMessage = err?.message || 'Unknown error occurred.';
      setMessages(prev => [...prev, {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        text: `Uh oh, the magic faded for a moment. Error: ${errorMessage}. Try telling me that again?`
      }]);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-stone-900 font-sans">
      <div className="absolute inset-0">
        <SceneryViewer sceneries={sceneries} />
      </div>
      <div className="absolute right-0 top-0 bottom-0 z-10 w-96">
        <ChatSidebar 
          messages={messages} 
          onSendMessage={handleSendMessage} 
          isGenerating={isGenerating} 
        />
      </div>
    </div>
  );
}
