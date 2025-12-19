import React, { useState, useEffect } from 'react';
import { AppState, MemeSegment, BoundingBox } from './types';
import { analyzeMemeImage, generateSpeechForSegment } from './services/geminiService';
import { analyzeLocalImage, performOCROnBox, calculateSegmentDuration, isTextCoherent } from './services/localAnalysisService';
import VideoCanvas from './components/VideoCanvas';

// --- HAND-DRAWN ICONS & DECORATIONS ---

const ScribbleStar = () => (
  <svg viewBox="0 0 100 100" className="w-12 h-12 text-[#ff4d4d] opacity-80 animate-wiggle" style={{ filter: 'drop-shadow(2px 2px 0px rgba(0,0,0,0.1))' }}>
    <path fill="currentColor" d="M50 0 L61 35 L98 35 L68 57 L79 91 L50 70 L21 91 L32 57 L2 35 L39 35 Z" stroke="#2d2d2d" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

const ScribbleArrow = () => (
  <svg viewBox="0 0 100 60" className="w-24 h-16 text-[#2d2d2d] absolute -right-4 top-1/2 transform -translate-y-1/2 rotate-12 hidden md:block">
    <path d="M10 30 C 30 10, 70 10, 90 30" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="5,5" />
    <path d="M90 30 L 80 20 M 90 30 L 80 40" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const Tape = ({ className = "" }: { className?: string }) => (
  <div className={`absolute h-8 w-24 tape-gray transform ${className}`} style={{ zIndex: 10 }}></div>
);

interface HeaderProps {
  segmentCount: number;
  totalDuration: number;
}

const Header: React.FC<HeaderProps> = ({ segmentCount, totalDuration }) => (
  <header className="relative w-full max-w-[1400px] mx-auto flex flex-col md:flex-row justify-between items-center mb-8 pt-8 px-6 z-10">
    <div className="relative group cursor-default">
      <h1 className="relative font-heading text-6xl md:text-7xl text-[#2d2d2d] transform -rotate-2 group-hover:rotate-0 transition-transform duration-300">
        Meme<span className="text-[#ff4d4d] underline decoration-wavy decoration-2 underline-offset-4">Reveal</span>
      </h1>
      <div className="absolute -top-6 -right-8 transform rotate-12">
        <span className="bg-[#ff4d4d] text-white font-bold px-3 py-1 text-sm border-wobbly-sm shadow-sketch-sm inline-block transform -rotate-3">
          BETA
        </span>
      </div>
    </div>
    
    {/* Relevant Project Stats Sticky Note */}
    <div className="mt-8 md:mt-0 relative transform rotate-1 hover:-rotate-1 transition-transform">
      <Tape className="-top-3 left-1/2 -translate-x-1/2 -rotate-2" />
      <div className="bg-[#fff9c4] p-4 min-w-[200px] border-[3px] border-[#2d2d2d] border-wobbly-sm shadow-sketch flex flex-col items-center">
        <h3 className="font-heading font-bold text-[#2d2d2d] text-xl border-b-2 border-dashed border-[#2d2d2d]/20 pb-1 w-full text-center mb-2">
          Project Stats
        </h3>
        <div className="flex justify-between w-full gap-4 font-hand font-bold text-lg text-[#2d2d2d]">
           <div className="flex flex-col items-center">
             <span className="text-2xl">🎞️</span>
             <span>{segmentCount} Panels</span>
           </div>
           <div className="w-[2px] bg-[#2d2d2d]/20 rounded-full"></div>
           <div className="flex flex-col items-center">
             <span className="text-2xl">⏱️</span>
             <span>{totalDuration.toFixed(1)}s</span>
           </div>
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
  const [useAI, setUseAI] = useState<boolean>(false); // Manual default
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

  const totalDuration = segments.reduce((acc, seg) => acc + (seg.duration || 0), 0);

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      {/* Decorative Background Elements */}
      <div className="fixed top-20 left-10 transform -rotate-12 opacity-20 hidden md:block select-none pointer-events-none">
        <div className="w-32 h-32 border-[3px] border-[#2d2d2d] rounded-full"></div>
      </div>
      <div className="fixed bottom-20 right-10 transform rotate-12 opacity-20 hidden md:block select-none pointer-events-none">
        <div className="w-40 h-40 border-[3px] border-[#2d2d2d] border-dashed rounded-full"></div>
      </div>

      <Header segmentCount={segments.length} totalDuration={totalDuration} />

      {/* Increased max-width for larger canvas area */}
      <main className="relative z-10 w-full max-w-[1400px] mx-auto px-4 pb-20 flex flex-col items-center gap-12">
        
        {error && (
          <div className="w-full max-w-2xl bg-[#ff4d4d] border-[3px] border-[#2d2d2d] text-white font-bold p-6 border-wobbly-md shadow-sketch rotate-1">
            <div className="flex items-center gap-2">
                <span className="text-2xl">⚠️</span>
                <span>ERROR: {error}</span>
            </div>
          </div>
        )}

        {/* State: IDLE - Upload Area */}
        {appState === AppState.IDLE && (
          <div className="flex flex-col gap-10 w-full max-w-2xl">
            
            {/* Mode Toggle - Sketchy */}
            <div className="flex items-center justify-between bg-white p-6 border-wobbly-md border-[3px] border-[#2d2d2d] shadow-sketch transform -rotate-1 relative">
                <Tape className="-top-4 right-20 rotate-2" />
                <div>
                    <h3 className="font-heading text-3xl text-[#2d2d2d]">
                        AI <span className="text-[#ff4d4d] underline decoration-wavy">Automation</span>
                    </h3>
                    <p className="text-sm text-[#2d2d2d]/70">Vision + TTS Analysis</p>
                </div>
                <button 
                    onClick={() => setUseAI(!useAI)}
                    className={`relative w-20 h-10 rounded-full transition-colors border-[3px] border-[#2d2d2d] ${useAI ? 'bg-[#ff4d4d]' : 'bg-[#e5e0d8]'}`}
                >
                    <span className={`absolute top-0.5 left-0.5 bg-white w-8 h-8 rounded-full border-2 border-[#2d2d2d] transition-transform transform ${useAI ? 'translate-x-10' : 'translate-x-0'}`} />
                </button>
            </div>

            {/* Manual Mode Voices */}
            {!useAI && (
              <div className="bg-[#fff9c4] p-6 border-wobbly-md border-[3px] border-[#2d2d2d] shadow-sketch rotate-1">
                  <label className="font-heading font-bold text-2xl text-[#2d2d2d] block mb-2">Narrator Voice</label>
                  <select 
                    value={selectedVoiceName}
                    onChange={(e) => setSelectedVoiceName(e.target.value)}
                    className="w-full bg-white text-[#2d2d2d] font-bold p-3 border-wobbly-sm border-2 border-[#2d2d2d] focus:outline-none focus:border-[#2d5da1] focus:ring-2 focus:ring-[#2d5da1]/20"
                  >
                    {voices.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                  </select>
              </div>
            )}

            {/* Upload Zone - Sketchbook Page */}
            <div className="relative group cursor-pointer w-full">
                <ScribbleArrow />
                <div className="relative w-full h-80 bg-white border-[4px] border-dashed border-[#2d2d2d] border-wobbly-md flex flex-col items-center justify-center transition-all duration-300 transform group-hover:scale-[1.01] group-hover:rotate-1 group-hover:shadow-sketch group-active:scale-[0.99]">
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleFileUpload} 
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-50"
                  />
                  <div className="w-20 h-20 bg-[#e5e0d8] rounded-full flex items-center justify-center mb-4 border-[3px] border-[#2d2d2d]">
                    <span className="text-4xl">📂</span>
                  </div>
                  <h3 className="font-heading text-4xl text-[#2d2d2d]">
                    Drop Meme Here
                  </h3>
                  <p className="text-[#2d2d2d]/60 font-bold mt-2">JPG / PNG / WEBP</p>
                </div>
            </div>

            {!useAI && (
               <div className="text-center font-bold text-[#ff4d4d] transform rotate-1">
                   ( Manual Mode Active — Local Only )
               </div>
            )}
          </div>
        )}

        {/* State: LOADING */}
        {(appState === AppState.ANALYZING || appState === AppState.GENERATING_AUDIO) && (
          <div className="flex flex-col items-center justify-center py-20 relative">
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                 <ScribbleStar />
            </div>
            <div className="relative w-32 h-32 mb-8 animate-bounce">
              <span className="text-8xl">✏️</span>
            </div>
            <h3 className="font-heading text-5xl text-[#2d2d2d] animate-pulse">
              {appState === AppState.ANALYZING ? 'Sketching Layout...' : 'Writing Script...'}
            </h3>
            <p className="text-[#2d2d2d]/60 font-bold mt-4 text-xl transform -rotate-1">
               Hold on tight!
            </p>
          </div>
        )}

        {/* State: EDITOR / PLAYER */}
        {(appState === AppState.READY || appState === AppState.PLAYING || appState === AppState.RECORDING) && imageSrc && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 w-full">
            
            {/* Left: Canvas (Adjusted col-span for larger size: 9 vs 3) */}
            <div className="lg:col-span-9 flex flex-col items-center">
              <div className="relative z-20 w-full">
                 <VideoCanvas 
                    imageSrc={imageSrc} 
                    segments={segments} 
                    appState={appState} 
                    setAppState={setAppState} 
                    // Width prop doesn't constrain it anymore, CSS does
                    width={1200}
                    height={800}
                    editingSegmentId={editingSegmentId}
                    onUpdateSegment={updateSegmentBox}
                    voice={getSelectedVoice()}
                  />
              </div>

              {/* Controls Bar */}
              <div className="flex flex-wrap gap-6 mt-10 justify-center w-full">
                <button
                  disabled={appState !== AppState.READY || editingSegmentId !== null}
                  onClick={() => setAppState(AppState.PLAYING)}
                  className="px-8 py-3 bg-white border-[3px] border-[#2d2d2d] text-[#2d2d2d] font-bold text-2xl border-wobbly-oval shadow-sketch hover:bg-[#2d5da1] hover:text-white hover:shadow-sketch-sm hover:translate-x-[2px] hover:translate-y-[2px] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <span>▶</span> Preview
                </button>

                <button
                  disabled={appState !== AppState.READY || editingSegmentId !== null}
                  onClick={() => setAppState(AppState.RECORDING)}
                  className="px-8 py-3 bg-white border-[3px] border-[#2d2d2d] text-[#ff4d4d] font-bold text-2xl border-wobbly-oval shadow-sketch hover:bg-[#ff4d4d] hover:text-white hover:shadow-sketch-sm hover:translate-x-[2px] hover:translate-y-[2px] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <span>🔴</span> Export Video
                </button>

                <button 
                  onClick={handleReset}
                  className="px-6 py-3 bg-[#e5e0d8] border-[3px] border-[#2d2d2d] text-[#2d2d2d] font-bold border-wobbly-oval hover:bg-[#2d2d2d] hover:text-white transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Right: Segment List (Adjusted col-span: 3) */}
            <div className="lg:col-span-3 flex flex-col h-[700px]">
              <div className="flex justify-between items-center mb-6 bg-[#2d2d2d] p-4 border-wobbly-sm shadow-sketch transform -rotate-1">
                <h3 className="font-heading text-2xl text-white tracking-wide">
                   Storyboard
                </h3>
                <button 
                  onClick={addSegment}
                  disabled={isProcessingAction}
                  className="px-3 py-1 bg-[#fff9c4] border-2 border-white text-[#2d2d2d] font-bold rounded hover:bg-white transition-colors text-sm uppercase"
                >
                  {isProcessingAction ? '...' : '+ Add'}
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2 space-y-4 scrollbar-hide pb-20 p-2">
                {segments.map((seg, idx) => {
                  return (
                    <div 
                      key={seg.id} 
                      className={`relative p-5 bg-white border-[2px] border-[#2d2d2d] transition-all duration-300 ${editingSegmentId === seg.id ? 'scale-105 z-20 border-wobbly-sm shadow-sketch-lg rotate-1' : 'hover:rotate-1 border-wobbly-sm shadow-sketch-sm'}`}
                    >
                      {/* Sticky Note decoration for active item */}
                      {editingSegmentId === seg.id && (
                          <div className="absolute -top-3 -right-2 w-8 h-8 rounded-full bg-[#ff4d4d] border-2 border-[#2d2d2d] shadow-sm z-30"></div>
                      )}

                      {/* Header */}
                      <div className="flex justify-between items-center mb-3 border-b-2 border-dashed border-[#2d2d2d]/20 pb-2">
                        <span className="font-heading text-2xl text-[#2d2d2d]">#{idx + 1}</span>
                        <div className="flex gap-2">
                           <button onClick={() => deleteSegment(seg.id)} className="text-[#2d2d2d]/40 hover:text-[#ff4d4d] font-bold text-lg">✕</button>
                           <button onClick={() => moveSegment(idx, 'up')} disabled={idx === 0} className="text-[#2d2d2d]/40 hover:text-[#2d5da1] font-bold text-lg">↑</button>
                           <button onClick={() => moveSegment(idx, 'down')} disabled={idx === segments.length - 1} className="text-[#2d2d2d]/40 hover:text-[#2d5da1] font-bold text-lg">↓</button>
                        </div>
                      </div>

                      {/* Content */}
                      {editingSegmentId === seg.id ? (
                        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                             <div className="bg-[#2d5da1]/10 p-2 rounded border-2 border-[#2d5da1] border-dashed text-center">
                                <button onClick={() => scanTextForSegment(seg.id)} disabled={isProcessingAction} className="text-xs font-bold text-[#2d5da1] uppercase hover:underline">
                                    {isProcessingAction ? 'Scanning...' : '📍 Auto-Scan Box'}
                                </button>
                             </div>
                             <div>
                                <label className="text-xs font-bold text-[#2d2d2d]/60 uppercase">Text</label>
                                <textarea 
                                    value={seg.text} 
                                    onChange={(e) => updateSegmentText(seg.id, e.target.value)}
                                    className="w-full bg-[#fdfbf7] border-2 border-[#2d2d2d] rounded-sm p-2 text-[#2d2d2d] font-hand text-lg focus:border-[#2d5da1] outline-none"
                                    rows={2}
                                />
                             </div>
                             <div>
                                <label className="text-xs font-bold text-[#2d2d2d]/60 uppercase">Seconds</label>
                                <input 
                                    type="number" step="0.5" 
                                    value={seg.duration} 
                                    onChange={(e) => updateSegmentDuration(seg.id, Number(e.target.value))}
                                    className="w-full bg-[#fdfbf7] border-2 border-[#2d2d2d] rounded-sm p-2 text-[#2d2d2d] font-hand text-lg focus:border-[#2d5da1] outline-none"
                                />
                             </div>
                             <button 
                                onClick={() => setEditingSegmentId(null)}
                                className="w-full py-2 bg-[#fff9c4] text-[#2d2d2d] border-2 border-[#2d2d2d] font-bold uppercase rounded-sm hover:bg-[#ffe082]"
                             >
                                Done
                             </button>
                        </div>
                      ) : (
                        <div onClick={() => setEditingSegmentId(seg.id)} className="cursor-pointer group">
                             <p className="text-[#2d2d2d] font-hand text-xl leading-tight line-clamp-2 group-hover:text-[#2d5da1] transition-colors">
                                 {seg.text || <span className="italic text-[#2d2d2d]/40">Empty Scene</span>}
                             </p>
                             <div className="mt-3 flex gap-2">
                                <span className="px-2 py-1 bg-[#e5e0d8] rounded-sm text-xs font-bold text-[#2d2d2d]/70 border border-[#2d2d2d]/20">
                                    ⏱ {seg.duration}s
                                </span>
                                {seg.audioBase64 ? (
                                    <span className="px-2 py-1 bg-[#2d5da1]/10 text-[#2d5da1] rounded-sm text-xs font-bold border border-[#2d5da1]/50">
                                        AUDIO READY
                                    </span>
                                ) : (
                                    <span className="px-2 py-1 bg-[#ff4d4d]/10 text-[#ff4d4d] rounded-sm text-xs font-bold border border-[#ff4d4d]/50">
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