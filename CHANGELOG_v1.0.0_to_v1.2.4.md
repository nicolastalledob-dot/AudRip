# AudRip Changelog (v1.0.0 -> v1.2.4)

## 🎵 Music Player & Audio Engine
*   **Media Session API Integration:**
    *   Added support for native OS media controls (Play/Pause, Next, Previous, Seek).
    *   Now displays artwork, title, and artist on the Lock Screen and Control Center.
*   **Enhanced Playback Logic:**
    *   **Seamless Looping:** Re-implemented "Repeat One" using native audio looping for gapless playback.
    *   **Smart Shuffle:** Improved shuffle algorithm to prevent immediate track repetition.
    *   **Scrubbing:** Added smooth drag-to-seek functionality on the timeline with visual time feedback.
*   **Audio FX Panel:**
    *   Fixed overlay positioning (z-index) to ensure it remains accessible over all other UI elements.
    *   Added controls for Bass Boost, Reverb, Pitch, and Stereo Width.

## 💾 System & Build Improvements
*   **Cross-Platform Compatibility:**
    *   **macOS (Silicon):** Full native ARM64 support with bundled binaries (`ffmpeg`, `yt-dlp`), resolving spawn errors.
    *   **Windows:** Implemented an **auto-downloader** for missing dependencies (`ffmpeg`, `ffprobe`) on first launch, making the app fully portable.
*   **Binary Management:**
    *   Fixed `ENOENT` and path resolution issues for external binaries across both OSs.
    *   Added intelligent path detection for development vs. production environments.
*   **Installation:**
    *   Created a Homebrew Cask formula for easier macOS installation.
    *   Configured NSIS installer for Windows with custom directory support.

## 🎨 UI/UX Design Refinements
*   **Playlist Experience:**
    *   **Edit Mode:** Added ability to rename playlists and update cover images.
    *   **Smart Modals:** completely redesigned the "Create/Edit Playlist" modal to be compact, centered, and visually cleaner.
    *   **Dynamic Covers:** Library now generates a 2x2 grid preview for playlists without custom covers.
*   **Visual Polish:**
    *   **Smart Marquee:** Song titles now only scroll if they overflow, featuring a clean gradient mask for smooth fading.
    *   **Floating Navigation:** Added a floating "Back" button in the player view for easier library navigation.
    *   **Glassmorphism:** Refined blur effects and dark mode transparency across the app.
*   **Shortcuts:**
    *   Added **Spacebar** shortcut for Play/Pause (smartly disabled when typing in text fields).

## 🛠 Fixes & Optimizations
*   **CORS & Custom Protocol:** Fixed issues with the `media://` protocol to properly serve local audio files with correct headers for the Web Audio API (Essential for the visualizer).
*   **Windows Paths:** Fixed bugs related to drive letters (C:/) in file paths.
*   **Performance:** Optimized re-renders in the main player component.
