import React, { useRef, useEffect, useState } from 'react';
import { MemeSegment, AppState } from '../types';

interface VideoCanvasProps {
  imageSrc: string;
  segments: MemeSegment[];
  appState: AppState;
  setAppState: (state: AppState) => void;
  width?: number;
  height?: number;
  editingSegmentId?: string | null;
}

const VideoCanvas: React.FC<VideoCanvasProps> = ({ 
  imageSrc, 
  segments, 
  appState, 
  setAppState,
  width = 600, 
  height = 600,
  editingSegmentId
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  
  // Recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Playback state refs (using refs for animation loop)
  const currentSegmentIndexRef = useRef<number>(-1);
  const isPlayingRef = useRef<boolean>(false);
  
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);

  // Initialize Image
  useEffect(() => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      imgRef.current = img;
      drawFrame();
    };
  }, [imageSrc]);

  // Effect to redraw when editing state changes
  useEffect(() => {
    drawFrame();
  }, [editingSegmentId, segments]);

  // Main Draw Loop
  const drawFrame = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const img = imgRef.current;

    if (!canvas || !ctx || !img) return;

    // Clear background
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate Aspect Ratio fit
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const x = (canvas.width / 2) - (img.width / 2) * scale;
    const y = (canvas.height / 2) - (img.height / 2) * scale;
    const w = img.width * scale;
    const h = img.height * scale;

    // --- EDIT MODE RENDERING ---
    if (editingSegmentId) {
      // Draw full image
      ctx.drawImage(img, x, y, w, h);
      
      // Overlay a semi-transparent dark layer to focus attention on the box
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(x, y, w, h);

      const seg = segments.find(s => s.id === editingSegmentId);
      if (seg) {
        const sx = (seg.box.xmin / 1000) * img.width;
        const sy = (seg.box.ymin / 1000) * img.height;
        const sw = ((seg.box.xmax - seg.box.xmin) / 1000) * img.width;
        const sh = ((seg.box.ymax - seg.box.ymin) / 1000) * img.height;

        const dx = x + sx * scale;
        const dy = y + sy * scale;
        const dw = sw * scale;
        const dh = sh * scale;

        // Cut out the "hole" to show the clear image
        ctx.save();
        ctx.beginPath();
        ctx.rect(dx, dy, dw, dh);
        ctx.clip();
        ctx.drawImage(img, x, y, w, h);
        ctx.restore();

        // Draw active edit border
        ctx.strokeStyle = '#06b6d4'; // Cyan-500
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(dx, dy, dw, dh);
        ctx.setLineDash([]);
        
        // Draw corner handles (visual only for now)
        ctx.fillStyle = '#06b6d4';
        const handleSize = 6;
        ctx.fillRect(dx - handleSize/2, dy - handleSize/2, handleSize, handleSize); // TL
        ctx.fillRect(dx + dw - handleSize/2, dy + dh - handleSize/2, handleSize, handleSize); // BR
      }
      return;
    }

    // --- NORMAL / PLAYBACK RENDERING ---

    // Draw the blurred base image (The "Hidden" state)
    ctx.filter = 'blur(15px) brightness(0.6)';
    ctx.drawImage(img, x, y, w, h);
    ctx.filter = 'none'; // Reset filter

    // Draw Revealed Segments
    const currentIndex = currentSegmentIndexRef.current;
    
    // We reveal all segments up to the current one
    const maxIndex = (appState === AppState.PLAYING || appState === AppState.RECORDING) 
      ? currentIndex 
      : (appState === AppState.READY ? -1 : segments.length - 1);

    segments.forEach((seg, index) => {
      if (index <= maxIndex && index >= 0) {
        // Convert 0-1000 coords to canvas coords relative to the image placement
        const sx = (seg.box.xmin / 1000) * img.width;
        const sy = (seg.box.ymin / 1000) * img.height;
        const sw = ((seg.box.xmax - seg.box.xmin) / 1000) * img.width;
        const sh = ((seg.box.ymax - seg.box.ymin) / 1000) * img.height;

        const dx = x + sx * scale;
        const dy = y + sy * scale;
        const dw = sw * scale;
        const dh = sh * scale;

        // Draw clean slice
        ctx.save();
        // Soft clipping for smoother edges
        ctx.beginPath();
        ctx.rect(dx, dy, dw, dh);
        ctx.clip();
        ctx.drawImage(img, x, y, w, h);
        ctx.restore();

        // Highlight active segment border
        if (index === currentIndex) {
          ctx.strokeStyle = '#facc15'; // Yellow neon
          ctx.lineWidth = 4;
          ctx.shadowColor = '#facc15';
          ctx.shadowBlur = 10;
          ctx.strokeRect(dx - 2, dy - 2, dw + 4, dh + 4);
          ctx.shadowBlur = 0;
        }
      }
    });

    // Request next frame if playing
    if (isPlayingRef.current) {
        requestAnimationFrame(drawFrame);
    }
  };

  // Helper to decode raw PCM audio from Gemini
  const decodePCM = (base64: string, ctx: AudioContext): AudioBuffer => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Gemini returns 16-bit PCM at 24kHz
    const dataInt16 = new Int16Array(bytes.buffer);
    const numChannels = 1;
    const sampleRate = 24000;
    const frameCount = dataInt16.length / numChannels;
    
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    const channelData = buffer.getChannelData(0);
    
    for (let i = 0; i < frameCount; i++) {
      // Convert PCM Int16 to Float32 [-1.0, 1.0]
      channelData[i] = dataInt16[i] / 32768.0;
    }
    
    return buffer;
  };

  const playSequence = async (isRecording: boolean) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const actx = audioContextRef.current;
    if (actx.state === 'suspended') {
      await actx.resume();
    }

    // Setup Recording Stream if needed
    if (isRecording && canvasRef.current) {
      destinationRef.current = actx.createMediaStreamDestination();
      const canvasStream = canvasRef.current.captureStream(30); // 30 FPS
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...destinationRef.current.stream.getAudioTracks()
      ]);

      mediaRecorderRef.current = new MediaRecorder(combinedStream, { mimeType: 'video/webm' });
      recordedChunksRef.current = [];
      
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `meme-reveal-${Date.now()}.webm`;
        a.click();
        setAppState(AppState.READY);
      };

      mediaRecorderRef.current.start();
    }

    isPlayingRef.current = true;
    currentSegmentIndexRef.current = -1; // Start before first
    drawFrame(); // Start loop

    // Playback Logic
    for (let i = 0; i < segments.length; i++) {
        if (!isPlayingRef.current) break;

        const seg = segments[i];
        currentSegmentIndexRef.current = i;
        setActiveSegmentId(seg.id);

        if (seg.audioBase64) {
            try {
              // Decode the raw PCM data
              const buffer = decodePCM(seg.audioBase64, actx);
              
              const source = actx.createBufferSource();
              source.buffer = buffer;
              
              // Route audio
              const mainOutput = actx.createGain();
              mainOutput.connect(actx.destination);
              
              if (isRecording && destinationRef.current) {
                  mainOutput.connect(destinationRef.current);
              }
              
              source.connect(mainOutput);
              source.start(0);

              // Wait for audio to finish
              await new Promise((resolve) => {
                  source.onended = resolve;
                  // Safety timeout
                  setTimeout(resolve, (buffer.duration * 1000) + 500); 
              });
            } catch (err) {
              console.error("Error decoding or playing audio segment:", err);
              // Fallback wait if audio fails
              await new Promise(r => setTimeout(r, 1000));
            }
        } else {
            // If no audio (visual only), wait a default time
            await new Promise(r => setTimeout(r, 2000));
        }
        
        // Small pause between segments
        await new Promise(r => setTimeout(r, 500));
    }

    // Finish
    if (isRecording && mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        // Wait a moment before cutting
        await new Promise(r => setTimeout(r, 1000));
        mediaRecorderRef.current.stop();
    } else {
        setAppState(AppState.READY);
    }
    
    isPlayingRef.current = false;
    currentSegmentIndexRef.current = -1;
    setActiveSegmentId(null);
    drawFrame(); // Final draw to clear or reset
  };

  useEffect(() => {
    if (appState === AppState.PLAYING) {
        playSequence(false);
    } else if (appState === AppState.RECORDING) {
        playSequence(true);
    } else {
        isPlayingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState]);

  // Initial draw on mount
  useEffect(() => {
    drawFrame();
  });

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="relative rounded-xl overflow-hidden shadow-2xl border border-slate-700 bg-slate-900">
        <canvas 
          ref={canvasRef} 
          width={width} 
          height={height}
          className="w-full h-auto max-h-[60vh] object-contain"
        />
        {appState === AppState.PLAYING && (
          <div className="absolute top-4 right-4 bg-red-500/80 text-white px-3 py-1 rounded-full text-xs font-bold animate-pulse">
            PREVIEWING
          </div>
        )}
        {appState === AppState.RECORDING && (
          <div className="absolute top-4 right-4 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold animate-pulse flex items-center gap-2">
            <span className="block w-2 h-2 bg-white rounded-full"></span> REC
          </div>
        )}
        {editingSegmentId && (
           <div className="absolute top-4 right-4 bg-cyan-600/90 text-white px-3 py-1 rounded-full text-xs font-bold shadow-lg">
             EDITING MODE
           </div>
        )}
      </div>
      
      {/* Active Segment Subtitle (Optional accessible view) */}
      <div className="h-12 text-center text-slate-300 font-medium text-lg min-h-[3rem] px-4">
        {activeSegmentId ? segments.find(s => s.id === activeSegmentId)?.text : "..."}
      </div>
    </div>
  );
};

export default VideoCanvas;