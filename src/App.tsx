import { useState, useEffect, useCallback, useRef } from 'react'
import { Home as HomeIcon, History as HistoryIcon, Headphones as HeadphonesIcon, Settings as SettingsIcon, ArrowLeft as ArrowLeftIcon } from 'lucide-react'
import UrlInput from './components/UrlInput'
import DownloadHistory from './components/DownloadHistory'
import PlaylistEditor from './components/PlaylistEditor'
import MusicPlayer from './components/MusicPlayer'
import SettingsModal, { Settings } from './components/SettingsModal'
import { PlaylistItem } from './types'

type ViewType = 'home' | 'history' | 'player'

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
}

function App() {
    const [playlistItems, setPlaylistItems] = useState<PlaylistItem[]>([])
    const [isLoading, setIsLoading] = useState(false)

    // Global Settings
    const [showSettings, setShowSettings] = useState(false)
    const [settings, setSettings] = useState<Settings>({
        format: 'm4a',
        coverArtRatio: '16:9'
    })

    const [downloadState, setDownloadState] = useState<DownloadState>({ stage: 'idle', percent: 0 })
    const [activeView, setActiveView] = useState<ViewType>('home')
    const [isSettingsLoaded, setIsSettingsLoaded] = useState(false)

    // Load settings
    useEffect(() => {
        if (window.electronAPI?.getSettings) {
            window.electronAPI.getSettings().then(saved => {
                if (saved) setSettings(saved)
                setIsSettingsLoaded(true)
            })
        } else {
            setIsSettingsLoaded(true)
        }
    }, [])

    // Save settings (debounce implied by useEffect nature if typing, but toggle is distinct)
    useEffect(() => {
        if (isSettingsLoaded && window.electronAPI?.saveSettings) {
            window.electronAPI.saveSettings(settings)
        }
    }, [settings, isSettingsLoaded])

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
                    percent: progress.percent
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
        console.log('Cancel requested. Current ID:', currentDownloadIdRef.current)
        abortDownloadRef.current = true

        // Immediate feedback
        setDownloadState(prev => ({
            ...prev,
            stage: 'error',
            error: 'Cancelling...'
        }))

        if (currentDownloadIdRef.current) {
            await window.electronAPI.cancelDownload(currentDownloadIdRef.current)

            // Validate cancellation confirmed
            setDownloadState(prev => ({
                ...prev,
                stage: 'error',
                error: 'Cancelled'
            }))

            // Reset after 3 seconds
            setTimeout(() => {
                setDownloadState({ stage: 'idle', percent: 0, error: undefined })
            }, 3000)
        }
    }, [])

    // Playlist choice state
    const [playlistChoice, setPlaylistChoice] = useState<{ url: string, listId: string } | null>(null)

    // Handle URL submission - Stack directly to playlist
    const handleUrlSubmit = useCallback(async (url: string) => {
        // Prevent duplicates? Let's allow for now as user might want different cuts
        setIsLoading(true)
        setDownloadState(prev => ({ ...prev, stage: 'idle', percent: 0, error: undefined }))

        try {
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

            // Block SC playlists for now
            if (isPlaylistUrl && url.includes('soundcloud.com')) {
                setIsLoading(false)
                setDownloadState({
                    stage: 'error',
                    percent: 0,
                    error: 'SoundCloud playlist downloads are not yet supported. Please paste individual song links for now.'
                })
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
                setDownloadState({
                    stage: 'error',
                    percent: 0,
                    error: 'SoundCloud playlist downloads are not yet supported. Please use "Just This Song" or paste individual song links.'
                })
                return
            } else {
                const playlistUrl = `https://www.youtube.com/playlist?list=${listId}`
                await processUrl(playlistUrl, true)
            }
        } else {
            await processUrl(url, false)
        }
    }, [playlistChoice, processUrl])

    // Batch download (the only download handler now)
    const handleDownload = useCallback(async () => {
        const selectedItems = playlistItems.filter(item => item.selected)
        if (selectedItems.length === 0) return

        abortDownloadRef.current = false

        setDownloadState({
            stage: 'downloading',
            percent: 0,
            currentIndex: 0,
            totalCount: selectedItems.length
        })

        for (let i = 0; i < selectedItems.length; i++) {
            if (abortDownloadRef.current) break

            const item = selectedItems[i]

            // Track which item is currently downloading
            currentDownloadingItemIdRef.current = item.id

            // Set initial downloading state for this item
            setPlaylistItems(items => items.map(it =>
                it.id === item.id
                    ? { ...it, downloadProgress: { stage: 'downloading', percent: 0 } }
                    : it
            ))

            setDownloadState(prev => ({
                ...prev,
                currentIndex: i + 1,
                percent: 0
            }))

            const id = crypto.randomUUID()
            currentDownloadIdRef.current = id

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

                // Mark item as complete
                setPlaylistItems(items => items.map(it =>
                    it.id === item.id
                        ? { ...it, downloadProgress: { stage: 'complete', percent: 100 } }
                        : it
                ))

                await window.electronAPI.saveToHistory({
                    title: item.metadata.title,
                    artist: item.metadata.artist,
                    album: item.metadata.album,
                    path: result.path,
                    thumbnail: item.thumbnail
                })
            } catch (error) {
                // Mark item as error
                setPlaylistItems(items => items.map(it =>
                    it.id === item.id
                        ? { ...it, downloadProgress: { stage: 'error', percent: 0 } }
                        : it
                ))

                if (abortDownloadRef.current) break
                console.error(`Failed to download ${item.title}:`, error)
            }
        }

        currentDownloadIdRef.current = null

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
        }
    }, [playlistItems, settings.format, settings.coverArtRatio])

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
        setPlaylistItems([])
    }, [])

    const handleClearSelected = useCallback(() => {
        setPlaylistItems(prev => prev.filter(item => !item.selected))
    }, [])

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
            default: return 'view-home'
        }
    }

    return (
        <div className="app">
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
                        <MusicPlayer isActive={activeView === 'player'} />
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
                                    <div style={{ color: '#ff4444', marginBottom: '8px', fontSize: '13px', padding: '0 10px' }}>
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
                                className={`playlist-action-btn-modal primary ${playlistChoice.url.includes('soundcloud.com') ? 'disabled' : ''}`}
                                onClick={() => handlePlaylistChoice('playlist')}
                                disabled={playlistChoice.url.includes('soundcloud.com')}
                                title={playlistChoice.url.includes('soundcloud.com') ? 'SoundCloud playlists not yet supported' : ''}
                            >
                                <span className="btn-text">{playlistChoice.url.includes('soundcloud.com') ? 'Not Available' : 'Full Playlist'}</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default App
