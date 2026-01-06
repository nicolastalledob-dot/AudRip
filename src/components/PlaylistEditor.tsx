import { useState, useCallback } from 'react'
import { ArrowDown } from 'lucide-react'
import AudioTrimmer from './AudioTrimmer'
import { PlaylistItem } from '../types'
import '../styles/index.css';

interface PlaylistEditorProps {
    items: PlaylistItem[]
    onUpdateItem: (index: number, updates: Partial<PlaylistItem>) => void
    onRemoveItem: (index: number) => void
    onClearItems: () => void
    onClearSelected: () => void
    onToggleAll: (selected: boolean) => void
    coverArtRatio: '1:1' | '16:9'
}

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
}

function PlaylistEditor({ items, onUpdateItem, onRemoveItem, onClearItems, onClearSelected, onToggleAll, coverArtRatio }: PlaylistEditorProps) {
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
    const [bulkArtist, setBulkArtist] = useState('')
    const [bulkAlbum, setBulkAlbum] = useState('')

    const selectedCount = items.filter(i => i.selected).length


    // Apply artist to all selected items
    const handleApplyBulkArtist = useCallback(() => {
        items.forEach((item, index) => {
            if (item.selected) {
                onUpdateItem(index, {
                    metadata: { ...item.metadata, artist: bulkArtist }
                })
            }
        })
    }, [items, bulkArtist, onUpdateItem])

    // Apply album to all selected items
    const handleApplyBulkAlbum = useCallback(() => {
        items.forEach((item, index) => {
            if (item.selected) {
                onUpdateItem(index, {
                    metadata: { ...item.metadata, album: bulkAlbum }
                })
            }
        })
    }, [items, bulkAlbum, onUpdateItem])

    return (
        <div className="panel playlist-panel">
            <div className="playlist-header">
                <h4 className="panel-title">
                    {items.length > 0 && `Playlist (${selectedCount}/${items.length} selected)`}
                </h4>
                <div className="playlist-actions">
                    {/* Actions here if needed later */}
                </div>
            </div>

            {/* Toolbar: Bulk Actions & Metadata - Only show when items exist */}
            {items.length > 0 && (
                <div
                    className="playlist-toolbar"
                    style={{
                        animation: 'staggeredSlideUp 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both'
                    }}
                >
                    <div className="bulk-actions-group">
                        <button
                            className="bulk-btn"
                            onClick={() => onToggleAll(true)}
                            title="Select All"
                        >
                            Sel. All
                        </button>
                        <button
                            className="bulk-btn"
                            onClick={() => onToggleAll(false)}
                            title="Deselect All"
                        >
                            Desel. All
                        </button>
                        <button
                            className="bulk-btn clear"
                            onClick={onClearSelected}
                            disabled={selectedCount === 0}
                            title="Clear Selected"
                        >
                            Clear Sel.
                        </button>
                        <button
                            className="bulk-btn clear"
                            onClick={onClearItems}
                            disabled={items.length === 0}
                            title="Clear All"
                        >
                            Clear All
                        </button>
                    </div>

                    <div className="bulk-inputs-group">
                        <div className="bulk-input-wrapper">
                            <input
                                type="text"
                                placeholder="Artist for sel..."
                                value={bulkArtist}
                                onChange={(e) => setBulkArtist(e.target.value)}
                                className="bulk-input"
                            />
                            <button
                                className="bulk-btn apply"
                                onClick={handleApplyBulkArtist}
                                disabled={!bulkArtist}
                            >
                                Apply
                            </button>
                        </div>
                        <div className="bulk-input-wrapper">
                            <input
                                type="text"
                                placeholder="Album for sel..."
                                value={bulkAlbum}
                                onChange={(e) => setBulkAlbum(e.target.value)}
                                className="bulk-input"
                            />
                            <button
                                className="bulk-btn apply"
                                onClick={handleApplyBulkAlbum}
                                disabled={!bulkAlbum}
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Items List */}
            <div className="playlist-items">
                {items.length === 0 ? (
                    <div className="history-empty-card">
                        <div className="empty-content">
                            <div className="empty-icon-wrapper">
                                <ArrowDown size={48} className="empty-icon-animated" />
                            </div>
                            <h3>Your Queue is Empty</h3>
                            <p>Paste a link above to start downloading.</p>
                        </div>
                    </div>
                ) : (
                    items.map((item, index) => (
                        <div
                            key={item.id}
                            className={`playlist-item ${item.selected ? 'selected' : ''} ${expandedIndex === index ? 'expanded' : ''} ${item.downloadProgress?.stage === 'complete' ? 'download-complete' : ''} ${item.downloadProgress?.stage === 'error' ? 'download-error' : ''}`}
                            style={{
                                animation: 'staggeredSlideUp 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both',
                                animationDelay: `${index * 0.05}s`
                            }}
                        >
                            {/* Status Badge (Corner Floating) */}
                            {item.downloadProgress?.stage === 'complete' && (
                                <div className="item-status-badge complete" title="Download Complete">✓</div>
                            )}
                            {item.downloadProgress?.stage === 'error' && (
                                <div className="item-status-badge error" title="Download Failed">!</div>
                            )}

                            {/* Per-item download progress indicator */}
                            {item.downloadProgress && item.downloadProgress.stage !== 'idle' && item.downloadProgress.stage !== 'complete' && (
                                <div
                                    className={`item-progress-bar ${item.downloadProgress.stage}`}
                                    style={{ width: `${item.downloadProgress.percent}%` }}
                                />
                            )}

                            {/* Main Row */}
                            <div className="playlist-item-main">
                                <label className="playlist-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={item.selected}
                                        onChange={(e) => onUpdateItem(index, { selected: e.target.checked })}
                                    />
                                    <span className="checkmark" />
                                </label>

                                <img
                                    src={item.albumArt?.imageData || item.thumbnail || 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Crect fill=%27%231a1a2e%27 width=%27100%27 height=%27100%27/%3E%3Ctext x=%2750%27 y=%2765%27 text-anchor=%27middle%27 font-size=%2735%27%3E🎵%3C/text%3E%3C/svg%3E'}
                                    alt={item.title}
                                    className={`playlist-thumb ${coverArtRatio === '1:1' ? 'square' : 'wide'}`}
                                    referrerPolicy="no-referrer"
                                    onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Crect fill=%27%231a1a2e%27 width=%27100%27 height=%27100%27/%3E%3Ctext x=%2750%27 y=%2765%27 text-anchor=%27middle%27 font-size=%2735%27%3E🎵%3C/text%3E%3C/svg%3E' }}
                                />

                                <div className="playlist-item-info">
                                    <input
                                        type="text"
                                        value={item.metadata.title}
                                        onChange={(e) => onUpdateItem(index, {
                                            metadata: { ...item.metadata, title: e.target.value }
                                        })}
                                        className="playlist-title-input"
                                        placeholder="Title"
                                    />
                                    <input
                                        type="text"
                                        value={item.metadata.artist}
                                        onChange={(e) => onUpdateItem(index, {
                                            metadata: { ...item.metadata, artist: e.target.value }
                                        })}
                                        className="playlist-artist-input"
                                        placeholder="Artist"
                                    />
                                    <input
                                        type="text"
                                        value={item.metadata.album}
                                        onChange={(e) => onUpdateItem(index, {
                                            metadata: { ...item.metadata, album: e.target.value }
                                        })}
                                        className="playlist-album-input"
                                        placeholder="Album"
                                    />
                                </div>

                                <div className="playlist-item-right">
                                    {/* Show progress during download, duration otherwise */}
                                    {item.downloadProgress?.stage === 'downloading' || item.downloadProgress?.stage === 'converting' ? (
                                        <span className="item-progress-percent">{Math.round(item.downloadProgress.percent)}%</span>
                                    ) : (
                                        <span className="playlist-duration">{item.duration > 0 ? formatDuration(item.duration) : '—'}</span>
                                    )}
                                    <div className="playlist-item-controls">
                                        <button
                                            className="playlist-remove-btn"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                onRemoveItem(index)
                                            }}
                                            title="Remove from queue"
                                        >
                                            ✕
                                        </button>
                                        <button
                                            className="playlist-expand-btn"
                                            onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                                            title="More options"
                                        >
                                            {expandedIndex === index ? '▲' : '▼'}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Expanded Options */}
                            {expandedIndex === index && (
                                <div className="playlist-item-expanded">
                                    <div className="expanded-grid">
                                        {/* Left: Album Art Preview (Non-editable) */}
                                        <div className="expanded-col-art">
                                            <img
                                                src={item.albumArt?.imageData || item.thumbnail}
                                                alt={item.title}
                                                className="playlist-thumb-large"
                                                style={{ width: '100%', borderRadius: '8px' }}
                                                referrerPolicy="no-referrer"
                                            />
                                        </div>

                                        {/* Right: Metadata & Trim */}
                                        <div className="expanded-col-details">
                                            <div className="expanded-field trim-field">
                                                <AudioTrimmer
                                                    duration={item.duration}
                                                    trimRange={item.trimRange}
                                                    onTrimChange={(range) => onUpdateItem(index, { trimRange: range })}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

export default PlaylistEditor
