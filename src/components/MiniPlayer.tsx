import { useState, useEffect, useRef, useCallback } from 'react'
import { Play as PlayIcon, Pause as PauseIcon, SkipBack as SkipBackIcon, SkipForward as SkipForwardIcon, Maximize2 as ExpandIcon } from 'lucide-react'
import * as THREE from 'three'
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js'
import { FontLoader } from 'three/addons/loaders/FontLoader.js'
import helvetikerBold from 'three/examples/fonts/helvetiker_bold.typeface.json'
import { THEME_PRESETS, ThemeKey } from './SettingsModal'
import CoverArtCube3D from './CoverArtCube3D'

interface PlaybackState {
    title: string
    artist: string
    album?: string
    coverArt: string | null
    isPlaying: boolean
    currentTime: number
    duration: number
    volume?: number
    theme?: string
    accentColor?: string
}

const MarqueeMini = ({ text, className }: { text: string, className?: string }) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const textRef = useRef<HTMLDivElement>(null)
    const [shouldAnimate, setShouldAnimate] = useState(false)

    useEffect(() => {
        const checkOverflow = () => {
            if (containerRef.current && textRef.current) {
                const contentWidth = textRef.current.children[0]?.scrollWidth || 0
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
        <div className={`mini-marquee-wrapper ${shouldAnimate ? 'mask-enabled' : ''}`} ref={containerRef}>
            <div className={`mini-marquee-track ${shouldAnimate ? 'animate' : ''}`} ref={textRef}>
                <span className={className}>{text}</span>
                {shouldAnimate && <span className={className} aria-hidden="true">{text}</span>}
            </div>
        </div>
    )
}

function QuestionMark3D({ color }: { color: string }) {
    const mountRef = useRef<HTMLDivElement>(null)
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
    const frameRef = useRef<number>(0)

    useEffect(() => {
        const mount = mountRef.current
        if (!mount) return

        const width = mount.clientWidth
        const height = mount.clientHeight

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
        camera.position.set(0, 0, 5)

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
        renderer.setSize(width, height)
        renderer.setPixelRatio(window.devicePixelRatio)
        renderer.setClearColor(0x000000, 0)
        mount.appendChild(renderer.domElement)
        rendererRef.current = renderer

        // Lighting
        const ambient = new THREE.AmbientLight(0xffffff, 0.6)
        scene.add(ambient)
        const directional = new THREE.DirectionalLight(0xffffff, 1.0)
        directional.position.set(2, 3, 4)
        scene.add(directional)
        const backLight = new THREE.DirectionalLight(0xffffff, 0.3)
        backLight.position.set(-2, -1, -3)
        scene.add(backLight)

        // Parse font and create text geometry
        const loader = new FontLoader()
        const font = loader.parse(helvetikerBold)
        const geometry = new TextGeometry('?', {
            font,
            size: 2.2,
            depth: 0.4,
            curveSegments: 1,
            bevelEnabled: false,
            steps: 1
        })
        geometry.center()

        const threeColor = new THREE.Color(color)
        const material = new THREE.MeshBasicMaterial({
            color: threeColor,
            wireframe: true
        })
        const mesh = new THREE.Mesh(geometry, material)
        scene.add(mesh)

        // Momentum physics — world-space rotation so it always spins "right" visually
        const worldY = new THREE.Vector3(0, 1, 0)
        const worldX = new THREE.Vector3(1, 0, 0)
        let velocityY = 0.006 // idle spin
        let velocityX = 0
        let isDragging = false
        let lastMouseX = 0
        let lastMouseY = 0
        let dragDist = 0
        const friction = 0.97
        const idleSpeed = 0.1

        const onMouseDown = (e: MouseEvent) => {
            isDragging = true
            dragDist = 0
            lastMouseX = e.clientX
            lastMouseY = e.clientY
            mount.style.cursor = 'grabbing'
        }

        const dragThreshold = 12

        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging) return
            const dx = e.clientX - lastMouseX
            const dy = e.clientY - lastMouseY
            dragDist += Math.abs(dx) + Math.abs(dy)
            if (dragDist >= dragThreshold) {
                velocityY = dx * 0.008
                velocityX = dy * 0.008
                mesh.rotateOnWorldAxis(worldY, velocityY)
                mesh.rotateOnWorldAxis(worldX, velocityX)
            }
            lastMouseX = e.clientX
            lastMouseY = e.clientY
        }

        const onMouseUp = () => {
            if (dragDist < dragThreshold) {
                // Click (not drag) — add spin momentum
                velocityY += 0.06
                velocityX += 0.03
            }
            isDragging = false
            mount.style.cursor = 'grab'
        }

        mount.style.cursor = 'grab'
        mount.addEventListener('mousedown', onMouseDown)
        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)

        const animate = () => {
            frameRef.current = requestAnimationFrame(animate)
            // Always apply momentum — drag overwrites velocity via onMouseMove
            mesh.rotateOnWorldAxis(worldY, velocityY)
            mesh.rotateOnWorldAxis(worldX, velocityX)
            if (!isDragging) {
                velocityX *= friction
                velocityY *= friction
                // Settle back to idle Y spin when momentum is nearly gone
                if (Math.abs(velocityY) < 0.001 && Math.abs(velocityX) < 0.001) {
                    velocityY += (idleSpeed - velocityY) * 0.02
                    velocityX *= 0.9
                }
            }
            renderer.render(scene, camera)
        }
        animate()

        return () => {
            cancelAnimationFrame(frameRef.current)
            mount.removeEventListener('mousedown', onMouseDown)
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
            renderer.dispose()
            geometry.dispose()
            material.dispose()
            if (mount.contains(renderer.domElement)) {
                mount.removeChild(renderer.domElement)
            }
        }
    }, [color])

    return <div ref={mountRef} className="mini-player-idle-3d" />
}

export default function MiniPlayer() {
    const [state, setState] = useState<PlaybackState>({
        title: 'Not Playing',
        artist: '',
        coverArt: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        volume: 1
    })
    const [isDragging, setIsDragging] = useState(false)
    const [dragProgress, setDragProgress] = useState(0)
    const progressRef = useRef<HTMLDivElement>(null)

    // Apply theme CSS variables
    useEffect(() => {
        const themeKey = (state.theme || 'dark') as ThemeKey
        const accent = state.accentColor || '#00ff88'
        const preset = THEME_PRESETS[themeKey] || THEME_PRESETS.dark
        const c = preset.colors
        const root = document.documentElement.style
        root.setProperty('--bg-primary', c.bgPrimary)
        root.setProperty('--bg-secondary', c.bgSecondary)
        root.setProperty('--bg-tertiary', c.bgTertiary)
        root.setProperty('--bg-glass', c.bgGlass)
        root.setProperty('--bg-glass-hover', c.bgGlassHover)
        root.setProperty('--bg-frosted', c.bgFrosted)
        root.setProperty('--text-primary', c.textPrimary)
        root.setProperty('--text-secondary', c.textSecondary)
        root.setProperty('--text-muted', c.textMuted)
        root.setProperty('--accent-primary', accent)
    }, [state.theme, state.accentColor])

    // Load initial theme from saved settings
    useEffect(() => {
        const api = window.electronAPI as any
        if (!api?.getSettings) return
        api.getSettings().then((s: any) => {
            if (s?.theme || s?.accentColor) {
                setState(prev => ({
                    ...prev,
                    theme: s.theme || 'dark',
                    accentColor: s.accentColor || '#00ff88'
                }))
            }
        })
    }, [])

    const [isChanging, setIsChanging] = useState(false)
    const lastTitleRef = useRef(state.title)

    // Listen for playback state sync from main player
    useEffect(() => {
        const api = window.electronAPI as any
        if (!api?.onPlaybackStateSync) return
        const cleanup = api.onPlaybackStateSync((newState: PlaybackState) => {
            if (newState.title !== lastTitleRef.current) {
                setIsChanging(true)
                setTimeout(() => setIsChanging(false), 500)
                lastTitleRef.current = newState.title
            }
            setState(newState)
        })
        return cleanup
    }, [])

    const sendCommand = useCallback((cmd: string) => {
        const api = window.electronAPI as any
        if (api?.miniPlayerCommand) api.miniPlayerCommand(cmd)
    }, [])

    const progress = isDragging ? dragProgress : (state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0)

    const getSeekTimeFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
        if (!progressRef.current || state.duration <= 0) return null
        const rect = progressRef.current.getBoundingClientRect()
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        return { ratio, time: ratio * state.duration }
    }, [state.duration])

    const handleProgressMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        const result = getSeekTimeFromEvent(e)
        if (!result) return
        setIsDragging(true)
        setDragProgress(result.ratio * 100)

        const handleMouseMove = (me: MouseEvent) => {
            if (!progressRef.current) return
            const rect = progressRef.current.getBoundingClientRect()
            const ratio = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width))
            setDragProgress(ratio * 100)
        }
        const handleMouseUp = (me: MouseEvent) => {
            if (progressRef.current && state.duration > 0) {
                const rect = progressRef.current.getBoundingClientRect()
                const ratio = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width))
                sendCommand(`seek:${ratio * state.duration}`)
            }
            setIsDragging(false)
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }, [getSeekTimeFromEvent, sendCommand, state.duration])

    const handleClose = useCallback(() => {
        const api = window.electronAPI as any
        if (api?.closeMiniPlayer) api.closeMiniPlayer()
    }, [])

    const [bgArt, setBgArt] = useState(state.coverArt)

    // Sync delayed background art
    useEffect(() => {
        const timer = setTimeout(() => {
            setBgArt(state.coverArt)
        }, 400) // Delay the background change
        return () => clearTimeout(timer)
    }, [state.coverArt])

    const isIdle = state.title === 'Not Playing' && !state.artist
    const [idleFading, setIdleFading] = useState(false)

    const handleIdlePlay = useCallback(() => {
        setIdleFading(true)
        sendCommand('play-random')
    }, [sendCommand])

    // Reset fade when leaving idle
    useEffect(() => {
        if (!isIdle) setIdleFading(false)
    }, [isIdle])

    return (
        <div className={`mini-player-container ${isChanging ? 'switching' : ''}`}>
            <div
                className="mini-player-background"
                style={{
                    backgroundImage: bgArt ? `url(${bgArt})` : 'none'
                }}
            />
            {isIdle ? (
                <div className={`mini-player-idle-wrapper ${idleFading ? 'fading' : ''}`}>
                    <QuestionMark3D color={state.accentColor || '#00ff88'} />
                    <div className="mini-player-controls">
                        <button onClick={() => sendCommand('prev')}><SkipBackIcon size={14} fill="currentColor" /></button>
                        <button className="mini-play-btn" onClick={handleIdlePlay}>
                            <PlayIcon size={16} fill="currentColor" />
                        </button>
                        <button onClick={() => sendCommand('next')}><SkipForwardIcon size={14} fill="currentColor" /></button>
                    </div>
                </div>
            ) : (
                <>
                    <CoverArtCube3D src={state.coverArt} artist={state.artist} album={state.album} className="mini-player-art-3d" />
                    <div className="mini-player-info">
                        <MarqueeMini text={state.title} className="mini-player-title" />
                        <MarqueeMini text={state.artist} className="mini-player-artist" />
                    </div>
                    <div
                        className="mini-player-progress"
                        ref={progressRef}
                        onMouseDown={handleProgressMouseDown}
                    >
                        <div className="mini-player-progress-fill" style={{ width: `${progress}%` }} />
                    </div>

                    <div className="mini-player-controls">
                        <button onClick={() => sendCommand('prev')}><SkipBackIcon size={14} fill="currentColor" /></button>
                        <button className="mini-play-btn" onClick={() => sendCommand('toggle')}>
                            {state.isPlaying ? <PauseIcon size={16} fill="currentColor" /> : <PlayIcon size={16} fill="currentColor" />}
                        </button>
                        <button onClick={() => sendCommand('next')}><SkipForwardIcon size={14} fill="currentColor" /></button>
                    </div>
                </>
            )}
            <button className="mini-player-expand" onClick={handleClose} title="Back to full player">
                <ExpandIcon size={13} />
            </button>
        </div>
    )
}
