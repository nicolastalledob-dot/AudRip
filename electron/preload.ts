import { contextBridge, ipcRenderer } from 'electron'

// Type definitions for the API
export interface VideoInfo {
    id: string
    title: string
    duration: number
    thumbnail: string
    channel: string
    url: string
}

export interface AlbumArtData {
    source: 'thumbnail' | 'custom'
    imageData: string
    aspectRatio: '1:1' | '16:9'
}

export interface DownloadOptions {
    url: string
    format: 'mp3' | 'm4a'
    metadata: {
        title: string
        artist: string
        album: string
    }
    trimStart?: number
    trimEnd?: number
    albumArt?: AlbumArtData
    coverArt?: string
    id?: string
    coverArtAspectRatio?: '1:1' | '16:9'
}

export interface DownloadProgress {
    stage: 'downloading' | 'converting' | 'complete'
    percent: number
    speed?: string | null
    eta?: string | null
}

export interface HistoryItem {
    id: string
    title: string
    artist: string
    album: string
    path: string
    thumbnail: string
    downloadedAt: string
}

export interface Playlist {
    id: string
    name: string
    description: string
    coverArt: string | null
    trackPaths: string[]
    createdAt: number
    updatedAt: number
}

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Get video info from URL
    getVideoInfo: (url: string): Promise<VideoInfo> =>
        ipcRenderer.invoke('get-video-info', url),

    // Get playlist info
    getPlaylistInfo: (url: string): Promise<VideoInfo[]> =>
        ipcRenderer.invoke('get-playlist-info', url),

    // Download audio
    // Download audio
    downloadAudio: async (options: DownloadOptions): Promise<{ success: boolean, path: string }> => {
        let coverArt = undefined;

        // Process album art if present
        if (options.albumArt) {
            try {
                // If it's a thumbnail URL and ratio is 1:1, we might want to crop it?
                // Or if it's custom base64.
                // To ensure consistent result (cropped to 1:1 or 16:9), always process it.
                // However, avoiding re-processing raw remote URLs if not needed is good.
                // But the user selected an aspect ratio, so we MUST process it to respect that crop.
                coverArt = await ipcRenderer.invoke('process-album-art', {
                    imageData: options.albumArt.imageData,
                    aspectRatio: options.albumArt.aspectRatio
                });
            } catch (e) {
                console.error('Failed to process album art for download:', e);
                // Fallback to original image data if processing fails
                coverArt = options.albumArt.imageData;
            }
        }

        // Pass flat options to main, but only override coverArt if we actually processed one
        const finalOptions = { ...options }
        if (coverArt) {
            finalOptions.coverArt = coverArt
        }

        return ipcRenderer.invoke('download-audio', finalOptions);
    },

    // Listen for download progress
    onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, progress: DownloadProgress) => callback(progress)
        ipcRenderer.on('download-progress', handler)
        return () => ipcRenderer.removeListener('download-progress', handler)
    },

    // Show file in folder
    showInFolder: (path: string): Promise<void> =>
        ipcRenderer.invoke('show-in-folder', path),

    // Select folder dialog
    selectFolder: (): Promise<string | null> =>
        ipcRenderer.invoke('select-folder'),

    // History management
    getHistory: (): Promise<HistoryItem[]> =>
        ipcRenderer.invoke('get-history'),

    clearHistory: (): Promise<void> =>
        ipcRenderer.invoke('clear-history'),

    saveSettings: (settings: any): Promise<void> =>
        ipcRenderer.invoke('save-settings', settings),

    getSettings: (): Promise<any> =>
        ipcRenderer.invoke('get-settings'),

    saveToHistory: (item: HistoryItem): Promise<void> =>
        ipcRenderer.invoke('save-to-history', item),

    getMetadataHistory: (): Promise<{ artists: string[], albums: string[] }> =>
        ipcRenderer.invoke('get-metadata-history'),

    // Album art functions
    extractFrames: (url: string, count?: number): Promise<string[]> =>
        ipcRenderer.invoke('extract-frames', url, count || 6),

    selectImage: (): Promise<string | null> =>
        ipcRenderer.invoke('select-image'),

    processAlbumArt: (options: { imageData: string, aspectRatio: '1:1' | '16:9', size?: number }): Promise<string> =>
        ipcRenderer.invoke('process-album-art', options),

    cancelDownload: (id: string): Promise<void> =>
        ipcRenderer.invoke('cancel-download', id),

    getMusicLibrary: (): Promise<{
        path: string
        title: string
        artist: string
        album: string
        duration: number
        coverArt: string | null
    }[]> => ipcRenderer.invoke('get-music-library'),

    getTrackCoverArt: (filePath: string): Promise<string | null> =>
        ipcRenderer.invoke('get-track-cover-art', filePath),

    // FX Presets API
    getFxPresets: (): Promise<any[]> =>
        ipcRenderer.invoke('get-fx-presets'),

    saveFxPreset: (preset: any): Promise<{ success: boolean, presets: any[] }> =>
        ipcRenderer.invoke('save-fx-preset', preset),

    deleteFxPreset: (presetId: string): Promise<{ success: boolean, presets: any[] }> =>
        ipcRenderer.invoke('delete-fx-preset', presetId),

    // Playlist API
    getPlaylists: (): Promise<Playlist[]> =>
        ipcRenderer.invoke('get-playlists'),

    savePlaylist: (playlist: Playlist): Promise<{ success: boolean, playlists: Playlist[] }> =>
        ipcRenderer.invoke('save-playlist', playlist),

    deletePlaylist: (playlistId: string): Promise<{ success: boolean, playlists: Playlist[] }> =>
        ipcRenderer.invoke('delete-playlist', playlistId),

    addTrackToPlaylist: (playlistId: string, trackPath: string): Promise<{ success: boolean, playlist?: Playlist, error?: string }> =>
        ipcRenderer.invoke('add-track-to-playlist', playlistId, trackPath),

    removeTrackFromPlaylist: (playlistId: string, trackPath: string): Promise<{ success: boolean, playlist?: Playlist, error?: string }> =>
        ipcRenderer.invoke('remove-track-from-playlist', playlistId, trackPath),

    // M4A Converter API
    scanForM4A: (paths: string[]): Promise<Array<{
        path: string
        filename: string
        title: string
        artist: string
        album: string
        duration: number
        coverArt: string | null
    }>> => ipcRenderer.invoke('scan-for-m4a', paths),

    selectM4AFiles: (): Promise<string[]> =>
        ipcRenderer.invoke('select-m4a-files'),

    convertM4AToMP3: (options: {
        inputPath: string
        outputFolder?: string
        metadata: { title: string; artist: string; album: string }
    }): Promise<{ success: boolean; outputPath: string }> =>
        ipcRenderer.invoke('convert-m4a-to-mp3', options),

    // Mini Player
    openMiniPlayer: (screenPos?: { x: number; y: number }): Promise<void> =>
        ipcRenderer.invoke('open-mini-player', screenPos),

    closeMiniPlayer: (): Promise<void> =>
        ipcRenderer.invoke('close-mini-player'),

    syncPlaybackState: (state: any): Promise<void> =>
        ipcRenderer.invoke('sync-playback-state', state),

    miniPlayerCommand: (command: string): Promise<void> =>
        ipcRenderer.invoke('mini-player-command', command),

    onPlaybackStateSync: (callback: (state: any) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, state: any) => callback(state)
        ipcRenderer.on('playback-state-sync', handler)
        return () => ipcRenderer.removeListener('playback-state-sync', handler)
    },

    onMiniPlayerCommand: (callback: (command: string) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, command: string) => callback(command)
        ipcRenderer.on('mini-player-command', handler)
        return () => ipcRenderer.removeListener('mini-player-command', handler)
    },

    // Metadata Editing
    editTrackMetadata: (options: {
        filePath: string
        metadata: { title: string; artist: string; album: string }
        coverArt?: string
    }): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('edit-track-metadata', options),

    // Native Notifications
    showNotification: (options: { title: string, body: string }): Promise<void> =>
        ipcRenderer.invoke('show-notification', options),

    // Auto Updater API
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),

    onUpdateAvailable: (callback: (info: any) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, info: any) => callback(info)
        ipcRenderer.on('update-available', handler)
        return () => ipcRenderer.removeListener('update-available', handler)
    },

    onUpdateNotAvailable: (callback: () => void) => {
        const handler = () => callback()
        ipcRenderer.on('update-not-available', handler)
        return () => ipcRenderer.removeListener('update-not-available', handler)
    },

    onUpdateError: (callback: (error: string) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, error: string) => callback(error)
        ipcRenderer.on('update-error', handler)
        return () => ipcRenderer.removeListener('update-error', handler)
    },

    onUpdateProgress: (callback: (progress: any) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress)
        ipcRenderer.on('auto-updater-progress', handler)
        return () => ipcRenderer.removeListener('auto-updater-progress', handler)
    },

    onUpdateDownloaded: (callback: (info: any) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, info: any) => callback(info)
        ipcRenderer.on('update-downloaded', handler)
        return () => ipcRenderer.removeListener('update-downloaded', handler)
    }
})

// Type declaration for window.electronAPI
declare global {
    interface Window {
        electronAPI: {
            getVideoInfo: (url: string) => Promise<VideoInfo>
            getPlaylistInfo: (url: string) => Promise<VideoInfo[]>
            downloadAudio: (options: DownloadOptions) => Promise<{ success: boolean, path: string }>
            onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
            showInFolder: (path: string) => Promise<void>
            selectFolder: () => Promise<string | null>
            getHistory: () => Promise<HistoryItem[]>
            clearHistory: () => Promise<void>
            saveSettings: (settings: any) => Promise<void>
            getSettings: () => Promise<any>
            saveToHistory: (item: HistoryItem) => Promise<void>
            getMetadataHistory: () => Promise<{ artists: string[], albums: string[] }>
            selectImage: () => Promise<string | null>
            processAlbumArt: (options: { imageData: string, aspectRatio: '1:1' | '16:9', size?: number }) => Promise<string>
            cancelDownload: (id: string) => Promise<void>
            extractFrames: (url: string, count?: number) => Promise<string[]>
            getMusicLibrary: () => Promise<{
                path: string
                title: string
                artist: string
                album: string
                duration: number
                coverArt: string | null
            }[]>
            getTrackCoverArt: (filePath: string) => Promise<string | null>
            getPlaylists: () => Promise<Playlist[]>
            savePlaylist: (playlist: Playlist) => Promise<{ success: boolean, playlists: Playlist[] }>
            deletePlaylist: (playlistId: string) => Promise<{ success: boolean, playlists: Playlist[] }>
            addTrackToPlaylist: (playlistId: string, trackPath: string) => Promise<{ success: boolean, playlist?: Playlist, error?: string }>
            removeTrackFromPlaylist: (playlistId: string, trackPath: string) => Promise<{ success: boolean, playlist?: Playlist, error?: string }>
            // M4A Converter
            scanForM4A: (paths: string[]) => Promise<Array<{
                path: string
                filename: string
                title: string
                artist: string
                album: string
                duration: number
                coverArt: string | null
            }>>
            selectM4AFiles: () => Promise<string[]>
            convertM4AToMP3: (options: {
                inputPath: string
                outputFolder?: string
                metadata: { title: string; artist: string; album: string }
            }) => Promise<{ success: boolean; outputPath: string }>
            // Mini Player
            openMiniPlayer: () => Promise<void>
            closeMiniPlayer: () => Promise<void>
            syncPlaybackState: (state: any) => Promise<void>
            miniPlayerCommand: (command: string) => Promise<void>
            onPlaybackStateSync: (callback: (state: any) => void) => () => void
            onMiniPlayerCommand: (callback: (command: string) => void) => () => void
            // Notifications
            showNotification: (options: { title: string, body: string }) => Promise<void>
            // Metadata editing
            editTrackMetadata: (options: {
                filePath: string
                metadata: { title: string; artist: string; album: string }
                coverArt?: string
            }) => Promise<{ success: boolean }>
            // Auto-updater
            checkForUpdates: () => Promise<{ updateAvailable: boolean, version?: string, releaseNotes?: string | null, error?: string }>
            downloadUpdate: () => Promise<{ success: boolean, error?: string }>
            installUpdate: () => Promise<void>
            onUpdateAvailable: (callback: (info: any) => void) => () => void
            onUpdateNotAvailable: (callback: () => void) => () => void
            onUpdateError: (callback: (error: string) => void) => () => void
            onUpdateProgress: (callback: (progress: any) => void) => () => void
            onUpdateDownloaded: (callback: (info: any) => void) => () => void
            // FX Presets
            getFxPresets: () => Promise<any[]>
            saveFxPreset: (preset: any) => Promise<{ success: boolean, presets: any[] }>
            deleteFxPreset: (presetId: string) => Promise<{ success: boolean, presets: any[] }>
        }
    }
}
