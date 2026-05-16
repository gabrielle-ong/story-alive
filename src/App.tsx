import { SceneryViewer } from './components/SceneryViewer';
import { ChatSidebar } from './components/ChatSidebar';
import { fileToBase64 } from './lib/fileUtils';
import { ChatMessage } from './types/chat';
import { useStoryteller } from './hooks/useStoryteller';
import { useMicrophone } from './hooks/useMicrophone';

export default function App() {
  const {
    messages,
    sceneries,
    isGenerating,
    isSpeaking,
    sendMessage,
    addMessage
  } = useStoryteller();

  const { isMicActive, toggleMic } = useMicrophone(sendMessage);

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

    addMessage(newUserMsg);

    if (base64Image) {
      sendMessage({ image: base64Image, imageText: text });
    } else if (text) {
      sendMessage({ text });
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
