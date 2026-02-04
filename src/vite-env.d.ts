/// <reference types="vite/client" />

interface AlbumArtData {
    source: 'thumbnail' | 'custom'
    imageData: string
    aspectRatio: '1:1' | '16:9'
}

interface VideoInfo {
    id: string
    title: string
    duration: number
    thumbnail: string
    channel: string
    url: string
}

interface DownloadOptions {
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

interface DownloadProgress {
    stage: 'downloading' | 'converting' | 'complete'
    percent: number
    speed?: string | null
    eta?: string | null
}

interface HistoryItem {
    id: string
    title: string
    artist: string
    album: string
    path: string
    thumbnail: string
    downloadedAt: string
}

interface MetadataHistory {
    artists: string[]
    albumArt?: AlbumArtData
    id?: string
}

interface Playlist {
    id: string
    name: string
    description: string
    coverArt: string | null
    trackPaths: string[]
    createdAt: number
    updatedAt: number
}

interface Window {
    electronAPI: {
        getVideoInfo: (url: string) => Promise<VideoInfo>
        getPlaylistInfo: (url: string) => Promise<VideoInfo[]>
        downloadAudio: (options: DownloadOptions) => Promise<{ success: boolean, path: string }>
        onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
        showInFolder: (path: string) => Promise<void>
        selectFolder: () => Promise<string | null>
        getHistory: () => Promise<HistoryItem[]>
        saveToHistory: (entry: Omit<HistoryItem, 'id' | 'downloadedAt'>) => Promise<void>
        getMetadataHistory: () => Promise<MetadataHistory>
        selectImage: () => Promise<string | null>
        processAlbumArt: (options: { imageData: string, aspectRatio: '1:1' | '16:9' }) => Promise<string>
        cancelDownload: (id: string) => Promise<void>
        getSettings: () => Promise<any>
        saveSettings: (settings: any) => Promise<void>
        clearHistory: () => Promise<void>
        getMusicLibrary: () => Promise<{
            path: string
            title: string
            artist: string
            album: string
            duration: number
            coverArt: string | null
        }[]>
        getTrackCoverArt: (filePath: string) => Promise<string | null>
        extractFrames: (url: string, count?: number) => Promise<string[]>
        // Playlists
        getPlaylists: () => Promise<Playlist[]>
        savePlaylist: (playlist: Playlist) => Promise<{ success: boolean, playlists: Playlist[] }>
        deletePlaylist: (playlistId: string) => Promise<{ success: boolean, playlists: Playlist[] }>
        addTrackToPlaylist: (playlistId: string, trackPath: string) => Promise<{ success: boolean, playlist?: Playlist, error?: string }>
        removeTrackFromPlaylist: (playlistId: string, trackPath: string) => Promise<{ success: boolean, playlist?: Playlist, error?: string }>
        // FX Presets
        getFxPresets: () => Promise<any[]>
        saveFxPreset: (preset: any) => Promise<{ success: boolean, presets: any[] }>
        deleteFxPreset: (presetId: string) => Promise<{ success: boolean, presets: any[] }>
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
    }
}
