import { FolderOpen, RotateCcw, Sun, Moon, X } from 'lucide-react'
import '../styles/index.css'

export const DEFAULT_ACCENT_COLOR = '#00ff88'

export interface Settings {
    format: 'mp3' | 'm4a'
    coverArtRatio: '1:1' | '16:9'
    // Folder paths
    downloadFolder: string      // YouTube/SoundCloud downloads
    musicPlayerFolder: string   // Music Player library scan
    mp3OutputFolder: string     // MP3 conversion output
    // Appearance
    accentColor: string
    theme: 'dark' | 'light'
}

interface SettingsModalProps {
    settings: Settings
    onUpdateSettings: (settings: Settings) => void
    onClose: () => void
}

function SettingsModal({ settings, onUpdateSettings, onClose }: SettingsModalProps) {
    const handleSelectFolder = async (key: 'downloadFolder' | 'musicPlayerFolder' | 'mp3OutputFolder') => {
        const folder = await window.electronAPI.selectFolder()
        if (folder) {
            onUpdateSettings({ ...settings, [key]: folder })
        }
    }

    const formatPath = (path: string) => {
        if (!path) return 'Not set'
        // Shorten long paths for display
        const parts = path.split('/')
        if (parts.length > 3) {
            return `.../${parts.slice(-2).join('/')}`
        }
        return path
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Settings</h2>
                    <button className="close-btn" onClick={onClose}><X size={16} /></button>
                </div>

                <div className="modal-body">
                    {/* Appearance */}
                    <div className="setting-group">
                        <label>Appearance</label>

                        <div className="setting-color-row">
                            <span className="color-label">Theme</span>
                            <div className="setting-options" style={{ flex: 'unset' }}>
                                <button
                                    className={`setting-opt theme-opt ${settings.theme === 'dark' ? 'active' : ''}`}
                                    onClick={() => onUpdateSettings({ ...settings, theme: 'dark' })}
                                >
                                    <Moon size={14} />
                                    Dark
                                </button>
                                <button
                                    className={`setting-opt theme-opt ${settings.theme === 'light' ? 'active' : ''}`}
                                    onClick={() => onUpdateSettings({ ...settings, theme: 'light' })}
                                >
                                    <Sun size={14} />
                                    Light
                                </button>
                            </div>
                        </div>

                        <div className="setting-color-row">
                            <span className="color-label">Accent Color</span>
                            <div className="color-picker-container">
                                <input
                                    type="color"
                                    className="color-input"
                                    value={settings.accentColor || DEFAULT_ACCENT_COLOR}
                                    onChange={e => onUpdateSettings({ ...settings, accentColor: e.target.value })}
                                />
                                {settings.accentColor && settings.accentColor !== DEFAULT_ACCENT_COLOR && (
                                    <button
                                        className="color-reset-btn"
                                        onClick={() => onUpdateSettings({ ...settings, accentColor: DEFAULT_ACCENT_COLOR })}
                                        title="Reset to default"
                                    >
                                        <RotateCcw size={14} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Audio Format */}
                    <div className="setting-group">
                        <label>Audio Format</label>
                        <div className="setting-options">
                            <button
                                className={`setting-opt ${settings.format === 'mp3' ? 'active' : ''}`}
                                onClick={() => onUpdateSettings({ ...settings, format: 'mp3' })}
                            >
                                MP3
                            </button>
                            <button
                                className={`setting-opt ${settings.format === 'm4a' ? 'active' : ''}`}
                                onClick={() => onUpdateSettings({ ...settings, format: 'm4a' })}
                            >
                                M4A
                            </button>
                        </div>
                    </div>

                    {/* Cover Art Ratio */}
                    <div className="setting-group">
                        <label>Cover Art Aspect Ratio</label>
                        <div className="setting-options">
                            <button
                                className={`setting-opt ${settings.coverArtRatio === '1:1' ? 'active' : ''}`}
                                onClick={() => onUpdateSettings({ ...settings, coverArtRatio: '1:1' })}
                            >
                                Square (1:1)
                            </button>
                            <button
                                className={`setting-opt ${settings.coverArtRatio === '16:9' ? 'active' : ''}`}
                                onClick={() => onUpdateSettings({ ...settings, coverArtRatio: '16:9' })}
                            >
                                Original (16:9)
                            </button>
                        </div>
                        <p className="setting-desc">Determines how the cover art is embedded in the audio file.</p>
                    </div>

                    {/* Folder Settings */}
                    <div className="setting-group">
                        <label>Folders</label>

                        <div className="setting-folder-row">
                            <span className="folder-label">Downloads</span>
                            <div className="folder-path-container">
                                <span className="folder-path" title={settings.downloadFolder || 'Not set'}>
                                    {formatPath(settings.downloadFolder)}
                                </span>
                                <button
                                    className="folder-picker-btn"
                                    onClick={() => handleSelectFolder('downloadFolder')}
                                    title="Choose folder"
                                >
                                    <FolderOpen size={16} />
                                </button>
                            </div>
                        </div>

                        <div className="setting-folder-row">
                            <span className="folder-label">Music Library</span>
                            <div className="folder-path-container">
                                <span className="folder-path" title={settings.musicPlayerFolder || 'Not set'}>
                                    {formatPath(settings.musicPlayerFolder)}
                                </span>
                                <button
                                    className="folder-picker-btn"
                                    onClick={() => handleSelectFolder('musicPlayerFolder')}
                                    title="Choose folder"
                                >
                                    <FolderOpen size={16} />
                                </button>
                            </div>
                        </div>

                        <div className="setting-folder-row">
                            <span className="folder-label">MP3 Output</span>
                            <div className="folder-path-container">
                                <span className="folder-path" title={settings.mp3OutputFolder || 'Not set'}>
                                    {formatPath(settings.mp3OutputFolder)}
                                </span>
                                <button
                                    className="folder-picker-btn"
                                    onClick={() => handleSelectFolder('mp3OutputFolder')}
                                    title="Choose folder"
                                >
                                    <FolderOpen size={16} />
                                </button>
                            </div>
                        </div>

                        <p className="setting-desc">Configure where files are saved and loaded from.</p>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default SettingsModal
