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
        getSettings: () => Promise<{ format: 'mp3' | 'm4a', coverArtRatio: '1:1' | '16:9' } | null>
        saveSettings: (settings: { format: 'mp3' | 'm4a', coverArtRatio: '1:1' | '16:9' }) => Promise<boolean>
        clearHistory: () => Promise<void>
    }
}
