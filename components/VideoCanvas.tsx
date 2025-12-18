import React, { useRef, useEffect, useState, MouseEvent } from 'react';
import { MemeSegment, AppState, BoundingBox } from '../types';
import { fetchFreeTTS } from '../services/localAnalysisService';

interface VideoCanvasProps {
  imageSrc: string;
  segments: MemeSegment[];
  appState: AppState;
  setAppState: (state: AppState) => void;
  width?: number;
  height?: number;
  editingSegmentId?: string | null;
  onUpdateSegment?: (id: string, box: BoundingBox) => void;
  voice?: SpeechSynthesisVoice | null;
}

type DragMode = 'NONE' | 'MOVE' | 'RESIZE_TL' | 'RESIZE_TR' | 'RESIZE_BL' | 'RESIZE_BR';

const VideoCanvas: React.FC<VideoCanvasProps> = ({ 
  imageSrc, 
  segments, 
  appState, 
  setAppState,
  width = 600, 
  height = 600,
  editingSegmentId,
  onUpdateSegment,
  voice
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  
  // State Refs
  const appStateRef = useRef(appState);
  
  // Recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Playback state refs
  const currentSegmentIndexRef = useRef<number>(-1);
  const isPlayingRef = useRef<boolean>(false);
  
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);

  // Interaction State
  const [dragMode, setDragMode] = useState<DragMode>('NONE');
  const [dragStart, setDragStart] = useState<{ x: number, y: number } | null>(null);
  const [initialBox, setInitialBox] = useState<BoundingBox | null>(null);

  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  useEffect(() => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      imgRef.current = img;
      drawFrame();
    };
  }, [imageSrc]);

  useEffect(() => {
    drawFrame();
  }, [editingSegmentId, segments]);

  const getLayout = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return null;

    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const x = (canvas.width / 2) - (img.width / 2) * scale;
    const y = (canvas.height / 2) - (img.height / 2) * scale;
    const w = img.width * scale;
    const h = img.height * scale;

    return { x, y, w, h, scale, imgWidth: img.width, imgHeight: img.height };
  };

  const drawFrame = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const img = imgRef.current;
    const currentState = appStateRef.current; 

    if (!canvas || !ctx || !img) return;

    // Clear
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const layout = getLayout();
    if (!layout) return;
    const { x, y, w, h, scale } = layout;

    // --- EDIT MODE RENDERING ---
    if (editingSegmentId) {
      ctx.drawImage(img, x, y, w, h);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
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

        ctx.save();
        ctx.beginPath();
        ctx.rect(dx, dy, dw, dh);
        ctx.clip();
        ctx.drawImage(img, x, y, w, h);
        ctx.restore();

        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(dx, dy, dw, dh);
        ctx.setLineDash([]);
        
        ctx.fillStyle = '#fff';
        const hs = 8;
        const handles = [{ x: dx, y: dy }, { x: dx + dw, y: dy }, { x: dx, y: dy + dh }, { x: dx + dw, y: dy + dh }];
        handles.forEach(h => {
            ctx.fillRect(h.x - hs/2, h.y - hs/2, hs, hs);
            ctx.strokeRect(h.x - hs/2, h.y - hs/2, hs, hs);
        });
      }
      return;
    }

    // --- PLAYBACK RENDERING ---
    ctx.filter = 'blur(15px) brightness(0.6)';
    ctx.drawImage(img, x, y, w, h);
    ctx.filter = 'none';

    const currentIndex = currentSegmentIndexRef.current;
    const maxIndex = (currentState === AppState.PLAYING || currentState === AppState.RECORDING) 
      ? currentIndex 
      : (currentState === AppState.READY ? -1 : segments.length - 1);

    segments.forEach((seg, index) => {
      if (index <= maxIndex && index >= 0) {
        const sx = (seg.box.xmin / 1000) * img.width;
        const sy = (seg.box.ymin / 1000) * img.height;
        const sw = ((seg.box.xmax - seg.box.xmin) / 1000) * img.width;
        const sh = ((seg.box.ymax - seg.box.ymin) / 1000) * img.height;

        const dx = x + sx * scale;
        const dy = y + sy * scale;
        const dw = sw * scale;
        const dh = sh * scale;

        ctx.save();
        ctx.beginPath();
        ctx.rect(dx, dy, dw, dh);
        ctx.clip();
        ctx.drawImage(img, x, y, w, h);
        ctx.restore();

        // Highlight only if NOT recording
        if (index === currentIndex && currentState !== AppState.RECORDING) {
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 4;
          ctx.shadowColor = '#facc15';
          ctx.shadowBlur = 10;
          ctx.strokeRect(dx - 2, dy - 2, dw + 4, dh + 4);
          ctx.shadowBlur = 0;
        }
      }
    });

    if (isPlayingRef.current) {
        requestAnimationFrame(drawFrame);
    }
  };

  const getCanvasCoords = (e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (!editingSegmentId || !onUpdateSegment) return;
    const { x: mx, y: my } = getCanvasCoords(e);
    const layout = getLayout();
    if (!layout) return;

    const seg = segments.find(s => s.id === editingSegmentId);
    if (!seg) return;

    const sx = (seg.box.xmin / 1000) * layout.imgWidth;
    const sy = (seg.box.ymin / 1000) * layout.imgHeight;
    const sw = ((seg.box.xmax - seg.box.xmin) / 1000) * layout.imgWidth;
    const sh = ((seg.box.ymax - seg.box.ymin) / 1000) * layout.imgHeight;
    const dx = layout.x + sx * layout.scale;
    const dy = layout.y + sy * layout.scale;
    const dw = sw * layout.scale;
    const dh = sh * layout.scale;
    
    const hitDist = 15;

    if (Math.abs(mx - dx) < hitDist && Math.abs(my - dy) < hitDist) setDragMode('RESIZE_TL');
    else if (Math.abs(mx - (dx + dw)) < hitDist && Math.abs(my - dy) < hitDist) setDragMode('RESIZE_TR');
    else if (Math.abs(mx - dx) < hitDist && Math.abs(my - (dy + dh)) < hitDist) setDragMode('RESIZE_BL');
    else if (Math.abs(mx - (dx + dw)) < hitDist && Math.abs(my - (dy + dh)) < hitDist) setDragMode('RESIZE_BR');
    else if (mx > dx && mx < dx + dw && my > dy && my < dy + dh) setDragMode('MOVE');
    else return;

    setDragStart({ x: mx, y: my });
    setInitialBox({ ...seg.box });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (editingSegmentId && !dragStart) {
        const { x: mx, y: my } = getCanvasCoords(e);
        const layout = getLayout();
        if (layout && canvasRef.current) {
            const seg = segments.find(s => s.id === editingSegmentId);
            if (seg) {
                const sx = (seg.box.xmin / 1000) * layout.imgWidth;
                const sy = (seg.box.ymin / 1000) * layout.imgHeight;
                const sw = ((seg.box.xmax - seg.box.xmin) / 1000) * layout.imgWidth;
                const sh = ((seg.box.ymax - seg.box.ymin) / 1000) * layout.imgHeight;
                const dx = layout.x + sx * layout.scale;
                const dy = layout.y + sy * layout.scale;
                const dw = sw * layout.scale;
                const dh = sh * layout.scale;
                const hit = 10;
                if ((Math.abs(mx - dx) < hit && Math.abs(my - dy) < hit) || (Math.abs(mx-(dx+dw))<hit && Math.abs(my-(dy+dh))<hit)) canvasRef.current.style.cursor = 'nwse-resize';
                else if ((Math.abs(mx-(dx+dw))<hit && Math.abs(my-dy)<hit) || (Math.abs(mx-dx)<hit && Math.abs(my-(dy+dh))<hit)) canvasRef.current.style.cursor = 'nesw-resize';
                else if (mx > dx && mx < dx + dw && my > dy && my < dy + dh) canvasRef.current.style.cursor = 'move';
                else canvasRef.current.style.cursor = 'default';
            }
        }
    }
    if (dragMode === 'NONE' || !dragStart || !initialBox || !editingSegmentId || !onUpdateSegment) return;
    const { x: mx, y: my } = getCanvasCoords(e);
    const layout = getLayout();
    if (!layout) return;

    const deltaX = (mx - dragStart.x) / layout.scale / layout.imgWidth * 1000;
    const deltaY = (my - dragStart.y) / layout.scale / layout.imgHeight * 1000;
    const newBox = { ...initialBox };

    switch (dragMode) {
        case 'MOVE':
            newBox.xmin = Math.max(0, Math.min(1000, initialBox.xmin + deltaX));
            newBox.ymin = Math.max(0, Math.min(1000, initialBox.ymin + deltaY));
            newBox.xmax = Math.max(0, Math.min(1000, initialBox.xmax + deltaX));
            newBox.ymax = Math.max(0, Math.min(1000, initialBox.ymax + deltaY));
            break;
        case 'RESIZE_TL':
            newBox.xmin = Math.min(newBox.xmax - 10, initialBox.xmin + deltaX);
            newBox.ymin = Math.min(newBox.ymax - 10, initialBox.ymin + deltaY);
            break;
        case 'RESIZE_TR':
            newBox.xmax = Math.max(newBox.xmin + 10, initialBox.xmax + deltaX);
            newBox.ymin = Math.min(newBox.ymax - 10, initialBox.ymin + deltaY);
            break;
        case 'RESIZE_BL':
            newBox.xmin = Math.min(newBox.xmax - 10, initialBox.xmin + deltaX);
            newBox.ymax = Math.max(newBox.ymin + 10, initialBox.ymax + deltaY);
            break;
        case 'RESIZE_BR':
            newBox.xmax = Math.max(newBox.xmin + 10, initialBox.xmax + deltaX);
            newBox.ymax = Math.max(newBox.ymin + 10, initialBox.ymax + deltaY);
            break;
    }
    const clampedBox = {
        xmin: Math.max(0, Math.min(1000, newBox.xmin)),
        ymin: Math.max(0, Math.min(1000, newBox.ymin)),
        xmax: Math.max(0, Math.min(1000, newBox.xmax)),
        ymax: Math.max(0, Math.min(1000, newBox.ymax))
    };
    onUpdateSegment(editingSegmentId, clampedBox);
  };

  const handleMouseUp = () => {
    setDragMode('NONE');
    setDragStart(null);
    setInitialBox(null);
  };

  // Decode Gemini 2.5 Raw PCM
  const decodePCM = (base64: string, ctx: AudioContext): AudioBuffer => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const dataInt16 = new Int16Array(bytes.buffer);
    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
    return buffer;
  };

  // Decode Standard Audio (MP3/WAV)
  const decodeAudio = async (base64: string, ctx: AudioContext): Promise<AudioBuffer> => {
     const binaryString = window.atob(base64);
     const len = binaryString.length;
     const bytes = new Uint8Array(len);
     for (let i = 0; i < len; i++) {
         bytes[i] = binaryString.charCodeAt(i);
     }
     return await ctx.decodeAudioData(bytes.buffer.slice(0));
  };

  const playSequence = async (isRecording: boolean) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const actx = audioContextRef.current;
    
    if (actx.state === 'suspended') await actx.resume();

    // Setup Recording
    if (isRecording && canvasRef.current) {
      const mimeTypes = [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm",
          "video/mp4"
      ];
      const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || "video/webm";

      destinationRef.current = actx.createMediaStreamDestination();
      const canvasStream = canvasRef.current.captureStream(30);
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...destinationRef.current.stream.getAudioTracks()
      ]);
      
      try {
        mediaRecorderRef.current = new MediaRecorder(combinedStream, { mimeType });
        recordedChunksRef.current = [];
        mediaRecorderRef.current.ondataavailable = (e) => { 
            if (e.data.size > 0) recordedChunksRef.current.push(e.data); 
        };
        mediaRecorderRef.current.onstop = () => {
            const blob = new Blob(recordedChunksRef.current, { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `meme-reveal-${Date.now()}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
            a.click();
            setAppState(AppState.READY);
        };
        mediaRecorderRef.current.start();
      } catch (e) {
          console.error("MediaRecorder failed to start", e);
          setAppState(AppState.READY);
          return;
      }
    }

    isPlayingRef.current = true;
    currentSegmentIndexRef.current = -1;
    drawFrame();

    for (let i = 0; i < segments.length; i++) {
        if (!isPlayingRef.current) break;
        const seg = segments[i];
        currentSegmentIndexRef.current = i;
        setActiveSegmentId(seg.id);

        let audioDuration = 0;

        if (seg.audioBase64) {
            // CASE 1: Pre-existing Audio Blob (Gemini or Regenerated)
            try {
              let buffer: AudioBuffer;
              if (seg.audioType === 'mp3') {
                 buffer = await decodeAudio(seg.audioBase64, actx);
              } else {
                 buffer = decodePCM(seg.audioBase64, actx);
              }
              audioDuration = buffer.duration;
              const source = actx.createBufferSource();
              source.buffer = buffer;
              const mainOutput = actx.createGain();
              mainOutput.connect(actx.destination);
              if (isRecording && destinationRef.current) mainOutput.connect(destinationRef.current);
              source.connect(mainOutput);
              source.start(0);
            } catch (err) {
              console.error("Audio playback error", err);
            }
        } else if (seg.text) {
             // CASE 2: No Blob - Manual Mode
             if (isRecording) {
                 // RECORDING: Try to fetch audio just-in-time
                 try {
                     const fetchedAudio = await fetchFreeTTS(seg.text);
                     if (fetchedAudio) {
                         const buffer = await decodeAudio(fetchedAudio, actx);
                         audioDuration = buffer.duration;
                         const source = actx.createBufferSource();
                         source.buffer = buffer;
                         const mainOutput = actx.createGain();
                         mainOutput.connect(actx.destination);
                         if (destinationRef.current) mainOutput.connect(destinationRef.current);
                         source.connect(mainOutput);
                         source.start(0);
                     }
                 } catch (e) {
                     console.warn("JIT Audio fetch failed for export", e);
                 }
             } else {
                 // PREVIEW: Use Browser TTS (SpeechSynthesis)
                 // This cannot be recorded, so audioDuration remains 0 (wait loop handles sync)
                 await new Promise<void>((resolve) => {
                     if (!isPlayingRef.current) { resolve(); return; }
                     const u = new SpeechSynthesisUtterance(seg.text);
                     if (voice) u.voice = voice;
                     u.onend = () => resolve();
                     u.onerror = () => resolve();
                     window.speechSynthesis.speak(u);
                 });
             }
        }
        
        // Wait logic
        const waitTime = Math.max(audioDuration, seg.duration || 0) * 1000;
        if (audioDuration > 0) {
            // If we played an audio buffer, wait for it
            await new Promise(r => setTimeout(r, waitTime));
        } else {
            // If we used Browser TTS, we already awaited the speech. 
            // Only wait extra if duration > speech (approximated by assuming duration is total time)
            // But since we can't measure speech time precisely without measuring start/end,
            // we effectively just waited for speech. If manual duration is very long, wait remainder?
            // Simplification: if Browser TTS, just pause a bit extra.
            if (!isRecording) await new Promise(r => setTimeout(r, 500));
            else await new Promise(r => setTimeout(r, waitTime)); // For recording silence/JIT audio
        }
        
        await new Promise(r => setTimeout(r, 200));
    }

    if (isRecording && mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        await new Promise(r => setTimeout(r, 500));
        mediaRecorderRef.current.stop();
    } else {
        setAppState(AppState.READY);
    }
    
    isPlayingRef.current = false;
    currentSegmentIndexRef.current = -1;
    setActiveSegmentId(null);
    drawFrame();
  };

  useEffect(() => {
    if (appState === AppState.PLAYING) playSequence(false);
    else if (appState === AppState.RECORDING) playSequence(true);
    else {
        isPlayingRef.current = false;
        window.speechSynthesis.cancel();
    }
  }, [appState]);

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="relative rounded-xl overflow-hidden shadow-2xl border border-slate-700 bg-slate-900 select-none">
        <canvas 
          ref={canvasRef} 
          width={width} 
          height={height}
          className="w-full h-auto max-h-[60vh] object-contain touch-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        {appState === AppState.PLAYING && (
          <div className="absolute top-4 right-4 bg-red-500/80 text-white px-3 py-1 rounded-full text-xs font-bold animate-pulse pointer-events-none">
            PREVIEWING
          </div>
        )}
        {appState === AppState.RECORDING && (
          <div className="absolute top-4 right-4 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold animate-pulse flex items-center gap-2 pointer-events-none">
            <span className="block w-2 h-2 bg-white rounded-full"></span> REC
          </div>
        )}
        {editingSegmentId && (
           <div className="absolute top-4 right-4 bg-cyan-600/90 text-white px-3 py-1 rounded-full text-xs font-bold shadow-lg pointer-events-none">
             DRAG TO EDIT
           </div>
        )}
      </div>
      
      <div className="h-12 text-center text-slate-300 font-medium text-lg min-h-[3rem] px-4">
        {activeSegmentId ? segments.find(s => s.id === activeSegmentId)?.text : "..."}
      </div>
    </div>
  );
};

export default VideoCanvas;