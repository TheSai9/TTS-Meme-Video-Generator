import React, { useState, useCallback } from 'react';
import { AppState, MemeSegment } from './types';
import { analyzeMemeImage, generateSpeechForSegment } from './services/geminiService';
import VideoCanvas from './components/VideoCanvas';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [segments, setSegments] = useState<MemeSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    setAppState(AppState.ANALYZING);
    setError(null);
    try {
      // 1. Vision Analysis
      const rawBase64 = base64.split(',')[1];
      const analyzedSegments = await analyzeMemeImage(rawBase64);
      setSegments(analyzedSegments);
      
      // 2. Generate Audio
      setAppState(AppState.GENERATING_AUDIO);
      const segmentsWithAudio = await Promise.all(analyzedSegments.map(async (seg) => {
        try {
          const { audioBase64 } = await generateSpeechForSegment(seg.text);
          return { ...seg, audioBase64 };
        } catch (e) {
          console.error(`Failed to generate audio for segment: ${seg.text}`, e);
          return seg; // Return without audio if fails
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
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 flex flex-col items-center">
      <header className="w-full max-w-4xl flex justify-between items-center mb-8 border-b border-slate-800 pb-4">
        <h1 className="text-2xl font-black bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
          MemeReveal
        </h1>
        <div className="text-xs text-slate-500 font-mono">
          Powered by Gemini 2.5
        </div>
      </header>

      <main className="w-full max-w-5xl flex flex-col items-center gap-8">
        
        {/* Error Banner */}
        {error && (
          <div className="w-full max-w-lg bg-red-900/30 border border-red-800 text-red-200 px-4 py-3 rounded-lg text-sm mb-4">
            Error: {error}
          </div>
        )}

        {/* State: IDLE - Upload Area */}
        {appState === AppState.IDLE && (
          <div className="w-full max-w-xl h-64 border-2 border-dashed border-slate-700 rounded-2xl flex flex-col items-center justify-center bg-slate-900/50 hover:bg-slate-900/80 transition-all cursor-pointer relative group">
             <input 
              type="file" 
              accept="image/*" 
              onChange={handleFileUpload} 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-cyan-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-200">Upload a Meme</h3>
            <p className="text-slate-500 text-sm mt-2">JPG, PNG supported</p>
          </div>
        )}

        {/* State: LOADING */}
        {(appState === AppState.ANALYZING || appState === AppState.GENERATING_AUDIO) && (
          <div className="w-full max-w-xl h-64 flex flex-col items-center justify-center">
            <div className="relative w-20 h-20 mb-6">
              <div className="absolute inset-0 border-4 border-slate-700 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-cyan-500 rounded-full border-t-transparent animate-spin"></div>
            </div>
            <h3 className="text-xl font-bold animate-pulse text-cyan-300">
              {appState === AppState.ANALYZING ? 'Vision Model Analyzing...' : 'Generating Narration...'}
            </h3>
            <p className="text-slate-400 mt-2 text-sm text-center max-w-xs">
              {appState === AppState.ANALYZING 
                ? 'Detecting text panels and comedic timing.' 
                : 'Synthesizing voiceovers using Gemini TTS.'}
            </p>
          </div>
        )}

        {/* State: EDITOR / PLAYER */}
        {(appState === AppState.READY || appState === AppState.PLAYING || appState === AppState.RECORDING) && imageSrc && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 w-full">
            
            {/* Left: Canvas */}
            <div className="lg:col-span-2 flex flex-col items-center">
              <VideoCanvas 
                imageSrc={imageSrc} 
                segments={segments} 
                appState={appState} 
                setAppState={setAppState} 
                width={800}
                height={600}
              />
              
              {/* Controls */}
              <div className="flex gap-4 mt-6">
                <button
                  disabled={appState !== AppState.READY}
                  onClick={() => setAppState(AppState.PLAYING)}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-bold flex items-center gap-2 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                  </svg>
                  Preview
                </button>

                <button
                  disabled={appState !== AppState.READY}
                  onClick={() => setAppState(AppState.RECORDING)}
                  className="px-6 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-bold flex items-center gap-2 transition-colors shadow-lg shadow-red-900/20"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                  Export Video
                </button>

                <button 
                  onClick={handleReset}
                  className="px-4 py-3 bg-slate-800 hover:bg-slate-700 rounded-lg font-medium text-slate-300"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Right: Segment List */}
            <div className="lg:col-span-1 bg-slate-900/50 rounded-xl p-4 border border-slate-800 h-fit max-h-[600px] overflow-y-auto">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 sticky top-0 bg-slate-900/95 py-2 z-10">
                Narrative Timeline
              </h3>
              <div className="space-y-3">
                {segments.map((seg, idx) => (
                  <div key={seg.id} className="bg-slate-800 p-3 rounded border border-slate-700 hover:border-indigo-500/50 transition-colors">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-mono text-cyan-400">Step {idx + 1}</span>
                      {seg.audioBase64 ? (
                        <span className="text-xs bg-green-900/50 text-green-300 px-1.5 py-0.5 rounded">Audio Ready</span>
                      ) : (
                        <span className="text-xs bg-yellow-900/50 text-yellow-300 px-1.5 py-0.5 rounded">Silent</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-200 line-clamp-3">{seg.text}</p>
                    <div className="mt-2 text-[10px] text-slate-500 font-mono">
                      Box: [{Math.round(seg.box.ymin)}, {Math.round(seg.box.xmin)}]
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
};

export default App;