import { useState, useEffect, useCallback, useRef } from 'react'
import { Home as HomeIcon, History as HistoryIcon, Headphones as HeadphonesIcon, Settings as SettingsIcon, Recycle } from 'lucide-react'
import UrlInput from './components/UrlInput'
import DownloadHistory from './components/DownloadHistory'
import PlaylistEditor from './components/PlaylistEditor'
import MusicPlayer from './components/MusicPlayer'
import SettingsModal, { Settings, DEFAULT_ACCENT_COLOR, THEME_PRESETS, ThemeKey } from './components/SettingsModal'
import M4AConverter from './components/M4AConverter'
import MiniPlayer from './components/MiniPlayer'
import { PlaylistItem, Track } from './types'

type ViewType = 'home' | 'history' | 'player' | 'converter'

interface VideoInfo {
    id: string
    title: string
    duration: number
    thumbnail: string
    channel: string
    url: string
    isPlaylist?: boolean
    items?: VideoInfo[]
}

interface DownloadState {
    stage: 'idle' | 'downloading' | 'converting' | 'complete' | 'error'
    percent: number
    error?: string
    completedPath?: string
    currentIndex?: number
    totalCount?: number
    speed?: string | null
    eta?: string | null
}

function App() {
    // Mini player mode: render only MiniPlayer component
    if (window.location.hash === '#/mini-player') {
        return <MiniPlayer />
    }

    const [playlistItems, setPlaylistItems] = useState<PlaylistItem[]>([])
    const [isLoading, setIsLoading] = useState(false)

    // Global Settings
    const [showSettings, setShowSettings] = useState(false)
    const [settings, setSettings] = useState<Settings>({
        format: 'm4a',
        coverArtRatio: '16:9',
        downloadFolder: '',
        musicPlayerFolder: '',
        mp3OutputFolder: '',
        accentColor: DEFAULT_ACCENT_COLOR,
        theme: 'dark',
        concurrentDownloads: 2,
        notifications: true,
        crossfadeDuration: 0,
        surpriseMode: false,
        adaptiveColors: false,
        playerModel: 'cube'
    })

    const [downloadState, setDownloadState] = useState<DownloadState>({ stage: 'idle', percent: 0 })
    const [activeView, setActiveView] = useState<ViewType>('home')
    const [isSettingsLoaded, setIsSettingsLoaded] = useState(false)

    // Music library preload state
    const [musicLibrary, setMusicLibrary] = useState<Track[]>([])
    const [isLibraryLoaded, setIsLibraryLoaded] = useState(false)
    const [showSplash, setShowSplash] = useState(true)



    const isAppReady = isSettingsLoaded && isLibraryLoaded

    // Load settings
    useEffect(() => {
        if (window.electronAPI?.getSettings) {
            window.electronAPI.getSettings().then(saved => {
                if (saved) {
                    const merged = { ...settings, ...saved }
                    if (merged.surpriseMode) {
                        const themeKeys = Object.keys(THEME_PRESETS) as ThemeKey[]
                        merged.theme = themeKeys[Math.floor(Math.random() * themeKeys.length)]
                        const randomColor = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')
                        merged.accentColor = randomColor
                    }
                    setSettings(merged)
                }
                setIsSettingsLoaded(true)
            })
        } else {
            setIsSettingsLoaded(true)
        }
    }, [])

    // Preload music library on mount
    useEffect(() => {
        if ((window.electronAPI as any)?.getMusicLibrary) {
            (window.electronAPI as any).getMusicLibrary()
                .then((tracks: Track[]) => {
                    setMusicLibrary(tracks)
                    setIsLibraryLoaded(true)
                })
                .catch((err: Error) => {
                    console.error('Failed to preload music library:', err)
                    setIsLibraryLoaded(true)
                })
        } else {
            setIsLibraryLoaded(true)
        }
    }, [])

    // Fade out splash when ready
    useEffect(() => {
        if (isAppReady) {
            const timeout = setTimeout(() => setShowSplash(false), 500)
            return () => clearTimeout(timeout)
        }
    }, [isAppReady])



    // Refresh music library (called by MusicPlayer or after download)
    const refreshMusicLibrary = useCallback(async () => {
        try {
            const tracks = await (window.electronAPI as any).getMusicLibrary()
            setMusicLibrary(tracks)
            return tracks
        } catch (err) {
            console.error('Failed to refresh music library:', err)
            return musicLibrary
        }
    }, [musicLibrary])

    // Save settings (debounce implied by useEffect nature if typing, but toggle is distinct)
    useEffect(() => {
        if (isSettingsLoaded && window.electronAPI?.saveSettings) {
            window.electronAPI.saveSettings(settings)
        }
    }, [settings, isSettingsLoaded])

    // Apply custom accent color & theme to CSS variables
    useEffect(() => {
        const hexToRgb = (hex: string) => {
            const r = parseInt(hex.slice(1, 3), 16)
            const g = parseInt(hex.slice(3, 5), 16)
            const b = parseInt(hex.slice(5, 7), 16)
            return { r, g, b }
        }

        const darken = (r: number, g: number, b: number, pct: number) => ({
            r: Math.round(r * (1 - pct / 100)),
            g: Math.round(g * (1 - pct / 100)),
            b: Math.round(b * (1 - pct / 100))
        })

        const rgbToHex = (r: number, g: number, b: number) =>
            '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')

        const root = document.documentElement.style

        // Skip if adaptive mode is on — MusicPlayer handles both accent + theme
        if (settings.adaptiveColors) return

        // Accent color
        const accentHex = settings.accentColor || DEFAULT_ACCENT_COLOR
        const accent = hexToRgb(accentHex)
        const secondary = darken(accent.r, accent.g, accent.b, 20)
        const tertiary = darken(accent.r, accent.g, accent.b, 35)

        root.setProperty('--accent-rgb', `${accent.r}, ${accent.g}, ${accent.b}`)
        root.setProperty('--accent-primary', accentHex)
        root.setProperty('--accent-secondary', rgbToHex(secondary.r, secondary.g, secondary.b))
        root.setProperty('--accent-tertiary', rgbToHex(tertiary.r, tertiary.g, tertiary.b))
        root.setProperty('--accent-success', accentHex)
        root.setProperty('--shadow-glow', `0 0 20px rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.3)`)

        // Theme - apply from preset
        const preset = THEME_PRESETS[settings.theme as ThemeKey] || THEME_PRESETS.dark
        const c = preset.colors
        root.setProperty('--bg-primary', c.bgPrimary)
        root.setProperty('--bg-secondary', c.bgSecondary)
        root.setProperty('--bg-tertiary', c.bgTertiary)
        root.setProperty('--bg-glass', c.bgGlass)
        root.setProperty('--bg-glass-hover', c.bgGlassHover)
        root.setProperty('--bg-frosted', c.bgFrosted)
        root.setProperty('--text-primary', c.textPrimary)
        root.setProperty('--text-secondary', c.textSecondary)
        root.setProperty('--text-muted', c.textMuted)
        root.setProperty('--overlay-rgb', c.overlayRgb)
        root.setProperty('--fx-overlay-bg', c.fxOverlayBg)
        root.setProperty('--shadow-sm', c.shadowSm)
        root.setProperty('--shadow-md', c.shadowMd)
        root.setProperty('--border-glass', c.borderGlass)
        root.setProperty('--player-bg-brightness', c.playerBgBrightness)
        root.setProperty('--player-bg-opacity', c.playerBgOpacity)
    }, [settings.accentColor, settings.theme, settings.adaptiveColors])

    const abortDownloadRef = useRef(false)
    const currentDownloadIdRef = useRef<string | null>(null)
    const currentDownloadingItemIdRef = useRef<string | null>(null)

    // Listen for download progress - update both global and per-item progress
    useEffect(() => {
        const unsubscribe = window.electronAPI.onDownloadProgress((progress) => {
            // Calculate unified progress: download = 0-70%, converting = 70-100%
            let unifiedPercent = progress.percent
            if (progress.stage === 'downloading') {
                unifiedPercent = progress.percent * 0.7  // 0-70%
            } else if (progress.stage === 'converting') {
                unifiedPercent = 70 + (progress.percent * 0.3)  // 70-100%
            } else if (progress.stage === 'complete') {
                unifiedPercent = 100
            }

            // Update Global State
            // IMPORTANT: We do NOT set 'complete' here because that signifies the ENTIRE batch is done.
            // Individual item completion is tracked via filtered items loop in handleDownload.
            if (progress.stage !== 'complete') {
                setDownloadState(prev => ({
                    ...prev,
                    stage: progress.stage,
                    percent: progress.percent,
                    speed: progress.speed,
                    eta: progress.eta
                }))
            }

            // Update per-item progress with unified percent
            const itemId = currentDownloadingItemIdRef.current
            if (itemId) {
                setPlaylistItems(items => items.map(item =>
                    item.id === itemId
                        ? { ...item, downloadProgress: { stage: progress.stage, percent: unifiedPercent } }
                        : item
                ))
            }
        })
        return unsubscribe
    }, [])

    const handleCancel = useCallback(async () => {
        abortDownloadRef.current = true

        setDownloadState(prev => ({
            ...prev,
            stage: 'error',
            error: 'Cancelling...'
        }))

        // Cancel all active downloads
        const cancelPromises = Array.from(activeDownloadIdsRef.current.keys()).map(id =>
            window.electronAPI.cancelDownload(id).catch(() => { })
        )
        if (currentDownloadIdRef.current) {
            cancelPromises.push(window.electronAPI.cancelDownload(currentDownloadIdRef.current).catch(() => { }))
        }
        await Promise.all(cancelPromises)

        setDownloadState(prev => ({
            ...prev,
            stage: 'error',
            error: 'Cancelled'
        }))

        setTimeout(() => {
            setDownloadState({ stage: 'idle', percent: 0, error: undefined })
        }, 3000)
    }, [])

    // Playlist choice state
    const [playlistChoice, setPlaylistChoice] = useState<{ url: string, listId: string } | null>(null)

    // Handle URL submission - Stack directly to playlist
    const handleUrlSubmit = useCallback(async (url: string) => {
        // Prevent duplicates? Let's allow for now as user might want different cuts
        setIsLoading(true)
        setDownloadState(prev => ({ ...prev, stage: 'idle', percent: 0, error: undefined }))

        try {
            // For non-YouTube/SC URLs, skip playlist detection entirely
            const isYouTube = url.includes('youtube.com') || url.includes('youtu.be')
            const isSoundCloud = url.includes('soundcloud.com')
            if (!isYouTube && !isSoundCloud) {
                await processUrl(url, false)
                return
            }

            let isPlaylistUrl = false
            let hasPlaylistParam = false
            let listId = ''

            try {
                const urlObj = new URL(url)

                if (url.includes('youtube') || url.includes('youtu.be')) {
                    listId = urlObj.searchParams.get('list') || ''
                    // Check if it's a real playlist (not Radio/Mix which starts with "RD")
                    const isRealPlaylist = Boolean(listId) && !listId.startsWith('RD')

                    // Pure playlist URL (no video)
                    isPlaylistUrl = urlObj.pathname.includes('/playlist') && isRealPlaylist
                    // Video URL with playlist param (e.g., watch?v=xxx&list=yyy)
                    hasPlaylistParam = urlObj.pathname.includes('/watch') && isRealPlaylist
                } else if (url.includes('soundcloud.com')) {
                    const hasInParam = urlObj.searchParams.get('in')?.includes('/sets/')
                    const isSetsPath = urlObj.pathname.includes('/sets/')
                    const isLikesPath = urlObj.pathname.includes('/likes')

                    if (isSetsPath || isLikesPath) {
                        isPlaylistUrl = true
                        listId = 'sc_set'
                    } else if (hasInParam) {
                        hasPlaylistParam = true
                        listId = 'sc_mixed'
                    }
                }
            } catch {
                isPlaylistUrl = false
                hasPlaylistParam = false
            }

            // If it's a video with a playlist, ask user what they want
            if (hasPlaylistParam && !isPlaylistUrl) {
                setIsLoading(false)
                setPlaylistChoice({ url, listId })
                return
            }

            await processUrl(url, isPlaylistUrl)
        } catch (error) {
            console.error('Failed to get video info:', error)
            setDownloadState(prev => ({
                ...prev,
                stage: 'error',
                percent: 0,
                error: error instanceof Error ? error.message : 'Failed to get video info'
            }))
            setIsLoading(false)
        }
    }, [])

    // Process URL (single video or playlist)
    const processUrl = useCallback(async (url: string, isPlaylist: boolean) => {
        setIsLoading(true)
        try {
            if (isPlaylist) {
                let targetUrl = url
                // If SoundCloud track with context, extract the actual Set URL
                if (url.includes('soundcloud.com') && url.includes('in=')) {
                    try {
                        const inParam = new URL(url).searchParams.get('in')
                        if (inParam) targetUrl = `https://soundcloud.com/${inParam}`
                    } catch { }
                }

                const items = await window.electronAPI.getPlaylistInfo(targetUrl)
                const newItems = items.map((item: VideoInfo) => ({
                    ...item,
                    metadata: { title: item.title, artist: item.channel, album: '' },
                    albumArt: null,
                    trimRange: { start: 0, end: item.duration },
                    selected: true
                }))
                setPlaylistItems(prev => [...prev, ...newItems])
            } else {
                // Remove playlist param for single video to get clean thumbnail
                let cleanUrl = url
                try {
                    const urlObj = new URL(url)
                    urlObj.searchParams.delete('list')
                    urlObj.searchParams.delete('in') // Remove SoundCloud context
                    urlObj.searchParams.delete('index')
                    cleanUrl = urlObj.toString()
                } catch { /* keep original */ }

                const info = await window.electronAPI.getVideoInfo(cleanUrl)

                // Duplicate detection
                const isDuplicate = playlistItems.some(item => item.url === info.url || item.id === info.id)
                if (isDuplicate) {
                    const addAnyway = window.confirm('This URL is already in the queue. Add it again?')
                    if (!addAnyway) {
                        setIsLoading(false)
                        return
                    }
                }

                const newItem: PlaylistItem = {
                    ...info,
                    metadata: {
                        title: info.title,
                        artist: info.channel,
                        album: ''
                    },
                    albumArt: null,
                    trimRange: { start: 0, end: info.duration },
                    selected: true
                }
                setPlaylistItems(prev => [...prev, newItem])
            }
        } catch (error) {
            console.error('Failed to get video info:', error)
            setDownloadState(prev => ({
                ...prev,
                stage: 'error',
                percent: 0,
                error: error instanceof Error ? error.message : 'Failed to get video info'
            }))
        } finally {
            setIsLoading(false)
        }
    }, [])

    // Handle playlist choice (user selected single video or full playlist)
    const handlePlaylistChoice = useCallback(async (choice: 'single' | 'playlist') => {
        if (!playlistChoice) return

        const { url, listId } = playlistChoice
        setPlaylistChoice(null)

        if (choice === 'playlist') {
            if (url.includes('soundcloud.com')) {
                // For SC, reconstruct the set URL from the 'in' param
                try {
                    const inParam = new URL(url).searchParams.get('in')
                    const setUrl = inParam ? `https://soundcloud.com/${inParam}` : url
                    await processUrl(setUrl, true)
                } catch {
                    await processUrl(url, true)
                }
            } else {
                const playlistUrl = `https://www.youtube.com/playlist?list=${listId}`
                await processUrl(playlistUrl, true)
            }
        } else {
            await processUrl(url, false)
        }
    }, [playlistChoice, processUrl])

    const activeDownloadIdsRef = useRef<Map<string, string>>(new Map()) // downloadUUID -> itemId

    // Batch download with parallel support
    const handleDownload = useCallback(async () => {
        const selectedItems = playlistItems.filter(item => item.selected)
        if (selectedItems.length === 0) return

        abortDownloadRef.current = false
        activeDownloadIdsRef.current.clear()

        setDownloadState({
            stage: 'downloading',
            percent: 0,
            currentIndex: 0,
            totalCount: selectedItems.length
        })

        const concurrency = settings.concurrentDownloads || 2
        let completedSoFar = 0

        const downloadItem = async (item: PlaylistItem) => {
            if (abortDownloadRef.current) return

            const id = crypto.randomUUID()
            activeDownloadIdsRef.current.set(id, item.id)
            currentDownloadingItemIdRef.current = item.id

            setPlaylistItems(items => items.map(it =>
                it.id === item.id
                    ? { ...it, downloadProgress: { stage: 'downloading', percent: 0 } }
                    : it
            ))

            try {
                const result = await window.electronAPI.downloadAudio({
                    url: item.url,
                    format: settings.format,
                    metadata: item.metadata,
                    trimStart: item.trimRange?.start,
                    trimEnd: item.trimRange?.end,
                    coverArt: item.thumbnail,
                    coverArtAspectRatio: settings.coverArtRatio,
                    id
                })

                setPlaylistItems(items => items.map(it =>
                    it.id === item.id
                        ? { ...it, downloadProgress: { stage: 'complete', percent: 100 } }
                        : it
                ))

                completedSoFar++
                setDownloadState(prev => ({
                    ...prev,
                    currentIndex: completedSoFar
                }))

                await window.electronAPI.saveToHistory({
                    title: item.metadata.title,
                    artist: item.metadata.artist,
                    album: item.metadata.album,
                    path: result.path,
                    thumbnail: item.thumbnail
                })
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error)
                setPlaylistItems(items => items.map(it =>
                    it.id === item.id
                        ? { ...it, downloadProgress: { stage: 'error', percent: 0 } }
                        : it
                ))
                completedSoFar++
                if (!abortDownloadRef.current) {
                    console.error(`Failed to download ${item.title}:`, error)
                    // Show error in UI for single-item downloads
                    if (selectedItems.length === 1) {
                        setDownloadState({
                            stage: 'error',
                            percent: 0,
                            error: errMsg
                        })
                    }
                }
            } finally {
                activeDownloadIdsRef.current.delete(id)
            }
        }

        // Worker pool pattern
        const queue = [...selectedItems]
        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
            while (queue.length > 0 && !abortDownloadRef.current) {
                const item = queue.shift()!
                await downloadItem(item)
            }
        })

        await Promise.all(workers)

        currentDownloadIdRef.current = null
        activeDownloadIdsRef.current.clear()

        if (abortDownloadRef.current) {
            setDownloadState(prev => ({
                ...prev,
                stage: 'error',
                error: 'Batch download cancelled'
            }))
        } else {
            setDownloadState({
                stage: 'complete',
                percent: 100,
                totalCount: selectedItems.length
            })
            refreshMusicLibrary()

            // Native notification
            if (settings.notifications !== false && (window.electronAPI as any).showNotification) {
                (window.electronAPI as any).showNotification({
                    title: 'Downloads Complete',
                    body: `${selectedItems.length} track${selectedItems.length > 1 ? 's' : ''} downloaded successfully.`
                })
            }
        }
    }, [playlistItems, settings.format, settings.coverArtRatio, settings.concurrentDownloads, settings.notifications, refreshMusicLibrary])

    const handleUpdatePlaylistItem = useCallback((index: number, updates: Partial<PlaylistItem>) => {
        setPlaylistItems(items => items.map((item, i) =>
            i === index ? { ...item, ...updates } : item
        ))
    }, [])

    const handleToggleAll = useCallback((selected: boolean) => {
        setPlaylistItems(items => items.map(item => ({ ...item, selected })))
    }, [])

    const handleShowInFolder = useCallback(() => {
        if (downloadState.completedPath) {
            window.electronAPI.showInFolder(downloadState.completedPath)
        }
    }, [downloadState.completedPath])

    const handleReset = useCallback(() => {
        setDownloadState({ stage: 'idle', percent: 0 })
    }, [])

    const handleRemoveItem = useCallback((index: number) => {
        setPlaylistItems(prev => prev.filter((_, i) => i !== index))
    }, [])

    const handleClearItems = useCallback(() => {
        if (playlistItems.length === 0) return
        if (!window.confirm(`Clear all ${playlistItems.length} items from queue?`)) return
        setPlaylistItems([])
    }, [playlistItems.length])

    const handleClearSelected = useCallback(() => {
        const selectedCount = playlistItems.filter(item => item.selected).length
        if (selectedCount === 0) return
        if (!window.confirm(`Remove ${selectedCount} selected item(s)?`)) return
        setPlaylistItems(prev => prev.filter(item => !item.selected))
    }, [playlistItems])

    const isDownloading = downloadState.stage === 'downloading' || downloadState.stage === 'converting'

    // Calculate progress counts
    const selectedCount = playlistItems.filter(i => i.selected).length
    const completedCount = playlistItems.filter(i => i.selected && i.downloadProgress?.stage === 'complete').length

    const [isTransitioning, setIsTransitioning] = useState(false)
    const transitionTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    // Trigger transition animation
    useEffect(() => {
        setIsTransitioning(true)
        if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current)
        transitionTimeoutRef.current = setTimeout(() => {
            setIsTransitioning(false)
        }, 800) // Matches CSS transition duration
    }, [activeView])

    const getViewClass = () => {
        switch (activeView) {
            case 'history': return 'view-history'
            case 'player': return 'view-player'
            case 'converter': return 'view-converter'
            default: return 'view-home'
        }
    }

    return (
        <>
            {showSplash && (
                <div className={`splash-screen ${isAppReady ? 'fade-out' : ''}`}>
                    <div className="splash-content">
                        <h1 className="splash-title">AudRip</h1>
                        <div className="splash-loader">
                            <div className="loading-spinner"></div>
                        </div>
                        <p className="splash-subtitle">Loading your library...</p>
                    </div>
                </div>
            )}
            <div className="app" style={{ visibility: showSplash ? 'hidden' : 'visible' }}>
                <div className="grid-background" />

                <div className="top-section">
                    <header className="app-header">
                        <h1>AudRip</h1>
                    </header>



                    <div className="toolbar">
                        <button
                            className={`toolbar-btn ${activeView === 'home' ? 'active' : ''}`}
                            onClick={() => setActiveView('home')}
                            title="Downloads"
                        >
                            <HomeIcon size={20} />
                        </button>
                        <button
                            className={`toolbar-btn ${activeView === 'history' ? 'active' : ''}`}
                            onClick={() => setActiveView('history')}
                            title="History"
                        >
                            <HistoryIcon size={20} />
                        </button>
                        <button
                            className={`toolbar-btn ${activeView === 'player' ? 'active' : ''}`}
                            onClick={() => setActiveView('player')}
                            title="Music Player"
                        >
                            <HeadphonesIcon size={20} />
                        </button>
                        <button
                            className={`toolbar-btn ${activeView === 'converter' ? 'active' : ''}`}
                            onClick={() => setActiveView('converter')}
                            title="M4A to MP3 Converter"
                        >
                            <Recycle size={20} />
                        </button>
                        <button
                            className="toolbar-btn"
                            onClick={() => setShowSettings(true)}
                            title="Settings"
                        >
                            <SettingsIcon size={20} />
                        </button>
                    </div>

                    <div className={`url-container ${activeView !== 'home' ? 'hidden' : ''}`}>
                        <UrlInput
                            onSubmit={handleUrlSubmit}
                            isLoading={isLoading}
                            disabled={isDownloading}
                        />
                    </div>
                </div>

                <main className={`app-main ${isTransitioning ? 'transitioning' : ''}`}>
                    <div className={`view-container ${getViewClass()}`}>
                        <div className="view-pane history-pane-wrapper">
                            <DownloadHistory isActive={activeView === 'history'} />
                        </div>

                        <div className="view-pane player-pane-wrapper">
                            <MusicPlayer
                                isActive={activeView === 'player'}
                                initialTracks={musicLibrary}
                                onRefreshTracks={refreshMusicLibrary}
                                crossfadeDuration={settings.crossfadeDuration || 0}
                                theme={settings.theme || 'dark'}
                                accentColor={settings.accentColor || DEFAULT_ACCENT_COLOR}
                                adaptiveColors={settings.adaptiveColors || false}
                                playerModel={settings.playerModel || 'cube'}
                            />
                        </div>

                        <div className="view-pane converter-pane-wrapper">
                            <M4AConverter
                                isActive={activeView === 'converter'}
                                outputFolder={settings.mp3OutputFolder}
                            />
                        </div>

                        <div className="view-pane home-pane-wrapper">
                            <div className={`queue-area ${playlistItems.length === 0 ? 'empty-queue' : ''}`}>
                                <PlaylistEditor
                                    items={playlistItems}
                                    onUpdateItem={handleUpdatePlaylistItem}
                                    onRemoveItem={handleRemoveItem}
                                    onClearItems={handleClearItems}
                                    onClearSelected={handleClearSelected}
                                    onToggleAll={handleToggleAll}
                                    coverArtRatio={settings.coverArtRatio}
                                />
                            </div>

                            <div className="action-footer">
                                {downloadState.stage === 'idle' ? (
                                    <button
                                        className="download-button"
                                        onClick={handleDownload}
                                        disabled={playlistItems.length === 0 || playlistItems.filter(i => i.selected).length === 0}
                                        style={{ width: '100%' }}
                                    >
                                        {playlistItems.length > 0 ? `Download Now (${playlistItems.filter(i => i.selected).length})` : 'Download Now'}
                                    </button>
                                ) : (downloadState.stage === 'downloading' || downloadState.stage === 'converting') ? (
                                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <div style={{
                                            textAlign: 'center',
                                            color: 'var(--text-secondary)',
                                            fontSize: '13px',
                                            fontWeight: 500
                                        }}>
                                            Downloaded {completedCount} / {selectedCount}
                                            {(settings.concurrentDownloads || 2) <= 1 && downloadState.speed && ` • ${downloadState.speed}`}
                                            {(settings.concurrentDownloads || 2) <= 1 && downloadState.eta && ` • ETA ${downloadState.eta}`}
                                        </div>
                                        <button
                                            className="cancel-button"
                                            onClick={handleCancel}
                                            style={{ width: '100%' }}
                                        >
                                            Cancel Download
                                        </button>
                                    </div>
                                ) : downloadState.stage === 'complete' ? (
                                    <div className="footer-actions">
                                        <button className="secondary-button" onClick={handleShowInFolder}>
                                            📂 Show in Folder
                                        </button>
                                        <button className="download-button" onClick={handleReset}>
                                            Done
                                        </button>
                                    </div>
                                ) : downloadState.stage === 'error' ? (
                                    <div style={{ width: '100%', textAlign: 'center' }}>
                                        <div style={{ color: 'var(--accent-error)', marginBottom: '8px', fontSize: '13px', padding: '0 10px' }}>
                                            {downloadState.error}
                                        </div>
                                        <button className="secondary-button" onClick={handleReset} style={{ width: '100%' }}>
                                            Dismiss
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </main>

                {showSettings && (
                    <SettingsModal
                        settings={settings}
                        onUpdateSettings={setSettings}
                        onClose={() => setShowSettings(false)}
                    />
                )}



                {/* Playlist Choice Modal */}
                {playlistChoice && (
                    <div className="modal-overlay" onClick={() => setPlaylistChoice(null)}>
                        <div className="modal playlist-choice-modal" onClick={e => e.stopPropagation()}>
                            <h2>{playlistChoice.url.includes('soundcloud.com') ? 'Song from Set Detected' : 'Video from Playlist Detected'}</h2>
                            <p>This {playlistChoice.url.includes('soundcloud.com') ? 'song' : 'video'} is part of a playlist. What would you like to download?</p>
                            <div className="playlist-choice-buttons">
                                <button
                                    className="playlist-action-btn-modal primary"
                                    onClick={() => handlePlaylistChoice('single')}
                                >
                                    <span className="btn-text">{playlistChoice.url.includes('soundcloud.com') ? 'Just This Song' : 'Just This Video'}</span>
                                </button>
                                <button
                                    className="playlist-action-btn-modal primary"
                                    onClick={() => handlePlaylistChoice('playlist')}
                                >
                                    <span className="btn-text">{playlistChoice.url.includes('soundcloud.com') ? 'Full Set' : 'Full Playlist'}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    )
}

export default App
