import { base64ToPcm } from './audioUtils';

export class AudioStreamingPlayer {
  private audioCtx: AudioContext;
  private nextStartTime: number = 0;
  private currentSources: AudioBufferSourceNode[] = [];

  constructor(sampleRate: number = 24000) {
    this.audioCtx = new AudioContext({ sampleRate });
    // Resume context if suspended
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  playAudioChunk(base64Audio: string) {
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const pcmData = base64ToPcm(base64Audio);
    
    // Create an empty, mono AudioBuffer for this chunk
    // Sample rate must match the incoming chunk sample rate.
    // Live API returns PCM 24000Hz by default, while we input 16000Hz.
    const buffer = this.audioCtx.createBuffer(1, pcmData.length, 24000);
    buffer.copyToChannel(pcmData, 0);

    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioCtx.destination);

    // Schedule audio to play accurately
    // Add small buffer time for the very first chunk to prevent stuttering
    if (this.nextStartTime < this.audioCtx.currentTime) {
      this.nextStartTime = this.audioCtx.currentTime + 0.1;
    }

    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
    
    source.onended = () => {
      this.currentSources = this.currentSources.filter(s => s !== source);
    };
    this.currentSources.push(source);
  }

  stopAllAndClear() {
    this.currentSources.forEach(source => {
      try {
        source.stop();
        source.disconnect();
      } catch(e) { }
    });
    this.currentSources = [];
    this.nextStartTime = this.audioCtx.currentTime;
  }
  
  close() {
    this.stopAllAndClear();
    try {
        this.audioCtx.close();
    } catch(e){}
  }
}
