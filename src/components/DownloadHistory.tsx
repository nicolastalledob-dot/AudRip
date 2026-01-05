import { useEffect, useState, useCallback } from 'react'

interface HistoryItem {
    id: string
    title: string
    artist: string
    album: string
    path: string
    thumbnail: string
    downloadedAt: string
}

interface DownloadHistoryProps {
    isActive: boolean
}

function DownloadHistory({ isActive }: DownloadHistoryProps) {
    const [history, setHistory] = useState<HistoryItem[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const fetchHistory = useCallback(() => {
        setIsLoading(true)
        window.electronAPI.getHistory()
            .then((data: HistoryItem[]) => {
                // Robust sort handling invalid dates (placing them last or first? usually last if 0)
                const getTime = (d: string) => {
                    const t = new Date(d).getTime()
                    return isNaN(t) ? 0 : t
                }
                const sorted = [...data].sort((a, b) =>
                    getTime(b.downloadedAt) - getTime(a.downloadedAt)
                )
                setHistory(sorted)
            })
            .finally(() => setIsLoading(false))
    }, [])

    useEffect(() => {
        if (isActive) {
            fetchHistory()
        }
    }, [isActive, fetchHistory])

    const handleClearHistory = async () => {
        if (history.length === 0) return
        if (window.confirm('Clear entire download history?')) {
            await window.electronAPI.clearHistory()
            setHistory([])
        }
    }

    const handleShowInFolder = (e: React.MouseEvent, path: string) => {
        e.stopPropagation()
        window.electronAPI.showInFolder(path)
    }

    if (isLoading) {
        return (
            <div className="panel playlist-panel history-panel">
                <div className="playlist-header">
                    <h4 className="panel-title">Download History</h4>
                </div>
                <div style={{ textAlign: 'center', padding: '60px' }}>
                    <span className="spinner" />
                </div>
            </div>
        )
    }

    // New animation delay logic with base wait for view transition
    const getAnimationOverlay = (idx: number) => {
        const baseDelay = 0.3
        const stagger = Math.min(idx * 0.05, 1.0)
        return `${baseDelay + stagger}s`
    }

    return (
        <div className="panel playlist-panel history-panel">
            <div className="playlist-header">
                <h4 className="panel-title">
                    {history.length > 0 && `Download History (${history.length} items)`}
                </h4>
            </div>

            {/* Toolbar for Clear All (only show if there are items) */}
            {history.length > 0 && (
                <div
                    className="playlist-toolbar"
                    style={{
                        marginTop: 0,
                        paddingBottom: '12px',
                        animation: 'staggeredSlideUp 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both'
                    }}
                >
                    <div className="bulk-actions-group">
                        <button
                            className="bulk-btn clear"
                            onClick={handleClearHistory}
                            title="Remove all items from history"
                        >
                            Clear History
                        </button>
                    </div>
                </div>
            )}

            <div className="history-container playlist-items">
                {history.length === 0 ? (
                    <div className="history-empty-card">
                        <div className="empty-content">
                            <div className="empty-icon-wrapper">
                                <span className="empty-icon-main">📂</span>
                            </div>
                            <h3>Your history is empty</h3>
                            <p>Download some music to see your history here.</p>
                        </div>
                    </div>
                ) : (
                    <div className="history-list">
                        {history.map((item, idx) => (
                            <div
                                key={`${item.id}-${idx}`}
                                className="playlist-item history-item"
                                style={{
                                    animation: 'staggeredSlideUp 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both',
                                    animationDelay: getAnimationOverlay(idx)
                                }}
                            >
                                <div className="playlist-item-main">
                                    <img
                                        src={item.thumbnail}
                                        alt={item.title}
                                        className="playlist-thumb square"
                                        loading="lazy"
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).src = 'https://i.ytimg.com/vi/unknown/mqdefault.jpg'
                                        }}
                                    />

                                    <div className="playlist-item-info">
                                        <div className="history-title">{item.title}</div>
                                        <div className="history-meta">
                                            <span className="history-artist">{item.artist}</span>
                                            {item.album && (
                                                <span className="history-album"> • {item.album}</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="playlist-item-right">
                                        <div className="playlist-item-controls">
                                            <button
                                                className="history-show-btn"
                                                onClick={(e) => handleShowInFolder(e, item.path)}
                                                title="Show in Folder"
                                            >
                                                📂
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default DownloadHistory
