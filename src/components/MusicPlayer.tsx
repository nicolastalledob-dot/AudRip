import { useState, useEffect, useRef, useCallback } from 'react'
import { Play as PlayIcon, Pause as PauseIcon, SkipBack as SkipBackIcon, SkipForward as SkipForwardIcon, Volume2 as VolumeIcon, VolumeX as MuteIcon, Music as MusicIcon, Search as SearchIcon, Sparkles as SparklesIcon } from 'lucide-react'

interface Track {
    path: string
    title: string
    artist: string
    album: string
    coverArt: string | null
    duration: number
}

interface MusicPlayerProps {
    isActive: boolean
}

const MarqueeText = ({ text }: { text: string }) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const textRef = useRef<HTMLDivElement>(null)
    const [shouldAnimate, setShouldAnimate] = useState(false)

    useEffect(() => {
        const checkOverflow = () => {
            if (containerRef.current && textRef.current) {
                const contentWidth = textRef.current.children[0]?.clientWidth || 0
                const containerWidth = containerRef.current.clientWidth
                setShouldAnimate(contentWidth > containerWidth)
            }
        }
        checkOverflow()
        const timeout = setTimeout(checkOverflow, 100)
        window.addEventListener('resize', checkOverflow)
        return () => {
            window.removeEventListener('resize', checkOverflow)
            clearTimeout(timeout)
        }
    }, [text])

    return (
        <div className="header-title-wrapper" ref={containerRef}>
            <div className={`marquee-track ${shouldAnimate ? 'animate' : ''}`} ref={textRef}>
                <h2 className="header-title">{text}</h2>
                {shouldAnimate && <h2 className="header-title" aria-hidden="true">{text}</h2>}
            </div>
        </div>
    )
}

export default function MusicPlayer({ isActive }: MusicPlayerProps) {
    const [tracks, setTracks] = useState<Track[]>([])
    const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1)
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [volume, setVolume] = useState(1)
    const [isLoading, setIsLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')

    // --- AUDIO EFFECTS STATE ---
    const [showFx, setShowFx] = useState(false)
    const [isClosing, setIsClosing] = useState(false)
    const [bassLevel, setBassLevel] = useState(0)       // -10 to 15
    const [reverbLevel, setReverbLevel] = useState(0)   // 0 to 3
    const [pitchLevel, setPitchLevel] = useState(1)     // 0.25 to 3
    const [saturationLevel, setSaturationLevel] = useState(0) // 0 to 1
    const [highPassLevel, setHighPassLevel] = useState(0) // 0 to 1 (Freq)
    const [delayLevel, setDelayLevel] = useState(0)     // 0 to 1 (Mix)
    const [stereoWidthLevel, setStereoWidthLevel] = useState(0) // 0 to 1 (Haas Mix)

    const closeFxPanel = () => {
        setIsClosing(true)
        setTimeout(() => {
            setShowFx(false)
            setIsClosing(false)
        }, 200)
    }

    const filteredTracks = tracks.filter(track =>
        track.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        track.artist.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const audioRef = useRef<HTMLAudioElement | null>(null)
    const currentAudioPathRef = useRef<string | null>(null)

    // Web Audio API Refs
    const audioContextRef = useRef<AudioContext | null>(null)
    const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)

    // Nodes
    const highPassNodeRef = useRef<BiquadFilterNode | null>(null)
    const bassNodeRef = useRef<BiquadFilterNode | null>(null)
    const saturationNodeRef = useRef<WaveShaperNode | null>(null)
    const reverbNodeRef = useRef<ConvolverNode | null>(null)
    const delayNodeRef = useRef<DelayNode | null>(null)
    const delayGainNodeRef = useRef<GainNode | null>(null)

    // Gains
    const dryGainNodeRef = useRef<GainNode | null>(null)
    const wetGainNodeRef = useRef<GainNode | null>(null) // Reverb
    const stereoWidthGainNodeRef = useRef<GainNode | null>(null) // Haas

    const currentTrack = currentTrackIndex >= 0 ? tracks[currentTrackIndex] : null

    // Helper: Create Reverb Impulse
    const createReverbImpulse = (ctx: AudioContext) => {
        const duration = 2.5
        const decay = 2.0
        const sampleRate = ctx.sampleRate
        const length = sampleRate * duration
        const impulse = ctx.createBuffer(2, length, sampleRate)
        const left = impulse.getChannelData(0)
        const right = impulse.getChannelData(1)
        for (let i = 0; i < length; i++) {
            const n = i / length
            left[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, decay)
            right[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, decay)
        }
        return impulse
    }

    // Helper: Saturation Curve
    const makeSaturationCurve = (amount: number) => {
        const k = amount * 100
        const n_samples = 44100
        const curve = new Float32Array(n_samples)
        const deg = Math.PI / 180
        if (amount === 0) {
            for (let i = 0; i < n_samples; ++i) curve[i] = i * 2 / n_samples - 1
            return curve
        }
        for (let i = 0; i < n_samples; ++i) {
            const x = i * 2 / n_samples - 1
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x))
        }
        return curve
    }

    // Init Audio Context
    const initAudioContext = useCallback(() => {
        if (audioContextRef.current || !audioRef.current) return

        console.log("AudioFX: Initializing Context...")

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        const ctx = new AudioContextClass()
        audioContextRef.current = ctx

        // --- Create Nodes ---
        const source = ctx.createMediaElementSource(audioRef.current)

        // 1. High Pass (Radio Effect)
        const highPass = ctx.createBiquadFilter()
        highPass.type = 'highpass'
        highPass.frequency.value = 0 // Start open (no cut)

        // 2. Bass (Tone)
        const bassFilter = ctx.createBiquadFilter()
        bassFilter.type = 'lowshelf'
        bassFilter.frequency.value = 200

        // 3. Saturation (Drive)
        const saturationShaper = ctx.createWaveShaper()
        saturationShaper.curve = makeSaturationCurve(0)
        saturationShaper.oversample = '4x'

        // 4. Reverb (Space)
        const reverbConvolver = ctx.createConvolver()
        reverbConvolver.buffer = createReverbImpulse(ctx)

        // 5. Delay (Echo)
        const delay = ctx.createDelay(1.0)
        delay.delayTime.value = 0.35 // 350ms echo
        const delayFeedback = ctx.createGain()
        delayFeedback.gain.value = 0.4 // 40% feedback
        const delayWetGain = ctx.createGain()
        delayWetGain.gain.value = 0

        // 6. Stereo Width (Haas Effect)
        // We split channels, delay Right by ~15ms, then merge.
        const widthSplitter = ctx.createChannelSplitter(2)
        const widthDelay = ctx.createDelay()
        widthDelay.delayTime.value = 0.015 // 15ms Haas
        const widthMerger = ctx.createChannelMerger(2)
        const widthGain = ctx.createGain()
        widthGain.gain.value = 0

        // Master Dry
        const dryGain = ctx.createGain()
        dryGain.gain.value = 1
        const wetGain = ctx.createGain() // Reverb level
        wetGain.gain.value = 0

        // --- Routing ---
        // Chain: Source -> HighPass -> Bass -> Saturation -> HUB
        source.connect(highPass)
        highPass.connect(bassFilter)
        bassFilter.connect(saturationShaper)

        const hub = saturationShaper // The processed "dry signal" hub

        // Path A: Dry Output
        hub.connect(dryGain)
        dryGain.connect(ctx.destination)

        // Path B: Reverb
        hub.connect(reverbConvolver)
        reverbConvolver.connect(wetGain)
        wetGain.connect(ctx.destination)

        // Path C: Delay
        hub.connect(delay)
        delay.connect(delayFeedback)
        delayFeedback.connect(delay) // Loop
        delay.connect(delayWetGain)
        delayWetGain.connect(ctx.destination)

        // Path D: Stereo Width (Haas Side-chain)
        hub.connect(widthSplitter)
        // Left goes direct to merger (ch 0)
        widthSplitter.connect(widthMerger, 0, 0)
        // Right goes through delay then to merger (ch 1)
        widthSplitter.connect(widthDelay, 1)
        widthDelay.connect(widthMerger, 0, 1)

        widthMerger.connect(widthGain)
        widthGain.connect(ctx.destination)


        // Store Refs
        sourceNodeRef.current = source
        highPassNodeRef.current = highPass
        bassNodeRef.current = bassFilter
        saturationNodeRef.current = saturationShaper
        reverbNodeRef.current = reverbConvolver
        delayNodeRef.current = delay
        delayGainNodeRef.current = delayWetGain

        dryGainNodeRef.current = dryGain
        wetGainNodeRef.current = wetGain
        stereoWidthGainNodeRef.current = widthGain

        // Apply Initial Values
        bassFilter.gain.value = bassLevel
        saturationShaper.curve = makeSaturationCurve(saturationLevel)
        dryGain.gain.value = 1
        wetGain.gain.value = reverbLevel
        highPass.frequency.value = highPassLevel * 2000 // Map 0-1 to 0-2000Hz
        delayWetGain.gain.value = delayLevel
        widthGain.gain.value = stereoWidthLevel

        console.log("AudioFX: Graph Connected successfully")
    }, [])

    // Initialize Audio Engine
    useEffect(() => {
        if (isPlaying && !audioContextRef.current) {
            initAudioContext()
        }
    }, [isPlaying, initAudioContext])


    // --- UPDATERS ---

    // High Pass (Radio)
    useEffect(() => {
        if (highPassNodeRef.current && audioContextRef.current) {
            // Map 0-1 to 20Hz - 3000Hz exponentially better, but linear is fine for radio effect
            // Let's do: 0 = 0Hz, 1 = 3000Hz
            const freq = highPassLevel * 3000
            highPassNodeRef.current.frequency.setTargetAtTime(freq, audioContextRef.current.currentTime, 0.1)
        }
    }, [highPassLevel])

    // Bass
    useEffect(() => {
        if (bassNodeRef.current && audioContextRef.current) {
            bassNodeRef.current.gain.setTargetAtTime(bassLevel, audioContextRef.current.currentTime, 0.1)
        }
    }, [bassLevel])

    // Saturation
    useEffect(() => {
        if (saturationNodeRef.current) {
            saturationNodeRef.current.curve = makeSaturationCurve(saturationLevel)
        }
    }, [saturationLevel])

    // Delay
    useEffect(() => {
        if (delayGainNodeRef.current && audioContextRef.current) {
            delayGainNodeRef.current.gain.setTargetAtTime(delayLevel, audioContextRef.current.currentTime, 0.1)
        }
    }, [delayLevel])

    // Stereo Width
    useEffect(() => {
        if (stereoWidthGainNodeRef.current && audioContextRef.current) {
            stereoWidthGainNodeRef.current.gain.setTargetAtTime(stereoWidthLevel, audioContextRef.current.currentTime, 0.1)
            // Compensate Dry to avoid doubling volume? No, Haas is an effect layer.
        }
    }, [stereoWidthLevel])

    // Reverb
    useEffect(() => {
        if (wetGainNodeRef.current && audioContextRef.current) {
            wetGainNodeRef.current.gain.setTargetAtTime(reverbLevel, audioContextRef.current.currentTime, 0.1)
        }
    }, [reverbLevel])

    // Pitch
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.playbackRate = pitchLevel
            // @ts-ignore
            if (audioRef.current.mozPreservesPitch !== undefined) audioRef.current.mozPreservesPitch = false;
            // @ts-ignore
            if (audioRef.current.webkitPreservesPitch !== undefined) audioRef.current.webkitPreservesPitch = false;
            // @ts-ignore
            audioRef.current.preservesPitch = false;
        }
    }, [pitchLevel])


    // Load tracks
    const loadTracks = useCallback(async () => {
        setIsLoading(true)
        try {
            // @ts-ignore
            const loadedTracks = await (window.electronAPI as any).getMusicLibrary()
            setTracks(prevTracks => {
                if (prevTracks.length > 0 && currentTrackIndex >= 0) {
                    const currentPath = prevTracks[currentTrackIndex].path
                    const newIndex = loadedTracks.findIndex((t: Track) => t.path === currentPath)
                    if (newIndex !== -1 && newIndex !== currentTrackIndex) {
                        setCurrentTrackIndex(newIndex)
                    }
                }
                return loadedTracks
            })
            if (loadedTracks.length > 0 && currentTrackIndex === -1) {
                setCurrentTrackIndex(0)
            }
        } catch (error) {
            console.error('Failed to load tracks:', error)
        } finally {
            setIsLoading(false)
        }
    }, [currentTrackIndex])

    useEffect(() => {
        if (isActive) loadTracks()
    }, [isActive])

    // Audio Elements Events
    useEffect(() => {
        const audio = new Audio()
        audio.crossOrigin = "anonymous" // IMPORTANT for Web Audio API
        audioRef.current = audio
        // Connect audio element immediately if strict context needed, but usually on play is fine.

        audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime))
        audio.addEventListener('loadedmetadata', () => setDuration(audio.duration))
        audio.addEventListener('play', () => setIsPlaying(true))
        audio.addEventListener('pause', () => setIsPlaying(false))

        // Handle Auto Next
        const handleEnded = () => {
            setTracks(currentTracks => {
                setCurrentTrackIndex(idx => {
                    if (currentTracks.length === 0) return -1
                    return (idx + 1) % currentTracks.length
                })
                return currentTracks
            })
        }
        audio.addEventListener('ended', handleEnded)

        return () => {
            audio.pause()
            audio.removeEventListener('ended', handleEnded)
            audio.src = ''
        }
    }, [])

    // Load Source when track changes
    useEffect(() => {
        if (currentTrack && audioRef.current) {
            if (currentAudioPathRef.current === currentTrack.path) return

            const audio = audioRef.current
            audio.src = `media://${currentTrack.path}`
            currentAudioPathRef.current = currentTrack.path
            audio.load()

            // Re-apply pitch on every track load as it resets
            audio.playbackRate = pitchLevel

            if (isPlaying) {
                audio.play().catch(console.error)
            }
        }
    }, [currentTrack])

    // Volume
    useEffect(() => {
        if (audioRef.current) audioRef.current.volume = volume
    }, [volume])


    const handlePlayPause = () => {
        if (!audioRef.current || !currentTrack) return
        if (audioContextRef.current?.state === 'suspended') {
            audioContextRef.current.resume()
        }
        if (isPlaying) audioRef.current.pause()
        else audioRef.current.play().catch(console.error)
    }

    const handleNext = () => {
        setTracks(currentTracks => {
            setCurrentTrackIndex(idx => (idx + 1) % currentTracks.length)
            return currentTracks
        })
    }

    const handlePrevious = () => {
        if (tracks.length === 0) return
        if (audioRef.current && audioRef.current.currentTime > 3) {
            audioRef.current.currentTime = 0
            return
        }
        setTracks(currentTracks => {
            setCurrentTrackIndex(idx => idx === 0 ? currentTracks.length - 1 : idx - 1)
            return currentTracks
        })
    }

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!audioRef.current || duration === 0) return
        const rect = e.currentTarget.getBoundingClientRect()
        const percent = (e.clientX - rect.left) / rect.width
        audioRef.current.currentTime = percent * duration
    }

    const handleTrackSelect = (track: Track) => {
        const index = tracks.findIndex(t => t.path === track.path)
        if (index !== -1) {
            setCurrentTrackIndex(index)
            setIsPlaying(true)
        }
    }

    const formatTime = (seconds: number) => {
        if (!seconds || isNaN(seconds)) return '0:00'
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    if (isLoading) {
        return (
            <div className="music-player">
                <div className="player-loading">
                    <div className="loading-spinner"></div>
                    <p>Loading music library...</p>
                </div>
            </div>
        )
    }

    if (tracks.length === 0) {
        return (
            <div className="music-player">
                <div className="player-empty">
                    <div className="empty-icon-wrapper">
                        <MusicIcon size={64} className="empty-icon-main" strokeWidth={1} style={{ opacity: 0.5 }} />
                    </div>
                    <h3>No Music Yet</h3>
                    <p>Download some music to start listening.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="music-player">
            <div className="player-background" style={{
                backgroundImage: currentTrack?.coverArt ? `url(${currentTrack.coverArt})` : 'none'
            }} />

            <div className="player-main-content">
                <div className="player-left-side">
                    <div className="now-playing-art-large">
                        {currentTrack?.coverArt ? (
                            <img src={currentTrack.coverArt} alt="Album Art" />
                        ) : (
                            <div className="no-art">
                                <MusicIcon size={80} strokeWidth={1} style={{ opacity: 0.3 }} />
                            </div>
                        )}



                        {/* FX Panel Overlay */}

                    </div>
                </div>

                <div className="player-right-side">
                    <div className="current-track-header">
                        <MarqueeText text={currentTrack?.title || 'AudRip Player'} />
                        <p className="header-artist">{currentTrack?.artist || 'Select a track to play'}</p>
                        <p className="header-album">{currentTrack?.album || 'Local Library'}</p>
                    </div>

                    <div className="library-search-container">
                        <SearchIcon size={16} className="search-icon" />
                        <input
                            type="text"
                            placeholder="Search library..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="search-input-minimal"
                        />
                    </div>

                    <div className="player-tracklist">
                        <div className="tracklist-scroll">
                            {filteredTracks.map((track, index) => {
                                const isActive = currentTrack && track.path === currentTrack.path
                                return (
                                    <div
                                        key={track.path}
                                        className={`track-item ${isActive ? 'active' : ''}`}
                                        onClick={() => handleTrackSelect(track)}
                                    >
                                        <div className="track-index">
                                            {isActive && isPlaying ? (
                                                <div className="mini-equalizer">
                                                    <span></span><span></span><span></span>
                                                </div>
                                            ) : (
                                                <span className="index-number">{index + 1}</span>
                                            )}
                                        </div>
                                        <div className="track-info">
                                            <span className="track-title">{track.title}</span>
                                        </div>
                                        <span className="track-duration">{formatTime(track.duration)}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>

                {showFx && (
                    <div
                        className={`fx-panel-overlay ${isClosing ? 'fade-out' : ''}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            closeFxPanel();
                        }}
                    >
                        {/* Stop propagation on this container so sliders work without closing */}
                        <div className="fx-controls-container" onClick={(e) => e.stopPropagation()}>
                            <div className="fx-row">
                                <label>Bass Boost</label>
                                <input
                                    type="range" min="-10" max="15" step="0.5"
                                    value={bassLevel}
                                    onChange={(e) => setBassLevel(parseFloat(e.target.value))}
                                    title={bassLevel.toString()}
                                />
                            </div>
                            <div className="fx-row">
                                <label>Reverb</label>
                                <input
                                    type="range" min="0" max="3" step="0.05"
                                    value={reverbLevel}
                                    onChange={(e) => setReverbLevel(parseFloat(e.target.value))}
                                    title={Math.round(reverbLevel * 100) + '%'}
                                />
                            </div>
                            <div className="fx-row">
                                <label>Speed / Pitch</label>
                                <input
                                    type="range" min="0.25" max="3.0" step="0.01"
                                    value={pitchLevel}
                                    onChange={(e) => setPitchLevel(parseFloat(e.target.value))}
                                    title={pitchLevel + 'x'}
                                />
                            </div>
                            <div className="fx-row">
                                <label>Saturation</label>
                                <input
                                    type="range" min="0" max="1" step="0.01"
                                    value={saturationLevel}
                                    onChange={(e) => setSaturationLevel(parseFloat(e.target.value))}
                                    title={(saturationLevel * 100).toFixed(0) + '%'}
                                />
                            </div>
                            <div className="fx-row">
                                <label>Radio Filter</label>
                                <input
                                    type="range" min="0" max="1" step="0.01"
                                    value={highPassLevel}
                                    onChange={(e) => setHighPassLevel(parseFloat(e.target.value))}
                                    title={(highPassLevel * 100).toFixed(0) + '%'}
                                />
                            </div>
                            <div className="fx-row">
                                <label>Echo</label>
                                <input
                                    type="range" min="0" max="1" step="0.01"
                                    value={delayLevel}
                                    onChange={(e) => setDelayLevel(parseFloat(e.target.value))}
                                    title={(delayLevel * 100).toFixed(0) + '%'}
                                />
                            </div>
                            <div className="fx-row">
                                <label>Spatial</label>
                                <input
                                    type="range" min="0" max="1" step="0.01"
                                    value={stereoWidthLevel}
                                    onChange={(e) => setStereoWidthLevel(parseFloat(e.target.value))}
                                    title={(stereoWidthLevel * 100).toFixed(0) + '%'}
                                />
                            </div>
                            <div className="fx-reset">
                                <button onClick={() => {
                                    setBassLevel(0); setReverbLevel(0); setPitchLevel(1); setSaturationLevel(0);
                                    setHighPassLevel(0); setDelayLevel(0); setStereoWidthLevel(0);
                                }}>Reset</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="player-bottom-bar">
                <div className="progress-area" onClick={handleSeek}>
                    <div className="progress-fill" style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }} />
                </div>

                <div className="controls-row">
                    <div className="controls-left">
                        <span className="time-display">{formatTime(currentTime)} / {formatTime(duration)}</span>
                    </div>

                    <div className="controls-center">
                        <button
                            className={`control-btn ${showFx ? 'active-fx-btn' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (showFx) closeFxPanel();
                                else setShowFx(true);
                            }}
                            title="Audio Effects"
                            style={{ color: showFx ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
                        >
                            <SparklesIcon size={18} />
                        </button>

                        <button className="control-btn" onClick={handlePrevious} title="Previous">
                            <SkipBackIcon size={20} fill="currentColor" />
                        </button>
                        <button className="control-btn play-btn" onClick={handlePlayPause}>
                            {isPlaying ? <PauseIcon size={28} fill="currentColor" /> : <PlayIcon size={28} fill="currentColor" className="ml-1" />}
                        </button>
                        <button className="control-btn" onClick={handleNext} title="Next">
                            <SkipForwardIcon size={20} fill="currentColor" />
                        </button>
                        {/* Dummy button to balance the layout so Play is exactly centered */}
                        <div className="control-btn" style={{ visibility: 'hidden', pointerEvents: 'none' }} aria-hidden="true" />
                    </div>

                    <div className="controls-right">
                        <div className="volume-control">
                            <button className="volume-btn-icon" onClick={() => setVolume(v => v === 0 ? 1 : 0)}>
                                {volume === 0 ? <MuteIcon size={16} /> : <VolumeIcon size={16} />}
                            </button>
                            <input
                                type="range"
                                min="0" max="1" step="0.01"
                                value={volume}
                                onChange={(e) => setVolume(parseFloat(e.target.value))}
                                className="volume-slider"
                                style={{
                                    background: `linear-gradient(to right, var(--accent-primary) ${volume * 100}%, rgba(255, 255, 255, 0.1) ${volume * 100}%)`
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
