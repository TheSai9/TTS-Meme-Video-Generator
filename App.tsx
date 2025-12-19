import React, { useState, useEffect } from 'react';
import { AppState, MemeSegment, BoundingBox } from './types';
import { analyzeMemeImage, generateSpeechForSegment } from './services/geminiService';
import { analyzeLocalImage, performOCROnBox, calculateSegmentDuration, isTextCoherent } from './services/localAnalysisService';
import VideoCanvas from './components/VideoCanvas';

// --- MAXIMALIST CONSTANTS ---
const ACCENT_COLORS = [
  '#FF3AF2', // Magenta
  '#00F5D4', // Cyan
  '#FFE600', // Yellow
  '#FF6B35', // Orange
  '#7B2FFF', // Purple
];

const DECORATIVE_EMOJIS = ['⚡', '🔥', '🚀', '✨', '👀', '💀', '👽', '👾'];

// --- SUBCOMPONENTS ---

const FloatingShape = ({ index }: { index: number }) => {
  // Deterministic "randomness" based on index
  const top = `${(index * 17) % 90}%`;
  const left = `${(index * 23) % 90}%`;
  const size = `${(index % 3) * 20 + 40}px`; // 40, 60, 80px
  const delay = `${index * 1.5}s`;
  const emoji = DECORATIVE_EMOJIS[index % DECORATIVE_EMOJIS.length];
  const rotation = index % 2 === 0 ? 'animate-float' : 'animate-wiggle';

  return (
    <div 
      className={`absolute select-none pointer-events-none z-0 text-6xl opacity-40 mix-blend-screen ${rotation}`}
      style={{ top, left, animationDelay: delay, fontSize: size }}
      aria-hidden="true"
    >
      {emoji}
    </div>
  );
};

const Header = () => (
  <header className="relative w-full max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center mb-16 pt-8 px-4 z-50">
    <div className="relative group cursor-default">
      <div className="absolute -inset-2 bg-gradient-to-r from-[#FF3AF2] via-[#00F5D4] to-[#FFE600] rounded-lg blur opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-tilt"></div>
      <h1 className="relative font-display text-7xl md:text-8xl text-white transform -rotate-2 group-hover:rotate-0 transition-transform duration-300 text-shadow-neon">
        MEME<span className="text-[#FFE600]">REVEAL</span>
      </h1>
      <div className="absolute -bottom-4 right-0 rotate-3 bg-[#FF6B35] text-black font-bold px-2 py-0.5 text-xs uppercase tracking-widest border-2 border-white shadow-hard-cyan">
        AI Powered
      </div>
    </div>
    
    <div className="mt-8 md:mt-0 flex flex-col items-end">
      <div className="bg-[#2D1B4E]/80 backdrop-blur-sm border-4 border-[#00F5D4] p-4 rounded-xl shadow-stack-sm transform rotate-1 hover:rotate-2 transition-all">
        <p className="font-heading font-black text-[#FF3AF2] uppercase tracking-tighter text-lg leading-none">
          Dopamine Level
        </p>
        <div className="w-full bg-black/50 h-3 mt-2 rounded-full overflow-hidden border border-white/20">
          <div className="h-full bg-gradient-to-r from-[#FF3AF2] to-[#FFE600] w-[90%] animate-pulse"></div>
        </div>
      </div>
    </div>
  </header>
);

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [segments, setSegments] = useState<MemeSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [useAI, setUseAI] = useState<boolean>(true);
  const [isProcessingAction, setIsProcessingAction] = useState<boolean>(false);
  
  // TTS State
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>('');

  useEffect(() => {
    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      setVoices(available);
      if (available.length > 0 && !selectedVoiceName) {
        const defaultVoice = available.find(v => v.name.includes('Google US English')) || available[0];
        setSelectedVoiceName(defaultVoice.name);
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [selectedVoiceName]);

  const getSelectedVoice = () => voices.find(v => v.name === selectedVoiceName) || null;

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setImageSrc(base64);
        processImage(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const processImage = async (base64: string) => {
    setError(null);
    setAppState(AppState.ANALYZING);
    const rawBase64 = base64.split(',')[1];

    if (!useAI) {
        try {
            const analyzedSegments = await analyzeLocalImage(rawBase64);
            setSegments(analyzedSegments);
            setAppState(AppState.READY);
        } catch (e: any) {
            console.error("Local Analysis Failed", e);
            setError("Local analysis failed.");
            setSegments([{
                id: `manual-init-${Date.now()}`,
                text: "MANUAL MODE // EDIT NOW",
                box: { xmin: 100, ymin: 100, xmax: 900, ymax: 900 },
                duration: 3
            }]);
            setAppState(AppState.READY);
        }
        return;
    }

    try {
      const analyzedSegments = await analyzeMemeImage(rawBase64);
      setAppState(AppState.GENERATING_AUDIO);
      const segmentsWithAudio = await Promise.all(analyzedSegments.map(async (seg) => {
        try {
          const { audioBase64, audioType } = await generateSpeechForSegment(seg.text);
          return { ...seg, audioBase64, audioType };
        } catch (e) {
          console.error(`Failed to generate audio for segment: ${seg.text}`, e);
          return seg;
        }
      }));
      setSegments(segmentsWithAudio);
      setAppState(AppState.READY);
    } catch (e: any) {
      setError(e.message || "Failed to analyze meme.");
      setAppState(AppState.IDLE);
    }
  };

  const handleReset = () => {
    setAppState(AppState.IDLE);
    setImageSrc(null);
    setSegments([]);
    setError(null);
    setEditingSegmentId(null);
  };

  // ... (Keeping logic functions same: moveSegment, updateSegmentBox, etc.) ...
  const moveSegment = (index: number, direction: 'up' | 'down') => {
    if (appState !== AppState.READY) return;
    const newSegments = [...segments];
    if (direction === 'up' && index > 0) {
      [newSegments[index], newSegments[index - 1]] = [newSegments[index - 1], newSegments[index]];
    } else if (direction === 'down' && index < newSegments.length - 1) {
      [newSegments[index], newSegments[index + 1]] = [newSegments[index + 1], newSegments[index]];
    }
    setSegments(newSegments);
  };

  const updateSegmentBox = (id: string, partialBox: Partial<BoundingBox>) => {
    setSegments(prev => prev.map(s => s.id !== id ? s : { ...s, box: { ...s.box, ...partialBox } }));
  };
  
  const updateSegmentDuration = (id: string, duration: number) => {
     setSegments(prev => prev.map(s => s.id === id ? { ...s, duration } : s));
  };

  const updateSegmentText = (id: string, text: string) => {
    setSegments(prev => prev.map(s => {
        if (s.id !== id) return s;
        const newDuration = calculateSegmentDuration(text);
        return { ...s, text, duration: newDuration };
    }));
  };

  const deleteSegment = (id: string) => {
    if(editingSegmentId === id) setEditingSegmentId(null);
    setSegments(prev => prev.filter(s => s.id !== id));
  };

  const scanTextForSegment = async (id: string) => {
      if (!imageSrc) return;
      const seg = segments.find(s => s.id === id);
      if (!seg) return;
      setIsProcessingAction(true);
      try {
          const rawBase64 = imageSrc.split(',')[1];
          const text = await performOCROnBox(rawBase64, seg.box);
          let finalText = "(Visual Only)";
          if (isTextCoherent(text)) finalText = text;
          const duration = calculateSegmentDuration(finalText);
          setSegments(prev => prev.map(s => s.id === id ? { ...s, text: finalText, duration } : s));
      } catch (e) {
          console.error("Scan failed", e);
      } finally {
          setIsProcessingAction(false);
      }
  };

  const addSegment = async () => {
    const defaultBox = { xmin: 300, ymin: 300, xmax: 700, ymax: 700 };
    const newId = `custom-${Date.now()}`;
    const newSeg: MemeSegment = { id: newId, text: "Scanning...", box: defaultBox, duration: 1 };
    setSegments(prev => [...prev, newSeg]);
    setEditingSegmentId(newId);
    if (imageSrc) {
        setIsProcessingAction(true);
        try {
            const rawBase64 = imageSrc.split(',')[1];
            const text = await performOCROnBox(rawBase64, defaultBox);
            let finalText = "New Reveal";
            if (isTextCoherent(text)) finalText = text;
            const duration = calculateSegmentDuration(finalText);
            setSegments(prev => prev.map(s => s.id === newId ? { ...s, text: finalText, duration } : s));
        } catch (e) { console.error("Auto-scan failed", e); setSegments(prev => prev.map(s => s.id === newId ? { ...s, text: "New Reveal" } : s));
        } finally { setIsProcessingAction(false); }
    }
  };

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      {/* BACKGROUND LAYERS */}
      <div className="fixed inset-0 pattern-dots pointer-events-none z-0"></div>
      <div className="fixed inset-0 pattern-checker pointer-events-none z-0 opacity-20"></div>
      
      {/* FLOATING DECORATIONS */}
      {Array.from({ length: 8 }).map((_, i) => <FloatingShape key={i} index={i} />)}

      <Header />

      <main className="relative z-10 w-full max-w-7xl mx-auto px-4 pb-20 flex flex-col items-center gap-12">
        
        {error && (
          <div className="w-full max-w-2xl bg-[#FF6B35] border-4 border-white text-black font-bold p-6 rounded-2xl shadow-stack-lg rotate-1 animate-wiggle">
            ERROR: {error}
          </div>
        )}

        {/* State: IDLE - Upload Area */}
        {appState === AppState.IDLE && (
          <div className="flex flex-col gap-8 w-full max-w-2xl">
            
            {/* Mode Toggle - Maximalist */}
            <div className="flex items-center justify-between bg-[#2D1B4E]/90 backdrop-blur-md p-6 rounded-3xl border-4 border-[#00F5D4] shadow-hard-magenta transform -rotate-1">
                <div>
                    <h3 className="font-display text-3xl text-white tracking-wide">
                        AI <span className="text-[#FFE600]">SUPERCHARGE</span>
                    </h3>
                    <p className="font-mono text-sm text-[#00F5D4] mt-1">Vision + TTS Analysis</p>
                </div>
                <button 
                    onClick={() => setUseAI(!useAI)}
                    className={`relative w-20 h-10 rounded-full transition-colors border-4 ${useAI ? 'bg-[#FF3AF2] border-[#FFE600]' : 'bg-[#2D1B4E] border-[#7B2FFF]'}`}
                >
                    <span className={`absolute top-0 left-0 bg-white w-8 h-8 rounded-full border-2 border-black transition-transform transform ${useAI ? 'translate-x-10' : 'translate-x-0'} shadow-sm`} />
                </button>
            </div>

            {/* Manual Mode Voices */}
            {!useAI && (
              <div className="bg-[#2D1B4E] p-6 rounded-3xl border-4 border-[#FFE600] shadow-hard-cyan rotate-1">
                  <label className="font-heading font-black text-xl text-white block mb-2 uppercase">Narrator Voice</label>
                  <select 
                    value={selectedVoiceName}
                    onChange={(e) => setSelectedVoiceName(e.target.value)}
                    className="w-full bg-black/50 text-white font-bold p-4 rounded-xl border-4 border-[#FF3AF2] focus:outline-none focus:ring-4 focus:ring-[#00F5D4] focus:ring-offset-2 focus:ring-offset-[#2D1B4E]"
                  >
                    {voices.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                  </select>
              </div>
            )}

            {/* Upload Zone - Maximalist */}
            <div className="relative group cursor-pointer perspective-1000">
                <div className="absolute inset-0 bg-gradient-to-r from-[#FF3AF2] to-[#00F5D4] rounded-3xl blur opacity-25 group-hover:opacity-60 transition duration-500 animate-pulse"></div>
                <div className="relative w-full h-80 bg-[#0D0D1A] border-8 border-dashed border-[#FF3AF2] group-hover:border-[#FFE600] rounded-3xl flex flex-col items-center justify-center transition-all duration-300 transform group-hover:scale-[1.02] group-hover:rotate-1">
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleFileUpload} 
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-50"
                  />
                  <div className="w-24 h-24 bg-[#7B2FFF] rounded-full flex items-center justify-center mb-6 border-4 border-[#00F5D4] shadow-hard-yellow group-hover:animate-bounce">
                    <span className="text-5xl">📂</span>
                  </div>
                  <h3 className="font-display text-4xl text-white uppercase tracking-wider text-shadow-neon">
                    Drop Meme Here
                  </h3>
                  <p className="text-[#00F5D4] font-bold mt-2 font-mono">JPG / PNG / WEBP</p>
                </div>
            </div>

            {!useAI && (
               <div className="text-center font-bold text-[#FF6B35] bg-[#2D1B4E] p-3 rounded-xl border-2 border-[#FF6B35] border-dashed">
                   MANUAL MODE ACTIVE // LOCAL ONLY
               </div>
            )}
          </div>
        )}

        {/* State: LOADING */}
        {(appState === AppState.ANALYZING || appState === AppState.GENERATING_AUDIO) && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="relative w-32 h-32 mb-8">
              <div className="absolute inset-0 border-8 border-[#2D1B4E] rounded-full"></div>
              <div className="absolute inset-0 border-8 border-t-[#FF3AF2] border-r-[#00F5D4] border-b-[#FFE600] border-l-[#FF6B35] rounded-full animate-spin"></div>
            </div>
            <h3 className="font-display text-6xl text-white text-shadow-neon animate-pulse">
              {appState === AppState.ANALYZING ? 'ANALYZING...' : 'COOKING AUDIO...'}
            </h3>
            <p className="text-[#00F5D4] font-mono mt-4 text-xl">
               DO NOT RESIST THE PROCESS
            </p>
          </div>
        )}

        {/* State: EDITOR / PLAYER */}
        {(appState === AppState.READY || appState === AppState.PLAYING || appState === AppState.RECORDING) && imageSrc && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full">
            
            {/* Left: Canvas (8 cols) */}
            <div className="lg:col-span-8 flex flex-col items-center">
              <div className="relative z-20 transform transition-transform duration-500 hover:scale-[1.01]">
                 <VideoCanvas 
                    imageSrc={imageSrc} 
                    segments={segments} 
                    appState={appState} 
                    setAppState={setAppState} 
                    width={800}
                    height={600}
                    editingSegmentId={editingSegmentId}
                    onUpdateSegment={updateSegmentBox}
                    voice={getSelectedVoice()}
                  />
              </div>

              {/* Controls Bar */}
              <div className="flex flex-wrap gap-4 mt-8 justify-center w-full">
                <button
                  disabled={appState !== AppState.READY || editingSegmentId !== null}
                  onClick={() => setAppState(AppState.PLAYING)}
                  className="px-8 py-4 bg-gradient-to-r from-[#00F5D4] to-[#7B2FFF] border-4 border-white text-black font-black uppercase text-xl rounded-full shadow-stack-sm hover:shadow-stack-lg hover:-translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <span>▶</span> Preview
                </button>

                <button
                  disabled={appState !== AppState.READY || editingSegmentId !== null}
                  onClick={() => setAppState(AppState.RECORDING)}
                  className="px-8 py-4 bg-[#FF3AF2] border-4 border-[#FFE600] text-white font-black uppercase text-xl rounded-full shadow-hard-yellow hover:shadow-stack-lg hover:-translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 animate-pulse-glow"
                >
                  <span>🔴</span> Export Video
                </button>

                <button 
                  onClick={handleReset}
                  className="px-6 py-4 bg-[#2D1B4E] border-4 border-[#FF6B35] text-[#FF6B35] font-bold uppercase rounded-full hover:bg-[#FF6B35] hover:text-black transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Right: Segment List (4 cols) */}
            <div className="lg:col-span-4 flex flex-col h-[700px]">
              <div className="flex justify-between items-center mb-6 bg-[#2D1B4E] p-4 rounded-xl border-4 border-[#7B2FFF] shadow-hard-magenta">
                <h3 className="font-display text-2xl text-white tracking-wide">
                   TIMELINE
                </h3>
                <button 
                  onClick={addSegment}
                  disabled={isProcessingAction}
                  className="px-4 py-2 bg-[#FFE600] border-2 border-black text-black font-black rounded hover:bg-white transition-colors text-sm uppercase"
                >
                  {isProcessingAction ? '...' : '+ Add'}
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2 space-y-4 scrollbar-hide pb-20">
                {segments.map((seg, idx) => {
                  const accent = ACCENT_COLORS[idx % ACCENT_COLORS.length];
                  const nextAccent = ACCENT_COLORS[(idx + 1) % ACCENT_COLORS.length];
                  
                  return (
                    <div 
                      key={seg.id} 
                      className={`relative p-5 rounded-3xl border-4 transition-all duration-300 ${editingSegmentId === seg.id ? 'scale-105 z-20' : 'hover:scale-102 hover:rotate-1'}`}
                      style={{ 
                        backgroundColor: '#2D1B4E', 
                        borderColor: editingSegmentId === seg.id ? '#FFFFFF' : accent,
                        boxShadow: editingSegmentId === seg.id ? `8px 8px 0px ${nextAccent}` : `6px 6px 0px ${nextAccent}`
                      }}
                    >
                      {/* Header */}
                      <div className="flex justify-between items-center mb-3 border-b-2 border-dashed border-white/20 pb-2">
                        <span className="font-display text-2xl" style={{ color: accent }}>#{idx + 1}</span>
                        <div className="flex gap-2">
                           <button onClick={() => deleteSegment(seg.id)} className="text-white/50 hover:text-[#FF3AF2] font-bold">✕</button>
                           <button onClick={() => moveSegment(idx, 'up')} disabled={idx === 0} className="text-white/50 hover:text-[#00F5D4]">↑</button>
                           <button onClick={() => moveSegment(idx, 'down')} disabled={idx === segments.length - 1} className="text-white/50 hover:text-[#00F5D4]">↓</button>
                        </div>
                      </div>

                      {/* Content */}
                      {editingSegmentId === seg.id ? (
                        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                             <div className="bg-[#00F5D4]/20 p-2 rounded border-2 border-[#00F5D4] border-dashed text-center">
                                <button onClick={() => scanTextForSegment(seg.id)} disabled={isProcessingAction} className="text-xs font-bold text-[#00F5D4] uppercase hover:text-white">
                                    {isProcessingAction ? 'Scanning...' : '📍 Auto-Scan Box'}
                                </button>
                             </div>
                             <div>
                                <label className="text-xs font-bold text-white/60 uppercase">Text</label>
                                <textarea 
                                    value={seg.text} 
                                    onChange={(e) => updateSegmentText(seg.id, e.target.value)}
                                    className="w-full bg-black/40 border-2 border-white/20 rounded p-2 text-white font-mono text-sm focus:border-[#FFE600] outline-none"
                                    rows={2}
                                />
                             </div>
                             <div>
                                <label className="text-xs font-bold text-white/60 uppercase">Seconds</label>
                                <input 
                                    type="number" step="0.5" 
                                    value={seg.duration} 
                                    onChange={(e) => updateSegmentDuration(seg.id, Number(e.target.value))}
                                    className="w-full bg-black/40 border-2 border-white/20 rounded p-2 text-white font-mono text-sm focus:border-[#FFE600] outline-none"
                                />
                             </div>
                             <button 
                                onClick={() => setEditingSegmentId(null)}
                                className="w-full py-2 bg-[#FFE600] text-black font-bold uppercase rounded hover:bg-white"
                             >
                                Done
                             </button>
                        </div>
                      ) : (
                        <div onClick={() => setEditingSegmentId(seg.id)} className="cursor-pointer group">
                             <p className="text-white font-bold text-lg leading-tight line-clamp-2 group-hover:text-[#FFE600] transition-colors">
                                 {seg.text || <span className="italic text-white/40">Empty Scene</span>}
                             </p>
                             <div className="mt-3 flex gap-2">
                                <span className="px-2 py-1 bg-black/40 rounded text-xs font-mono text-white/70 border border-white/10">
                                    ⏱ {seg.duration}s
                                </span>
                                {seg.audioBase64 ? (
                                    <span className="px-2 py-1 bg-[#00F5D4]/20 text-[#00F5D4] rounded text-xs font-bold border border-[#00F5D4]/50">
                                        AUDIO READY
                                    </span>
                                ) : (
                                    <span className="px-2 py-1 bg-[#FF3AF2]/20 text-[#FF3AF2] rounded text-xs font-bold border border-[#FF3AF2]/50">
                                        BROWSER TTS
                                    </span>
                                )}
                             </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
};

export default App;