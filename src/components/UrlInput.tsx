import { useState, useCallback, KeyboardEvent } from 'react'

interface UrlInputProps {
    onSubmit: (url: string) => void
    isLoading: boolean
    disabled: boolean
}

function UrlInput({ onSubmit, isLoading, disabled }: UrlInputProps) {
    const [url, setUrl] = useState('')

    const handleSubmit = useCallback(() => {
        const trimmedUrl = url.trim()
        if (trimmedUrl && !isLoading && !disabled) {
            onSubmit(trimmedUrl)
        }
    }, [url, isLoading, disabled, onSubmit])

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleSubmit()
        }
    }, [handleSubmit])

    const isValidUrl = url.trim().length > 0 &&
        (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('soundcloud.com'))

    return (
        <div className="panel">
            <div className="url-input-container">
                <input
                    type="text"
                    className="url-input"
                    placeholder="Paste YouTube or SoundCloud URL..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                />
                <button
                    className="url-submit-btn"
                    onClick={handleSubmit}
                    disabled={!isValidUrl || isLoading || disabled}
                >
                    {isLoading ? (
                        <span className="spinner" />
                    ) : (
                        'Get Info'
                    )}
                </button>
            </div>
        </div>
    )
}

export default UrlInput
