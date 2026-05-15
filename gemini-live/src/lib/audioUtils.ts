export function pcmToBase64(pcmData: Float32Array): string {
  // Float32Array to Int16Array
  const buffer = new ArrayBuffer(pcmData.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < pcmData.length; i++) {
    // Clamp to -1 to 1
    const s = Math.max(-1, Math.min(1, pcmData[i]));
    // Convert to 16-bit PCM
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  
  // ArrayBuffer to Base64
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToPcm(base64: string): Float32Array {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  
  const buffer = bytes.buffer;
  const view = new DataView(buffer);
  const pcmData = new Float32Array(len / 2);
  for (let i = 0; i < len / 2; i++) {
    pcmData[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return pcmData;
}
