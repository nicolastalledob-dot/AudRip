import { useState, useCallback, DragEvent } from 'react'
import { Upload, Trash2, CheckCircle, AlertCircle, FolderOpen } from 'lucide-react'
import '../styles/index.css'

export interface M4AFile {
    id: string
    path: string
    filename: string
    title: string
    artist: string
    album: string
    duration: number
    coverArt: string | null
    selected: boolean
    status: 'idle' | 'converting' | 'complete' | 'error'
    progress: number
}

interface M4AConverterProps {
    isActive: boolean
    outputFolder: string
}

function M4AConverter({ isActive, outputFolder }: M4AConverterProps) {
    const [files, setFiles] = useState<M4AFile[]>([])
    const [isDragging, setIsDragging] = useState(false)
    const [isConverting, setIsConverting] = useState(false)
    const [completedPath, setCompletedPath] = useState<string | null>(null)

    // Handle file drop
    const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        setIsDragging(false)

        const items = Array.from(e.dataTransfer.items)
        const paths: string[] = []

        for (const item of items) {
            if (item.kind === 'file') {
                const file = item.getAsFile()
                if (file) {
                    // Get the actual file path from the File object
                    // In Electron, we can access the path property
                    const filePath = (file as any).path
                    if (filePath) {
                        paths.push(filePath)
                    }
                }
            }
        }

        if (paths.length > 0) {
            await loadFiles(paths)
        }
    }, [])

    // Load files and extract metadata
    const loadFiles = async (paths: string[]) => {
        try {
            const results = await window.electronAPI.scanForM4A(paths)
            const newFiles: M4AFile[] = results.map((file: any) => ({
                id: crypto.randomUUID(),
                path: file.path,
                filename: file.filename,
                title: file.title || file.filename.replace('.m4a', ''),
                artist: file.artist || 'Unknown Artist',
                album: file.album || '',
                duration: file.duration || 0,
                coverArt: file.coverArt,
                selected: true,
                status: 'idle' as const,
                progress: 0
            }))

            setFiles(prev => [...prev, ...newFiles])
        } catch (error) {
            console.error('Failed to load M4A files:', error)
        }
    }

    // Select folder via dialog
    const handleSelectFolder = async () => {
        const folder = await window.electronAPI.selectFolder()
        if (folder) {
            await loadFiles([folder])
        }
    }

    // Select files via dialog  
    const handleSelectFiles = async () => {
        const filePaths = await window.electronAPI.selectM4AFiles()
        if (filePaths && filePaths.length > 0) {
            await loadFiles(filePaths)
        }
    }

    // Toggle file selection
    const toggleFile = (id: string) => {
        setFiles(prev => prev.map(f =>
            f.id === id ? { ...f, selected: !f.selected } : f
        ))
    }

    // Toggle all
    const toggleAll = (selected: boolean) => {
        setFiles(prev => prev.map(f => ({ ...f, selected })))
    }

    // Remove file
    const removeFile = (id: string) => {
        setFiles(prev => prev.filter(f => f.id !== id))
    }

    // Clear all
    const clearAll = () => {
        setFiles([])
        setCompletedPath(null)
    }

    // Convert selected files
    const handleConvert = async () => {
        const selectedFiles = files.filter(f => f.selected && f.status !== 'complete')
        if (selectedFiles.length === 0) return

        setIsConverting(true)
        setCompletedPath(null)

        for (const file of selectedFiles) {
            // Update status to converting
            setFiles(prev => prev.map(f =>
                f.id === file.id ? { ...f, status: 'converting', progress: 0 } : f
            ))

            try {
                const result = await window.electronAPI.convertM4AToMP3({
                    inputPath: file.path,
                    outputFolder: outputFolder || undefined,
                    metadata: {
                        title: file.title,
                        artist: file.artist,
                        album: file.album
                    }
                })

                setFiles(prev => prev.map(f =>
                    f.id === file.id ? { ...f, status: 'complete', progress: 100 } : f
                ))

                setCompletedPath(result.outputPath)
            } catch (error) {
                console.error(`Failed to convert ${file.filename}:`, error)
                setFiles(prev => prev.map(f =>
                    f.id === file.id ? { ...f, status: 'error', progress: 0 } : f
                ))
            }
        }

        setIsConverting(false)
    }

    // Show in folder
    const handleShowInFolder = () => {
        if (completedPath) {
            window.electronAPI.showInFolder(completedPath)
        }
    }

    // Format duration
    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    const selectedCount = files.filter(f => f.selected).length
    const completedCount = files.filter(f => f.status === 'complete').length
    const hasFiles = files.length > 0

    if (!isActive) return null

    return (
        <div className="converter-container">
            {/* Drop Zone / Empty State */}
            {!hasFiles ? (
                <div
                    className={`converter-drop-zone ${isDragging ? 'dragging' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                >
                    <div className="drop-zone-content">
                        <div className="drop-zone-icon">
                            <Upload size={48} strokeWidth={1.5} />
                        </div>
                        <h3>Drop M4A Files Here</h3>
                        <p>or drag entire folders to convert all M4A files</p>
                        <div className="drop-zone-actions">
                            <button className="drop-zone-btn" onClick={handleSelectFiles}>
                                <Upload size={16} /> Select Files
                            </button>
                            <button className="drop-zone-btn secondary" onClick={handleSelectFolder}>
                                <FolderOpen size={16} /> Select Folder
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    {/* File List Header */}
                    <div className="converter-header">
                        <div className="converter-header-left">
                            <label className="playlist-checkbox">
                                <input
                                    type="checkbox"
                                    checked={selectedCount === files.length}
                                    onChange={(e) => toggleAll(e.target.checked)}
                                />
                                <span className="checkmark"></span>
                            </label>
                            <span className="converter-count">
                                {files.length} file{files.length !== 1 ? 's' : ''}
                                {selectedCount < files.length && ` (${selectedCount} selected)`}
                            </span>
                        </div>
                        <div className="converter-header-right">
                            <button
                                className="drop-zone-btn secondary small"
                                onClick={handleSelectFiles}
                                disabled={isConverting}
                            >
                                <Upload size={14} /> Add Files
                            </button>
                            <button
                                className="bulk-btn clear"
                                onClick={clearAll}
                                disabled={isConverting}
                            >
                                Clear All
                            </button>
                        </div>
                    </div>

                    {/* File List with drop support */}
                    <div
                        className={`converter-file-list ${isDragging ? 'dragging' : ''}`}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                    >
                        {files.map((file, index) => (
                            <div
                                key={file.id}
                                className={`converter-file-card ${file.selected ? 'selected' : ''} ${file.status}`}
                                style={{ animationDelay: `${index * 0.05}s` }}
                            >
                                {/* Progress bar */}
                                {file.status === 'converting' && (
                                    <div
                                        className="item-progress-bar"
                                        style={{ width: `${file.progress}%` }}
                                    />
                                )}

                                {/* Status badge */}
                                {file.status === 'complete' && (
                                    <div className="item-status-badge complete">
                                        <CheckCircle size={12} />
                                    </div>
                                )}
                                {file.status === 'error' && (
                                    <div className="item-status-badge error">
                                        <AlertCircle size={12} />
                                    </div>
                                )}

                                <div className="playlist-item-main">
                                    {/* Checkbox */}
                                    <label className="playlist-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={file.selected}
                                            onChange={() => toggleFile(file.id)}
                                            disabled={isConverting}
                                        />
                                        <span className="checkmark"></span>
                                    </label>

                                    {/* Cover Art */}
                                    <div className="playlist-thumb square">
                                        {file.coverArt ? (
                                            <img src={file.coverArt} alt={file.title} />
                                        ) : (
                                            <div className="thumb-placeholder">♪</div>
                                        )}
                                    </div>

                                    {/* Info */}
                                    <div className="playlist-item-info">
                                        <input
                                            className="playlist-title-input"
                                            value={file.title}
                                            onChange={(e) => setFiles(prev => prev.map(f =>
                                                f.id === file.id ? { ...f, title: e.target.value } : f
                                            ))}
                                            disabled={isConverting}
                                        />
                                        <div className="playlist-item-meta">
                                            <input
                                                className="playlist-artist-input"
                                                value={file.artist}
                                                placeholder="Artist"
                                                onChange={(e) => setFiles(prev => prev.map(f =>
                                                    f.id === file.id ? { ...f, artist: e.target.value } : f
                                                ))}
                                                disabled={isConverting}
                                            />
                                            <input
                                                className="playlist-album-input"
                                                value={file.album}
                                                placeholder="Album"
                                                onChange={(e) => setFiles(prev => prev.map(f =>
                                                    f.id === file.id ? { ...f, album: e.target.value } : f
                                                ))}
                                                disabled={isConverting}
                                            />
                                        </div>
                                    </div>

                                    {/* Right side */}
                                    <div className="playlist-item-right">
                                        <span className="playlist-duration">
                                            {formatDuration(file.duration)}
                                        </span>
                                        <button
                                            className="playlist-remove-btn"
                                            onClick={() => removeFile(file.id)}
                                            disabled={isConverting}
                                            title="Remove"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Footer */}
            {hasFiles && (
                <div className="action-footer">
                    {!isConverting && completedCount === 0 ? (
                        <button
                            className="download-button"
                            onClick={handleConvert}
                            disabled={selectedCount === 0}
                            style={{ width: '100%' }}
                        >
                            Convert to MP3 ({selectedCount})
                        </button>
                    ) : isConverting ? (
                        <div style={{ width: '100%', textAlign: 'center' }}>
                            <div style={{
                                color: 'var(--text-secondary)',
                                fontSize: '13px',
                                fontWeight: 500
                            }}>
                                Converting {completedCount} / {selectedCount}
                            </div>
                        </div>
                    ) : (
                        <div className="footer-actions">
                            <button className="secondary-button" onClick={handleShowInFolder}>
                                📂 Show in Folder
                            </button>
                            <button className="download-button" onClick={clearAll}>
                                Done
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default M4AConverter
