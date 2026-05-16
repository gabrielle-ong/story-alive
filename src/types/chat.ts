export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  imageData?: { mimeType: string; data: string }; // base64
  isInterrupted?: boolean;
}
