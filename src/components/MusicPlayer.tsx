import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

// ... existing imports ...
import { Play as PlayIcon, Pause as PauseIcon, SkipBack as SkipBackIcon, SkipForward as SkipForwardIcon, Volume2 as VolumeIcon, VolumeX as MuteIcon, Music as MusicIcon, Search as SearchIcon, Sparkles as SparklesIcon, MoreHorizontal as MoreIcon, ListMusic as PlaylistIcon, Plus as PlusIcon, X as CloseIcon, ArrowLeft as BackIcon, Trash2 as TrashIcon, Upload as UploadIcon, Edit2 as EditIcon, Shuffle as ShuffleIcon, Repeat as RepeatIcon, Repeat1 as Repeat1Icon, Minus as MinusIcon, ArrowUpDown as SortIcon, Save as SaveIcon } from 'lucide-react'
import { Track } from '../types'

interface Playlist {
    id: string
    name: string
    description: string
    coverArt: string | null
    trackPaths: string[]
    createdAt: number
    updatedAt: number
}

interface MusicPlayerProps {
    isActive: boolean
    initialTracks?: Track[]
    onRefreshTracks?: () => Promise<Track[]>
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
        <div className={`header-title-wrapper ${shouldAnimate ? 'mask-enabled' : ''}`} ref={containerRef}>
            <div className={`marquee-track ${shouldAnimate ? 'animate' : ''}`} ref={textRef}>
                <h2 className="header-title">{text}</h2>
                {shouldAnimate && <h2 className="header-title" aria-hidden="true">{text}</h2>}
            </div>
        </div>
    )
}

export default function MusicPlayer({ isActive, initialTracks, onRefreshTracks }: MusicPlayerProps) {
    const [tracks, setTracks] = useState<Track[]>(initialTracks || [])
    const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1)
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [volume, setVolume] = useState(1)
    const [isLoading, setIsLoading] = useState(!initialTracks || initialTracks.length === 0)
    const [searchTerm, setSearchTerm] = useState('')

    // --- PLAYLIST STATE ---
    const [playlists, setPlaylists] = useState<Playlist[]>([])

    const [showPlaylistBrowser, setShowPlaylistBrowser] = useState(false)
    const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null)
    const [showPlaylistModal, setShowPlaylistModal] = useState(false)
    const [trackToAddToPlaylist, setTrackToAddToPlaylist] = useState<Track | null>(null)
    const [trackMenuOpen, setTrackMenuOpen] = useState<string | null>(null) // track path
    const [menuPosition, setMenuPosition] = useState<{ x: number, y: number } | null>(null)
    const [isClosingBrowser, setIsClosingBrowser] = useState(false)
    const [newPlaylistImage, setNewPlaylistImage] = useState<string | null>(null)
    const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null)
    const [isDraggingImage, setIsDraggingImage] = useState(false)
    const [isScrubbing, setIsScrubbing] = useState(false)
    const [scrubTime, setScrubTime] = useState(0)
    // --- PLAYBACK CONTROL STATE ---
    const [isShuffle, setIsShuffle] = useState(false)
    const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>('all')
    const shuffleHistoryRef = useRef<number[]>([])
    const [sortBy, setSortBy] = useState<'default' | 'title' | 'artist' | 'duration' | 'recent'>('default')


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

    // --- FX PRESETS STATE ---
    interface FxPreset {
        id: string
        name: string
        bass: number
        reverb: number
        pitch: number
        saturation: number
        highPass: number
        delay: number
        stereoWidth: number
    }
    const [fxPresets, setFxPresets] = useState<FxPreset[]>([])
    const [activePresetId, setActivePresetId] = useState<string | null>(null)
    const [showPresetNameModal, setShowPresetNameModal] = useState(false)
    const [presetNameInput, setPresetNameInput] = useState('')

    const loadFxPresets = useCallback(async () => {
        try {
            const presets = await (window.electronAPI as any).getFxPresets()
            setFxPresets(presets)
        } catch (error) {
            console.error('Failed to load FX presets:', error)
        }
    }, [])

    const applyPreset = (preset: FxPreset) => {
        setBassLevel(preset.bass)
        setReverbLevel(preset.reverb)
        setPitchLevel(preset.pitch)
        setSaturationLevel(preset.saturation)
        setHighPassLevel(preset.highPass)
        setDelayLevel(preset.delay)
        setStereoWidthLevel(preset.stereoWidth)
        setActivePresetId(preset.id)
    }

    const handleSavePreset = async () => {
        setPresetNameInput('')
        setShowPresetNameModal(true)
    }

    const confirmSavePreset = async () => {
        const name = presetNameInput.trim()
        if (!name) return

        const preset: FxPreset = {
            id: activePresetId || Date.now().toString() + Math.random().toString(36).slice(2),
            name,
            bass: bassLevel,
            reverb: reverbLevel,
            pitch: pitchLevel,
            saturation: saturationLevel,
            highPass: highPassLevel,
            delay: delayLevel,
            stereoWidth: stereoWidthLevel
        }

        try {
            const result = await (window.electronAPI as any).saveFxPreset(preset)
            if (result.success) {
                setFxPresets(result.presets)
                setActivePresetId(preset.id)
            }
        } catch (error) {
            console.error('Failed to save FX preset:', error)
        }
        setShowPresetNameModal(false)
        setPresetNameInput('')
    }

    const handleDeletePreset = async () => {
        if (!activePresetId) return
        try {
            const result = await (window.electronAPI as any).deleteFxPreset(activePresetId)
            if (result.success) {
                setFxPresets(result.presets)
                setActivePresetId(null)
            }
        } catch (error) {
            console.error('Failed to delete FX preset:', error)
        }
    }

    // Mark preset as custom when any slider changes
    const markCustom = () => setActivePresetId(null)

    const closeFxPanel = () => {
        setIsClosing(true)
        setTimeout(() => {
            setShowFx(false)
            setIsClosing(false)
        }, 200)
    }

    // Get tracks for current view (all library or active playlist), sorted
    const getDisplayTracks = useCallback(() => {
        let result = activePlaylist
            ? tracks.filter(t => activePlaylist.trackPaths.includes(t.path))
            : [...tracks]

        if (sortBy === 'title') {
            result.sort((a, b) => a.title.localeCompare(b.title))
        } else if (sortBy === 'artist') {
            result.sort((a, b) => a.artist.localeCompare(b.artist))
        } else if (sortBy === 'duration') {
            result.sort((a, b) => a.duration - b.duration)
        } else if (sortBy === 'recent') {
            result.reverse()
        }

        return result
    }, [tracks, activePlaylist, sortBy])

    // Sync tracks when initialTracks prop changes (preloaded from parent)
    useEffect(() => {
        if (!initialTracks || initialTracks.length === 0) return

        setTracks(prevTracks => {
            // Skip update if track list hasn't actually changed
            if (prevTracks.length === initialTracks.length &&
                prevTracks.every((t, i) => t.path === initialTracks[i].path)) {
                return prevTracks
            }

            // Preserve current track position
            if (prevTracks.length > 0 && currentTrackIndex >= 0) {
                const currentPath = prevTracks[currentTrackIndex]?.path
                const newIndex = initialTracks.findIndex(t => t.path === currentPath)
                if (newIndex !== -1 && newIndex !== currentTrackIndex) {
                    setCurrentTrackIndex(newIndex)
                }
            }
            return initialTracks
        })
        setIsLoading(false)
        if (currentTrackIndex === -1 && initialTracks.length > 0) {
            setCurrentTrackIndex(0)
        }
    }, [initialTracks])

    const filteredTracks = getDisplayTracks().filter(track =>
        track.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        track.artist.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const audioRef = useRef<HTMLAudioElement | null>(null)
    const currentAudioPathRef = useRef<string | null>(null)
    const shouldAutoPlayRef = useRef<boolean>(false) // Track if we should auto-play next track

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
            let loadedTracks: Track[]
            if (onRefreshTracks) {
                loadedTracks = await onRefreshTracks()
            } else {
                // @ts-ignore
                loadedTracks = await (window.electronAPI as any).getMusicLibrary()
            }
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
            shuffleHistoryRef.current = []
            if (loadedTracks.length > 0 && currentTrackIndex === -1) {
                setCurrentTrackIndex(0)
            }
        } catch (error) {
            console.error('Failed to load tracks:', error)
        } finally {
            setIsLoading(false)
        }
    }, [currentTrackIndex, onRefreshTracks])

    // Load playlists
    const loadPlaylists = useCallback(async () => {
        try {
            // @ts-ignore
            const loadedPlaylists = await (window.electronAPI as any).getPlaylists()
            setPlaylists(loadedPlaylists)
        } catch (error) {
            console.error('Failed to load playlists:', error)
        }
    }, [])

    // Add track to playlist
    const handleAddToPlaylist = async (trackPath: string, playlistId: string) => {
        try {
            // @ts-ignore
            const result = await (window.electronAPI as any).addTrackToPlaylist(playlistId, trackPath)
            if (result.success) {
                await loadPlaylists() // Refresh playlists
            }
        } catch (error) {
            console.error('Failed to add track to playlist:', error)
        }
        setTrackMenuOpen(null)
    }

    // Remove track from playlist
    const handleRemoveFromPlaylist = async (trackPath: string) => {
        if (!activePlaylist) return

        // Show confirmation before removing
        if (!window.confirm('Remove this track from the playlist?')) {
            setTrackMenuOpen(null)
            return
        }

        try {
            // @ts-ignore
            const result = await (window.electronAPI as any).removeTrackFromPlaylist(activePlaylist.id, trackPath)
            if (result.success) {
                await loadPlaylists()
                // Update active playlist with removed track
                setActivePlaylist(prev => prev ? {
                    ...prev,
                    trackPaths: prev.trackPaths.filter(p => p !== trackPath)
                } : null)
            }
        } catch (error) {
            console.error('Failed to remove track from playlist:', error)
        }
        setTrackMenuOpen(null)
    }

    // Save playlist (create or update)
    const handleSavePlaylist = async (name: string, description: string, coverArt: string | null) => {
        try {
            if (editingPlaylist) {
                const updatedPlaylist: Playlist = {
                    ...editingPlaylist,
                    name,
                    description,
                    coverArt,
                    updatedAt: Date.now()
                }
                // @ts-ignore
                const result = await (window.electronAPI as any).savePlaylist(updatedPlaylist)
                if (result.success) {
                    setPlaylists(result.playlists)
                    if (activePlaylist?.id === updatedPlaylist.id) {
                        setActivePlaylist(updatedPlaylist)
                    }
                }
            } else {
                const newPlaylist: Playlist = {
                    id: Date.now().toString() + Math.random().toString(36).slice(2),
                    name,
                    description,
                    coverArt,
                    trackPaths: trackToAddToPlaylist ? [trackToAddToPlaylist.path] : [],
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                }
                // @ts-ignore
                const result = await (window.electronAPI as any).savePlaylist(newPlaylist)
                if (result.success) {
                    setPlaylists(result.playlists)
                    if (trackToAddToPlaylist) {
                        setTrackToAddToPlaylist(null)
                        setShowPlaylistBrowser(false)
                    }
                }
            }
        } catch (error) {
            console.error('Failed to save playlist:', error)
        }
        setShowPlaylistModal(false)
        setEditingPlaylist(null)
        setNewPlaylistImage(null)
        setIsDraggingImage(false)
    }

    // Delete playlist
    const handleDeletePlaylist = async (playlistId: string) => {
        // Show confirmation before deleting
        if (!window.confirm('Delete this playlist? This cannot be undone.')) return

        try {
            // @ts-ignore
            const result = await (window.electronAPI as any).deletePlaylist(playlistId)
            if (result.success) {
                setPlaylists(result.playlists)
                if (activePlaylist?.id === playlistId) {
                    setActivePlaylist(null)
                }
            }
        } catch (error) {
            console.error('Failed to delete playlist:', error)
        }
    }

    // Helper to close browser with animation
    const closePlaylistBrowser = () => {
        setIsClosingBrowser(true)
        setTimeout(() => {
            setShowPlaylistBrowser(false)
            setIsClosingBrowser(false)
            setTrackToAddToPlaylist(null)
        }, 200)
    }



    useEffect(() => {
        if (isActive) {
            // If tracks were preloaded, just load playlists
            if (tracks.length > 0) {
                loadPlaylists()
            } else {
                loadTracks()
                loadPlaylists()
            }
            loadFxPresets()
        }
    }, [isActive])



    // Close menu when clicking outside
    useEffect(() => {
        if (!trackMenuOpen) return
        const handleClickOutside = () => {
            setTrackMenuOpen(null)

        }
        // Delay to avoid immediate closing
        const timeout = setTimeout(() => {
            document.addEventListener('click', handleClickOutside)
        }, 0)
        return () => {
            clearTimeout(timeout)
            document.removeEventListener('click', handleClickOutside)
        }
    }, [trackMenuOpen])

    // Audio Elements Events
    useEffect(() => {
        const audio = new Audio()
        audio.crossOrigin = "anonymous" // IMPORTANT for Web Audio API
        audioRef.current = audio
        // Connect audio element immediately if strict context needed, but usually on play is fine.

        audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime))
        audio.addEventListener('loadedmetadata', () => {
            console.log('[Audio] Metadata loaded, duration:', audio.duration)
            setDuration(audio.duration)
        })
        audio.addEventListener('play', () => setIsPlaying(true))
        audio.addEventListener('pause', () => setIsPlaying(false))
        audio.addEventListener('error', () => {
            console.error('[Audio] Error loading audio:', audio.error?.message, audio.error?.code, audio.src)
        })
        audio.addEventListener('canplay', () => {
            console.log('[Audio] Can play:', audio.src)
        })

        return () => {
            audio.pause()
            audio.src = ''
        }
    }, [])



    // Load Source when track changes
    useEffect(() => {
        const track = currentTrackIndex >= 0 ? tracks[currentTrackIndex] : null
        if (!track || !audioRef.current) return
        // Guard: don't reload if same path is already loaded
        if (currentAudioPathRef.current === track.path) return

        const audio = audioRef.current
        const mediaUrl = `media://${track.path}`
        console.log('[Audio] Loading:', mediaUrl)
        audio.src = mediaUrl
        currentAudioPathRef.current = track.path
        audio.load()

        // Re-apply pitch on every track load as it resets
        audio.playbackRate = pitchLevel

        // Sync loop attribute for new track
        audio.loop = (repeatMode === 'one')

        // Auto-play if triggered by track ending or if already playing
        if (isPlaying || shouldAutoPlayRef.current) {
            shouldAutoPlayRef.current = false
            audio.play().catch(err => {
                console.error('[Audio] Play failed:', err)
                setIsPlaying(false)
            })
        }
    }, [currentTrackIndex])

    // Volume
    useEffect(() => {
        if (audioRef.current) audioRef.current.volume = volume
    }, [volume])

    // Sync Loop Attribute
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.loop = (repeatMode === 'one')
        }
    }, [repeatMode])

    const handlePlayPause = useCallback(() => {
        if (!audioRef.current || !currentTrack) return
        if (audioContextRef.current?.state === 'suspended') {
            audioContextRef.current.resume()
        }
        if (isPlaying) audioRef.current.pause()
        else audioRef.current.play().catch(console.error)
    }, [currentTrack, isPlaying])

    // Global Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                const activeTag = document.activeElement?.tagName.toLowerCase()
                if (activeTag === 'input' || activeTag === 'textarea') return

                e.preventDefault()
                handlePlayPause()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handlePlayPause])

    const handleNext = useCallback(() => {
        const displayTracks = getDisplayTracks()
        if (displayTracks.length === 0) return

        const currentTrack = tracks[currentTrackIndex]
        if (!currentTrack) {
            // Start playing first
            if (displayTracks.length > 0) {
                const idx = tracks.findIndex(t => t.path === displayTracks[0].path)
                if (idx !== -1) setCurrentTrackIndex(idx)
            }
            return
        }

        // Shuffle Logic
        if (isShuffle) {
            if (displayTracks.length <= 1) return

            // Push current track to history before changing
            shuffleHistoryRef.current.push(currentTrackIndex)
            if (shuffleHistoryRef.current.length > 200) {
                shuffleHistoryRef.current = shuffleHistoryRef.current.slice(-200)
            }

            let randomIdx
            do {
                randomIdx = Math.floor(Math.random() * displayTracks.length)
            } while (displayTracks.length > 1 && displayTracks[randomIdx].path === currentTrack.path)

            const nextTrack = displayTracks[randomIdx]
            const globalIdx = tracks.findIndex(t => t.path === nextTrack.path)
            if (globalIdx !== -1) setCurrentTrackIndex(globalIdx)
            return
        }

        const currentIdxInDisplay = displayTracks.findIndex(t => t.path === currentTrack.path)

        let nextTrack: Track | null = null
        if (currentIdxInDisplay === -1) {
            nextTrack = displayTracks[0]
        } else {
            // Logic for next button click:
            // If Repeat One, Next button should still go to next track.
            // If Repeat Off, Next button at end -> wrap to start (standard behavior) or stop? Let's wrap.
            // If Repeat All, Next button -> wrap.
            nextTrack = displayTracks[(currentIdxInDisplay + 1) % displayTracks.length]
        }

        if (nextTrack) {
            const newGlobalIndex = tracks.findIndex(t => t.path === nextTrack.path)
            if (newGlobalIndex !== -1) setCurrentTrackIndex(newGlobalIndex)
        }
    }, [getDisplayTracks, tracks, currentTrackIndex, isShuffle])

    const handlePrevious = useCallback(() => {
        const displayTracks = getDisplayTracks()
        if (displayTracks.length === 0) return

        // 3-second restart: if past 3s, restart current track
        if (audioRef.current && audioRef.current.currentTime > 3) {
            audioRef.current.currentTime = 0
            return
        }

        // Shuffle mode: pop from history stack
        if (isShuffle && shuffleHistoryRef.current.length > 0) {
            const previousIndex = shuffleHistoryRef.current.pop()!
            if (previousIndex >= 0 && previousIndex < tracks.length) {
                shouldAutoPlayRef.current = true
                setCurrentTrackIndex(previousIndex)
                return
            }
            // If invalid, fall through to normal behavior
        }

        // Normal (non-shuffle) previous behavior
        const currentTrack = tracks[currentTrackIndex]
        if (!currentTrack) {
            const first = displayTracks[0]
            const firstGlobalIdx = tracks.findIndex(t => t.path === first.path)
            if (firstGlobalIdx !== -1) setCurrentTrackIndex(firstGlobalIdx)
            return
        }

        const currentIdxInDisplay = displayTracks.findIndex(t => t.path === currentTrack.path)

        let prevTrack: Track
        if (currentIdxInDisplay === -1) {
            prevTrack = displayTracks[0]
        } else {
            const newIdx = currentIdxInDisplay === 0 ? displayTracks.length - 1 : currentIdxInDisplay - 1
            prevTrack = displayTracks[newIdx]
        }

        const newGlobalIndex = tracks.findIndex(t => t.path === prevTrack.path)
        if (newGlobalIndex !== -1) setCurrentTrackIndex(newGlobalIndex)
    }, [getDisplayTracks, tracks, currentTrackIndex, isShuffle])

    // Media Session API Support
    useEffect(() => {
        if ('mediaSession' in navigator && currentTrack) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: currentTrack.title,
                artist: currentTrack.artist,
                album: currentTrack.album,
                artwork: currentTrack.coverArt ? [{ src: currentTrack.coverArt, sizes: '512x512', type: 'image/jpeg' }] : []
            })
        }
    }, [currentTrack])

    useEffect(() => {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

            navigator.mediaSession.setActionHandler('play', handlePlayPause);
            navigator.mediaSession.setActionHandler('pause', handlePlayPause);
            navigator.mediaSession.setActionHandler('previoustrack', handlePrevious);
            navigator.mediaSession.setActionHandler('nexttrack', handleNext);

            navigator.mediaSession.setActionHandler('seekto', (details) => {
                if (details.seekTime !== undefined && audioRef.current) {
                    audioRef.current.currentTime = details.seekTime;
                }
            });
        }
    }, [isPlaying, handlePlayPause, handlePrevious, handleNext])

    // Updated onEnded
    const onTrackEnded = useCallback(() => {
        // Repeat One: Replay the same song
        if (repeatMode === 'one') {
            if (audioRef.current) {
                audioRef.current.currentTime = 0
                audioRef.current.play().catch(console.error)
            }
            return
        }

        const displayTracks = getDisplayTracks()
        const currentTrack = tracks[currentTrackIndex]
        const currentIdx = displayTracks.findIndex(t => t.path === currentTrack?.path)

        // Repeat Off: Play next until end of list, then stop
        if (repeatMode === 'off') {
            // If we're at the last track, stop playback
            if (currentIdx >= displayTracks.length - 1 && !isShuffle) {
                setIsPlaying(false)
                return
            }
            // Otherwise, play next with auto-play
            shouldAutoPlayRef.current = true
            handleNext()
            return
        }

        // Repeat All: Always play next (handleNext wraps around at end)
        shouldAutoPlayRef.current = true
        handleNext()
    }, [repeatMode, handleNext, getDisplayTracks, tracks, currentTrackIndex, isShuffle])

    // Handle Auto Next (Playlist aware)
    useEffect(() => {
        const audio = audioRef.current
        if (!audio) return

        // We use a specific handler that uses the latest state
        // But since we use useCallback for onTrackEnded with dependencies, 
        // we need to make sure the event listener is updated or we use a ref.
        // A common pattern is to just call a function that refs the latest logic?
        // Let's rely on React cleaning up and re-adding listener when `onTrackEnded` changes.

        audio.addEventListener('ended', onTrackEnded)
        return () => audio.removeEventListener('ended', onTrackEnded)
    }, [onTrackEnded])

    // Timeline Scrubbing Logic
    const handleScrubStart = (e: React.MouseEvent<HTMLDivElement>) => {
        setIsScrubbing(true)
        if (duration > 0) {
            const rect = e.currentTarget.getBoundingClientRect()
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
            setScrubTime(percent * duration)
        }
    }

    const handleScrubMove = useCallback((e: MouseEvent) => {
        if (!isScrubbing || !duration) return
        const progressBar = document.querySelector('.progress-area')
        if (progressBar) {
            const rect = progressBar.getBoundingClientRect()
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
            setScrubTime(percent * duration)
        }
    }, [isScrubbing, duration])

    const handleScrubEnd = useCallback((e: MouseEvent) => {
        if (!isScrubbing) return
        setIsScrubbing(false)
        if (audioRef.current && duration) {
            const progressBar = document.querySelector('.progress-area')
            if (progressBar) {
                const rect = progressBar.getBoundingClientRect()
                const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                audioRef.current.currentTime = percent * duration
            }
        }
    }, [isScrubbing, duration])

    // Attach global listeners for scrubbing
    useEffect(() => {
        if (isScrubbing) {
            document.body.style.userSelect = 'none'
            document.body.style.webkitUserSelect = 'none' // For Safari/Chrome
            window.addEventListener('mousemove', handleScrubMove)
            window.addEventListener('mouseup', handleScrubEnd)
        } else {
            document.body.style.userSelect = ''
            document.body.style.webkitUserSelect = ''
            window.removeEventListener('mousemove', handleScrubMove)
            window.removeEventListener('mouseup', handleScrubEnd)
        }
        return () => {
            document.body.style.userSelect = ''
            document.body.style.webkitUserSelect = ''
            window.removeEventListener('mousemove', handleScrubMove)
            window.removeEventListener('mouseup', handleScrubEnd)
        }
    }, [isScrubbing, handleScrubMove, handleScrubEnd])


    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        // Only seek on click if not dragging (handled by scrub end)
        if (isScrubbing) return
        if (!audioRef.current || duration === 0) return
        const rect = e.currentTarget.getBoundingClientRect()
        const percent = (e.clientX - rect.left) / rect.width
        audioRef.current.currentTime = percent * duration
    }

    const handleTrackSelect = (track: Track) => {
        const index = tracks.findIndex(t => t.path === track.path)
        if (index !== -1) {
            if (isShuffle && currentTrackIndex >= 0) {
                shuffleHistoryRef.current.push(currentTrackIndex)
                if (shuffleHistoryRef.current.length > 200) {
                    shuffleHistoryRef.current = shuffleHistoryRef.current.slice(-200)
                }
            }
            setCurrentTrackIndex(index)
            setIsPlaying(true)
        }
    }

    // Format time helper
    const formatTime = (time: number) => {
        if (!time || isNaN(time)) return '0:00'
        const minutes = Math.floor(time / 60)
        const seconds = Math.floor(time % 60)
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
    }

    // Helper to process image file
    const processImageFile = useCallback((file: File) => {
        const reader = new FileReader()
        reader.onload = (event) => {
            const img = new Image()
            img.onload = () => {
                const canvas = document.createElement('canvas')
                canvas.width = 1000
                canvas.height = 1000
                const ctx = canvas.getContext('2d')
                if (ctx) {
                    // Draw image covering the 1000x1000 square (object-fit: cover equivalent)
                    const scale = Math.max(1000 / img.width, 1000 / img.height)
                    const x = (1000 - img.width * scale) / 2
                    const y = (1000 - img.height * scale) / 2
                    ctx.drawImage(img, x, y, img.width * scale, img.height * scale)
                    setNewPlaylistImage(canvas.toDataURL('image/jpeg', 0.8))
                }
            }
            img.src = event.target?.result as string
        }
        reader.readAsDataURL(file)
    }, [])

    // Helper to process image selection
    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            processImageFile(file)
        }
    }

    const handleImageDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDraggingImage(true)
    }

    const handleImageDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDraggingImage(false)
    }

    const handleImageDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDraggingImage(false)

        const file = e.dataTransfer.files?.[0]
        if (file && file.type.startsWith('image/')) {
            processImageFile(file)
        }
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
                backgroundImage: (activePlaylist?.coverArt || currentTrack?.coverArt)
                    ? `url(${activePlaylist?.coverArt || currentTrack?.coverArt})`
                    : (activePlaylist && tracks.find(t => activePlaylist.trackPaths[0] === t.path)?.coverArt)
                        ? `url(${tracks.find(t => activePlaylist.trackPaths[0] === t.path)?.coverArt})`
                        : 'none'
            }} />

            <div className="player-main-content">
                <div className="player-left-side">
                    <div className="now-playing-art-large">
                        {activePlaylist ? (
                            activePlaylist.coverArt ? (
                                <img src={activePlaylist.coverArt} alt={activePlaylist.name} />
                            ) : (
                                <div className="auto-cover-large">
                                    {tracks.filter(t => activePlaylist.trackPaths.includes(t.path)).slice(0, 4).map((t, i) => (
                                        t.coverArt ? (
                                            <img key={i} src={t.coverArt} alt="" />
                                        ) : (
                                            <div key={i} className="no-cover-cell-large">
                                                <MusicIcon size={32} strokeWidth={1} style={{ opacity: 0.2 }} />
                                            </div>
                                        )
                                    ))}
                                    {/* Fill empty cells if playlist has < 4 tracks */}
                                    {Array.from({ length: Math.max(0, 4 - tracks.filter(t => activePlaylist.trackPaths.includes(t.path)).length) }).map((_, i) => (
                                        <div key={`empty-${i}`} className="no-cover-cell-large">
                                            <MusicIcon size={32} strokeWidth={1} style={{ opacity: 0.1 }} />
                                        </div>
                                    ))}
                                </div>
                            )
                        ) : currentTrack?.coverArt ? (
                            <img src={currentTrack.coverArt} alt="Album Art" />
                        ) : (
                            <div className="no-art">
                                <MusicIcon size={80} strokeWidth={1} style={{ opacity: 0.3 }} />
                            </div>
                        )}
                    </div>
                </div>

                <div className="player-right-side">
                    {activePlaylist && (
                        <button
                            className="back-to-library-btn-floating"
                            onClick={() => setActivePlaylist(null)}
                        >
                            <BackIcon size={18} />
                        </button>
                    )}
                    <div className="current-track-header">
                        <MarqueeText text={currentTrack?.title || 'AudRip Player'} />
                        <p className="header-artist">{currentTrack?.artist || 'Select a track to play'}</p>
                        <p className="header-album">{currentTrack?.album || 'Local Library'}</p>
                    </div>

                    <div className="library-controls-header">
                        {activePlaylist ? (
                            <div className="playlist-active-header">
                                <div className="playlist-title-group">
                                    <div className="title-row">
                                        <h3>{activePlaylist.name}</h3>
                                        <button
                                            className="edit-active-playlist-btn"
                                            onClick={() => {
                                                setEditingPlaylist(activePlaylist)
                                                setNewPlaylistImage(activePlaylist.coverArt)
                                                setShowPlaylistModal(true)
                                            }}
                                            title="Edit Playlist"
                                        >
                                            <EditIcon size={14} />
                                        </button>
                                    </div>
                                    <span>{activePlaylist.trackPaths.length} tracks</span>
                                </div>
                            </div>
                        ) : (
                            <div className="library-header-spacer" />
                        )}

                        <div className="library-search-sort-row">
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
                            <div className="sort-select-container">
                                <SortIcon size={14} />
                                <select
                                    className="sort-select"
                                    value={sortBy}
                                    onChange={(e) => setSortBy(e.target.value as any)}
                                >
                                    <option value="default">Default</option>
                                    <option value="title">Title</option>
                                    <option value="artist">Artist</option>
                                    <option value="duration">Duration</option>
                                    <option value="recent">Recent</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="player-tracklist">
                        <div
                            className="tracklist-scroll animate-enter"
                            key={activePlaylist ? activePlaylist.id : 'library'}
                            onScroll={() => {
                                if (trackMenuOpen) {
                                    setTrackMenuOpen(null)
                                }
                            }}
                        >
                            {filteredTracks.map((track, index) => {
                                const isActive = currentTrack && track.path === currentTrack.path
                                return (
                                    <div
                                        key={track.path}
                                        className={`track-item ${isActive ? 'active' : ''}`}
                                    >
                                        <div className="track-main" onClick={() => handleTrackSelect(track)}>
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

                                        {/* Track Menu Button */}
                                        <button
                                            className="track-menu-btn"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                if (trackMenuOpen === track.path) {
                                                    setTrackMenuOpen(null)
                                                } else {
                                                    const rect = e.currentTarget.getBoundingClientRect()
                                                    setMenuPosition({ x: rect.right, y: rect.bottom })
                                                    setTrackMenuOpen(track.path)
                                                }
                                            }}
                                        >
                                            <MoreIcon size={16} />
                                        </button>

                                        {/* Track Menu Dropdown */}

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
                            <div className="fx-presets-row">
                                <select
                                    className="fx-preset-select"
                                    value={activePresetId || ''}
                                    onChange={(e) => {
                                        const preset = fxPresets.find(p => p.id === e.target.value)
                                        if (preset) applyPreset(preset)
                                    }}
                                >
                                    <option value="" disabled>{activePresetId ? 'Custom' : 'Presets'}</option>
                                    {fxPresets.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                                <button className="fx-preset-btn" onClick={handleSavePreset} title="Save Preset">
                                    <SaveIcon size={14} />
                                </button>
                                {activePresetId && (
                                    <button className="fx-preset-btn fx-preset-btn-danger" onClick={handleDeletePreset} title="Delete Preset">
                                        <TrashIcon size={14} />
                                    </button>
                                )}
                            </div>
                            <div className="fx-row">
                                <label>Bass Boost</label>
                                <input
                                    type="range" min="-10" max="15" step="0.5"
                                    value={bassLevel}
                                    onChange={(e) => { setBassLevel(parseFloat(e.target.value)); markCustom() }}
                                    title={bassLevel.toString()}
                                />
                            </div>
                            <div className="fx-row">
                                <label>Reverb</label>
                                <input
                                    type="range" min="0" max="3" step="0.05"
                                    value={reverbLevel}
                                    onChange={(e) => { setReverbLevel(parseFloat(e.target.value)); markCustom() }}
                                    title={Math.round(reverbLevel * 100) + '%'}
                                />
                            </div>
                            <div className="fx-row">
                                <label>Speed / Pitch</label>
                                <input
                                    type="range" min="0.25" max="3.0" step="0.01"
                                    value={pitchLevel}
                                    onChange={(e) => { setPitchLevel(parseFloat(e.target.value)); markCustom() }}
                                    title={pitchLevel + 'x'}
                                />
                            </div>
                            <div className="fx-row">
                                <label>Saturation</label>
                                <input
                                    type="range" min="0" max="1" step="0.01"
                                    value={saturationLevel}
                                    onChange={(e) => { setSaturationLevel(parseFloat(e.target.value)); markCustom() }}
                                    title={(saturationLevel * 100).toFixed(0) + '%'}
                                />
                            </div>
                            <div className="fx-row">
                                <label>Radio Filter</label>
                                <input
                                    type="range" min="0" max="1" step="0.01"
                                    value={highPassLevel}
                                    onChange={(e) => { setHighPassLevel(parseFloat(e.target.value)); markCustom() }}
                                    title={(highPassLevel * 100).toFixed(0) + '%'}
                                />
                            </div>
                            <div className="fx-row">
                                <label>Echo</label>
                                <input
                                    type="range" min="0" max="1" step="0.01"
                                    value={delayLevel}
                                    onChange={(e) => { setDelayLevel(parseFloat(e.target.value)); markCustom() }}
                                    title={(delayLevel * 100).toFixed(0) + '%'}
                                />
                            </div>
                            <div className="fx-row">
                                <label>Spatial</label>
                                <input
                                    type="range" min="0" max="1" step="0.01"
                                    value={stereoWidthLevel}
                                    onChange={(e) => { setStereoWidthLevel(parseFloat(e.target.value)); markCustom() }}
                                    title={(stereoWidthLevel * 100).toFixed(0) + '%'}
                                />
                            </div>
                            <div className="fx-reset">
                                <button onClick={() => {
                                    setBassLevel(0); setReverbLevel(0); setPitchLevel(1); setSaturationLevel(0);
                                    setHighPassLevel(0); setDelayLevel(0); setStereoWidthLevel(0);
                                    setActivePresetId(null);
                                }}>Reset</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Preset Name Modal */}
                {showPresetNameModal && (
                    <div className="fx-panel-overlay" onClick={() => setShowPresetNameModal(false)}>
                        <div className="fx-controls-container" onClick={(e) => e.stopPropagation()} style={{ minWidth: 280 }}>
                            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>Save Preset</h3>
                            <input
                                type="text"
                                placeholder="Preset name..."
                                value={presetNameInput}
                                onChange={(e) => setPresetNameInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') confirmSavePreset() }}
                                autoFocus
                                style={{
                                    width: '100%',
                                    padding: '10px 12px',
                                    background: 'rgba(255,255,255,0.08)',
                                    border: '1px solid rgba(255,255,255,0.15)',
                                    borderRadius: 8,
                                    color: 'white',
                                    fontSize: 14,
                                    outline: 'none',
                                    marginBottom: 12
                                }}
                            />
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                <button
                                    onClick={() => setShowPresetNameModal(false)}
                                    style={{
                                        padding: '8px 16px',
                                        background: 'rgba(255,255,255,0.1)',
                                        border: 'none',
                                        borderRadius: 6,
                                        color: 'white',
                                        cursor: 'pointer'
                                    }}
                                >Cancel</button>
                                <button
                                    onClick={confirmSavePreset}
                                    disabled={!presetNameInput.trim()}
                                    style={{
                                        padding: '8px 16px',
                                        background: presetNameInput.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                                        border: 'none',
                                        borderRadius: 6,
                                        color: 'white',
                                        cursor: presetNameInput.trim() ? 'pointer' : 'default',
                                        opacity: presetNameInput.trim() ? 1 : 0.5
                                    }}
                                >Save</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="player-bottom-bar">
                <div
                    className="progress-area"
                    onMouseDown={handleScrubStart}
                    onClick={handleSeek}
                >
                    <div
                        className="progress-fill"
                        style={{ width: duration ? `${((isScrubbing ? scrubTime : currentTime) / duration) * 100}%` : '0%' }}
                    />
                </div>

                <div className="controls-row">
                    <div className="controls-left">
                        <span className="time-display">{formatTime(isScrubbing ? scrubTime : currentTime)} / {formatTime(duration)}</span>
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

                        {/* Toggle Shuffle */}
                        <button
                            className="control-btn"
                            onClick={() => {
                                const newShuffle = !isShuffle
                                if (!newShuffle) shuffleHistoryRef.current = []
                                setIsShuffle(newShuffle)
                            }}
                            title="Shuffle"
                            style={{ color: isShuffle ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
                        >
                            <ShuffleIcon size={18} />
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

                        {/* Toggle Repeat */}
                        <button
                            className="control-btn"
                            onClick={() => {
                                if (repeatMode === 'off') setRepeatMode('all')
                                else if (repeatMode === 'all') setRepeatMode('one')
                                else setRepeatMode('off')
                            }}
                            title="Repeat"
                            style={{ color: repeatMode !== 'off' ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
                        >
                            {repeatMode === 'one' ? <Repeat1Icon size={18} /> : <RepeatIcon size={18} />}
                        </button>
                        {/* Playlist Button */}
                        <button
                            className={`control-btn ${showPlaylistBrowser ? 'active-fx-btn' : ''}`}
                            onClick={() => {
                                if (showPlaylistBrowser) closePlaylistBrowser()
                                else setShowPlaylistBrowser(true)
                            }}
                            title="Playlists"
                            style={{ color: showPlaylistBrowser ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
                        >
                            <PlaylistIcon size={18} />
                        </button>
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

            {/* Playlist Browser Overlay */}
            {/* Playlist Browser Overlay - Portal to Body for full width */}
            {
                showPlaylistBrowser && createPortal(
                    <div
                        className={`playlist-browser-overlay ${isClosingBrowser ? 'closing' : ''}`}
                        onClick={closePlaylistBrowser}
                    >
                        <div
                            className={`playlist-browser ${isClosingBrowser ? 'closing' : ''}`}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="playlist-browser-header">
                                <h3>{trackToAddToPlaylist ? 'Add to Playlist' : 'Your Playlists'}</h3>
                                <button className="close-btn" onClick={closePlaylistBrowser}>
                                    <CloseIcon size={20} />
                                </button>
                            </div>

                            <div className="playlist-grid">
                                {playlists.map(pl => (
                                    <div
                                        key={pl.id}
                                        className="playlist-card"
                                        onClick={() => {
                                            if (trackToAddToPlaylist) {
                                                handleAddToPlaylist(trackToAddToPlaylist.path, pl.id)
                                                closePlaylistBrowser()
                                            } else {
                                                setActivePlaylist(pl)
                                                closePlaylistBrowser()
                                            }
                                        }}
                                    >
                                        <div className="playlist-cover">
                                            {pl.coverArt ? (
                                                <img src={pl.coverArt} alt={pl.name} />
                                            ) : (
                                                <div className="auto-cover">
                                                    {tracks.filter(t => pl.trackPaths.includes(t.path)).slice(0, 4).map((t, i) => (
                                                        t.coverArt ? (
                                                            <img key={i} src={t.coverArt} alt="" />
                                                        ) : (
                                                            <div key={i} className="no-cover-cell">
                                                                <MusicIcon size={20} />
                                                            </div>
                                                        )
                                                    ))}
                                                </div>
                                            )}
                                            {/* Overlay Checkmark if track is already in playlist */}
                                            {trackToAddToPlaylist && pl.trackPaths.includes(trackToAddToPlaylist.path) && (
                                                <div className="playlist-contains-overlay">
                                                    <div className="check-badge">✓</div>
                                                </div>
                                            )}
                                        </div>
                                        <div className="playlist-info">
                                            <span className="playlist-name">{pl.name}</span>
                                            <span className="playlist-count">{pl.trackPaths.length} tracks</span>
                                        </div>
                                        <div className="playlist-card-actions">
                                            <button
                                                className="edit-playlist-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setEditingPlaylist(pl)
                                                    setNewPlaylistImage(pl.coverArt)
                                                    setShowPlaylistModal(true)
                                                }}
                                            >
                                                <EditIcon size={14} />
                                            </button>
                                            <button
                                                className="delete-playlist-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleDeletePlaylist(pl.id)
                                                }}
                                            >
                                                <TrashIcon size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                <div
                                    className="playlist-card create-playlist-card"
                                    onClick={() => {
                                        setShowPlaylistModal(true)
                                        closePlaylistBrowser()
                                        // Keep trackToAddToPlaylist set so it can be used by the modal
                                    }}
                                >
                                    <div className="create-icon">
                                        <PlusIcon size={32} />
                                    </div>
                                    <span>Create Playlist</span>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )
            }

            {/* Create Playlist Modal */}
            {/* Fixed Track Menu - Portal to Body */}
            {
                trackMenuOpen && menuPosition && createPortal(
                    <div
                        className="track-menu-dropdown fixed-menu"
                        style={{
                            position: 'fixed',
                            top: menuPosition?.y,
                            left: menuPosition?.x,
                            // transform handles alignment and animation via CSS class 'fixed-menu'
                            zIndex: 9999,
                            width: 'auto',
                            minWidth: '180px'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div
                            className="menu-item"
                            onClick={(e) => {
                                e.stopPropagation()
                                const track = tracks.find(t => t.path === trackMenuOpen)
                                if (track) {
                                    setTrackToAddToPlaylist(track)
                                    setShowPlaylistBrowser(true)
                                }
                                setTrackMenuOpen(null)
                            }}
                        >
                            <PlusIcon size={14} />
                            <span>Add to Playlist...</span>
                        </div>
                        {activePlaylist && (
                            <div
                                className="menu-item menu-item-danger"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    if (trackMenuOpen) handleRemoveFromPlaylist(trackMenuOpen)
                                }}
                            >
                                <MinusIcon size={14} />
                                <span>Remove from Playlist</span>
                            </div>
                        )}
                    </div>,
                    document.body
                )
            }

            {/* Create Playlist Modal */}
            {/* Create Playlist Modal - Portal to Body */}
            {
                showPlaylistModal && createPortal(
                    <div className="playlist-modal-overlay" onClick={() => setShowPlaylistModal(false)}>
                        <div className="playlist-modal" onClick={(e) => e.stopPropagation()}>
                            <h3>{editingPlaylist ? 'Edit Playlist' : 'Create New Playlist'}</h3>
                            <form onSubmit={(e) => {
                                e.preventDefault()
                                const form = e.target as HTMLFormElement
                                const nameInput = form.elements.namedItem('name') as HTMLInputElement
                                const name = nameInput.value
                                if (name && name.trim()) {
                                    handleSavePlaylist(name.trim(), '', newPlaylistImage)
                                }
                            }}>
                                <div className="playlist-modal-content" style={{ flexDirection: 'column', alignItems: 'center', width: '100%', gap: '20px' }}>

                                    <div className="form-group" style={{ width: '100%' }}>
                                        <label>Playlist Name</label>
                                        <input
                                            type="text"
                                            name="name"
                                            defaultValue={editingPlaylist?.name || ''}
                                            placeholder="My Awesome Playlist"
                                            required
                                            autoFocus
                                            style={{ fontSize: '0.95rem', padding: '10px 12px', width: '100%' }}
                                        />
                                    </div>

                                    <div className="form-group image-upload-group" style={{ width: '100%', alignItems: 'center' }}>
                                        <label style={{ marginBottom: '8px', width: '100%', textAlign: 'center' }}>Cover Image</label>
                                        <div
                                            className={`image-preview-container ${isDraggingImage ? 'dragging' : ''}`}
                                            onClick={() => document.getElementById('playlist-image-input')?.click()}
                                            onDragOver={handleImageDragOver}
                                            onDragEnter={handleImageDragOver}
                                            onDragLeave={handleImageDragLeave}
                                            onDrop={handleImageDrop}
                                            style={{ width: '140px', height: '140px' }}
                                        >
                                            {newPlaylistImage ? (
                                                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                                                    <img src={newPlaylistImage} alt="Preview" className="playlist-image-preview" />
                                                    <button
                                                        className="remove-image-btn"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setNewPlaylistImage(null)
                                                        }}
                                                        title="Remove Image"
                                                    >
                                                        <TrashIcon size={16} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="upload-placeholder">
                                                    <UploadIcon size={40} className="upload-icon-animated" />
                                                </div>
                                            )}
                                            <input
                                                id="playlist-image-input"
                                                type="file"
                                                accept="image/*"
                                                onChange={handleImageSelect}
                                                style={{ display: 'none' }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="modal-actions">
                                    <button type="button" className="cancel-btn" onClick={() => {
                                        setShowPlaylistModal(false)
                                        setEditingPlaylist(null)
                                        setNewPlaylistImage(null)
                                        setIsDraggingImage(false)
                                    }}>
                                        Cancel
                                    </button>
                                    <button type="submit" className="create-btn">
                                        {editingPlaylist ? 'Save Changes' : 'Create Playlist'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>,
                    document.body
                )
            }
        </div >
    )
}
