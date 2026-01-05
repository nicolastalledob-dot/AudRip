
import { app, BrowserWindow, ipcMain, dialog, shell, net } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { homedir, platform } from 'os'

let mainWindow: BrowserWindow | null = null

// Get the path to bundled binaries
function getBinaryPath(name: string): string {
    const isDev = !app.isPackaged
    const os = platform() === 'darwin' ? 'mac' : 'win'

    if (isDev) {
        return join(__dirname, '..', 'bin', os, name)
    }
    return join(process.resourcesPath, 'bin', name)
}

// Get default download directory
function getDownloadDir(): string {
    const dir = join(homedir(), 'Downloads', 'AudRip')
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
    }
    return dir
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#0a0a0f',
        webPreferences: {
            preload: join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            allowRunningInsecureContent: false
        }
    })

    // Load the app
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
        mainWindow.webContents.openDevTools()
    } else {
        mainWindow.loadFile(join(__dirname, '../dist/index.html'))
    }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

// ===== IPC Handlers =====

// Get video info from YouTube URL
ipcMain.handle('get-video-info', async (_event, url: string) => {
    return new Promise((resolve, reject) => {
        const ytdlp = getBinaryPath(platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')

        // For development, use system yt-dlp if binary doesn't exist
        const command = existsSync(ytdlp) ? ytdlp : 'yt-dlp'

        const args = [
            '--dump-json',
            '--no-playlist',
            url
        ]

        const proc = spawn(command, args)
        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', (data) => {
            stdout += data.toString()
        })

        proc.stderr.on('data', (data) => {
            stderr += data.toString()
        })

        proc.on('close', (code) => {
            if (code === 0) {
                try {
                    const info = JSON.parse(stdout)
                    // Use mqdefault (320x180, native 16:9) instead of hqdefault (480x360, 4:3 with letterboxing)
                    // This eliminates black bars when displaying as 1:1
                    const reliableThumbnail = (info.thumbnail && !info.thumbnail.includes('hqdefault'))
                        ? info.thumbnail
                        : `https://i.ytimg.com/vi/${info.id}/mqdefault.jpg`

                    resolve({
                        id: info.id,
                        title: info.title,
                        duration: info.duration,
                        thumbnail: reliableThumbnail,
                        channel: info.channel || info.uploader,
                        url: info.webpage_url || url
                    })
                } catch (e) {
                    reject(new Error('Failed to parse video info'))
                }
            } else {
                reject(new Error(stderr || 'Failed to get video info'))
            }
        })
    })
})

// Get playlist info from YouTube URL
ipcMain.handle('get-playlist-info', async (_event, url: string) => {
    return new Promise((resolve, reject) => {
        const ytdlp = getBinaryPath(platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
        const command = existsSync(ytdlp) ? ytdlp : 'yt-dlp'

        const args = [
            '--dump-json',
            '--flat-playlist',
            '--yes-playlist',
            url
        ]

        const proc = spawn(command, args)
        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', (data) => {
            stdout += data.toString()
        })

        proc.stderr.on('data', (data) => {
            stderr += data.toString()
        })

        proc.on('close', async (code) => {
            if (code === 0) {
                try {
                    // Each line is a separate JSON object
                    const lines = stdout.trim().split('\n').filter(line => line.trim())
                    const items = []

                    for (const line of lines) {
                        try {
                            const info = JSON.parse(line)

                            // Robust thumbnail extraction
                            let thumbnail = info.thumbnail
                            if (!thumbnail && info.thumbnails && Array.isArray(info.thumbnails) && info.thumbnails.length > 0) {
                                thumbnail = info.thumbnails[info.thumbnails.length - 1].url
                            }

                            // Only use YouTube fallback if it looks like YouTube
                            const isYoutube = (info.webpage_url && (info.webpage_url.includes('youtube') || info.webpage_url.includes('youtu.be'))) || (info.id && info.id.length === 11)

                            if (!thumbnail && isYoutube) {
                                thumbnail = `https://i.ytimg.com/vi/${info.id}/mqdefault.jpg`
                            }

                            // Metadata Fallback
                            let title = info.title
                            let artist = info.channel || info.uploader
                            const pUrl = info.webpage_url || info.url || ''

                            if ((!title || title === 'Unknown Title') && pUrl.includes('soundcloud.com')) {
                                try {
                                    const parts = pUrl.split('soundcloud.com/')[1].split('/')
                                    if (parts.length >= 2) {
                                        artist = artist || parts[0]
                                        title = parts[1].split('?')[0].replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
                                    }
                                } catch (e) { }
                            }

                            items.push({
                                id: info.id,
                                title: title || 'Unknown Title',
                                duration: info.duration || 0,
                                thumbnail: thumbnail || '',
                                channel: artist || 'Unknown',
                                url: pUrl || `https://www.youtube.com/watch?v=${info.id}`
                            })
                        } catch (e) {
                            // Skip malformed lines
                        }
                    }

                    if (items.length === 0) {
                        reject(new Error('No videos found in playlist'))
                    } else {
                        resolve(items)
                    }
                } catch (e) {
                    reject(new Error('Failed to parse playlist info'))
                }
            } else {
                reject(new Error(stderr || 'Failed to get playlist info'))
            }
        })
    })
})

interface ActiveDownload {
    proc: ReturnType<typeof spawn>
    cleanupPaths: string[]
}
const activeDownloads = new Map<string, ActiveDownload>()
const cancelledDownloads = new Set<string>()

ipcMain.handle('cancel-download', async (_event, id: string) => {
    console.log(`[Main] Cancel request for ID: ${id}`)
    cancelledDownloads.add(id)

    const download = activeDownloads.get(id)
    if (download) {
        console.log(`[Main] Killing process for ID: ${id}`)
        download.proc.kill('SIGKILL') // Force kill

        // Cleanup files
        setTimeout(() => {
            download.cleanupPaths.forEach(path => {
                try { if (path && existsSync(path)) unlinkSync(path) } catch (e) { console.error('Cleanup error:', e) }
                // Try .part for temp files if they exist
                try { if (path && existsSync(path + '.part')) unlinkSync(path + '.part') } catch { }
                try { if (path && existsSync(path + '.ytdl')) unlinkSync(path + '.ytdl') } catch { }
            })
        }, 200)

        activeDownloads.delete(id)
        return true
    }
    console.log(`[Main] No active process found for ID: ${id}`)
    return false
})

// Download audio from YouTube
// Download audio from YouTube
ipcMain.handle('download-audio', async (_event, options: {
    url: string,
    format: 'mp3' | 'm4a',
    metadata: { title: string, artist: string, album: string },
    coverArt?: string,
    trimStart?: number,
    trimEnd?: number,
    id?: string,
    coverArtAspectRatio?: '1:1' | '16:9'
}) => {
    return new Promise(async (resolve, reject) => {
        const ytdlp = getBinaryPath(platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
        const ytdlpCmd = existsSync(ytdlp) ? ytdlp : 'yt-dlp'

        const ffmpegBin = getBinaryPath(platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
        const ffmpegCmd = existsSync(ffmpegBin) ? ffmpegBin : 'ffmpeg'

        const downloadDir = getDownloadDir()
        const safeTitle = options.metadata.title.replace(/[<>:"/\\|?*]/g, '_')
        const outputPath = join(downloadDir, `${safeTitle}.${options.format}`)

        const tempId = options.id || Date.now().toString()
        const tempBaseName = `yt_${tempId}`
        const tempOutputTemplate = join(downloadDir, `${tempBaseName}.%(ext)s`)

        // 1. Download RAW audio + Thumbnail (Separate files)
        // We use separation to ensure we can process the image (crop) and merge robustly with ffmpeg
        // REMOVED: --convert-thumbnails (causes failures if ffmpeg not found/compat)
        // REMOVED: --ffmpeg-location (rely on PATH or handle explicitly if needed, avoid failure)
        const ytdlpArgs = [
            '-f', 'bestaudio', // Download best audio (webm/m4a)
            // '--write-thumbnail' REMOVED: We download manual HQ cover art now
            '--no-playlist',
            '--progress',
            '--force-overwrites',
            '-o', tempOutputTemplate,
            options.url
        ]

        // Only pass ffmpeg location if we are 100% sure we have a customized binary path, 
        // otherwise let yt-dlp find it in PATH.
        if (existsSync(ffmpegBin)) {
            ytdlpArgs.push('--ffmpeg-location', ffmpegBin)
        }

        // If coverArt is a base64 string (custom art), save it to a file
        let customArtPath: string | null = null
        if (options.coverArt && options.coverArt.startsWith('data:image')) {
            try {
                const base64Data = options.coverArt.split(';base64,').pop()
                if (base64Data) {
                    customArtPath = join(downloadDir, `yt_${tempId}_custom.jpg`)
                    writeFileSync(customArtPath, base64Data, { encoding: 'base64' })
                }
            } catch (e) {
                console.error('[Main] Failed to save custom album art:', e)
            }
        }

        console.log(`[Main] Starting yt-dlp separate mode: ${ytdlpArgs.join(' ')}`)

        const downloadProc = spawn(ytdlpCmd, ytdlpArgs)

        if (options.id) {
            activeDownloads.set(options.id, {
                proc: downloadProc,
                // Paths not fully known yet, will clean by prefix on cancel
                cleanupPaths: []
            })
        }

        downloadProc.stdout.on('data', (data) => {
            const output = data.toString()
            const match = output.match(/(\d+\.?\d*)%/)
            if (match) {
                _event.sender.send('download-progress', { stage: 'downloading', percent: parseFloat(match[1]) })
            }
        })

        downloadProc.stderr.on('data', (_data) => { })

        downloadProc.on('close', async (code) => {
            if (options.id) activeDownloads.delete(options.id)

            if ((options.id && cancelledDownloads.has(options.id)) || downloadProc.killed) {
                if (options.id) cancelledDownloads.delete(options.id)
                reject(new Error('Cancelled'))
                try {
                    const files = readdirSync(downloadDir).filter(f => f.startsWith(tempBaseName))
                    files.forEach(f => unlinkSync(join(downloadDir, f)))
                } catch { }
                return
            }

            if (code !== 0) {
                reject(new Error(`yt-dlp failed: ${code}`))
                return
            }

            // 2. Locate Files
            // 2. Download Cover Art Manually (prioritize High Res, avoid 4:3 letterbox)
            _event.sender.send('download-progress', { stage: 'converting', percent: 0 })

            let audioPath: string | null = null
            let imagePath: string | null = null

            // Manual Image Download Helper
            const downloadImage = (url: string, dest: string): Promise<boolean> => {
                return new Promise((resolve) => {
                    const request = net.request(url)
                    request.on('response', (response) => {
                        if (response.statusCode !== 200) {
                            resolve(false)
                            return
                        }
                        const chunks: Buffer[] = []
                        response.on('data', (chunk) => chunks.push(chunk))
                        response.on('end', () => {
                            try {
                                const buffer = Buffer.concat(chunks)
                                writeFileSync(dest, buffer)
                                resolve(true)
                            } catch (e) {
                                resolve(false)
                            }
                        })
                    })
                    request.on('error', () => resolve(false))
                    request.end()
                })
            }

            try {
                // Determine audio file path
                const files = readdirSync(downloadDir)
                const audioFile = files.find(f => f.startsWith(tempBaseName) && !f.endsWith('.jpg') && !f.endsWith('.jpeg') && !f.endsWith('.webp') && !f.endsWith('.png') && !f.endsWith('.part'))
                if (audioFile) audioPath = join(downloadDir, audioFile)

                // Handle Cover Art
                if (customArtPath && existsSync(customArtPath)) {
                    imagePath = customArtPath
                } else if (options.coverArt && options.coverArt.startsWith('http')) {
                    // Manual download handling
                    let downloadUrl = options.coverArt
                    const tempImgPath = join(downloadDir, `yt_${tempId}_cover.jpg`)

                    // YouTube specific high-res logic
                    if (options.coverArt.includes('ytimg.com') || options.url.includes('youtube') || options.url.includes('youtu.be')) {
                        const baseId = options.coverArt.match(/\/vi\/([^\/]+)\//)?.[1] || options.id
                        if (baseId) {
                            const maxResUrl = `https://i.ytimg.com/vi/${baseId}/maxresdefault.jpg`
                            const mqUrl = `https://i.ytimg.com/vi/${baseId}/mqdefault.jpg`

                            console.log(`[Main] Attempting maxres art: ${maxResUrl}`)
                            if (await downloadImage(maxResUrl, tempImgPath)) {
                                imagePath = tempImgPath
                            } else {
                                console.log(`[Main] Falling back to mqdefault: ${mqUrl}`)
                                if (await downloadImage(mqUrl, tempImgPath)) {
                                    imagePath = tempImgPath
                                }
                            }
                        }
                    }

                    // Generic (SoundCloud etc) or if YouTube specialized failed but original might work
                    if (!imagePath) {
                        if (await downloadImage(downloadUrl, tempImgPath)) {
                            imagePath = tempImgPath
                        }
                    }
                }

                // Fallback to yt-dlp downloaded thumb if manual failed (rare)
                if (!imagePath) {
                    let imageFile = files.find(f => f.startsWith(tempBaseName) && (f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.webp') || f.endsWith('.png')))
                    if (imageFile) imagePath = join(downloadDir, imageFile)
                }
            } catch (e) {
                console.error('[Main] File location error:', e)
                reject(new Error('Failed to locate downloaded files'))
                return
            }

            if (!audioPath) {
                reject(new Error('Audio file missing'))
                return
            }

            // 3. FFmpeg Merge & Convert
            // Build FFmpeg args with correct order
            const ffmpegArgs: string[] = []

            // Trim (input-level is more precise for audio)
            if (options.trimStart !== undefined) ffmpegArgs.push('-ss', options.trimStart.toString())
            if (options.trimEnd !== undefined) ffmpegArgs.push('-to', options.trimEnd.toString())

            // Inputs
            ffmpegArgs.push('-i', audioPath)
            if (imagePath) ffmpegArgs.push('-i', imagePath)

            // Map streams
            if (imagePath) {
                ffmpegArgs.push('-map', '0:a')
                ffmpegArgs.push('-map', '1:0')
            } else {
                ffmpegArgs.push('-map', '0:a')
            }

            // Cover Art Processing
            if (imagePath) {
                ffmpegArgs.push('-c:v', 'mjpeg')
                ffmpegArgs.push('-pix_fmt', 'yuv420p')

                // Default to 1:1 if not specified
                const aspectRatio = options.coverArtAspectRatio || '1:1'
                console.log(`[Main] Cover art aspect ratio: ${aspectRatio}`)

                // Use filter chain that matches CSS 'object-fit: cover' behavior exactly:
                // Scale so the image COVERS the target box, then crop center.
                // This prevents the "zoomed in" look from aggressive pre-cropping.
                if (aspectRatio === '1:1') {
                    // Scale to fill 1400x1400 (force_original_aspect_ratio=increase ensure min dim is 1400)
                    // Then crop central 1400x1400
                    ffmpegArgs.push('-vf', 'scale=1400:1400:force_original_aspect_ratio=increase,crop=1400:1400')
                } else if (aspectRatio === '16:9') {
                    // Scale to fill 1920x1080, then crop center
                    ffmpegArgs.push('-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080')
                }

                ffmpegArgs.push('-disposition:v', 'attached_pic')
            }

            // Audio Codec
            if (options.format === 'mp3') {
                ffmpegArgs.push('-c:a', 'libmp3lame', '-q:a', '2', '-id3v2_version', '3')
            } else {
                ffmpegArgs.push('-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart')
                ffmpegArgs.push('-f', 'ipod')
            }

            // Metadata
            ffmpegArgs.push(
                '-metadata', `title=${options.metadata.title}`,
                '-metadata', `artist=${options.metadata.artist}`,
                '-metadata', `album=${options.metadata.album}`,
                '-y', outputPath
            )

            console.log(`[Main] FFmpeg processing: ${ffmpegArgs.join(' ')}`)
            const ffmpegProc = spawn(ffmpegCmd, ffmpegArgs)

            ffmpegProc.on('close', (fCode) => {
                // Cleanup ALL temps (audio, images, eventual yt-dlp leftovers)
                try {
                    const files = readdirSync(downloadDir)
                    const tempFiles = files.filter(f => f.startsWith(tempBaseName))
                    tempFiles.forEach(f => {
                        try { unlinkSync(join(downloadDir, f)) } catch { }
                    })
                } catch { }

                if (fCode === 0) {
                    _event.sender.send('download-progress', { stage: 'complete', percent: 100 })
                    resolve({ success: true, path: outputPath })
                } else {
                    reject(new Error(`FFmpeg failed: ${fCode}`))
                }
            })
        })
    })
})

// Open file in folder
ipcMain.handle('show-in-folder', async (_event, path: string) => {
    shell.showItemInFolder(path)
})

// Select download folder
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory']
    })
    return result.filePaths[0] || null
})

// Get download history
ipcMain.handle('get-history', async () => {
    const historyPath = join(app.getPath('userData'), 'history.json')
    if (existsSync(historyPath)) {
        return JSON.parse(readFileSync(historyPath, 'utf-8'))
    }
    return []
})

ipcMain.handle('clear-history', async () => {
    const historyPath = join(app.getPath('userData'), 'history.json')
    writeFileSync(historyPath, JSON.stringify([]))
    return true
})

ipcMain.handle('save-settings', async (_event, settings) => {
    const path = join(app.getPath('userData'), 'settings.json')
    writeFileSync(path, JSON.stringify(settings))
    return true
})

ipcMain.handle('get-settings', async () => {
    const path = join(app.getPath('userData'), 'settings.json')
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'))
    return null
})

// Save to download history
ipcMain.handle('save-to-history', async (_event, item: { artist?: string, album?: string }) => {
    const historyPath = join(app.getPath('userData'), 'history.json')
    let history: object[] = []
    if (existsSync(historyPath)) {
        history = JSON.parse(readFileSync(historyPath, 'utf-8'))
    }
    history.unshift(item)
    history = history.slice(0, 50) // Keep last 50 items
    writeFileSync(historyPath, JSON.stringify(history, null, 2))

    // Also save artist/album to metadata history
    const metaPath = join(app.getPath('userData'), 'metadata-history.json')
    let metaHistory: { artists: string[], albums: string[] } = { artists: [], albums: [] }
    if (existsSync(metaPath)) {
        metaHistory = JSON.parse(readFileSync(metaPath, 'utf-8'))
    }

    if (item.artist && !metaHistory.artists.includes(item.artist)) {
        metaHistory.artists.unshift(item.artist)
        metaHistory.artists = metaHistory.artists.slice(0, 100)
    }
    if (item.album && item.album.trim() && !metaHistory.albums.includes(item.album)) {
        metaHistory.albums.unshift(item.album)
        metaHistory.albums = metaHistory.albums.slice(0, 100)
    }

    writeFileSync(metaPath, JSON.stringify(metaHistory, null, 2))
})

// Get metadata history (artists and albums)
ipcMain.handle('get-metadata-history', async () => {
    const metaPath = join(app.getPath('userData'), 'metadata-history.json')
    if (existsSync(metaPath)) {
        return JSON.parse(readFileSync(metaPath, 'utf-8'))
    }
    return { artists: [], albums: [] }
})

// Extract frames from a video URL
ipcMain.handle('extract-frames', async (_event, url: string, count: number = 6) => {
    return new Promise((resolve, reject) => {
        const ytdlp = getBinaryPath(platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
        const ffmpeg = getBinaryPath(platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')

        const ytdlpCmd = existsSync(ytdlp) ? ytdlp : 'yt-dlp'
        const ffmpegCmd = existsSync(ffmpeg) ? ffmpeg : 'ffmpeg'

        const tempDir = join(app.getPath('temp'), 'ytad-frames')
        if (!existsSync(tempDir)) {
            mkdirSync(tempDir, { recursive: true })
        }

        // First, get video duration
        const infoArgs = ['--dump-json', '--no-playlist', url]
        const infoProc = spawn(ytdlpCmd, infoArgs)
        let stdout = ''

        infoProc.stdout.on('data', (data) => {
            stdout += data.toString()
        })

        infoProc.on('close', async (code) => {
            if (code !== 0) {
                reject(new Error('Failed to get video info for frames'))
                return
            }

            try {
                const info = JSON.parse(stdout)
                const duration = info.duration || 60

                // Calculate timestamps for frames (evenly distributed)
                const timestamps: number[] = []
                for (let i = 0; i < count; i++) {
                    timestamps.push(Math.floor((duration / (count + 1)) * (i + 1)))
                }

                // Get video URL for ffmpeg
                const getUrlArgs = ['-f', 'bestvideo[height<=720]', '-g', '--no-playlist', url]
                const urlProc = spawn(ytdlpCmd, getUrlArgs)
                let videoUrl = ''

                urlProc.stdout.on('data', (data) => {
                    videoUrl += data.toString().trim()
                })

                urlProc.on('close', async (urlCode) => {
                    if (urlCode !== 0 || !videoUrl) {
                        // Fallback: use thumbnail variations
                        const frames = timestamps.map(() => {
                            return info.thumbnail || `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`
                        })
                        resolve(frames)
                        return
                    }

                    // Extract frames using ffmpeg
                    const frames: string[] = []

                    for (let i = 0; i < timestamps.length; i++) {
                        const outputPath = join(tempDir, `frame_${Date.now()}_${i}.jpg`)

                        const ffmpegArgs = [
                            '-ss', timestamps[i].toString(),
                            '-i', videoUrl,
                            '-vframes', '1',
                            '-q:v', '2',
                            '-y',
                            outputPath
                        ]

                        try {
                            await new Promise<void>((res) => {
                                const proc = spawn(ffmpegCmd, ffmpegArgs)
                                proc.on('close', (c) => {
                                    if (c === 0 && existsSync(outputPath)) {
                                        const imageData = readFileSync(outputPath)
                                        frames.push(`data:image/jpeg;base64,${imageData.toString('base64')}`)
                                        try { unlinkSync(outputPath) } catch (e) { /* ignore */ }
                                    }
                                    res()
                                })
                                proc.on('error', () => res())
                            })
                        } catch (e) {
                            // Continue with other frames
                        }
                    }

                    resolve(frames.length > 0 ? frames : [info.thumbnail])
                })
            } catch (e) {
                reject(new Error('Failed to parse video info'))
            }
        })
    })
})

// Select image file
ipcMain.handle('select-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile'],
        filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }
        ]
    })

    if (result.filePaths[0]) {
        const imagePath = result.filePaths[0]
        const imageData = readFileSync(imagePath)
        const ext = imagePath.split('.').pop()?.toLowerCase() || 'jpg'
        const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
        return `data:${mimeType};base64,${imageData.toString('base64')}`
    }
    return null
})

// Process album art (crop/resize for aspect ratio)
ipcMain.handle('process-album-art', async (_event, options: {
    imageData: string,
    aspectRatio: '1:1' | '16:9',
    size?: number
}) => {
    const ffmpeg = getBinaryPath(platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    const ffmpegCmd = existsSync(ffmpeg) ? ffmpeg : 'ffmpeg'

    const tempDir = join(app.getPath('temp'), 'ytad-art')
    if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true })
    }

    const base64Data = options.imageData.replace(/^data:image\/\w+;base64,/, '')
    const inputPath = join(tempDir, `input_${Date.now()}.jpg`)
    const outputPath = join(tempDir, `output_${Date.now()}.jpg`)

    writeFileSync(inputPath, Buffer.from(base64Data, 'base64'))

    return new Promise((resolve, reject) => {
        const size = options.size || 500
        const width = options.aspectRatio === '16:9' ? size : size
        const height = options.aspectRatio === '16:9' ? Math.round(size * 9 / 16) : size

        const ffmpegArgs = [
            '-i', inputPath,
            '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
            '-y',
            outputPath
        ]

        const proc = spawn(ffmpegCmd, ffmpegArgs)

        proc.on('close', (code) => {
            try { require('fs').unlinkSync(inputPath) } catch (e) { /* ignore */ }

            if (code === 0 && existsSync(outputPath)) {
                const imageData = readFileSync(outputPath)
                const result = `data:image/jpeg;base64,${imageData.toString('base64')}`
                try { require('fs').unlinkSync(outputPath) } catch (e) { /* ignore */ }
                resolve(result)
            } else {
                reject(new Error('Failed to process album art'))
            }
        })
    })
})

