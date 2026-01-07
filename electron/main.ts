
import { app, BrowserWindow, ipcMain, dialog, shell, net } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { homedir, platform } from 'os'

// Register scheme as privileged
const { protocol } = require('electron')
protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }
])

let mainWindow: BrowserWindow | null = null

// Get the path to bundled binaries with extensive path checking for Windows compatibility
function getBinaryPath(name: string): string {
    const isDev = !app.isPackaged
    const osFolder = platform() === 'darwin' ? 'mac' : 'win'
    const isWindows = platform() === 'win32'

    // Possible paths to check (in order of priority)
    const possiblePaths: string[] = []

    if (isDev) {
        // Development mode - binaries are in bin/mac or bin/win
        possiblePaths.push(join(__dirname, '..', 'bin', osFolder, name))
        possiblePaths.push(join(process.cwd(), 'bin', osFolder, name))
    } else {
        // Production mode - multiple possible locations depending on how electron-builder packages

        // 0. FIRST: Check user data directory (where auto-downloaded binaries are stored)
        // This takes priority so that downloaded binaries are found first
        const userBinDir = join(app.getPath('userData'), 'bin')
        possiblePaths.push(join(userBinDir, name))

        // 1. Standard extraResources location (resources/bin/)
        possiblePaths.push(join(process.resourcesPath, 'bin', name))

        // 2. With OS subfolder (resources/bin/win/ or resources/bin/mac/)
        possiblePaths.push(join(process.resourcesPath, 'bin', osFolder, name))

        // 3. Unpacked asar location
        possiblePaths.push(join(process.resourcesPath, 'app.asar.unpacked', 'bin', name))
        possiblePaths.push(join(process.resourcesPath, 'app.asar.unpacked', 'bin', osFolder, name))

        // 4. Directly in resources folder
        possiblePaths.push(join(process.resourcesPath, name))

        // 5. Relative to the executable (Windows specific)
        if (isWindows && process.execPath) {
            const exeDir = join(process.execPath, '..')
            possiblePaths.push(join(exeDir, 'resources', 'bin', name))
            possiblePaths.push(join(exeDir, 'bin', name))
        }

        // 6. app path variations
        const appPath = app.getAppPath()
        possiblePaths.push(join(appPath, '..', 'bin', name))
        possiblePaths.push(join(appPath, 'bin', osFolder, name))
    }

    // Find the first existing path
    for (const p of possiblePaths) {
        try {
            if (existsSync(p)) {
                console.log(`[getBinaryPath] ✓ Found ${name} at: ${p}`)
                return p
            }
        } catch (e) {
            // Ignore access errors
        }
    }

    // Log all attempted paths for debugging
    console.error(`[getBinaryPath] ✗ Binary ${name} not found!`)
    console.error(`[getBinaryPath] isDev: ${isDev}, platform: ${platform()}`)
    console.error(`[getBinaryPath] resourcesPath: ${process.resourcesPath}`)
    console.error(`[getBinaryPath] execPath: ${process.execPath}`)
    console.error(`[getBinaryPath] appPath: ${app.getAppPath()}`)
    console.error(`[getBinaryPath] Attempted paths:`)
    possiblePaths.forEach(p => {
        try {
            console.error(`  - ${p} (exists: ${existsSync(p)})`)
        } catch {
            console.error(`  - ${p} (error checking)`)
        }
    })

    // Return the primary expected path (will trigger fallback to system binary)
    return isDev ? possiblePaths[0] : join(process.resourcesPath, 'bin', name)
}

// Verify required binaries exist and return info about missing ones
function verifyBinaries(): { valid: boolean, missingBinaries: string[], paths: Record<string, string> } {
    const isWindows = platform() === 'win32'
    const ytdlpName = isWindows ? 'yt-dlp.exe' : 'yt-dlp'
    const ffmpegName = isWindows ? 'ffmpeg.exe' : 'ffmpeg'
    const ffprobeName = isWindows ? 'ffprobe.exe' : 'ffprobe'

    const ytdlpPath = getBinaryPath(ytdlpName)
    const ffmpegPath = getBinaryPath(ffmpegName)
    const ffprobePath = getBinaryPath(ffprobeName)

    const missingBinaries: string[] = []

    if (!existsSync(ytdlpPath)) {
        missingBinaries.push('yt-dlp')
    }
    // ffmpeg and ffprobe are bundled together - if one is missing, download both
    if (!existsSync(ffmpegPath) || !existsSync(ffprobePath)) {
        missingBinaries.push('ffmpeg')
    }

    return {
        valid: missingBinaries.length === 0,
        missingBinaries,
        paths: { ytdlp: ytdlpPath, ffmpeg: ffmpegPath, ffprobe: ffprobePath }
    }
}

// Get the user data bin directory (writable location for downloaded binaries)
function getUserBinDir(): string {
    const dir = join(app.getPath('userData'), 'bin')
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
    }
    return dir
}

// Download a file from URL to destination
async function downloadFile(url: string, dest: string, onProgress?: (percent: number) => void): Promise<boolean> {
    return new Promise((resolve) => {
        console.log(`[Download] Starting download: ${url}`)
        const request = net.request(url)

        request.on('response', (response) => {
            // Handle redirects
            if (response.statusCode === 302 || response.statusCode === 301) {
                const redirectUrl = response.headers.location
                if (redirectUrl && typeof redirectUrl === 'string') {
                    console.log(`[Download] Redirecting to: ${redirectUrl}`)
                    downloadFile(redirectUrl, dest, onProgress).then(resolve)
                    return
                } else if (Array.isArray(redirectUrl) && redirectUrl[0]) {
                    console.log(`[Download] Redirecting to: ${redirectUrl[0]}`)
                    downloadFile(redirectUrl[0], dest, onProgress).then(resolve)
                    return
                }
            }

            if (response.statusCode !== 200) {
                console.error(`[Download] Failed with status: ${response.statusCode}`)
                resolve(false)
                return
            }

            const totalSize = parseInt(response.headers['content-length'] as string || '0', 10)
            let downloadedSize = 0
            const chunks: Buffer[] = []

            response.on('data', (chunk) => {
                chunks.push(chunk)
                downloadedSize += chunk.length
                if (totalSize > 0 && onProgress) {
                    onProgress(Math.round((downloadedSize / totalSize) * 100))
                }
            })

            response.on('end', () => {
                try {
                    const buffer = Buffer.concat(chunks)
                    writeFileSync(dest, buffer)
                    // Make executable on Unix
                    if (platform() !== 'win32') {
                        const { chmodSync } = require('fs')
                        chmodSync(dest, 0o755)
                    }
                    console.log(`[Download] Saved to: ${dest}`)
                    resolve(true)
                } catch (e) {
                    console.error(`[Download] Failed to save:`, e)
                    resolve(false)
                }
            })
        })

        request.on('error', (error) => {
            console.error(`[Download] Error:`, error)
            resolve(false)
        })

        request.end()
    })
}

// Download missing binaries automatically
async function downloadMissingBinaries(missing: string[]): Promise<{ success: boolean, downloaded: string[], failed: string[] }> {
    const isWindows = platform() === 'win32'
    const binDir = getUserBinDir()

    const downloaded: string[] = []
    const failed: string[] = []

    // Binary download URLs
    const urls: Record<string, { url: string, filename: string }> = {
        'yt-dlp': {
            url: isWindows
                ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
                : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
            filename: isWindows ? 'yt-dlp.exe' : 'yt-dlp'
        },
        'ffmpeg': {
            url: isWindows
                ? 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
                : 'https://evermeet.cx/ffmpeg/getrelease/zip',
            filename: isWindows ? 'ffmpeg.exe' : 'ffmpeg'
        }
    }

    for (const binary of missing) {
        const info = urls[binary]
        if (!info) continue

        const destPath = join(binDir, info.filename)
        console.log(`[AutoInstall] Downloading ${binary}...`)

        // Show progress in a window
        if (mainWindow) {
            mainWindow.webContents.send('binary-download-progress', {
                binary,
                status: 'downloading',
                percent: 0
            })
        }

        // For ffmpeg, we need to handle ZIP extraction
        if (binary === 'ffmpeg') {
            // Download to temp zip first
            const tempZip = join(binDir, 'ffmpeg-temp.zip')
            const success = await downloadFile(info.url, tempZip, (percent) => {
                if (mainWindow) {
                    mainWindow.webContents.send('binary-download-progress', { binary, status: 'downloading', percent })
                }
            })

            if (success) {
                try {
                    // Extract ffmpeg from zip using unzipper or manual extraction
                    // For simplicity, we'll use a spawned process
                    if (isWindows) {
                        // On Windows, use PowerShell to extract
                        const { execSync } = require('child_process')
                        execSync(`powershell -command "Expand-Archive -Path '${tempZip}' -DestinationPath '${binDir}' -Force"`, { stdio: 'ignore' })

                        // Find ffmpeg.exe and ffprobe.exe in extracted files
                        const findBinary = (dir: string, targetName: string): string | null => {
                            try {
                                const files = readdirSync(dir, { withFileTypes: true })
                                for (const file of files) {
                                    const fullPath = join(dir, file.name)
                                    if (file.isDirectory()) {
                                        const found = findBinary(fullPath, targetName)
                                        if (found) return found
                                    } else if (file.name === targetName) {
                                        return fullPath
                                    }
                                }
                            } catch { }
                            return null
                        }

                        const { copyFileSync } = require('fs')

                        // Copy ffmpeg.exe
                        const ffmpegExe = findBinary(binDir, 'ffmpeg.exe')
                        if (ffmpegExe && ffmpegExe !== destPath) {
                            copyFileSync(ffmpegExe, destPath)
                            console.log(`[AutoInstall] Copied ffmpeg.exe to ${destPath}`)
                        }

                        // Also copy ffprobe.exe (needed for audio player)
                        const ffprobeExe = findBinary(binDir, 'ffprobe.exe')
                        const ffprobeDest = join(binDir, 'ffprobe.exe')
                        if (ffprobeExe && ffprobeExe !== ffprobeDest) {
                            copyFileSync(ffprobeExe, ffprobeDest)
                            console.log(`[AutoInstall] Copied ffprobe.exe to ${ffprobeDest}`)
                        }

                        downloaded.push(binary)
                    } else {
                        // On macOS, use unzip
                        const { execSync } = require('child_process')
                        execSync(`unzip -o "${tempZip}" -d "${binDir}"`, { stdio: 'ignore' })
                        downloaded.push(binary)
                    }

                    // Cleanup temp zip
                    try { unlinkSync(tempZip) } catch { }
                } catch (e) {
                    console.error(`[AutoInstall] Failed to extract ffmpeg:`, e)
                    failed.push(binary)
                }
            } else {
                failed.push(binary)
            }
        } else {
            // Direct download for yt-dlp
            const success = await downloadFile(info.url, destPath, (percent) => {
                if (mainWindow) {
                    mainWindow.webContents.send('binary-download-progress', { binary, status: 'downloading', percent })
                }
            })

            if (success) {
                downloaded.push(binary)
            } else {
                failed.push(binary)
            }
        }

        if (mainWindow) {
            mainWindow.webContents.send('binary-download-progress', {
                binary,
                status: downloaded.includes(binary) ? 'complete' : 'failed',
                percent: 100
            })
        }
    }

    return { success: failed.length === 0, downloaded, failed }
}

// Show dialog asking user if they want to download missing binaries
async function promptAndDownloadBinaries(missing: string[]): Promise<boolean> {
    const result = await dialog.showMessageBox(mainWindow!, {
        type: 'question',
        buttons: ['Download Now', 'Cancel'],
        defaultId: 0,
        title: 'AudRip - Components Required',
        message: 'Some required components are missing',
        detail: `The following components need to be downloaded:\n\n• ${missing.join('\n• ')}\n\nThis is a one-time download (about 100MB total). Would you like to download them now?`
    })

    if (result.response === 0) {
        // Show downloading message
        dialog.showMessageBox(mainWindow!, {
            type: 'info',
            buttons: [],
            title: 'Downloading...',
            message: 'Downloading required components',
            detail: 'Please wait while the components are being downloaded. This may take a few minutes depending on your internet connection.'
        })

        const downloadResult = await downloadMissingBinaries(missing)

        if (downloadResult.success) {
            await dialog.showMessageBox(mainWindow!, {
                type: 'info',
                buttons: ['OK'],
                title: 'Download Complete',
                message: 'All components downloaded successfully!',
                detail: 'AudRip is now ready to use.'
            })
            return true
        } else {
            await dialog.showMessageBox(mainWindow!, {
                type: 'error',
                buttons: ['OK'],
                title: 'Download Failed',
                message: 'Some components failed to download',
                detail: `Failed: ${downloadResult.failed.join(', ')}\n\nPlease check your internet connection and try again.`
            })
            return false
        }
    }

    return false
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

app.whenReady().then(async () => {
    // Create window first so user sees something
    createWindow()

    // Then verify binaries
    const binCheck = verifyBinaries()
    if (!binCheck.valid) {
        console.error('[App] Missing binaries:', binCheck.missingBinaries)
        // Prompt user to download missing binaries
        const downloaded = await promptAndDownloadBinaries(binCheck.missingBinaries)
        if (downloaded) {
            console.log('[App] Binaries downloaded successfully')
        } else {
            console.error('[App] User cancelled or download failed')
        }
    } else {
        console.log('[App] All binaries verified successfully')
        console.log('[App] yt-dlp:', binCheck.paths.ytdlp)
        console.log('[App] ffmpeg:', binCheck.paths.ffmpeg)
    }
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// Register media protocol for local file access with proper CORS headers
app.whenReady().then(() => {
    const { protocol } = require('electron')

    protocol.handle('media', async (request: { url: string }) => {
        // Use URL parsing to correctly extract the path
        // media:///Users/path = URL with empty host and path /Users/path
        // media://C:/path = URL with host "C" and path /path (Windows quirk)
        let filePath: string

        try {
            const url = new URL(request.url)
            // For file-like URLs, the pathname is what we need
            // But we also need to check hostname for Windows drive letters
            if (url.hostname && /^[a-zA-Z]$/.test(url.hostname)) {
                // Windows path: hostname is drive letter, pathname is the rest
                filePath = `${url.hostname.toUpperCase()}:${url.pathname}`
            } else if (url.hostname) {
                // Host was incorrectly parsed as first path component
                filePath = `/${url.hostname}${url.pathname}`
            } else {
                // Normal case: just use pathname
                filePath = url.pathname
            }
        } catch (e) {
            // Fallback: manual parsing
            filePath = request.url.replace(/^media:\/\//, '')
            if (filePath.startsWith('/')) {
                // Already correct
            }
        }

        filePath = decodeURIComponent(filePath)

        // Windows path fix: Convert forward slashes to backslashes for Windows paths
        if (platform() === 'win32') {
            if (/^[a-zA-Z]:/.test(filePath)) {
                filePath = filePath.replace(/\//g, '\\')
            }
        }

        console.log('[Media Protocol] Request URL:', request.url)
        console.log('[Media Protocol] Resolved path:', filePath)

        try {
            if (!existsSync(filePath)) {
                console.error('[Media Protocol] File does not exist:', filePath)
                return new Response('File not found', { status: 404 })
            }

            // Determine MIME type based on extension
            const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'))
            const mimeTypes: Record<string, string> = {
                '.mp3': 'audio/mpeg',
                '.m4a': 'audio/mp4',
                '.aac': 'audio/aac',
                '.ogg': 'audio/ogg',
                '.flac': 'audio/flac',
                '.wav': 'audio/wav',
                '.webm': 'audio/webm'
            }
            const mimeType = mimeTypes[ext] || 'audio/mpeg'

            // Read file and return as Response with CORS headers
            const fileBuffer = readFileSync(filePath)
            console.log('[Media Protocol] Serving file:', filePath, 'Size:', fileBuffer.length, 'Type:', mimeType)

            return new Response(fileBuffer, {
                status: 200,
                headers: {
                    'Content-Type': mimeType,
                    'Content-Length': fileBuffer.length.toString(),
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': '*',
                    'Accept-Ranges': 'bytes'
                }
            })
        } catch (error) {
            console.error('[Media Protocol] Error loading file:', filePath, error)
            return new Response('File not found', { status: 404 })
        }
    })
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

        // --- CONCURRENT COVER ART LOGIC START ---
        const downloadImage = (url: string, dest: string): Promise<boolean> => {
            return new Promise((resolve) => {
                const request = net.request(url)
                request.on('response', (response) => {
                    if (response.statusCode !== 200) { resolve(false); return }
                    const chunks: Buffer[] = []
                    response.on('data', (chunk) => chunks.push(chunk))
                    response.on('end', () => {
                        try {
                            const buffer = Buffer.concat(chunks)
                            writeFileSync(dest, buffer)
                            resolve(true)
                        } catch (e) { resolve(false) }
                    })
                })
                request.on('error', () => resolve(false))
                request.end()
            })
        }

        const findBestCoverArt = async (): Promise<{ path: string | null, isLegacy: boolean }> => {
            if (customArtPath && existsSync(customArtPath)) return { path: customArtPath, isLegacy: false }
            if (!options.coverArt || !options.coverArt.startsWith('http')) return { path: null, isLegacy: false }

            const tempImgPath = join(downloadDir, `yt_${tempId}_cover.jpg`)
            let fPath: string | null = null
            let isLegacy = false

            if (options.coverArt.includes('ytimg.com') || options.url.includes('youtube') || options.url.includes('youtu.be')) {
                const baseId = options.coverArt.match(/\/vi\/([^\/]+)\//)?.[1] || options.id
                if (baseId) {
                    const maxResUrl = `https://i.ytimg.com/vi/${baseId}/maxresdefault.jpg`
                    const sdUrl = `https://i.ytimg.com/vi/${baseId}/sddefault.jpg`
                    const hqUrl = `https://i.ytimg.com/vi/${baseId}/hqdefault.jpg`
                    const mqUrl = `https://i.ytimg.com/vi/${baseId}/mqdefault.jpg`

                    console.log(`[Main] Checking art (Parallel): ${maxResUrl}`)
                    if (await downloadImage(maxResUrl, tempImgPath)) {
                        fPath = tempImgPath
                    } else if (await downloadImage(sdUrl, tempImgPath)) {
                        fPath = tempImgPath; isLegacy = true
                    } else if (await downloadImage(hqUrl, tempImgPath)) {
                        fPath = tempImgPath; isLegacy = true
                    } else if (await downloadImage(mqUrl, tempImgPath)) {
                        fPath = tempImgPath; isLegacy = true
                    }
                }
            } else if (options.url.includes('soundcloud.com')) {
                const scUrl = options.coverArt
                const replacements = ['t3000x3000', 'original', 't500x500']
                for (const size of replacements) {
                    if (fPath) break
                    const highResUrl = scUrl.replace(/-\w+\.jpg$/i, `-${size}.jpg`).replace(/-\w+\.png$/i, `-${size}.png`)
                    if (highResUrl !== scUrl && await downloadImage(highResUrl, tempImgPath)) fPath = tempImgPath
                }
            }

            if (!fPath && await downloadImage(options.coverArt, tempImgPath)) fPath = tempImgPath
            return { path: fPath, isLegacy }
        }

        // Start task immediately
        const coverArtTask = findBestCoverArt()
        // --- CONCURRENT COVER ART LOGIC END ---

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

            // Wait for concurrent cover art task
            const coverResult = await coverArtTask
            let imagePath = coverResult.path
            let isLegacyThumbnail = coverResult.isLegacy
            let audioPath: string | null = null

            try {
                // Determine audio file path
                const files = readdirSync(downloadDir)
                const audioFile = files.find(f => f.startsWith(tempBaseName) && !f.endsWith('.jpg') && !f.endsWith('.jpeg') && !f.endsWith('.webp') && !f.endsWith('.png') && !f.endsWith('.part'))
                if (audioFile) audioPath = join(downloadDir, audioFile)

                if (false) { // Handle Cover Art (DISABLED - CONCURRENT LOGIC USED)
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
                                const sdUrl = `https://i.ytimg.com/vi/${baseId}/sddefault.jpg`
                                const hqUrl = `https://i.ytimg.com/vi/${baseId}/hqdefault.jpg`
                                const mqUrl = `https://i.ytimg.com/vi/${baseId}/mqdefault.jpg`

                                console.log(`[Main] Attempting maxres art: ${maxResUrl}`)
                                if (await downloadImage(maxResUrl, tempImgPath)) {
                                    imagePath = tempImgPath
                                } else {
                                    console.log(`[Main] Maxres failed. Trying sddefault: ${sdUrl}`)
                                    if (await downloadImage(sdUrl, tempImgPath)) {
                                        imagePath = tempImgPath
                                        isLegacyThumbnail = true
                                    } else {
                                        console.log(`[Main] Sddefault failed. Trying hqdefault: ${hqUrl}`)
                                        if (await downloadImage(hqUrl, tempImgPath)) {
                                            imagePath = tempImgPath
                                            isLegacyThumbnail = true
                                        } else {
                                            console.log(`[Main] Hqdefault failed. Trying mqdefault: ${mqUrl}`)
                                            if (await downloadImage(mqUrl, tempImgPath)) {
                                                imagePath = tempImgPath
                                                isLegacyThumbnail = true
                                            }
                                        }
                                    }
                                }
                            }
                        } else if (options.url.includes('soundcloud.com')) {
                            // SoundCloud specific high-res logic
                            // Urls usually look like: https://i1.sndcdn.com/artworks-...-t500x500.jpg
                            // We can try replacing the size suffix with 'original' or keep 't500x500' if it was smaller
                            const scUrl = options.coverArt
                            const replacements = ['t3000x3000', 'original', 't500x500']

                            // Try to extract the base URL without the size suffix if possible, 
                            // though SC urls are a bit variable. 
                            // Simple replacement strategy:
                            for (const size of replacements) {
                                if (imagePath) break
                                const highResUrl = scUrl.replace(/-\w+\.jpg$/i, `-${size}.jpg`).replace(/-\w+\.png$/i, `-${size}.png`)
                                if (highResUrl !== scUrl) {
                                    console.log(`[Main] Attempting SC high-res art: ${highResUrl}`)
                                    if (await downloadImage(highResUrl, tempImgPath)) {
                                        imagePath = tempImgPath
                                    }
                                }
                            }
                        }

                        // Generic fallback (original URL provided)
                        if (!imagePath) {
                            if (await downloadImage(downloadUrl, tempImgPath)) {
                                imagePath = tempImgPath
                            }
                        }
                    }

                } // End of Disabled Block
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
                console.log(`[Main] FFmpeg processing options:AspectRatio=${aspectRatio}, IsLegacy=${isLegacyThumbnail}, Path=${imagePath}`)

                if (aspectRatio === '1:1') {
                    if (isLegacyThumbnail) {
                        // Legacy thumbnails (sddefault/hqdefault) are often 4:3 with black bars (letterbox) containing 16:9 content.
                        // Filter 1: Crop to 16:9 ratio (recovers the content, removes top/bottom bars) -> Explicit center
                        // Filter 2: Scale to COVER 1000x1000
                        // Filter 3: Crop central 1000x1000
                        const cropTo169 = "crop=iw:iw*9/16:(iw-ow)/2:(ih-oh)/2"
                        const scaleTo1000 = "scale=1000:1000:force_original_aspect_ratio=increase"
                        const cropTo1000 = "crop=1000:1000"

                        ffmpegArgs.push('-vf', `${cropTo169},${scaleTo1000},${cropTo1000}`)
                    } else {
                        // Modern/HighRes
                        ffmpegArgs.push('-vf', "scale=1000:1000:force_original_aspect_ratio=increase,crop=1000:1000")
                    }
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

// Get music library from downloads folder
ipcMain.handle('get-music-library', async () => {
    const downloadDir = getDownloadDir()
    const ffprobe = getBinaryPath(platform() === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    const ffprobeCmd = existsSync(ffprobe) ? ffprobe : 'ffprobe'

    const audioExtensions = ['.mp3', '.m4a', '.aac', '.ogg', '.flac', '.wav']

    try {
        const files = readdirSync(downloadDir)
        const audioFiles = files.filter(f => {
            const ext = f.toLowerCase().slice(f.lastIndexOf('.'))
            return audioExtensions.includes(ext)
        })

        const tracks = []

        for (const file of audioFiles) {
            const filePath = join(downloadDir, file)

            try {
                // Get metadata using ffprobe
                const metadata = await new Promise<{
                    title: string
                    artist: string
                    album: string
                    duration: number
                    coverArt: string | null
                }>((resolve) => {
                    const args = [
                        '-v', 'quiet',
                        '-print_format', 'json',
                        '-show_format',
                        '-show_streams',
                        filePath
                    ]

                    const proc = spawn(ffprobeCmd, args)
                    let stdout = ''

                    proc.stdout.on('data', (data) => {
                        stdout += data.toString()
                    })

                    proc.on('close', async (code) => {
                        if (code !== 0) {
                            // Fallback to filename parsing
                            const nameWithoutExt = file.slice(0, file.lastIndexOf('.'))
                            resolve({
                                title: nameWithoutExt,
                                artist: 'Unknown Artist',
                                album: '',
                                duration: 0,
                                coverArt: null
                            })
                            return
                        }

                        try {
                            const info = JSON.parse(stdout)
                            const format = info.format || {}
                            const tags = format.tags || {}

                            // Try to extract cover art
                            let coverArt: string | null = null
                            const videoStream = (info.streams || []).find(
                                (s: { codec_type: string; codec_name: string }) =>
                                    s.codec_type === 'video' && s.codec_name !== 'mjpeg' || s.codec_name === 'mjpeg'
                            )

                            if (videoStream) {
                                // Extract cover art using ffmpeg
                                const ffmpeg = getBinaryPath(platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
                                const ffmpegCmd = existsSync(ffmpeg) ? ffmpeg : 'ffmpeg'
                                const tempDir = join(app.getPath('temp'), 'audrip-covers')
                                if (!existsSync(tempDir)) {
                                    mkdirSync(tempDir, { recursive: true })
                                }
                                const coverPath = join(tempDir, `cover_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`)

                                try {
                                    await new Promise<void>((res) => {
                                        const extractProc = spawn(ffmpegCmd, [
                                            '-i', filePath,
                                            '-an',
                                            '-vcodec', 'mjpeg',
                                            '-vframes', '1',
                                            '-y',
                                            coverPath
                                        ])
                                        extractProc.on('close', () => res())
                                        extractProc.on('error', () => res())
                                    })

                                    if (existsSync(coverPath)) {
                                        const imageData = readFileSync(coverPath)
                                        coverArt = `data:image/jpeg;base64,${imageData.toString('base64')}`
                                        try { unlinkSync(coverPath) } catch { }
                                    }
                                } catch { }
                            }

                            resolve({
                                title: tags.title || tags.TITLE || file.slice(0, file.lastIndexOf('.')),
                                artist: tags.artist || tags.ARTIST || 'Unknown Artist',
                                album: tags.album || tags.ALBUM || '',
                                duration: parseFloat(format.duration) || 0,
                                coverArt
                            })
                        } catch (e) {
                            const nameWithoutExt = file.slice(0, file.lastIndexOf('.'))
                            resolve({
                                title: nameWithoutExt,
                                artist: 'Unknown Artist',
                                album: '',
                                duration: 0,
                                coverArt: null
                            })
                        }
                    })
                })

                tracks.push({
                    path: filePath,
                    ...metadata
                })
            } catch (e) {
                console.error(`Failed to process ${file}:`, e)
            }
        }

        return tracks
    } catch (e) {
        console.error('Failed to read music library:', e)
        return []
    }
})

// ===== PLAYLIST MANAGEMENT =====

interface Playlist {
    id: string
    name: string
    description: string
    coverArt: string | null  // base64 data URL or null
    trackPaths: string[]
    createdAt: number
    updatedAt: number
}

function getPlaylistsFilePath(): string {
    return join(app.getPath('userData'), 'playlists.json')
}

function loadPlaylists(): Playlist[] {
    const filePath = getPlaylistsFilePath()
    try {
        if (existsSync(filePath)) {
            const data = readFileSync(filePath, 'utf-8')
            return JSON.parse(data)
        }
    } catch (e) {
        console.error('[Playlists] Failed to load:', e)
    }
    return []
}

function savePlaylists(playlists: Playlist[]): boolean {
    const filePath = getPlaylistsFilePath()
    try {
        writeFileSync(filePath, JSON.stringify(playlists, null, 2))
        return true
    } catch (e) {
        console.error('[Playlists] Failed to save:', e)
        return false
    }
}

// Get all playlists
ipcMain.handle('get-playlists', async () => {
    return loadPlaylists()
})

// Save (create or update) a playlist
ipcMain.handle('save-playlist', async (_event, playlist: Playlist) => {
    const playlists = loadPlaylists()
    const existingIndex = playlists.findIndex(p => p.id === playlist.id)

    if (existingIndex >= 0) {
        // Update existing
        playlists[existingIndex] = { ...playlist, updatedAt: Date.now() }
    } else {
        // Create new
        playlists.push({ ...playlist, createdAt: Date.now(), updatedAt: Date.now() })
    }

    const success = savePlaylists(playlists)
    return { success, playlists }
})

// Delete a playlist
ipcMain.handle('delete-playlist', async (_event, playlistId: string) => {
    const playlists = loadPlaylists()
    const filtered = playlists.filter(p => p.id !== playlistId)
    const success = savePlaylists(filtered)
    return { success, playlists: filtered }
})

// Add a track to a playlist
ipcMain.handle('add-track-to-playlist', async (_event, playlistId: string, trackPath: string) => {
    const playlists = loadPlaylists()
    const playlist = playlists.find(p => p.id === playlistId)

    if (!playlist) {
        return { success: false, error: 'Playlist not found' }
    }

    if (!playlist.trackPaths.includes(trackPath)) {
        playlist.trackPaths.push(trackPath)
        playlist.updatedAt = Date.now()
        const success = savePlaylists(playlists)
        return { success, playlist }
    }

    return { success: true, playlist } // Already exists
})

// Remove a track from a playlist
ipcMain.handle('remove-track-from-playlist', async (_event, playlistId: string, trackPath: string) => {
    const playlists = loadPlaylists()
    const playlist = playlists.find(p => p.id === playlistId)

    if (!playlist) {
        return { success: false, error: 'Playlist not found' }
    }

    playlist.trackPaths = playlist.trackPaths.filter(p => p !== trackPath)
    playlist.updatedAt = Date.now()
    const success = savePlaylists(playlists)
    return { success, playlist }
})
