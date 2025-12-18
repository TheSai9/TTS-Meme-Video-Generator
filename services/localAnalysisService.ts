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

// Helper to get image data
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
  // Handle edge case if image ends with line
  if (inLine) rowCuts.push({ y: lineStart, h: height - lineStart });

  // Define Horizontal Regions (Gaps between lines)
  const rows: { y: number, h: number }[] = [];
  let currentY = 0;
  
  // Implicit start line if image doesn't start with one
  if (rowCuts.length > 0 && rowCuts[0].y > 0) {
     rows.push({ y: 0, h: rowCuts[0].y });
     currentY = rowCuts[0].y + rowCuts[0].h;
  } else if (rowCuts.length === 0) {
      rows.push({ y: 0, h: height });
  }

  for (let i = 0; i < rowCuts.length; i++) {
    const cut = rowCuts[i];
    // Gap after this cut
    const nextY = (i < rowCuts.length - 1) ? rowCuts[i+1].y : height;
    if (nextY - (cut.y + cut.h) > MIN_PANEL_SIZE) {
      rows.push({ y: cut.y + cut.h, h: nextY - (cut.y + cut.h) });
    }
  }

  const panels: Rect[] = [];

  // 2. Scan Vertical Lines within each Row
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
            // Remove data URL prefix (e.g., "data:audio/mp3;base64,")
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

export const fetchFreeTTS = async (text: string): Promise<string> => {
    try {
        const encodedText = encodeURIComponent(text);
        // Using StreamElements free TTS API (Brian is a popular voice)
        const url = `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodedText}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("TTS fetch failed");
        const blob = await response.blob();
        return await blobToBase64(blob);
    } catch (e) {
        console.warn("Failed to fetch free TTS", e);
        return "";
    }
};

export const analyzeLocalImage = async (base64Image: string): Promise<MemeSegment[]> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64Image}`; // Ensure prefix if missing, though usually provided
    img.onload = async () => {
      try {
        // 1. Detect Panels
        const rects = detectPanels(img);
        
        // 2. Perform OCR on each panel
        const segments: MemeSegment[] = [];

        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          
          // Crop image for OCR
          const canvas = document.createElement('canvas');
          canvas.width = r.w;
          canvas.height = r.h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
            const cropDataUrl = canvas.toDataURL('image/png');

            // Run Tesseract
            const result = await Tesseract.recognize(cropDataUrl, 'eng');
            const text = result.data.text.trim();
            
            // Normalize coordinates to 0-1000 scale
            const xmin = (r.x / img.width) * 1000;
            const ymin = (r.y / img.height) * 1000;
            const xmax = ((r.x + r.w) / img.width) * 1000;
            const ymax = ((r.y + r.h) / img.height) * 1000;

            segments.push({
              id: `local-seg-${i}-${Date.now()}`,
              text: text || `Panel ${i + 1}`, // Fallback if no text
              box: { xmin, ymin, xmax, ymax },
              duration: 2 // Default duration
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
