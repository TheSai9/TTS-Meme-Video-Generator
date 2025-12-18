# MemeReveal

MemeReveal is an AI-powered tool that automatically converts static meme images into narrated video reveals. It analyzes the visual structure of a meme, extracts the text, generates voiceovers, and synchronizes them with progressive visual reveals.

## Features

*   **Intelligent Analysis:** Uses Gemini Vision to understand meme layouts, panel ordering, and text content.
*   **Narrated Audio:** Converts embedded text into spoken audio with comedic timing using Gemini TTS.
*   **Visual Reveals:** Automatically creates a progressive reveal effect (blur to clear) synchronized with the audio.
*   **Editor:**
    *   **Reorder Segments:** Drag and drop (or click up/down) to change the order of narration.
    *   **Adjust Crop:** Manually fine-tune the bounding box for each reveal to ensure perfect framing.
*   **Video Export:** Generates a downloadable `.webm` video file ready for sharing.

## Setup

1.  **API Key:** This application requires a valid API Key from a supported provider. Ensure your `API_KEY` environment variable is set in your runtime environment.
2.  **Install Dependencies:** Run `npm install` (if running locally with a build step, though this project uses ES modules via CDN).
3.  **Run:** Open `index.html` via a local server (e.g., Live Server in VS Code) or deploy to a static host.

## Usage

1.  **Upload:** Click the upload area to select a meme (JPG/PNG).
2.  **Analyze:** The app will automatically analyze the image and generate audio.
3.  **Preview:** Click "Preview" to watch the generated sequence.
4.  **Edit:**
    *   Use the **Up/Down arrows** in the timeline to change the order of panels.
    *   Click **Edit** on a segment to adjust the highlighted reveal area using the sliders.
5.  **Export:** Click "Export Video" to record the sequence and download the result.

## Technology

*   **Frontend:** React, TailwindCSS
*   **AI Models:**
    *   Gemini 2.5 Flash (Vision & Text Analysis)
    *   Gemini 2.5 Flash TTS (Audio Generation)
*   **Audio:** Native Web Audio API for PCM decoding and playback.
