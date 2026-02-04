import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

// ... existing imports ...
import { Play as PlayIcon, Pause as PauseIcon, SkipBack as SkipBackIcon, SkipForward as SkipForwardIcon, Volume2 as VolumeIcon, VolumeX as MuteIcon, Music as MusicIcon, Search as SearchIcon, Sparkles as SparklesIcon, MoreHorizontal as MoreIcon, ListMusic as PlaylistIcon, Plus as PlusIcon, X as CloseIcon, ArrowLeft as BackIcon, Trash2 as TrashIcon, Upload as UploadIcon, Edit2 as EditIcon, Shuffle as ShuffleIcon, Repeat as RepeatIcon, Repeat1 as Repeat1Icon, Minus as MinusIcon, ArrowUpDown as SortIcon, Save as SaveIcon, Clock as ClockIcon, List as CompactIcon, ListOrdered as QueueIcon, Monitor as MiniPlayerIcon } from 'lucide-react'
import { Track } from '../types'
import { THEME_PRESETS, ThemeKey } from './SettingsModal'
import CoverArtCube3D from './CoverArtCube3D'

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
    crossfadeDuration?: number
    audioNormalization?: boolean
    theme?: string
    accentColor?: string
    adaptiveColors?: boolean
}

interface ArtAnalysis {
    color: string
    theme: ThemeKey
}

// Map dominant hue to the most fitting theme
function hueToTheme(hue: number, avgLightness: number): ThemeKey {
    // Very bright images → light theme
    if (avgLightness > 0.65) return 'light'
    // Very dark & desaturated → dark
    if (avgLightness < 0.2) return 'dark'

    // Map hue ranges to themed variants
    if (hue < 30 || hue >= 330) return 'rose'       // red/pink
    if (hue < 60) return 'sunset'                     // orange/warm
    if (hue < 150) return 'forest'                    // yellow-green/green
    if (hue < 210) return 'ocean'                     // cyan/teal
    if (hue < 270) return 'nord'                      // blue
    return 'synthwave'                                 // purple/magenta
}

function analyzeAlbumArt(imgSrc: string): Promise<ArtAnalysis | null> {
    return new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas')
                const size = 40
                canvas.width = size
                canvas.height = size
                const ctx = canvas.getContext('2d')
                if (!ctx) { resolve(null); return }

                ctx.drawImage(img, 0, 0, size, size)
                const { data } = ctx.getImageData(0, 0, size, size)

                // Group pixels into 12 hue buckets (30 degrees each)
                const buckets: Array<{ totalR: number; totalG: number; totalB: number; count: number; satSum: number }> = Array.from(
                    { length: 12 }, () => ({ totalR: 0, totalG: 0, totalB: 0, count: 0, satSum: 0 })
                )

                // Track overall image brightness
                let totalLightness = 0
                const pixelCount = data.length / 4

                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i], g = data[i + 1], b = data[i + 2]
                    const max = Math.max(r, g, b), min = Math.min(r, g, b)
                    const delta = max - min
                    const l = (max + min) / 510
                    const s = delta === 0 ? 0 : delta / (255 * (1 - Math.abs(2 * l - 1)))

                    totalLightness += l

                    // Skip desaturated, very dark, or very bright pixels for color extraction
                    if (s < 0.2 || l < 0.1 || l > 0.85) continue

                    let h = 0
                    if (delta !== 0) {
                        if (max === r) h = 60 * (((g - b) / delta) % 6)
                        else if (max === g) h = 60 * ((b - r) / delta + 2)
                        else h = 60 * ((r - g) / delta + 4)
                        if (h < 0) h += 360
                    }

                    const bucket = Math.min(11, Math.floor(h / 30))
                    buckets[bucket].totalR += r
                    buckets[bucket].totalG += g
                    buckets[bucket].totalB += b
                    buckets[bucket].count++
                    buckets[bucket].satSum += s
                }

                const avgLightness = totalLightness / pixelCount

                // Pick the bucket with the best score (count * average saturation)
                let bestBucket = -1
                let bestScore = 0
                for (let i = 0; i < 12; i++) {
                    const b = buckets[i]
                    if (b.count === 0) continue
                    const score = b.count * (b.satSum / b.count)
                    if (score > bestScore) {
                        bestScore = score
                        bestBucket = i
                    }
                }

                if (bestBucket === -1) {
                    // No vibrant colors found — pick theme from brightness alone
                    resolve({ color: '#888888', theme: avgLightness > 0.5 ? 'light' : 'dark' })
                    return
                }

                const b = buckets[bestBucket]
                const avgR = Math.round(b.totalR / b.count)
                const avgG = Math.round(b.totalG / b.count)
                const avgB = Math.round(b.totalB / b.count)

                // Boost saturation slightly for a more vivid accent
                const max = Math.max(avgR, avgG, avgB), min = Math.min(avgR, avgG, avgB)
                const mid = (max + min) / 2
                const boost = 1.3
                const finalR = Math.min(255, Math.round(mid + (avgR - mid) * boost))
                const finalG = Math.min(255, Math.round(mid + (avgG - mid) * boost))
                const finalB = Math.min(255, Math.round(mid + (avgB - mid) * boost))

                const color = '#' + [finalR, finalG, finalB].map(v => Math.max(0, v).toString(16).padStart(2, '0')).join('')
                const dominantHue = bestBucket * 30 + 15
                const theme = hueToTheme(dominantHue, avgLightness)

                resolve({ color, theme })
            } catch {
                resolve(null)
            }
        }
        img.onerror = () => resolve(null)
        img.src = imgSrc
    })
}

const EQ_BANDS = [
    { freq: 60, label: '60', type: 'lowshelf' as const },
    { freq: 170, label: '170', type: 'peaking' as const },
    { freq: 310, label: '310', type: 'peaking' as const },
    { freq: 600, label: '600', type: 'peaking' as const },
    { freq: 1000, label: '1k', type: 'peaking' as const },
    { freq: 3000, label: '3k', type: 'peaking' as const },
    { freq: 6000, label: '6k', type: 'peaking' as const },
    { freq: 12000, label: '12k', type: 'highshelf' as const },
]

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

export default function MusicPlayer({ isActive, initialTracks, onRefreshTracks, crossfadeDuration = 0, audioNormalization = false, theme = 'dark', accentColor = '#00ff88', adaptiveColors = false }: MusicPlayerProps) {
    const [tracks, setTracks] = useState<Track[]>(initialTracks || [])
    const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1)
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [volume, setVolume] = useState(() => {
        const savedVol = localStorage.getItem('audrip-volume')
        return savedVol ? parseFloat(savedVol) : 1
    })

    // Save volume to localStorage
    useEffect(() => {
        localStorage.setItem('audrip-volume', volume.toString())
    }, [volume])
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

    // --- COMPACT MODE ---
    const [isCompact, setIsCompact] = useState(false)

    // --- SLEEP TIMER ---
    const [sleepTimerMode, setSleepTimerMode] = useState<'off' | 'time' | 'endOfTrack'>('off')
    const [sleepTimerEnd, setSleepTimerEnd] = useState<number | null>(null)
    const [sleepTimerRemaining, setSleepTimerRemaining] = useState('')
    const [showSleepMenu, setShowSleepMenu] = useState(false)
    const sleepTimerModeRef = useRef<'off' | 'time' | 'endOfTrack'>('off')

    // --- PLAYBACK QUEUE ---
    const [playbackQueue, setPlaybackQueue] = useState<Track[]>([])
    const [showQueueView, setShowQueueView] = useState(false)

    // --- METADATA EDIT ---
    const [editingTrackMeta, setEditingTrackMeta] = useState<Track | null>(null)
    const [metaEditValues, setMetaEditValues] = useState({ title: '', artist: '', album: '' })

    // --- COVER ART LAZY LOADING ---
    const [coverArtCache, setCoverArtCache] = useState<Record<string, string | null>>({})
    const coverArtLoadingRef = useRef<Set<string>>(new Set())
    const [displayedArt, setDisplayedArt] = useState<string | null>(null)

    const fetchCoverArt = useCallback(async (filePath: string) => {
        if (coverArtLoadingRef.current.has(filePath)) return
        coverArtLoadingRef.current.add(filePath)
        try {
            const art = await (window.electronAPI as any).getTrackCoverArt(filePath)
            setCoverArtCache(prev => ({ ...prev, [filePath]: art }))
        } catch {
            setCoverArtCache(prev => ({ ...prev, [filePath]: null }))
        }
    }, [])

    // Helper to get cover art for a track (from track data or lazy cache)
    const getTrackCoverArt = useCallback((track: Track | null | undefined): string | null => {
        if (!track) return null
        if (track.coverArt) return track.coverArt
        return coverArtCache[track.path] ?? null
    }, [coverArtCache])

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
    // Phase 1 New Effects
    const [lowPassLevel, setLowPassLevel] = useState(1)    // 0 to 1 (1 = open, 0 = muffled)
    const [panningLevel, setPanningLevel] = useState(0)    // -1 to 1 (L to R)
    const [compressorLevel, setCompressorLevel] = useState(0) // 0 to 1 (amount)
    // Phase 2 New Effects
    const [flangerLevel, setFlangerLevel] = useState(0)   // 0 to 1 (intensity)
    const [tremoloLevel, setTremoloLevel] = useState(0)   // 0 to 1 (depth)
    // Phase 3 New Effects
    const [audio8DLevel, setAudio8DLevel] = useState(0)   // 0 to 1 (rotation speed)
    // 8-band EQ
    const [eqBands, setEqBands] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0])

    // Phase 4: A-B Loop
    const [loopA, setLoopA] = useState<number | null>(null)
    const [loopB, setLoopB] = useState<number | null>(null)
    const [isLoopActive, setIsLoopActive] = useState(false)

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

    // Phase 4 Refs for Loop
    const loopARef = useRef<number | null>(null)
    const loopBRef = useRef<number | null>(null)
    const isLoopActiveRef = useRef<boolean>(false)

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
    // Phase 1 New Nodes
    const lowPassNodeRef = useRef<BiquadFilterNode | null>(null)
    const pannerNodeRef = useRef<StereoPannerNode | null>(null)
    const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null)
    // Phase 2 New Nodes (modulation effects need gain nodes for wet mix)
    const flangerGainRef = useRef<GainNode | null>(null)
    const flangerDelayRef = useRef<DelayNode | null>(null)
    const flangerLfoRef = useRef<OscillatorNode | null>(null)
    const tremoloGainRef = useRef<GainNode | null>(null)
    const tremoloLfoRef = useRef<OscillatorNode | null>(null)
    const tremoloDepthRef = useRef<GainNode | null>(null)
    // Phase 3 New Nodes
    const audio8DPannerRef = useRef<StereoPannerNode | null>(null)
    const audio8DLfoRef = useRef<OscillatorNode | null>(null)
    const audio8DGainRef = useRef<GainNode | null>(null)
    // 8-band EQ
    const eqNodesRef = useRef<BiquadFilterNode[]>([])

    // Normalization
    const normGainNodeRef = useRef<GainNode | null>(null)
    const normAnalyserRef = useRef<AnalyserNode | null>(null)
    const normAnimFrameRef = useRef<number | null>(null)

    // Crossfade
    const crossfadeActiveRef = useRef(false)
    const crossfadeDurationRef = useRef(crossfadeDuration)

    // Sync crossfade duration ref
    useEffect(() => { crossfadeDurationRef.current = crossfadeDuration }, [crossfadeDuration])

    // Sync loop state with refs
    useEffect(() => {
        loopARef.current = loopA
        loopBRef.current = loopB
        isLoopActiveRef.current = isLoopActive
    }, [loopA, loopB, isLoopActive])

    const currentTrack = currentTrackIndex >= 0 ? tracks[currentTrackIndex] : null

    // Fetch cover art for current track
    useEffect(() => {
        if (!currentTrack || currentTrack.coverArt) return
        if (coverArtCache[currentTrack.path] !== undefined) return
        fetchCoverArt(currentTrack.path)
    }, [currentTrack?.path])

    // Update displayed art only when the new track's art is resolved
    useEffect(() => {
        if (!currentTrack) { setDisplayedArt(null); return }
        const art = getTrackCoverArt(currentTrack)
        // Art is available (loaded or inline) — update immediately
        if (art) { setDisplayedArt(art); return }
        // Art was explicitly fetched and confirmed null — no art for this track
        if (coverArtCache[currentTrack.path] === null) { setDisplayedArt(null); return }
        // Otherwise: still loading — keep previous displayedArt
    }, [currentTrack?.path, coverArtCache, getTrackCoverArt])

    // Adaptive colors — extract vibrant color and matching theme from album art
    useEffect(() => {
        if (!adaptiveColors || !displayedArt) return

        let cancelled = false
        analyzeAlbumArt(displayedArt).then(result => {
            if (cancelled || !result) return

            const hexToRgb = (hex: string) => ({
                r: parseInt(hex.slice(1, 3), 16),
                g: parseInt(hex.slice(3, 5), 16),
                b: parseInt(hex.slice(5, 7), 16)
            })
            const darken = (r: number, g: number, b: number, pct: number) => ({
                r: Math.round(r * (1 - pct / 100)),
                g: Math.round(g * (1 - pct / 100)),
                b: Math.round(b * (1 - pct / 100))
            })
            const rgbToHex = (r: number, g: number, b: number) =>
                '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')

            const root = document.documentElement.style

            // Apply accent color
            const accent = hexToRgb(result.color)
            const secondary = darken(accent.r, accent.g, accent.b, 20)
            const tertiary = darken(accent.r, accent.g, accent.b, 35)

            root.setProperty('--accent-rgb', `${accent.r}, ${accent.g}, ${accent.b}`)
            root.setProperty('--accent-primary', result.color)
            root.setProperty('--accent-secondary', rgbToHex(secondary.r, secondary.g, secondary.b))
            root.setProperty('--accent-tertiary', rgbToHex(tertiary.r, tertiary.g, tertiary.b))
            root.setProperty('--accent-success', result.color)
            root.setProperty('--shadow-glow', `0 0 20px rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.3)`)

            // Apply matching theme
            const preset = THEME_PRESETS[result.theme]
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
        })

        return () => { cancelled = true }
    }, [displayedArt, adaptiveColors])

    // Fetch cover art for active playlist's first 4 tracks (for auto-cover grid)
    useEffect(() => {
        if (!activePlaylist) return
        const playlistTracks = tracks.filter(t => activePlaylist.trackPaths.includes(t.path)).slice(0, 4)
        for (const t of playlistTracks) {
            if (!t.coverArt && coverArtCache[t.path] === undefined) {
                fetchCoverArt(t.path)
            }
        }
    }, [activePlaylist?.id, tracks])

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

        // 2. Low Pass (Muffled Effect) - NEW
        const lowPass = ctx.createBiquadFilter()
        lowPass.type = 'lowpass'
        lowPass.frequency.value = 20000 // Start fully open

        // 3. Bass (Tone)
        const bassFilter = ctx.createBiquadFilter()
        bassFilter.type = 'lowshelf'
        bassFilter.frequency.value = 200

        // 4. Saturation (Drive)
        const saturationShaper = ctx.createWaveShaper()
        saturationShaper.curve = makeSaturationCurve(0)
        saturationShaper.oversample = '4x'

        // 5. Compressor - NEW
        const compressor = ctx.createDynamicsCompressor()
        compressor.threshold.value = 0   // Will be adjusted by level
        compressor.knee.value = 30
        compressor.ratio.value = 1       // 1 = no compression
        compressor.attack.value = 0.003
        compressor.release.value = 0.25

        // 6. Panner (L/R) - NEW
        const panner = ctx.createStereoPanner()
        panner.pan.value = 0 // Center

        // 7. Reverb (Space)
        const reverbConvolver = ctx.createConvolver()
        reverbConvolver.buffer = createReverbImpulse(ctx)

        // 8. Delay (Echo)
        const delay = ctx.createDelay(1.0)
        delay.delayTime.value = 0.35 // 350ms echo
        const delayFeedback = ctx.createGain()
        delayFeedback.gain.value = 0.4 // 40% feedback
        const delayWetGain = ctx.createGain()
        delayWetGain.gain.value = 0

        // 9. Stereo Width (Haas Effect)
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
        // Chain: Source -> HighPass -> LowPass -> Bass -> Saturation -> Compressor -> Panner -> HUB
        source.connect(highPass)
        highPass.connect(lowPass)
        lowPass.connect(bassFilter)
        bassFilter.connect(saturationShaper)
        saturationShaper.connect(compressor)
        compressor.connect(panner)

        const hub = panner // The processed "dry signal" hub

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
        widthSplitter.connect(widthMerger, 0, 0)
        widthSplitter.connect(widthDelay, 1)
        widthDelay.connect(widthMerger, 0, 1)
        widthMerger.connect(widthGain)
        widthGain.connect(ctx.destination)

        // === PHASE 2: MODULATION EFFECTS (EXTREME VERSION) ===

        // Path F: Flanger (EXTREME jet engine / alien sound)
        const flangerGain = ctx.createGain()
        flangerGain.gain.value = 0
        const flangerDelay = ctx.createDelay(0.1)
        flangerDelay.delayTime.value = 0.015 // 15ms base delay
        const flangerFeedback = ctx.createGain()
        flangerFeedback.gain.value = 0.95  // EXTREME feedback - almost oscillating
        hub.connect(flangerDelay)
        flangerDelay.connect(flangerGain)
        flangerDelay.connect(flangerFeedback)
        flangerFeedback.connect(flangerDelay)
        flangerGain.connect(ctx.destination)
        // Flanger LFO - extreme modulation
        const flangerLfo = ctx.createOscillator()
        const flangerLfoGain = ctx.createGain()
        flangerLfo.type = 'sine'
        flangerLfo.frequency.value = 0.1 // Very slow for dramatic sweep
        flangerLfoGain.gain.value = 0.02 // Modulate 20ms (EXTREME)
        flangerLfo.connect(flangerLfoGain)
        flangerLfoGain.connect(flangerDelay.delayTime)
        flangerLfo.start()

        // Path G: Tremolo (EXTREME helicopter chop)
        const tremoloGain = ctx.createGain()
        tremoloGain.gain.value = 1
        const tremoloDepth = ctx.createGain()
        tremoloDepth.gain.value = 0
        hub.connect(tremoloGain)
        tremoloGain.connect(ctx.destination)
        // Tremolo LFO - fast for helicopter effect
        const tremoloLfo = ctx.createOscillator()
        tremoloLfo.type = 'square' // Square wave for hard chop
        tremoloLfo.frequency.value = 10 // Fast 10Hz chop
        tremoloLfo.connect(tremoloDepth)
        tremoloDepth.connect(tremoloGain.gain)
        tremoloLfo.start()

        // === PHASE 3: NEW EFFECTS ===

        // Path H: 8D Audio (auto-rotation panning)
        const audio8DPanner = ctx.createStereoPanner()
        audio8DPanner.pan.value = 0
        const audio8DGain = ctx.createGain()
        audio8DGain.gain.value = 0 // Wet mix
        hub.connect(audio8DPanner)
        audio8DPanner.connect(audio8DGain)
        audio8DGain.connect(ctx.destination)
        // 8D LFO - rotates pan L to R continuously
        const audio8DLfo = ctx.createOscillator()
        const audio8DLfoGain = ctx.createGain()
        audio8DLfo.type = 'sine'
        audio8DLfo.frequency.value = 0.15 // Slow rotation
        audio8DLfoGain.gain.value = 1 // Full L-R sweep
        audio8DLfo.connect(audio8DLfoGain)
        audio8DLfoGain.connect(audio8DPanner.pan)
        audio8DLfo.start()

        // 8-band EQ chain (in series, inserted into dry path)
        const eqFilters: BiquadFilterNode[] = EQ_BANDS.map((band) => {
            const filter = ctx.createBiquadFilter()
            filter.type = band.type
            filter.frequency.value = band.freq
            if (band.type === 'peaking') filter.Q.value = 1.0
            filter.gain.value = 0
            return filter
        })
        // Insert EQ into dry path: dryGain → eq[0] → eq[1] → ... → eq[7] → normGain → destination
        dryGain.disconnect()
        dryGain.connect(eqFilters[0])
        for (let i = 0; i < eqFilters.length - 1; i++) {
            eqFilters[i].connect(eqFilters[i + 1])
        }

        // Normalization gain node (after EQ, before destination)
        const normGain = ctx.createGain()
        normGain.gain.value = 1.0
        const normAnalyser = ctx.createAnalyser()
        normAnalyser.fftSize = 2048
        eqFilters[eqFilters.length - 1].connect(normAnalyser)
        normAnalyser.connect(normGain)
        normGain.connect(ctx.destination)

        // Store Refs
        sourceNodeRef.current = source
        highPassNodeRef.current = highPass
        lowPassNodeRef.current = lowPass
        bassNodeRef.current = bassFilter
        saturationNodeRef.current = saturationShaper
        compressorNodeRef.current = compressor
        pannerNodeRef.current = panner
        reverbNodeRef.current = reverbConvolver
        delayNodeRef.current = delay
        delayGainNodeRef.current = delayWetGain

        dryGainNodeRef.current = dryGain
        wetGainNodeRef.current = wetGain
        stereoWidthGainNodeRef.current = widthGain

        // Phase 2 refs
        flangerGainRef.current = flangerGain
        flangerDelayRef.current = flangerDelay
        flangerLfoRef.current = flangerLfo
        tremoloGainRef.current = tremoloGain
        tremoloLfoRef.current = tremoloLfo
        tremoloDepthRef.current = tremoloDepth

        // Phase 3 refs
        audio8DPannerRef.current = audio8DPanner
        audio8DLfoRef.current = audio8DLfo
        audio8DGainRef.current = audio8DGain
        // EQ refs
        eqNodesRef.current = eqFilters
        // Normalization refs
        normGainNodeRef.current = normGain
        normAnalyserRef.current = normAnalyser

        // Apply Initial Values
        bassFilter.gain.value = bassLevel
        saturationShaper.curve = makeSaturationCurve(saturationLevel)
        dryGain.gain.value = 1
        wetGain.gain.value = reverbLevel
        highPass.frequency.value = highPassLevel * 3000
        lowPass.frequency.value = lowPassLevel * 19920 + 80 // Map 0-1 to 80-20000Hz
        delayWetGain.gain.value = delayLevel
        widthGain.gain.value = stereoWidthLevel
        panner.pan.value = panningLevel
        // Compressor: map 0-1 to threshold -100 to 0, ratio 1 to 20
        compressor.threshold.value = -100 * compressorLevel
        compressor.ratio.value = 1 + (19 * compressorLevel)
        // Phase 2 initial values
        flangerGain.gain.value = flangerLevel
        tremoloDepth.gain.value = tremoloLevel
        // Phase 3 initial values
        audio8DGain.gain.value = audio8DLevel

        console.log("AudioFX: Graph Connected successfully (Phase 1 + 2 + 3 effects)")
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

    // Low Pass (Muffled) - NEW
    useEffect(() => {
        if (lowPassNodeRef.current && audioContextRef.current) {
            // Map 0-1 to 80-20000Hz (0 = very muffled, 1 = open)
            const freq = lowPassLevel * 19920 + 80
            lowPassNodeRef.current.frequency.setTargetAtTime(freq, audioContextRef.current.currentTime, 0.1)
        }
    }, [lowPassLevel])

    // Panning (L/R) - NEW
    useEffect(() => {
        if (pannerNodeRef.current && audioContextRef.current) {
            pannerNodeRef.current.pan.setTargetAtTime(panningLevel, audioContextRef.current.currentTime, 0.05)
        }
    }, [panningLevel])

    // Compressor - NEW
    useEffect(() => {
        if (compressorNodeRef.current) {
            // EXTREME Compressor: map 0-1 to threshold -100 to 0, ratio 1 to 20
            compressorNodeRef.current.threshold.value = -100 * compressorLevel
            compressorNodeRef.current.ratio.value = 1 + (19 * compressorLevel)
        }
    }, [compressorLevel])

    // Flanger - Phase 2
    useEffect(() => {
        if (flangerGainRef.current && audioContextRef.current) {
            flangerGainRef.current.gain.setTargetAtTime(flangerLevel, audioContextRef.current.currentTime, 0.1)
        }
    }, [flangerLevel])

    // Tremolo - Phase 2
    useEffect(() => {
        if (tremoloDepthRef.current && audioContextRef.current) {
            // Map 0-1 to 0-1 (full depth for intense choppy effect)
            tremoloDepthRef.current.gain.setTargetAtTime(tremoloLevel, audioContextRef.current.currentTime, 0.1)
        }
    }, [tremoloLevel])

    // 8D Audio - Phase 3
    useEffect(() => {
        if (audio8DGainRef.current && audioContextRef.current) {
            audio8DGainRef.current.gain.setTargetAtTime(audio8DLevel, audioContextRef.current.currentTime, 0.1)
        }
    }, [audio8DLevel])

    // 8-band EQ
    useEffect(() => {
        if (eqNodesRef.current.length > 0 && audioContextRef.current) {
            eqBands.forEach((gain, i) => {
                if (eqNodesRef.current[i]) {
                    eqNodesRef.current[i].gain.setTargetAtTime(gain, audioContextRef.current!.currentTime, 0.05)
                }
            })
        }
    }, [eqBands])

    // Audio Normalization
    useEffect(() => {
        if (!normGainNodeRef.current || !normAnalyserRef.current || !audioContextRef.current) return

        if (!audioNormalization) {
            normGainNodeRef.current.gain.value = 1.0
            if (normAnimFrameRef.current) cancelAnimationFrame(normAnimFrameRef.current)
            return
        }

        const analyser = normAnalyserRef.current
        const gainNode = normGainNodeRef.current
        const dataArray = new Float32Array(analyser.fftSize)
        const targetRms = 0.2

        const normalize = () => {
            analyser.getFloatTimeDomainData(dataArray)
            let sumSquares = 0
            for (let i = 0; i < dataArray.length; i++) {
                sumSquares += dataArray[i] * dataArray[i]
            }
            const rms = Math.sqrt(sumSquares / dataArray.length)
            if (rms > 0.001) {
                const desiredGain = Math.min(3.0, Math.max(0.3, targetRms / rms))
                gainNode.gain.setTargetAtTime(desiredGain, audioContextRef.current!.currentTime, 0.3)
            }
            normAnimFrameRef.current = requestAnimationFrame(normalize)
        }
        normAnimFrameRef.current = requestAnimationFrame(normalize)

        return () => {
            if (normAnimFrameRef.current) cancelAnimationFrame(normAnimFrameRef.current)
        }
    }, [audioNormalization])

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

    // --- SLEEP TIMER LOGIC ---
    useEffect(() => { sleepTimerModeRef.current = sleepTimerMode }, [sleepTimerMode])

    const startSleepTimer = useCallback((minutes: number) => {
        setSleepTimerMode('time')
        setSleepTimerEnd(Date.now() + minutes * 60 * 1000)
        setShowSleepMenu(false)
    }, [])

    const startEndOfTrackSleep = useCallback(() => {
        setSleepTimerMode('endOfTrack')
        setSleepTimerEnd(null)
        setShowSleepMenu(false)
    }, [])

    const cancelSleepTimer = useCallback(() => {
        setSleepTimerMode('off')
        setSleepTimerEnd(null)
        setSleepTimerRemaining('')
        setShowSleepMenu(false)
    }, [])

    // Sleep timer countdown
    useEffect(() => {
        if (sleepTimerMode !== 'time' || !sleepTimerEnd) return
        const interval = setInterval(() => {
            const remaining = sleepTimerEnd - Date.now()
            if (remaining <= 0) {
                // Fade out and pause
                if (audioRef.current) {
                    const fadeSteps = 30
                    const fadeInterval = 100 // 3 second fade
                    const originalVolume = audioRef.current.volume
                    let step = 0
                    const fade = setInterval(() => {
                        step++
                        if (audioRef.current) {
                            audioRef.current.volume = Math.max(0, originalVolume * (1 - step / fadeSteps))
                        }
                        if (step >= fadeSteps) {
                            clearInterval(fade)
                            if (audioRef.current) {
                                audioRef.current.pause()
                                audioRef.current.volume = originalVolume
                            }
                        }
                    }, fadeInterval)
                }
                cancelSleepTimer()
            } else {
                const mins = Math.floor(remaining / 60000)
                const secs = Math.floor((remaining % 60000) / 1000)
                setSleepTimerRemaining(`${mins}:${secs.toString().padStart(2, '0')}`)
            }
        }, 1000)
        return () => clearInterval(interval)
    }, [sleepTimerMode, sleepTimerEnd, cancelSleepTimer])

    // --- QUEUE LOGIC ---
    const playNext = useCallback((track: Track) => {
        setPlaybackQueue(q => [track, ...q])
        setTrackMenuOpen(null)
    }, [])

    const addToQueue = useCallback((track: Track) => {
        setPlaybackQueue(q => [...q, track])
        setTrackMenuOpen(null)
    }, [])

    // --- METADATA EDIT LOGIC ---
    const openMetadataEdit = useCallback((track: Track) => {
        setEditingTrackMeta(track)
        setMetaEditValues({ title: track.title, artist: track.artist, album: track.album })
        setTrackMenuOpen(null)
    }, [])

    const saveMetadataEdit = useCallback(async () => {
        if (!editingTrackMeta) return
        try {
            const result = await (window.electronAPI as any).editTrackMetadata({
                filePath: editingTrackMeta.path,
                metadata: metaEditValues
            })
            if (result.success && onRefreshTracks) {
                await onRefreshTracks()
            }
        } catch (e) {
            console.error('Failed to edit metadata:', e)
        }
        setEditingTrackMeta(null)
    }, [editingTrackMeta, metaEditValues, onRefreshTracks])

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

        audio.addEventListener('timeupdate', () => {
            setCurrentTime(audio.currentTime)
            // Phase 4: A-B Loop Logic
            if (isLoopActiveRef.current && loopARef.current !== null && loopBRef.current !== null) {
                if (audio.currentTime >= loopBRef.current) {
                    audio.currentTime = loopARef.current
                }
            }
            // Crossfade trigger
            if (crossfadeDurationRef.current > 0 && audio.duration && !crossfadeActiveRef.current) {
                const timeLeft = audio.duration - audio.currentTime
                if (timeLeft <= crossfadeDurationRef.current && timeLeft > 0) {
                    crossfadeActiveRef.current = true
                    // Fade out current track
                    const fadeDuration = crossfadeDurationRef.current
                    const startVolume = audio.volume
                    const fadeOutInterval = setInterval(() => {
                        const remaining = audio.duration - audio.currentTime
                        if (remaining <= 0 || !audio.duration) {
                            clearInterval(fadeOutInterval)
                            return
                        }
                        audio.volume = Math.max(0, startVolume * (remaining / fadeDuration))
                    }, 50)
                    // Trigger next track with auto-play
                    shouldAutoPlayRef.current = true
                    // The onended handler will fire naturally - reset crossfade flag
                    setTimeout(() => {
                        crossfadeActiveRef.current = false
                        audio.volume = startVolume
                    }, fadeDuration * 1000 + 500)
                }
            }
        })
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
            if (audioContextRef.current?.state === 'suspended') {
                audioContextRef.current.resume()
            }
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
        if (isPlaying) {
            audioRef.current.pause()
        } else {
            // Resume AudioContext and play audio concurrently to preserve user gesture context
            if (audioContextRef.current?.state === 'suspended') {
                audioContextRef.current.resume()
            }
            audioRef.current.play().catch(err => {
                console.error('[Audio] Play failed, retrying with reload:', err)
                // Recovery: reload source and retry
                if (audioRef.current && currentAudioPathRef.current) {
                    audioRef.current.load()
                    audioRef.current.play().catch(console.error)
                }
            })
        }
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
        // Check queue first
        if (playbackQueue.length > 0) {
            const nextTrack = playbackQueue[0]
            setPlaybackQueue(q => q.slice(1))
            const globalIdx = tracks.findIndex(t => t.path === nextTrack.path)
            if (globalIdx !== -1) {
                shouldAutoPlayRef.current = true
                setCurrentTrackIndex(globalIdx)
            }
            return
        }

        const displayTracks = getDisplayTracks()
        if (displayTracks.length === 0) return

        const currentTrack = tracks[currentTrackIndex]
        if (!currentTrack) {
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
            const art = getTrackCoverArt(currentTrack)
            navigator.mediaSession.metadata = new MediaMetadata({
                title: currentTrack.title,
                artist: currentTrack.artist,
                album: currentTrack.album,
                artwork: art ? [{ src: art, sizes: '512x512', type: 'image/jpeg' }] : []
            })
        }
    }, [currentTrack, coverArtCache])

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

    // Broadcast playback state to mini player
    useEffect(() => {
        const api = window.electronAPI as any
        if (!api?.syncPlaybackState) return
        api.syncPlaybackState({
            title: currentTrack?.title || 'Not Playing',
            artist: currentTrack?.artist || '',
            album: currentTrack?.album || '',
            coverArt: currentTrack ? getTrackCoverArt(currentTrack) : null,
            isPlaying,
            currentTime,
            duration,
            volume,
            theme,
            accentColor
        })
    }, [currentTrack?.path, isPlaying, Math.floor(currentTime), duration, volume, theme, accentColor])

    // Listen for mini player commands
    useEffect(() => {
        const api = window.electronAPI as any
        if (!api?.onMiniPlayerCommand) return
        const cleanup = api.onMiniPlayerCommand((command: string) => {
            if (command.startsWith('seek:')) {
                const time = parseFloat(command.split(':')[1])
                if (!isNaN(time) && audioRef.current) {
                    audioRef.current.currentTime = Math.max(0, Math.min(time, audioRef.current.duration || 0))
                }
                return
            }
            if (command.startsWith('volume:')) {
                const vol = parseFloat(command.split(':')[1])
                if (!isNaN(vol)) setVolume(Math.max(0, Math.min(1, vol)))
                return
            }
            switch (command) {
                case 'toggle': handlePlayPause(); break
                case 'next': handleNext(); break
                case 'prev': handlePrevious(); break
                case 'play-random': {
                    const displayTracks = getDisplayTracks()
                    if (displayTracks.length > 0) {
                        const randomIdx = Math.floor(Math.random() * displayTracks.length)
                        const track = displayTracks[randomIdx]
                        const globalIdx = tracks.findIndex(t => t.path === track.path)
                        if (globalIdx !== -1) {
                            shouldAutoPlayRef.current = true
                            setCurrentTrackIndex(globalIdx)
                        }
                    }
                    break
                }
            }
        })
        return cleanup
    }, [handlePlayPause, handleNext, handlePrevious, getDisplayTracks, tracks])

    // Updated onEnded
    const onTrackEnded = useCallback(() => {
        // Sleep timer: end of track mode
        if (sleepTimerModeRef.current === 'endOfTrack') {
            if (audioRef.current) {
                // Fade out
                const originalVolume = audioRef.current.volume
                const fadeSteps = 30
                let step = 0
                const fade = setInterval(() => {
                    step++
                    if (audioRef.current) {
                        audioRef.current.volume = Math.max(0, originalVolume * (1 - step / fadeSteps))
                    }
                    if (step >= fadeSteps) {
                        clearInterval(fade)
                        if (audioRef.current) {
                            audioRef.current.pause()
                            audioRef.current.volume = originalVolume
                        }
                    }
                }, 100)
            }
            setSleepTimerMode('off')
            setSleepTimerRemaining('')
            return
        }

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
            if (currentIdx >= displayTracks.length - 1 && !isShuffle && playbackQueue.length === 0) {
                setIsPlaying(false)
                return
            }
            shouldAutoPlayRef.current = true
            handleNext()
            return
        }

        // Repeat All: Always play next (handleNext wraps around at end)
        shouldAutoPlayRef.current = true
        handleNext()
    }, [repeatMode, handleNext, getDisplayTracks, tracks, currentTrackIndex, isShuffle, playbackQueue.length])

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

    // A-B Loop Handlers
    const handleSetLoopA = () => {
        setLoopA(currentTime)
        if (loopB !== null && currentTime >= loopB) {
            setLoopB(null)
            setIsLoopActive(false)
        }
    }

    const handleSetLoopB = () => {
        if (loopA !== null && currentTime > loopA) {
            setLoopB(currentTime)
            setIsLoopActive(true)
        }
    }

    const clearLoop = () => {
        setLoopA(null)
        setLoopB(null)
        setIsLoopActive(false)
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
                backgroundImage: (activePlaylist?.coverArt || displayedArt)
                    ? `url(${activePlaylist?.coverArt || displayedArt})`
                    : (activePlaylist && getTrackCoverArt(tracks.find(t => activePlaylist.trackPaths[0] === t.path)))
                        ? `url(${getTrackCoverArt(tracks.find(t => activePlaylist.trackPaths[0] === t.path))})`
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
                                    {tracks.filter(t => activePlaylist.trackPaths.includes(t.path)).slice(0, 4).map((t, i) => {
                                        const art = getTrackCoverArt(t)
                                        return art ? (
                                            <img key={i} src={art} alt="" />
                                        ) : (
                                            <div key={i} className="no-cover-cell-large">
                                                <MusicIcon size={32} strokeWidth={1} style={{ opacity: 0.2 }} />
                                            </div>
                                        )
                                    })}
                                    {/* Fill empty cells if playlist has < 4 tracks */}
                                    {Array.from({ length: Math.max(0, 4 - tracks.filter(t => activePlaylist.trackPaths.includes(t.path)).length) }).map((_, i) => (
                                        <div key={`empty-${i}`} className="no-cover-cell-large">
                                            <MusicIcon size={32} strokeWidth={1} style={{ opacity: 0.1 }} />
                                        </div>
                                    ))}
                                </div>
                            )
                        ) : displayedArt ? (
                            <CoverArtCube3D src={displayedArt} artist={currentTrack?.artist} album={currentTrack?.album} />
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
                            <button
                                className={`compact-toggle-btn ${isCompact ? 'active' : ''}`}
                                onClick={() => setIsCompact(!isCompact)}
                                title={isCompact ? 'Normal view' : 'Compact view'}
                            >
                                <CompactIcon size={14} />
                            </button>
                        </div>
                    </div>

                    <div className={`player-tracklist ${isCompact ? 'compact-list' : ''}`}>
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

            </div>

            {showFx && (
                <div
                    className={`fx-panel-overlay ${isClosing ? 'fade-out' : ''}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        closeFxPanel();
                    }}
                >
                    <div className="fx-controls-container" onClick={(e) => e.stopPropagation()}>
                        <div className="fx-columns">
                            <div className="fx-column">
                                <div className="fx-section">
                                    <div className="fx-section-header">Tone</div>
                                    <div className="fx-row">
                                        <label>Bass Boost</label>
                                        <input type="range" min="-10" max="15" step="0.5" value={bassLevel}
                                            onChange={(e) => { setBassLevel(parseFloat(e.target.value)); markCustom() }}
                                            title={bassLevel.toString()} />
                                    </div>
                                    <div className="fx-row">
                                        <label>Saturation</label>
                                        <input type="range" min="0" max="1" step="0.01" value={saturationLevel}
                                            onChange={(e) => { setSaturationLevel(parseFloat(e.target.value)); markCustom() }}
                                            title={(saturationLevel * 100).toFixed(0) + '%'} />
                                    </div>
                                    <div className="fx-row">
                                        <label>Low Pass</label>
                                        <input type="range" min="0" max="1" step="0.01" value={lowPassLevel}
                                            onChange={(e) => { setLowPassLevel(parseFloat(e.target.value)); markCustom() }}
                                            title={lowPassLevel < 1 ? 'Muffled' : 'Open'} />
                                    </div>
                                    <div className="fx-row">
                                        <label>Radio Filter</label>
                                        <input type="range" min="0" max="1" step="0.01" value={highPassLevel}
                                            onChange={(e) => { setHighPassLevel(parseFloat(e.target.value)); markCustom() }}
                                            title={(highPassLevel * 100).toFixed(0) + '%'} />
                                    </div>
                                </div>

                                <div className="fx-section">
                                    <div className="fx-section-header">Dynamics</div>
                                    <div className="fx-row">
                                        <label>Compress</label>
                                        <input type="range" min="0" max="1" step="0.01" value={compressorLevel}
                                            onChange={(e) => { setCompressorLevel(parseFloat(e.target.value)); markCustom() }}
                                            title={(compressorLevel * 100).toFixed(0) + '%'} />
                                    </div>
                                    <div className="fx-row">
                                        <label>Speed / Pitch</label>
                                        <input type="range" min="0.25" max="3.0" step="0.01" value={pitchLevel}
                                            onChange={(e) => { setPitchLevel(parseFloat(e.target.value)); markCustom() }}
                                            title={pitchLevel + 'x'} />
                                    </div>
                                </div>

                                <div className="fx-section">
                                    <div className="fx-section-header">Modulation</div>
                                    <div className="fx-row">
                                        <label>Flanger</label>
                                        <input type="range" min="0" max="1" step="0.01" value={flangerLevel}
                                            onChange={(e) => { setFlangerLevel(parseFloat(e.target.value)); markCustom() }}
                                            title={(flangerLevel * 100).toFixed(0) + '%'} />
                                    </div>
                                    <div className="fx-row">
                                        <label>Tremolo</label>
                                        <input type="range" min="0" max="1" step="0.01" value={tremoloLevel}
                                            onChange={(e) => { setTremoloLevel(parseFloat(e.target.value)); markCustom() }}
                                            title={(tremoloLevel * 100).toFixed(0) + '%'} />
                                    </div>
                                </div>
                            </div>

                            <div className="fx-column">
                                <div className="fx-section">
                                    <div className="fx-section-header">Space</div>
                                    <div className="fx-row">
                                        <label>Reverb</label>
                                        <input type="range" min="0" max="3" step="0.05" value={reverbLevel}
                                            onChange={(e) => { setReverbLevel(parseFloat(e.target.value)); markCustom() }}
                                            title={Math.round(reverbLevel * 100) + '%'} />
                                    </div>
                                    <div className="fx-row">
                                        <label>Echo</label>
                                        <input type="range" min="0" max="1" step="0.01" value={delayLevel}
                                            onChange={(e) => { setDelayLevel(parseFloat(e.target.value)); markCustom() }}
                                            title={(delayLevel * 100).toFixed(0) + '%'} />
                                    </div>
                                    <div className="fx-row">
                                        <label>Spatial</label>
                                        <input type="range" min="0" max="1" step="0.01" value={stereoWidthLevel}
                                            onChange={(e) => { setStereoWidthLevel(parseFloat(e.target.value)); markCustom() }}
                                            title={(stereoWidthLevel * 100).toFixed(0) + '%'} />
                                    </div>
                                    <div className="fx-row">
                                        <label>8D Audio</label>
                                        <input type="range" min="0" max="1" step="0.01" value={audio8DLevel}
                                            onChange={(e) => { setAudio8DLevel(parseFloat(e.target.value)); markCustom() }}
                                            title={audio8DLevel > 0 ? 'Rotating' : 'Off'} />
                                    </div>
                                    <div className="fx-row">
                                        <label>Pan L/R</label>
                                        <input type="range" min="-1" max="1" step="0.01" value={panningLevel}
                                            onChange={(e) => { setPanningLevel(parseFloat(e.target.value)); markCustom() }}
                                            title={panningLevel < 0 ? `L ${Math.abs(panningLevel * 100).toFixed(0)}%` : panningLevel > 0 ? `R ${(panningLevel * 100).toFixed(0)}%` : 'Center'} />
                                    </div>
                                </div>

                                <div className="fx-section eq-section">
                                    <div className="fx-section-header">Equalizer</div>
                                    <div className="eq-band-row">
                                        {EQ_BANDS.map((band, i) => (
                                            <div className="eq-band" key={band.freq}>
                                                <input
                                                    type="range" min="-15" max="15" step="0.5"
                                                    value={eqBands[i]}
                                                    onChange={(e) => {
                                                        const val = parseFloat(e.target.value)
                                                        setEqBands(prev => { const next = [...prev]; next[i] = val; return next })
                                                        markCustom()
                                                    }}
                                                    title={eqBands[i] > 0 ? `+${eqBands[i]}dB` : `${eqBands[i]}dB`}
                                                />
                                                <span className="eq-band-label">{band.label}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="fx-toolbar">
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
                            <button className="fx-reset-btn" onClick={() => {
                                setBassLevel(0); setReverbLevel(0); setPitchLevel(1); setSaturationLevel(0);
                                setHighPassLevel(0); setDelayLevel(0); setStereoWidthLevel(0);
                                setLowPassLevel(1); setPanningLevel(0); setCompressorLevel(0);
                                setFlangerLevel(0); setTremoloLevel(0);
                                setAudio8DLevel(0);
                                setEqBands([0, 0, 0, 0, 0, 0, 0, 0]);
                                setActivePresetId(null);
                            }}>Reset</button>
                        </div>
                    </div>
                </div>
            )}

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
                                background: 'rgba(var(--overlay-rgb), 0.08)',
                                border: '1px solid rgba(var(--overlay-rgb), 0.15)',
                                borderRadius: 8,
                                color: 'var(--text-primary)',
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
                                    background: 'rgba(var(--overlay-rgb), 0.1)',
                                    border: 'none',
                                    borderRadius: 6,
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer'
                                }}
                            >Cancel</button>
                            <button
                                onClick={confirmSavePreset}
                                disabled={!presetNameInput.trim()}
                                style={{
                                    padding: '8px 16px',
                                    background: presetNameInput.trim() ? 'var(--accent-primary)' : 'rgba(var(--overlay-rgb), 0.1)',
                                    border: 'none',
                                    borderRadius: 6,
                                    color: presetNameInput.trim() ? 'white' : 'var(--text-primary)',
                                    cursor: presetNameInput.trim() ? 'pointer' : 'default',
                                    opacity: presetNameInput.trim() ? 1 : 0.5
                                }}
                            >Save</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="player-bottom-bar">
                {/* Row 1: Progress */}
                <div className="progress-row">
                    <span className="time-display">{formatTime(isScrubbing ? scrubTime : currentTime)}</span>
                    <div
                        className="progress-area"
                        onMouseDown={handleScrubStart}
                        onClick={handleSeek}
                    >
                        <div
                            className="progress-fill"
                            style={{ width: duration ? `${((isScrubbing ? scrubTime : currentTime) / duration) * 100}%` : '0%' }}
                        />

                        {/* A-B Loop Markers */}
                        {loopA !== null && duration > 0 && (
                            <div
                                className="loop-marker marker-a"
                                style={{ left: `${(loopA / duration) * 100}%` }}
                            />
                        )}
                        {loopB !== null && duration > 0 && (
                            <div
                                className="loop-marker marker-b"
                                style={{ left: `${(loopB / duration) * 100}%` }}
                            />
                        )}
                        {isLoopActive && loopA !== null && loopB !== null && duration > 0 && (
                            <div
                                className="loop-range-highlight"
                                style={{
                                    left: `${(loopA / duration) * 100}%`,
                                    width: `${((loopB - loopA) / duration) * 100}%`
                                }}
                            />
                        )}
                    </div>
                    <span className="time-display">{formatTime(duration)}</span>
                </div>

                {/* Row 2: Controls */}
                <div className="controls-row">
                    <div className="controls-left">
                        <button
                            className="control-btn-sm"
                            onClick={(e) => {
                                const api = window.electronAPI as any
                                if (api?.openMiniPlayer) api.openMiniPlayer({ x: e.screenX, y: e.screenY })
                            }}
                            title="Mini Player"
                            style={{ color: 'var(--text-secondary)' }}
                        >
                            <MiniPlayerIcon size={16} />
                        </button>
                        <button
                            className={`control-btn-sm ${showFx ? 'active-fx-btn' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (showFx) closeFxPanel();
                                else setShowFx(true);
                            }}
                            title="Audio Effects"
                            style={{ color: showFx ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
                        >
                            <SparklesIcon size={16} />
                        </button>
                        <button
                            className={`control-btn-sm ${showPlaylistBrowser ? 'active-fx-btn' : ''}`}
                            onClick={() => {
                                if (showPlaylistBrowser) closePlaylistBrowser()
                                else setShowPlaylistBrowser(true)
                            }}
                            title="Playlists"
                            style={{ color: showPlaylistBrowser ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
                        >
                            <PlaylistIcon size={16} />
                        </button>
                        {playbackQueue.length > 0 && (
                            <button
                                className={`control-btn-sm ${showQueueView ? 'active-fx-btn' : ''}`}
                                onClick={() => setShowQueueView(!showQueueView)}
                                title={`Queue (${playbackQueue.length})`}
                                style={{ color: showQueueView ? 'var(--accent-primary)' : 'var(--text-secondary)', position: 'relative' }}
                            >
                                <QueueIcon size={16} />
                                <span className="queue-badge">{playbackQueue.length}</span>
                            </button>
                        )}
                        <div style={{ position: 'relative' }}>
                            <button
                                className={`control-btn-sm ${sleepTimerMode !== 'off' ? 'active-fx-btn' : ''}`}
                                onClick={() => setShowSleepMenu(!showSleepMenu)}
                                title={sleepTimerMode !== 'off' ? `Sleep: ${sleepTimerRemaining || 'End of track'}` : 'Sleep Timer'}
                                style={{ color: sleepTimerMode !== 'off' ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
                            >
                                <ClockIcon size={16} />
                            </button>
                            {sleepTimerMode !== 'off' && sleepTimerRemaining && (
                                <span className="sleep-timer-indicator">{sleepTimerRemaining}</span>
                            )}
                            {showSleepMenu && (
                                <div className="sleep-timer-menu">
                                    {sleepTimerMode !== 'off' ? (
                                        <div className="menu-item" onClick={cancelSleepTimer}>
                                            <CloseIcon size={14} />
                                            <span>Cancel Timer</span>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="menu-item" onClick={() => startSleepTimer(15)}>15 min</div>
                                            <div className="menu-item" onClick={() => startSleepTimer(30)}>30 min</div>
                                            <div className="menu-item" onClick={() => startSleepTimer(45)}>45 min</div>
                                            <div className="menu-item" onClick={() => startSleepTimer(60)}>60 min</div>
                                            <div className="menu-item" onClick={startEndOfTrackSleep}>End of Track</div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="ab-loop-controls">
                            <button
                                className={`ab-btn ${loopA !== null ? 'set' : ''}`}
                                onClick={handleSetLoopA}
                                title={loopA !== null ? `A: ${formatTime(loopA)}` : "Set A (Start)"}
                            >A</button>
                            <button
                                className={`ab-btn ${loopB !== null ? 'set' : ''}`}
                                onClick={handleSetLoopB}
                                disabled={loopA === null}
                                title={loopB !== null ? `B: ${formatTime(loopB)}` : "Set B (End)"}
                            >B</button>
                            {(loopA !== null || loopB !== null) && (
                                <button className="ab-clear-btn" onClick={clearLoop} title="Clear Loop">
                                    <CloseIcon size={12} />
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="controls-center">
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
                                    background: `linear-gradient(to right, var(--accent-primary) ${volume * 100}%, rgba(var(--overlay-rgb), 0.1) ${volume * 100}%)`
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
                                                    {tracks.filter(t => pl.trackPaths.includes(t.path)).slice(0, 4).map((t, i) => {
                                                        const art = getTrackCoverArt(t)
                                                        return art ? (
                                                            <img key={i} src={art} alt="" />
                                                        ) : (
                                                            <div key={i} className="no-cover-cell">
                                                                <MusicIcon size={20} />
                                                            </div>
                                                        )
                                                    })}
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
                                if (track) playNext(track)
                            }}
                        >
                            <SkipForwardIcon size={14} />
                            <span>Play Next</span>
                        </div>
                        <div
                            className="menu-item"
                            onClick={(e) => {
                                e.stopPropagation()
                                const track = tracks.find(t => t.path === trackMenuOpen)
                                if (track) addToQueue(track)
                            }}
                        >
                            <QueueIcon size={14} />
                            <span>Add to Queue</span>
                        </div>
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
                        <div
                            className="menu-item"
                            onClick={(e) => {
                                e.stopPropagation()
                                const track = tracks.find(t => t.path === trackMenuOpen)
                                if (track) openMetadataEdit(track)
                            }}
                        >
                            <EditIcon size={14} />
                            <span>Edit Metadata</span>
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
            {/* Queue View Overlay */}
            {showQueueView && playbackQueue.length > 0 && createPortal(
                <div className="queue-overlay" onClick={() => setShowQueueView(false)}>
                    <div className="queue-panel" onClick={e => e.stopPropagation()}>
                        <div className="queue-header">
                            <h3>Up Next ({playbackQueue.length})</h3>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button className="queue-clear-btn" onClick={() => { setPlaybackQueue([]); setShowQueueView(false) }}>
                                    Clear
                                </button>
                                <button className="close-btn" onClick={() => setShowQueueView(false)}>
                                    <CloseIcon size={18} />
                                </button>
                            </div>
                        </div>
                        <div className="queue-list">
                            {playbackQueue.map((track, i) => (
                                <div key={`${track.path}-${i}`} className="queue-item">
                                    <span className="queue-item-index">{i + 1}</span>
                                    <div className="queue-item-info">
                                        <span className="queue-item-title">{track.title}</span>
                                        <span className="queue-item-artist">{track.artist}</span>
                                    </div>
                                    <button
                                        className="queue-remove-btn"
                                        onClick={() => setPlaybackQueue(q => q.filter((_, idx) => idx !== i))}
                                    >
                                        <CloseIcon size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Metadata Edit Modal */}
            {editingTrackMeta && createPortal(
                <div className="playlist-modal-overlay" onClick={() => setEditingTrackMeta(null)}>
                    <div className="playlist-modal" onClick={e => e.stopPropagation()}>
                        <h3>Edit Metadata</h3>
                        <form onSubmit={(e) => { e.preventDefault(); saveMetadataEdit() }}>
                            <div className="playlist-modal-content" style={{ flexDirection: 'column', width: '100%', gap: '12px' }}>
                                <div className="form-group" style={{ width: '100%' }}>
                                    <label>Title</label>
                                    <input
                                        type="text"
                                        value={metaEditValues.title}
                                        onChange={e => setMetaEditValues(v => ({ ...v, title: e.target.value }))}
                                        style={{ fontSize: '0.95rem', padding: '10px 12px', width: '100%' }}
                                        autoFocus
                                    />
                                </div>
                                <div className="form-group" style={{ width: '100%' }}>
                                    <label>Artist</label>
                                    <input
                                        type="text"
                                        value={metaEditValues.artist}
                                        onChange={e => setMetaEditValues(v => ({ ...v, artist: e.target.value }))}
                                        style={{ fontSize: '0.95rem', padding: '10px 12px', width: '100%' }}
                                    />
                                </div>
                                <div className="form-group" style={{ width: '100%' }}>
                                    <label>Album</label>
                                    <input
                                        type="text"
                                        value={metaEditValues.album}
                                        onChange={e => setMetaEditValues(v => ({ ...v, album: e.target.value }))}
                                        style={{ fontSize: '0.95rem', padding: '10px 12px', width: '100%' }}
                                    />
                                </div>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="cancel-btn" onClick={() => setEditingTrackMeta(null)}>Cancel</button>
                                <button type="submit" className="create-btn">Save</button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}
        </div >
    )
}
