# MemeReveal

MemeReveal is an AI-powered tool that automatically converts static meme images into narrated video reveals. It analyzes the visual structure of a meme, extracts the text, generates voiceovers, and synchronizes them with progressive visual reveals.

## Features

*   **Intelligent Analysis (AI Mode):** Uses Gemini Vision to understand meme layouts, panel ordering, and text content.
*   **Narrated Audio (AI Mode):** Converts embedded text into spoken audio with comedic timing using Gemini TTS.
*   **Manual Mode (Open Source / Offline):** Fully functional offline editor that allows manual creation of visual reveals without requiring an API key. Uses Browser TTS for preview and fetches free TTS audio during export.
*   **Smart Timing:** Automatically calculates reveal duration based on text length and reading speed.
*   **Visual Reveals:** Automatically creates a progressive reveal effect (blur to clear) synchronized with the audio or custom timing.
*   **High Quality Export:** Exported videos match the native resolution of the uploaded meme image.
*   **Editor:**
    *   **Reorder Segments:** Drag and drop (or click up/down) to change the order of narration.
    *   **Adjust Crop:** Manually fine-tune the bounding box for each reveal by dragging the box on the canvas or using sliders.
    *   **Auto Scan:** When adding or editing segments manually, automatically scans the selected area for text.
*   **Video Export:** Generates a downloadable `.webm` video file ready for sharing.

## Setup

1.  **API Key (Optional):** To use the AI features (Vision & TTS), the application requires a valid API Key from a supported provider. Set `API_KEY` in your environment.
2.  **Install Dependencies:** Run `npm install`.
3.  **Run:** Open `index.html` via a local server (e.g., Live Server in VS Code) or deploy to a static host.

## Usage

1.  **Select Mode:** Toggle "AI Automation" ON for automatic analysis (requires API key), or OFF for Manual/Open Source mode.
2.  **Upload:** Click the upload area to select a meme (JPG/PNG).
3.  **Analyze / Edit:** 
    *   **AI Mode:** The app analyzes the image and generates audio automatically.
    *   **Manual Mode:** The app loads the image. You must click "+ Add Reveal" to define segments.
4.  **Refine:**
    *   Use the **Up/Down arrows** in the timeline to change the order of panels.
    *   Click **Edit** on a segment to adjust the highlighted reveal area by dragging the box on the image.
    *   Adjust the **Duration** for silent segments.
    *   Use **Auto-Detect Text** to re-scan a specific region.
5.  **Preview:** Click "Preview" to watch the generated sequence.
6.  **Export:** Click "Export Video" to record the sequence and download the result.

## Technology

*   **Frontend:** React, TailwindCSS
*   **AI Models:**
    *   Gemini 2.5 Flash (Vision & Text Analysis)
    *   Gemini 2.5 Flash TTS (Audio Generation)
*   **Local Processing:** Tesseract.js for offline OCR.
*   **Audio:** Native Web Audio API for PCM decoding and playback.