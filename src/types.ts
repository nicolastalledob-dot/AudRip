export interface Track {
    path: string
    title: string
    artist: string
    album: string
    coverArt: string | null
    duration: number
}

export interface AlbumArtData {
    source: 'thumbnail' | 'custom'
    imageData: string
    aspectRatio: '1:1' | '16:9'
}

export interface Metadata {
    title: string
    artist: string
    album: string
}

export interface TrimRange {
    start: number
    end: number
}

export type DownloadStage = 'idle' | 'downloading' | 'converting' | 'complete' | 'error'

export interface ItemDownloadProgress {
    stage: DownloadStage
    percent: number
}

export interface PlaylistItem {
    id: string
    title: string
    duration: number
    thumbnail: string
    channel: string
    url: string
    metadata: Metadata
    albumArt: AlbumArtData | null
    trimRange: TrimRange | null
    selected: boolean
    downloadProgress?: ItemDownloadProgress
}
