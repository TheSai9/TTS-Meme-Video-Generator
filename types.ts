export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface MemeSegment {
  id: string;
  text: string;
  box: BoundingBox;
  audioBase64?: string; // Populated after TTS
  duration?: number; // Duration of audio in seconds
}

export enum AppState {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  GENERATING_AUDIO = 'GENERATING_AUDIO',
  READY = 'READY',
  PLAYING = 'PLAYING',
  RECORDING = 'RECORDING',
}

export interface PlaybackState {
  currentSegmentIndex: number;
  isPlaying: boolean;
  progress: number; // 0 to 1 for the current segment
}