import '../styles/index.css'

export interface Settings {
    format: 'mp3' | 'm4a'
    coverArtRatio: '1:1' | '16:9'
}

interface SettingsModalProps {
    settings: Settings
    onUpdateSettings: (settings: Settings) => void
    onClose: () => void
}

function SettingsModal({ settings, onUpdateSettings, onClose }: SettingsModalProps) {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Settings</h2>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>

                <div className="modal-body">
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
                </div>
            </div>
        </div>
    )
}

export default SettingsModal
