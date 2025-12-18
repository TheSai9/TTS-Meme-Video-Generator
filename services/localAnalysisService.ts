import Tesseract from 'tesseract.js';
import { MemeSegment, BoundingBox } from "../types";

// Configuration for detection
const DARK_THRESHOLD = 60; // Pixel brightness (0-255) to be considered "black"
const LINE_DENSITY_THRESHOLD = 0.6; // Percentage of row/col that must be dark to count as a line
const MIN_PANEL_SIZE = 50; // Minimum dimension for a panel

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// --- Text Analysis Helpers ---

export const isTextCoherent = (text: string): boolean => {
  if (!text || text.trim().length < 2) return false;
  
  const clean = text.trim();
  // Check 1: Ratio of alphanumeric characters
  const alphaNumeric = clean.replace(/[^a-zA-Z0-9]/g, '').length;
  if (alphaNumeric < clean.length * 0.5) return false; // Mostly symbols/garbage

  // Check 2: Vowel presence (simple heuristic for "real" words in English/Euro langs)
  const vowels = clean.match(/[aeiouAEIOU]/g);
  if (!vowels && clean.length > 4) return false; // Long string with no vowels is suspicious

  return true;
};

export const calculateSegmentDuration = (text: string): number => {
  if (!text || !isTextCoherent(text)) {
    return 1.0; // Default for no text or visual-only panels
  }

  const wordCount = text.trim().split(/\s+/).length;
  // Average reading speed: ~200wpm = ~3.3 words/sec => ~0.3s per word.
  // Formula: Reading time + 0.3s buffer
  const readingTime = wordCount * 0.3; 
  const duration = readingTime + 0.3;

  // Round to nearest 0.5s for cleaner UI, but ensure min 1s
  return Math.max(1.0, Math.ceil(duration * 2) / 2);
};

// --- Image Processing ---

const getImageData = (img: HTMLImageElement): ImageData => {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error("Could not get canvas context");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
};

// Check if a row is a dividing line
const isRowDivider = (data: Uint8ClampedArray, width: number, y: number): boolean => {
  let darkCount = 0;
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma < DARK_THRESHOLD) darkCount++;
  }
  return (darkCount / width) > LINE_DENSITY_THRESHOLD;
};

// Check if a column is a dividing line (within a specific vertical slice)
const isColDivider = (data: Uint8ClampedArray, width: number, x: number, startY: number, endY: number): boolean => {
  let darkCount = 0;
  const height = endY - startY;
  if (height <= 0) return false;
  
  for (let y = startY; y < endY; y++) {
    const i = (y * width + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma < DARK_THRESHOLD) darkCount++;
  }
  return (darkCount / height) > LINE_DENSITY_THRESHOLD;
};

const detectPanels = (img: HTMLImageElement): Rect[] => {
  const { data, width, height } = getImageData(img);
  
  // 1. Scan Horizontal Lines to split into Rows
  const rowCuts: { y: number, h: number }[] = [];
  let inLine = false;
  let lineStart = 0;

  for (let y = 0; y < height; y++) {
    const isLine = isRowDivider(data, width, y);
    if (isLine && !inLine) {
      inLine = true;
      lineStart = y;
    } else if (!isLine && inLine) {
      inLine = false;
      rowCuts.push({ y: lineStart, h: y - lineStart });
    }
  }
  if (inLine) rowCuts.push({ y: lineStart, h: height - lineStart });

  const rows: { y: number, h: number }[] = [];
  
  if (rowCuts.length > 0 && rowCuts[0].y > 0) {
     rows.push({ y: 0, h: rowCuts[0].y });
  } else if (rowCuts.length === 0) {
      rows.push({ y: 0, h: height });
  }

  for (let i = 0; i < rowCuts.length; i++) {
    const cut = rowCuts[i];
    const nextY = (i < rowCuts.length - 1) ? rowCuts[i+1].y : height;
    if (nextY - (cut.y + cut.h) > MIN_PANEL_SIZE) {
      rows.push({ y: cut.y + cut.h, h: nextY - (cut.y + cut.h) });
    }
  }

  const panels: Rect[] = [];

  rows.forEach(row => {
    let inVLine = false;
    let vLineStart = 0;
    const colCuts: { x: number, w: number }[] = [];

    for (let x = 0; x < width; x++) {
      const isLine = isColDivider(data, width, x, row.y, row.y + row.h);
      if (isLine && !inVLine) {
        inVLine = true;
        vLineStart = x;
      } else if (!isLine && inVLine) {
        inVLine = false;
        colCuts.push({ x: vLineStart, w: x - vLineStart });
      }
    }
    if (inVLine) colCuts.push({ x: vLineStart, w: width - vLineStart });

    let currentX = 0;
    if (colCuts.length > 0 && colCuts[0].x > 0) {
      panels.push({ x: 0, y: row.y, w: colCuts[0].x, h: row.h });
    } else if (colCuts.length === 0) {
      panels.push({ x: 0, y: row.y, w: width, h: row.h });
    }

    for (let i = 0; i < colCuts.length; i++) {
      const cut = colCuts[i];
      const nextX = (i < colCuts.length - 1) ? colCuts[i+1].x : width;
      if (nextX - (cut.x + cut.w) > MIN_PANEL_SIZE) {
        panels.push({ x: cut.x + cut.w, y: row.y, w: nextX - (cut.x + cut.w), h: row.h });
      }
    }
  });

  return panels.length > 0 ? panels : [{ x: 0, y: 0, w: width, h: height }];
};

// Helper to convert Blob to Base64
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            if (!result) { reject("Empty result"); return; }
            const parts = result.split(',');
            resolve(parts.length > 1 ? parts[1] : parts[0]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

const cleanTextForTTS = (text: string): string => {
    return text.replace(/\s+/g, ' ').replace(/[^\w\s.,?!'-]/g, '').trim();
};

export const fetchFreeTTS = async (text: string): Promise<string> => {
    if (!text) return "";
    const cleanText = cleanTextForTTS(text);
    if (cleanText.length === 0) return "";

    try {
        const encodedText = encodeURIComponent(cleanText);
        const url = `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodedText}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`TTS fetch failed with status: ${response.status}`);
        const blob = await response.blob();
        if (blob.size < 100) throw new Error("TTS blob too small, likely error");
        return await blobToBase64(blob);
    } catch (e) {
        console.warn("Failed to fetch free TTS for text: " + text.substring(0,20), e);
        return "";
    }
};

export const performOCROnBox = async (base64Image: string, box: BoundingBox): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64Image}`;
        img.onload = async () => {
            try {
                const canvas = document.createElement('canvas');
                // Convert 0-1000 coordinates to pixels
                const x = (box.xmin / 1000) * img.width;
                const y = (box.ymin / 1000) * img.height;
                const w = ((box.xmax - box.xmin) / 1000) * img.width;
                const h = ((box.ymax - box.ymin) / 1000) * img.height;
                
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if(!ctx) throw new Error("Canvas context failed");
                
                ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
                const cropDataUrl = canvas.toDataURL('image/png');
                
                const result = await Tesseract.recognize(cropDataUrl, 'eng');
                const text = result.data.text.trim().replace(/\n/g, ' ');
                resolve(text);
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = () => reject("Image load failed");
    });
};

export const analyzeLocalImage = async (base64Image: string): Promise<MemeSegment[]> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64Image}`; 
    img.onload = async () => {
      try {
        const rects = detectPanels(img);
        const segments: MemeSegment[] = [];

        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          const canvas = document.createElement('canvas');
          canvas.width = r.w;
          canvas.height = r.h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
            const cropDataUrl = canvas.toDataURL('image/png');

            const result = await Tesseract.recognize(cropDataUrl, 'eng');
            const rawText = result.data.text.trim().replace(/\n/g, ' ');
            
            // Apply Coherence Check
            const isCoherent = isTextCoherent(rawText);
            const text = isCoherent ? rawText : ""; 

            // Calculate Duration
            const duration = calculateSegmentDuration(text);

            const xmin = (r.x / img.width) * 1000;
            const ymin = (r.y / img.height) * 1000;
            const xmax = ((r.x + r.w) / img.width) * 1000;
            const ymax = ((r.y + r.h) / img.height) * 1000;

            segments.push({
              id: `local-seg-${i}-${Date.now()}`,
              text: text || `(Visual Only)`,
              box: { xmin, ymin, xmax, ymax },
              duration: duration
            });
          }
        }
        resolve(segments);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = (err) => reject(new Error("Failed to load image for local analysis"));
  });
};