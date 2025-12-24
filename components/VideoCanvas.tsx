import React, { useRef, useEffect, useState, MouseEvent } from 'react';
import { MemeSegment, AppState, BoundingBox } from '../types';

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
  width = 800, 
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
  const recordedChunksRef = useRef<Blob[]>([]);
  const screenStreamRef = useRef<MediaStream | null>(null); // To stop screen share after recording

  // Playback state refs
  const currentSegmentIndexRef = useRef<number>(-1);
  const isPlayingRef = useRef<boolean>(false);
  
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [canvasDims, setCanvasDims] = useState<{ width: number, height: number }>({ width, height });

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
      // Update canvas dimensions to match the source image exactly
      setCanvasDims({ width: img.naturalWidth, height: img.naturalHeight });
    };
  }, [imageSrc]);

  // Redraw when dimensions change (implies image loaded) or segments update
  useEffect(() => {
    if (imgRef.current) {
        drawFrame();
    }
  }, [canvasDims, editingSegmentId, segments]);

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

    // Clear background (Warm paper color)
    ctx.fillStyle = '#fdfbf7';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const layout = getLayout();
    if (!layout) return;
    const { x, y, w, h, scale } = layout;

    // --- EDIT MODE RENDERING ---
    if (editingSegmentId) {
      ctx.drawImage(img, x, y, w, h);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; // White fade
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

        // Correction Marker Style Edit Box
        ctx.strokeStyle = '#ff4d4d';
        ctx.lineWidth = 3;
        // Make it look hand-drawn with slight irregularities (simulated) by line joins
        ctx.lineJoin = 'round';
        ctx.strokeRect(dx, dy, dw, dh);
        
        ctx.fillStyle = '#ff4d4d';
        const hs = 10;
        const handles = [{ x: dx, y: dy }, { x: dx + dw, y: dy }, { x: dx, y: dy + dh }, { x: dx + dw, y: dy + dh }];
        handles.forEach(h => {
            ctx.beginPath();
            ctx.arc(h.x, h.y, hs/2, 0, Math.PI * 2);
            ctx.fill();
        });
      }
      return;
    }

    // --- PLAYBACK RENDERING ---
    // Reduce blur intensity to keep context visible
    ctx.filter = 'blur(5px) grayscale(30%) opacity(0.5)';
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
          // Highlighter Effect
          ctx.strokeStyle = 'rgba(255, 235, 59, 0.6)'; // Transparent yellow
          ctx.lineWidth = 12;
          ctx.lineCap = 'round';
          ctx.strokeRect(dx - 6, dy - 6, dw + 12, dh + 12);
          
          // Pencil Outline
          ctx.strokeStyle = '#2d2d2d';
          ctx.lineWidth = 2;
          ctx.strokeRect(dx, dy, dw, dh);
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
    
    const hitDist = 20; // Larger hit area

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
                const hit = 15;
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

    // 1. SETUP RECORDING (Screen Share)
    if (isRecording && canvasRef.current) {
      try {
        // Request Display Media to capture system/tab audio
        // NOTE: We cast to 'any' because some options like 'preferCurrentTab' are experimental in TS types
        const displayMedia = await navigator.mediaDevices.getDisplayMedia({
            video: true, // Video is mandatory to get audio
            audio: true,
            preferCurrentTab: true,
            selfBrowserSurface: "include",
            systemAudio: "include"
        } as any);

        screenStreamRef.current = displayMedia;

        // Verify audio track
        const audioTrack = displayMedia.getAudioTracks()[0];
        if (!audioTrack) {
           alert("No audio track detected! Please ensure 'Share tab audio' is checked in the browser popup.");
           displayMedia.getTracks().forEach(t => t.stop());
           setAppState(AppState.READY);
           return;
        }

        // Combine Canvas Video + System Audio
        const canvasStream = canvasRef.current.captureStream(30);
        const videoTrack = canvasStream.getVideoTracks()[0];
        const combinedStream = new MediaStream([videoTrack, audioTrack]);

        // Init Recorder
        const mimeTypes = [
            "video/webm;codecs=vp9,opus",
            "video/webm;codecs=vp8,opus",
            "video/webm",
            "video/mp4"
        ];
        const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || "video/webm";

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

        mediaRecorderRef.current.start(100);

      } catch (e: any) {
          console.error("Recording setup failed or cancelled", e);
          if (e.name === 'NotAllowedError' || e.name === 'SecurityError' || (e.message && e.message.includes('policy'))) {
              alert("Screen recording permission was denied or is blocked by the browser policy. Please ensure you grant permission to share the screen (and audio) when prompted.");
          }
          setAppState(AppState.READY);
          return;
      }
    }

    // 2. PLAYBACK LOOP (Unified)
    isPlayingRef.current = true;
    currentSegmentIndexRef.current = -1;
    drawFrame();

    for (let i = 0; i < segments.length; i++) {
        if (!isPlayingRef.current) break;
        const seg = segments[i];
        currentSegmentIndexRef.current = i;
        setActiveSegmentId(seg.id);

        let audioDuration = 0;

        // If we have an audio blob (AI generated or fetched), we play it via Web Audio API.
        // This output goes to speakers, so getDisplayMedia captures it.
        if (seg.audioBase64) {
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
              source.connect(actx.destination); // Play to speakers
              source.start(0);
            } catch (err) {
              console.error("Audio playback error", err);
            }
        } 
        // If text only (Manual Mode), we use Browser TTS.
        // This output goes to speakers, so getDisplayMedia captures it.
        else if (seg.text) {
             await new Promise<void>((resolve) => {
                 if (!isPlayingRef.current) { resolve(); return; }
                 const u = new SpeechSynthesisUtterance(seg.text);
                 if (voice) u.voice = voice;
                 u.onend = () => resolve();
                 u.onerror = () => resolve();
                 // Estimate duration if synthesis fails instantly to prevent skipping
                 audioDuration = 0; // Duration logic handled by onend
                 window.speechSynthesis.speak(u);
             });
        }
        
        // If audioDuration was set (from buffer), wait for it.
        // If we used TTS, the await Promise above handles the wait.
        if (audioDuration > 0) {
            await new Promise(r => setTimeout(r, audioDuration * 1000));
        } else if (!seg.text && !seg.audioBase64) {
             // Visual only, use segment duration
             await new Promise(r => setTimeout(r, (seg.duration || 1) * 1000));
        }

        // Small buffer between segments
        await new Promise(r => setTimeout(r, 300));
    }

    // 3. CLEANUP
    if (isRecording) {
        mediaRecorderRef.current?.stop();
        // Stop the screen share streams to remove the browser warning bar
        screenStreamRef.current?.getTracks().forEach(t => t.stop());
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
    <div className="flex flex-col items-center gap-6 w-full">
      <div className="relative p-2 bg-white border-[3px] border-[#2d2d2d] border-wobbly-sm shadow-sketch-lg rotate-1 transition-transform duration-500 hover:rotate-0 w-full flex justify-center">
        <canvas 
          ref={canvasRef} 
          width={canvasDims.width} 
          height={canvasDims.height}
          className="w-full h-auto max-h-[80vh] object-contain touch-none border-2 border-[#2d2d2d] border-dashed"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        {appState === AppState.PLAYING && (
          <div className="absolute top-6 right-6 bg-[#fff9c4] border-2 border-[#2d2d2d] text-[#2d2d2d] px-4 py-2 text-sm font-bold animate-pulse pointer-events-none shadow-sm transform -rotate-2">
            PREVIEWING
          </div>
        )}
        {appState === AppState.RECORDING && (
          <div className="absolute top-6 right-6 bg-[#ff4d4d] border-2 border-[#2d2d2d] text-white px-4 py-2 text-sm font-bold animate-pulse flex items-center gap-2 pointer-events-none shadow-sm transform rotate-1">
            <span className="block w-3 h-3 bg-white rounded-full border border-[#2d2d2d]"></span> REC
          </div>
        )}
        {editingSegmentId && (
           <div className="absolute top-6 right-6 bg-[#2d5da1] text-white border-2 border-[#2d2d2d] px-4 py-2 text-sm font-bold shadow-sm pointer-events-none transform -rotate-1">
             Drag to Edit
           </div>
        )}
      </div>
      
      <div className="h-16 flex items-center justify-center w-full max-w-2xl">
        <p className="text-center text-[#2d2d2d] font-hand font-bold text-2xl min-h-[1.5rem]">
            {activeSegmentId ? `"${segments.find(s => s.id === activeSegmentId)?.text}"` : "..."}
        </p>
      </div>
    </div>
  );
};

export default VideoCanvas;