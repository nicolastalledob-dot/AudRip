# AudRip

A modern desktop application to download high-quality audio from **YouTube** and **SoundCloud**, featuring advanced metadata editing, precise audio trimming, and a built-in music player.

<img width="900" alt="AudRip UI" src="https://github.com/user-attachments/assets/5ce127c1-e3d7-457c-ac3b-fdfd7655a216" />

---

## ✨ Features

### 🎧 Audio & Playback (New)
*   **Media Session API Integration:** Native OS media controls (Play/Pause, Seek, Artwork on Lock Screen/Control Center).
*   **Built-in Music Player:** High-quality playback with seamless loop (Repeat One) and Smart Shuffle.
*   **Audio FX Panel:** Real-time Bass Boost, Reverb, Pitch Control, and Stereo Width adjustment.
*   **Smart Playlists:** Create, rename, and manage playlists with custom cover art and drag-and-drop reordering.
*   **Visualizer:** Dynamic audio visualization synced to your music.

### 📥 Downloading
*   **Platform Support:**
    *   📺 **YouTube**: Single videos and full playlists.
    *   ☁️ **SoundCloud**: High-quality track downloads.
*   **Smart Metadata:**
    *   **Auto-Tagging:** Automatically detects Artist and Title from video names.
    *   **Cover Art:** Extract frames from video, upload custom images, or use high-res thumbnails.
*   **Tools:**
    *   **Audio Trimmer:** Visual waveform editor to cut unwanted intros/outros before downloading.
    *   **Format Choice:** MP3 or M4A (AAC) up to 320kbps.

### 💻 System Integration
*   **Cross-Platform:** Native support for **macOS** (Silicon/Intel) and **Windows**.
*   **Auto-Dependency Management:** 
    *   **macOS:** Binaries (`ffmpeg`, `yt-dlp`) are bundled inside the app.
    *   **Windows:** First-run auto-downloader fetches necessary components seamlessly.
*   **Shortcuts:** Spacebar to Play/Pause (smartly disabled when typing).

---

## 🚀 Installation

### 🍎 macOS
1.  Download `AudRip-1.2.4-arm64.dmg` from [Releases](https://github.com/nmtb97/AudRip/releases).
2.  Open the DMG and drag AudRip to **Applications**.
3.  **First Run:** Right-click the app → **Open** → Click **Open** again (required for non-App Store apps).

### 🪟 Windows
1.  Download `AudRip Setup 1.2.4.exe` (Installer) or `AudRip 1.2.4.exe` (Portable) from [Releases](https://github.com/nmtb97/AudRip/releases).
2.  Run the application.
3.  **One-Time Setup:** On first launch, if components are missing, a dialog will ask to auto-download them (~100MB). Click **Yes**.

---

## 🛠 Tech Stack

*   **Electron** - Cross-platform desktop framework
*   **React + TypeScript** - UI Library & Type safety
*   **Vite** - High-performance build tooling
*   **yt-dlp** - Core downloading engine
*   **FFmpeg** - Audio processing and metadata embedding
*   **WaveSurfer.js** - Waveform visualization

---

## ⌨️ Development

### Prerequisites
*   Node.js 18+
*   npm or yarn

### Setup
```bash
# Clone the repository
git clone https://github.com/nmtb97/AudRip.git
cd AudRip

# Install dependencies
npm install

# Start development server
npm run dev
```

### Build for Distribution
```bash
# Build for macOS
npm run electron:build -- --mac

# Build for Windows
npm run electron:build -- --win --x64
```

---

## 📄 License
MIT © [Nicolas Talledo](https://github.com/nmtb97)
