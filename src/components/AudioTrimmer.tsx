import { useCallback, useRef, useEffect, useState } from 'react'

interface TrimRange {
    start: number
    end: number
}

interface AudioTrimmerProps {
    duration: number
    trimRange: TrimRange | null
    onTrimChange: (range: TrimRange) => void
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
}

function AudioTrimmer({ duration, trimRange, onTrimChange }: AudioTrimmerProps) {
    const timelineRef = useRef<HTMLDivElement>(null)
    const [isDragging, setIsDragging] = useState<'start' | 'end' | 'range' | null>(null)
    const [dragStartX, setDragStartX] = useState(0)
    const [initialRange, setInitialRange] = useState<TrimRange | null>(null)

    const start = trimRange?.start ?? 0
    const end = trimRange?.end ?? duration

    // Convert time to percentage
    const timeToPercent = useCallback((time: number): number => {
        if (duration <= 0) return 0
        return (time / duration) * 100
    }, [duration])

    // Convert position to time
    const positionToTime = useCallback((clientX: number): number => {
        if (!timelineRef.current || duration <= 0) return 0
        const rect = timelineRef.current.getBoundingClientRect()
        const relativeX = Math.max(0, Math.min(clientX - rect.left, rect.width))
        return (relativeX / rect.width) * duration
    }, [duration])

    // Handle mouse down on handles
    const handleMouseDown = useCallback((e: React.MouseEvent, type: 'start' | 'end' | 'range') => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(type)
        setDragStartX(e.clientX)
        setInitialRange({ start, end })
    }, [start, end])

    // Handle mouse move
    useEffect(() => {
        if (!isDragging || !initialRange) return

        const handleMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - dragStartX
            const rect = timelineRef.current?.getBoundingClientRect()
            if (!rect) return

            const deltaTime = (deltaX / rect.width) * duration

            if (isDragging === 'start') {
                const newStart = Math.max(0, Math.min(initialRange.start + deltaTime, end - 1))
                onTrimChange({ start: newStart, end })
            } else if (isDragging === 'end') {
                const newEnd = Math.max(start + 1, Math.min(initialRange.end + deltaTime, duration))
                onTrimChange({ start, end: newEnd })
            } else if (isDragging === 'range') {
                const rangeLength = initialRange.end - initialRange.start
                let newStart = initialRange.start + deltaTime
                let newEnd = initialRange.end + deltaTime

                if (newStart < 0) {
                    newStart = 0
                    newEnd = rangeLength
                }
                if (newEnd > duration) {
                    newEnd = duration
                    newStart = duration - rangeLength
                }

                onTrimChange({ start: newStart, end: newEnd })
            }
        }

        const handleMouseUp = () => {
            setIsDragging(null)
            setInitialRange(null)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isDragging, dragStartX, initialRange, duration, start, end, onTrimChange])

    // Click on timeline to set position
    const handleTimelineClick = useCallback((e: React.MouseEvent) => {
        if (isDragging) return
        const time = positionToTime(e.clientX)

        const distToStart = Math.abs(time - start)
        const distToEnd = Math.abs(time - end)

        if (distToStart < distToEnd) {
            onTrimChange({ start: Math.min(time, end - 1), end })
        } else {
            onTrimChange({ start, end: Math.max(time, start + 1) })
        }
    }, [positionToTime, start, end, isDragging, onTrimChange])

    // Generate time markers


    return (
        <div className="panel audio-trimmer-panel">
            <h4 className="panel-title">Trim</h4>
            <div className="trimmer-visual">
                {/* Timeline */}
                <div
                    ref={timelineRef}
                    className="timeline"
                    onClick={handleTimelineClick}
                >
                    {/* Selected range highlight */}
                    <div
                        className={`timeline-range ${isDragging === 'range' ? 'dragging' : ''}`}
                        style={{
                            left: `${timeToPercent(start)}%`,
                            width: `${timeToPercent(end - start)}%`
                        }}
                        onMouseDown={(e) => handleMouseDown(e, 'range')}
                    />

                    {/* Start handle */}
                    <div
                        className={`timeline-handle start ${isDragging === 'start' ? 'dragging' : ''}`}
                        style={{ left: `${timeToPercent(start)}%` }}
                        onMouseDown={(e) => handleMouseDown(e, 'start')}
                    >
                        <div className="handle-grip" />
                    </div>

                    {/* End handle */}
                    <div
                        className={`timeline-handle end ${isDragging === 'end' ? 'dragging' : ''}`}
                        style={{ left: `${timeToPercent(end)}%` }}
                        onMouseDown={(e) => handleMouseDown(e, 'end')}
                    >
                        <div className="handle-grip" />
                    </div>
                </div>

                {/* Info */}
                <div className="trim-info-simple">
                    <div className="trim-time">
                        <span className="trim-label">Start: </span>
                        <span className="trim-value">{formatTime(start)}</span>
                    </div>
                    <div className="trim-time">
                        <span className="trim-label">End: </span>
                        <span className="trim-value">{formatTime(end)}</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default AudioTrimmer
