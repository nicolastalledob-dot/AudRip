
import { app, BrowserWindow, ipcMain, dialog, shell, net, Notification } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs'
import { homedir, platform } from 'os'
import { createHash } from 'crypto'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

// Configure logging
log.transports.file.level = 'info'
autoUpdater.logger = log
autoUpdater.autoDownload = false


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

// Cached settings to avoid repeated synchronous reads
let cachedSettings: { downloadFolder?: string, musicPlayerFolder?: string, mp3OutputFolder?: string } | null = null

// Read saved settings from disk (cached)
function loadSettings(): { downloadFolder?: string, musicPlayerFolder?: string, mp3OutputFolder?: string } {
    if (cachedSettings) return cachedSettings
    try {
        const settingsPath = join(app.getPath('userData'), 'settings.json')
        if (existsSync(settingsPath)) {
            cachedSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
            return cachedSettings!
        }
    } catch { }
    cachedSettings = {}
    return cachedSettings
}

// Get download directory (uses custom setting if set)
function getDownloadDir(): string {
    const settings = loadSettings()
    const dir = settings.downloadFolder || join(homedir(), 'Downloads', 'AudRip')
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
    }
    return dir
}

// Get music library directory (uses custom setting if set, falls back to download dir)
function getMusicLibraryDir(): string {
    const settings = loadSettings()
    const dir = settings.musicPlayerFolder || getDownloadDir()
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
            allowRunningInsecureContent: false,
            autoplayPolicy: 'no-user-gesture-required'
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

// Clean orphaned temp files from download folder (older than 1 hour)
function cleanupOrphanedTempFiles() {
    try {
        const downloadDir = getDownloadDir()
        const oneHourAgo = Date.now() - (60 * 60 * 1000)
        const files = readdirSync(downloadDir)
        let cleanedCount = 0

        files.filter(f => f.startsWith('yt_')).forEach(f => {
            const filePath = join(downloadDir, f)
            try {
                const stats = statSync(filePath)
                if (stats.mtimeMs < oneHourAgo) {
                    unlinkSync(filePath)
                    cleanedCount++
                    console.log('[Cleanup] Removed orphaned temp:', f)
                }
            } catch { }
        })

        if (cleanedCount > 0) {
            console.log(`[Cleanup] Cleaned ${cleanedCount} orphaned temp files`)
        }
    } catch (e) {
        console.error('[Cleanup] Error during temp cleanup:', e)
    }
}

app.whenReady().then(async () => {
    // Create window first so user sees something
    createWindow()

    // Clean orphaned temp files from previous sessions
    cleanupOrphanedTempFiles()

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

    protocol.handle('media', async (request: Request) => {
        // Use URL parsing to correctly extract the path
        // media:///Users/path = URL with empty host and path /Users/path
        // media://C:/path = URL with host "C" and path /path (Windows quirk)
        let filePath: string

        try {
            const url = new URL(request.url)
            if (url.hostname && /^[a-zA-Z]$/.test(url.hostname)) {
                filePath = `${url.hostname.toUpperCase()}:${url.pathname}`
            } else if (url.hostname) {
                filePath = `/${url.hostname}${url.pathname}`
            } else {
                filePath = url.pathname
            }
        } catch (e) {
            filePath = request.url.replace(/^media:\/\//, '')
        }

        filePath = decodeURIComponent(filePath)

        if (platform() === 'win32') {
            if (/^[a-zA-Z]:/.test(filePath)) {
                filePath = filePath.replace(/\//g, '\\')
            }
        }

        try {
            if (!existsSync(filePath)) {
                console.error('[Media Protocol] File does not exist:', filePath)
                return new Response('File not found', { status: 404 })
            }

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

            const fileBuffer = readFileSync(filePath)
            const fileSize = fileBuffer.length

            const corsHeaders = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Accept-Ranges': 'bytes'
            }

            // Handle Range requests (critical for pause/resume after buffer eviction)
            const rangeHeader = request.headers.get('range')
            if (rangeHeader) {
                const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
                if (match) {
                    const start = parseInt(match[1])
                    const end = match[2] ? parseInt(match[2]) : fileSize - 1
                    const chunk = fileBuffer.slice(start, end + 1)
                    return new Response(chunk, {
                        status: 206,
                        headers: {
                            ...corsHeaders,
                            'Content-Type': mimeType,
                            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                            'Content-Length': chunk.length.toString(),
                        }
                    })
                }
            }

            return new Response(fileBuffer, {
                status: 200,
                headers: {
                    ...corsHeaders,
                    'Content-Type': mimeType,
                    'Content-Length': fileSize.toString(),
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

        // Timeout: kill yt-dlp if it takes longer than 5 minutes
        const downloadTimeout = setTimeout(() => {
            console.error('[Main] yt-dlp timeout after 5 minutes, killing process')
            downloadProc.kill('SIGKILL')
        }, 5 * 60 * 1000)

        let stderrOutput = ''

        downloadProc.stdout.on('data', (data) => {
            const output = data.toString()
            const match = output.match(/(\d+\.?\d*)%/)
            if (match) {
                // Parse speed and ETA from yt-dlp output
                // Example: "[download] 45.2% of 5.23MiB at 2.15MiB/s ETA 00:02"
                const speedMatch = output.match(/at\s+([\d.]+\s*\w+\/s)/i)
                const etaMatch = output.match(/ETA\s+([\d:]+)/i)

                _event.sender.send('download-progress', {
                    stage: 'downloading',
                    percent: parseFloat(match[1]),
                    speed: speedMatch?.[1] || null,
                    eta: etaMatch?.[1] || null
                })
            }
        })

        downloadProc.stderr.on('data', (data) => {
            stderrOutput += data.toString()
        })

        downloadProc.on('close', async (code) => {
            clearTimeout(downloadTimeout)
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
                // Extract meaningful error from stderr
                const errLines = stderrOutput.split('\n').filter(l => l.includes('ERROR') || l.includes('error'))
                const errMsg = errLines.length > 0
                    ? errLines[errLines.length - 1].replace(/^.*ERROR:\s*/i, '').trim()
                    : `yt-dlp exit code ${code}`
                console.error('[Main] yt-dlp stderr:', stderrOutput)
                reject(new Error(errMsg))
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

            // Timeout: kill ffmpeg if it takes longer than 10 minutes
            const ffmpegTimeout = setTimeout(() => {
                console.error('[Main] FFmpeg timeout after 10 minutes, killing process')
                ffmpegProc.kill('SIGKILL')
            }, 10 * 60 * 1000)

            ffmpegProc.on('close', (fCode) => {
                clearTimeout(ffmpegTimeout)

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
                } else if (ffmpegProc.killed) {
                    reject(new Error('FFmpeg timed out after 10 minutes'))
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

// Select download folder (with ability to create new folders)
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory', 'createDirectory']
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
    cachedSettings = settings
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

// --- Music metadata cache ---
interface MusicCacheEntry {
    mtime: number
    title: string
    artist: string
    album: string
    duration: number
}

function getMusicCachePath(): string {
    return join(app.getPath('userData'), 'music-cache.json')
}

function loadMusicCache(): Record<string, MusicCacheEntry> {
    try {
        const cachePath = getMusicCachePath()
        if (existsSync(cachePath)) {
            return JSON.parse(readFileSync(cachePath, 'utf-8'))
        }
    } catch (e) {
        console.error('[MusicCache] Failed to load cache:', e)
    }
    return {}
}

function saveMusicCache(cache: Record<string, MusicCacheEntry>): void {
    try {
        writeFileSync(getMusicCachePath(), JSON.stringify(cache))
    } catch (e) {
        console.error('[MusicCache] Failed to save cache:', e)
    }
}

// Parallel executor with concurrency limit
async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
    const results: T[] = new Array(tasks.length)
    let index = 0

    async function worker() {
        while (index < tasks.length) {
            const i = index++
            results[i] = await tasks[i]()
        }
    }

    const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
    await Promise.all(workers)
    return results
}

// Get music library from music library folder
ipcMain.handle('get-music-library', async () => {
    const downloadDir = getMusicLibraryDir()
    const ffprobe = getBinaryPath(platform() === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    const ffprobeCmd = existsSync(ffprobe) ? ffprobe : 'ffprobe'

    const audioExtensions = ['.mp3', '.m4a', '.aac', '.ogg', '.flac', '.wav']

    try {
        const files = readdirSync(downloadDir)
        const audioFiles = files.filter(f => {
            const ext = f.toLowerCase().slice(f.lastIndexOf('.'))
            return audioExtensions.includes(ext)
        })

        // Load metadata cache
        const cache = loadMusicCache()
        const updatedCache: Record<string, MusicCacheEntry> = {}

        // Separate into cache hits and misses
        const cacheHits: { file: string, filePath: string, entry: MusicCacheEntry }[] = []
        const cacheMisses: { file: string, filePath: string }[] = []

        for (const file of audioFiles) {
            const filePath = join(downloadDir, file)
            try {
                const stat = statSync(filePath)
                const mtime = stat.mtimeMs
                const cached = cache[filePath]

                if (cached && cached.mtime === mtime) {
                    cacheHits.push({ file, filePath, entry: cached })
                    updatedCache[filePath] = cached
                } else {
                    cacheMisses.push({ file, filePath })
                }
            } catch {
                cacheMisses.push({ file, filePath })
            }
        }

        console.log(`[MusicLibrary] ${cacheHits.length} cache hits, ${cacheMisses.length} cache misses`)

        // Process cache misses in parallel (up to 8 concurrent ffprobe)
        const probeResults = await parallelLimit(
            cacheMisses.map(({ file, filePath }) => () => {
                return new Promise<{ file: string, filePath: string, meta: MusicCacheEntry }>((resolve) => {
                    let mtime = 0
                    try { mtime = statSync(filePath).mtimeMs } catch { }

                    const args = [
                        '-v', 'quiet',
                        '-print_format', 'json',
                        '-show_format',
                        filePath
                    ]

                    const proc = spawn(ffprobeCmd, args)
                    let stdout = ''

                    proc.stdout.on('data', (data: Buffer) => {
                        stdout += data.toString()
                    })

                    proc.on('close', (code: number | null) => {
                        if (code !== 0) {
                            const nameWithoutExt = file.slice(0, file.lastIndexOf('.'))
                            resolve({
                                file, filePath,
                                meta: { mtime, title: nameWithoutExt, artist: 'Unknown Artist', album: '', duration: 0 }
                            })
                            return
                        }

                        try {
                            const info = JSON.parse(stdout)
                            const format = info.format || {}
                            const tags = format.tags || {}

                            resolve({
                                file, filePath,
                                meta: {
                                    mtime,
                                    title: tags.title || tags.TITLE || file.slice(0, file.lastIndexOf('.')),
                                    artist: tags.artist || tags.ARTIST || 'Unknown Artist',
                                    album: tags.album || tags.ALBUM || '',
                                    duration: parseFloat(format.duration) || 0
                                }
                            })
                        } catch {
                            const nameWithoutExt = file.slice(0, file.lastIndexOf('.'))
                            resolve({
                                file, filePath,
                                meta: { mtime, title: nameWithoutExt, artist: 'Unknown Artist', album: '', duration: 0 }
                            })
                        }
                    })

                    proc.on('error', () => {
                        const nameWithoutExt = file.slice(0, file.lastIndexOf('.'))
                        resolve({
                            file, filePath,
                            meta: { mtime, title: nameWithoutExt, artist: 'Unknown Artist', album: '', duration: 0 }
                        })
                    })
                })
            }),
            8
        )

        // Add probe results to cache
        for (const result of probeResults) {
            updatedCache[result.filePath] = result.meta
        }

        // Save updated cache
        saveMusicCache(updatedCache)

        // Build tracks array (cache hits + misses, all with coverArt: null for lazy loading)
        const tracks = [
            ...cacheHits.map(({ filePath, entry }) => ({
                path: filePath,
                title: entry.title,
                artist: entry.artist,
                album: entry.album,
                duration: entry.duration,
                coverArt: null as string | null
            })),
            ...probeResults.map((result) => ({
                path: result.filePath,
                title: result.meta.title,
                artist: result.meta.artist,
                album: result.meta.album,
                duration: result.meta.duration,
                coverArt: null as string | null
            }))
        ]

        // Sort by filename to maintain consistent order
        tracks.sort((a, b) => a.path.localeCompare(b.path))

        return tracks
    } catch (e) {
        console.error('Failed to read music library:', e)
        return []
    }
})

// Get cover art for a single track (lazy loaded, cached to disk)
ipcMain.handle('get-track-cover-art', async (_event, filePath: string) => {
    if (!filePath || !existsSync(filePath)) return null

    const coversDir = join(app.getPath('userData'), 'covers')
    if (!existsSync(coversDir)) {
        mkdirSync(coversDir, { recursive: true })
    }

    // Cache key based on file path + mtime
    let mtime = 0
    try { mtime = statSync(filePath).mtimeMs } catch { return null }

    const hash = createHash('md5').update(`${filePath}:${mtime}`).digest('hex')
    const cachedPath = join(coversDir, `${hash}.jpg`)

    // Return from disk cache if available
    if (existsSync(cachedPath)) {
        try {
            const imageData = readFileSync(cachedPath)
            return `data:image/jpeg;base64,${imageData.toString('base64')}`
        } catch { }
    }

    // Extract cover art using ffmpeg
    const ffmpeg = getBinaryPath(platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    const ffmpegCmd = existsSync(ffmpeg) ? ffmpeg : 'ffmpeg'

    try {
        const coverArt = await new Promise<string | null>((resolve) => {
            const extractProc = spawn(ffmpegCmd, [
                '-i', filePath,
                '-an',
                '-vcodec', 'mjpeg',
                '-vframes', '1',
                '-y',
                cachedPath
            ])
            extractProc.on('close', (code) => {
                if (code === 0 && existsSync(cachedPath)) {
                    try {
                        const imageData = readFileSync(cachedPath)
                        resolve(`data:image/jpeg;base64,${imageData.toString('base64')}`)
                    } catch {
                        resolve(null)
                    }
                } else {
                    resolve(null)
                }
            })
            extractProc.on('error', () => resolve(null))
        })
        return coverArt
    } catch {
        return null
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

// ===== FX Presets =====

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

function getFxPresetsFilePath(): string {
    return join(app.getPath('userData'), 'fx-presets.json')
}

function loadFxPresets(): FxPreset[] {
    const filePath = getFxPresetsFilePath()
    try {
        if (existsSync(filePath)) {
            return JSON.parse(readFileSync(filePath, 'utf-8'))
        }
    } catch (e) {
        console.error('[FxPresets] Failed to load:', e)
    }
    return []
}

function saveFxPresetsToFile(presets: FxPreset[]): boolean {
    try {
        writeFileSync(getFxPresetsFilePath(), JSON.stringify(presets, null, 2))
        return true
    } catch (e) {
        console.error('[FxPresets] Failed to save:', e)
        return false
    }
}

ipcMain.handle('get-fx-presets', async () => {
    return loadFxPresets()
})

ipcMain.handle('save-fx-preset', async (_event, preset: FxPreset) => {
    console.log('[FxPresets] Saving preset:', preset)
    const presets = loadFxPresets()
    const existingIndex = presets.findIndex(p => p.id === preset.id)
    if (existingIndex >= 0) {
        presets[existingIndex] = preset
    } else {
        presets.push(preset)
    }
    const success = saveFxPresetsToFile(presets)
    console.log('[FxPresets] Save result:', success, 'Total presets:', presets.length)
    return { success, presets }
})

ipcMain.handle('delete-fx-preset', async (_event, presetId: string) => {
    const presets = loadFxPresets()
    const filtered = presets.filter(p => p.id !== presetId)
    const success = saveFxPresetsToFile(filtered)
    return { success, presets: filtered }
})

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

// ===== M4A Converter Handlers =====

// Scan paths for M4A files (supports files and folders recursively)
ipcMain.handle('scan-for-m4a', async (_event, paths: string[]) => {
    const ffprobe = getBinaryPath(platform() === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    const ffprobeCmd = existsSync(ffprobe) ? ffprobe : 'ffprobe'

    const m4aFiles: Array<{
        path: string
        filename: string
        title: string
        artist: string
        album: string
        duration: number
        coverArt: string | null
    }> = []

    // Recursively find M4A files
    const findM4AFiles = (dir: string): string[] => {
        const results: string[] = []
        try {
            const items = readdirSync(dir, { withFileTypes: true })
            for (const item of items) {
                const fullPath = join(dir, item.name)
                if (item.isDirectory()) {
                    results.push(...findM4AFiles(fullPath))
                } else if (item.isFile() && item.name.toLowerCase().endsWith('.m4a')) {
                    results.push(fullPath)
                }
            }
        } catch (e) {
            console.error('[M4A Scan] Error reading directory:', dir, e)
        }
        return results
    }

    // Process each path
    const allPaths: string[] = []
    for (const p of paths) {
        try {
            const stat = require('fs').statSync(p)
            if (stat.isDirectory()) {
                allPaths.push(...findM4AFiles(p))
            } else if (p.toLowerCase().endsWith('.m4a')) {
                allPaths.push(p)
            }
        } catch (e) {
            console.error('[M4A Scan] Error checking path:', p, e)
        }
    }

    // Extract metadata from each M4A file
    for (const filePath of allPaths) {
        try {
            const metadata = await new Promise<any>((resolve, reject) => {
                const args = [
                    '-v', 'quiet',
                    '-print_format', 'json',
                    '-show_format',
                    '-show_streams',
                    filePath
                ]
                const proc = spawn(ffprobeCmd, args)
                let stdout = ''
                proc.stdout.on('data', (data) => { stdout += data.toString() })
                proc.on('close', (code) => {
                    if (code === 0) {
                        try {
                            resolve(JSON.parse(stdout))
                        } catch {
                            reject(new Error('Failed to parse metadata'))
                        }
                    } else {
                        reject(new Error(`ffprobe failed with code ${code}`))
                    }
                })
            })

            const format = metadata.format || {}
            const tags = format.tags || {}

            // Extract cover art as base64 if present
            let coverArt: string | null = null
            try {
                const coverPath = join(app.getPath('temp'), `cover_${Date.now()}.jpg`)
                await new Promise<void>((resolve, reject) => {
                    const ffmpeg = getBinaryPath(platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
                    const ffmpegCmd = existsSync(ffmpeg) ? ffmpeg : 'ffmpeg'
                    const proc = spawn(ffmpegCmd, ['-i', filePath, '-an', '-vcodec', 'copy', '-y', coverPath])
                    proc.on('close', (code) => {
                        if (code === 0 && existsSync(coverPath)) {
                            const buffer = readFileSync(coverPath)
                            coverArt = `data:image/jpeg;base64,${buffer.toString('base64')}`
                            try { unlinkSync(coverPath) } catch { }
                        }
                        resolve()
                    })
                    proc.on('error', () => resolve())
                })
            } catch { }

            m4aFiles.push({
                path: filePath,
                filename: filePath.split('/').pop() || filePath.split('\\').pop() || filePath,
                title: tags.title || '',
                artist: tags.artist || tags.album_artist || '',
                album: tags.album || '',
                duration: parseFloat(format.duration) || 0,
                coverArt
            })
        } catch (e) {
            console.error('[M4A Scan] Error extracting metadata:', filePath, e)
        }
    }

    return m4aFiles
})

// Select M4A files via dialog
ipcMain.handle('select-m4a-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'M4A Audio', extensions: ['m4a'] }]
    })
    return result.filePaths || []
})

// Convert M4A to MP3 at 320kbps
ipcMain.handle('convert-m4a-to-mp3', async (_event, options: {
    inputPath: string
    outputFolder?: string
    metadata: { title: string; artist: string; album: string }
}) => {
    return new Promise((resolve, reject) => {
        const ffmpeg = getBinaryPath(platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
        const ffmpegCmd = existsSync(ffmpeg) ? ffmpeg : 'ffmpeg'

        // Determine output path
        const inputDir = options.inputPath.substring(0, options.inputPath.lastIndexOf('/') !== -1
            ? options.inputPath.lastIndexOf('/')
            : options.inputPath.lastIndexOf('\\'))
        const outputDir = options.outputFolder || inputDir
        const baseName = options.inputPath.split('/').pop()?.split('\\').pop()?.replace('.m4a', '') || 'output'
        const safeBaseName = baseName.replace(/[<>:"/\\|?*]/g, '_')
        const outputPath = join(outputDir, `${safeBaseName}.mp3`)

        // Ensure output directory exists
        if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true })
        }

        // FFmpeg command: convert M4A to MP3 at 320kbps, preserving metadata
        const args = [
            '-i', options.inputPath,
            '-codec:a', 'libmp3lame',
            '-b:a', '320k',
            '-map_metadata', '0',
            '-metadata', `title=${options.metadata.title}`,
            '-metadata', `artist=${options.metadata.artist}`,
            '-metadata', `album=${options.metadata.album}`,
            '-id3v2_version', '3',
            '-y',
            outputPath
        ]

        console.log(`[M4A Convert] Converting: ${options.inputPath} -> ${outputPath}`)
        const proc = spawn(ffmpegCmd, args)

        let stderr = ''
        proc.stderr.on('data', (data) => {
            stderr += data.toString()
        })

        proc.on('close', (code) => {
            if (code === 0) {
                console.log(`[M4A Convert] Success: ${outputPath}`)
                resolve({ success: true, outputPath })
            } else {
                console.error(`[M4A Convert] Failed:`, stderr)
                reject(new Error(`Conversion failed: ${stderr.slice(-200)}`))
            }
        })

        proc.on('error', (err) => {
            reject(new Error(`Failed to start ffmpeg: ${err.message}`))
        })
    })
})

// ===== Mini Player =====
let miniPlayerWindow: BrowserWindow | null = null

ipcMain.handle('open-mini-player', async (_event, screenPos?: { x: number; y: number }) => {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
        miniPlayerWindow.focus()
        return
    }

    const miniSize = 180

    // Position mini player at click location (centered on cursor)
    let x: number | undefined
    let y: number | undefined
    if (screenPos) {
        x = Math.round(screenPos.x - miniSize / 2)
        y = Math.round(screenPos.y - miniSize / 2)
    }

    miniPlayerWindow = new BrowserWindow({
        width: miniSize,
        height: miniSize,
        x,
        y,
        alwaysOnTop: true,
        frame: false,
        resizable: false,
        skipTaskbar: true,
        transparent: true,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    })

    if (process.env.VITE_DEV_SERVER_URL) {
        miniPlayerWindow.loadURL(process.env.VITE_DEV_SERVER_URL + '#/mini-player')
    } else {
        miniPlayerWindow.loadFile(join(__dirname, '../dist/index.html'), { hash: '/mini-player' })
    }

    miniPlayerWindow.on('closed', () => {
        miniPlayerWindow = null
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show()
        }
    })

    // Hide main window after mini player is ready
    miniPlayerWindow.once('ready-to-show', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.hide()
        }
    })
})

ipcMain.handle('close-mini-player', () => {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
        // Position main window centered on mini player's location
        if (mainWindow && !mainWindow.isDestroyed()) {
            const miniBounds = miniPlayerWindow.getBounds()
            const mainBounds = mainWindow.getBounds()
            const miniCenterX = miniBounds.x + miniBounds.width / 2
            const miniCenterY = miniBounds.y + miniBounds.height / 2
            mainWindow.setPosition(
                Math.round(miniCenterX - mainBounds.width / 2),
                Math.round(miniCenterY - mainBounds.height / 2)
            )
        }
        miniPlayerWindow.close()
    }
})

ipcMain.handle('sync-playback-state', (_event, state: any) => {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
        miniPlayerWindow.webContents.send('playback-state-sync', state)
    }
})

ipcMain.handle('mini-player-command', (_event, command: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mini-player-command', command)
    }
})

// ===== Metadata Editing =====
ipcMain.handle('edit-track-metadata', async (_event, options: {
    filePath: string,
    metadata: { title: string, artist: string, album: string },
    coverArt?: string
}) => {
    const ffmpegBin = getBinaryPath(platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    const ffmpegCmd = existsSync(ffmpegBin) ? ffmpegBin : 'ffmpeg'

    const ext = options.filePath.split('.').pop() || 'mp3'
    const tempOutput = options.filePath.replace(`.${ext}`, `_edited.${ext}`)

    const args: string[] = ['-i', options.filePath]

    // If cover art provided, add as input
    let coverArtTempPath: string | null = null
    if (options.coverArt && options.coverArt.startsWith('data:image')) {
        const base64Data = options.coverArt.split(';base64,').pop()
        if (base64Data) {
            coverArtTempPath = options.filePath.replace(`.${ext}`, '_cover.jpg')
            writeFileSync(coverArtTempPath, base64Data, { encoding: 'base64' })
            args.push('-i', coverArtTempPath)
        }
    }

    // Copy audio without re-encoding
    args.push('-c:a', 'copy')

    // Map streams
    if (coverArtTempPath) {
        args.push('-map', '0:a', '-map', '1:v')
        if (ext === 'mp3') {
            args.push('-id3v2_version', '3')
        }
        args.push('-disposition:v:0', 'attached_pic')
    }

    // Metadata tags
    args.push(
        '-metadata', `title=${options.metadata.title}`,
        '-metadata', `artist=${options.metadata.artist}`,
        '-metadata', `album=${options.metadata.album}`,
        '-y', tempOutput
    )

    return new Promise((resolve) => {
        const proc = spawn(ffmpegCmd, args)
        proc.on('close', (code) => {
            if (code === 0) {
                try {
                    unlinkSync(options.filePath)
                    const { renameSync } = require('fs')
                    renameSync(tempOutput, options.filePath)

                    // Invalidate cache
                    const cacheDir = join(app.getPath('userData'), 'music-cache.json')
                    if (existsSync(cacheDir)) {
                        try {
                            const cache = JSON.parse(readFileSync(cacheDir, 'utf-8'))
                            delete cache[options.filePath]
                            writeFileSync(cacheDir, JSON.stringify(cache))
                        } catch { }
                    }

                    resolve({ success: true })
                } catch (e) {
                    resolve({ success: false })
                }
            } else {
                try { if (existsSync(tempOutput)) unlinkSync(tempOutput) } catch { }
                resolve({ success: false })
            }
            if (coverArtTempPath) {
                try { if (existsSync(coverArtTempPath)) unlinkSync(coverArtTempPath) } catch { }
            }
        })
        proc.on('error', () => {
            resolve({ success: false })
        })
    })
})

// ===== Native Notifications =====
ipcMain.handle('show-notification', async (_event, options: { title: string, body: string }) => {
    if (Notification.isSupported()) {
        const notification = new Notification({
            title: options.title,
            body: options.body,
            silent: false
        })
        notification.show()
        notification.on('click', () => {
            mainWindow?.show()
            mainWindow?.focus()
        })
    }
})

// ===== Auto-Updater Logic =====

ipcMain.handle('check-for-updates', async () => {
    if (!app.isPackaged) {
        console.log('[AutoUpdater] Skipping check in dev mode')
        return { updateAvailable: false }
    }

    try {
        console.log('[AutoUpdater] Checking for updates...')
        // Force manual download
        autoUpdater.autoDownload = false
        const result = await autoUpdater.checkForUpdates()

        // If result is null, it means no update or error caught internally
        if (!result) {
            return { updateAvailable: false }
        }

        return {
            updateAvailable: result.updateInfo.version !== app.getVersion(),
            version: result.updateInfo.version,
            releaseNotes: Array.isArray(result.updateInfo.releaseNotes)
                ? result.updateInfo.releaseNotes.map(n => typeof n === 'string' ? n : n.note).join('\n')
                : (result.updateInfo.releaseNotes || '')
        }
    } catch (error) {
        console.error('[AutoUpdater] Check failed:', error)
        const errStr = String(error)
        // Suppress common "no update found" errors to avoid alerting user unnecessarily
        if (errStr.includes('Unable to find latest version') || errStr.includes('404') || errStr.includes('406')) {
            return { updateAvailable: false }
        }
        return { updateAvailable: false, error: errStr }
    }
})

ipcMain.handle('download-update', async () => {
    try {
        await autoUpdater.downloadUpdate()
        return { success: true }
    } catch (error) {
        return { success: false, error: String(error) }
    }
})

ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall()
})

// Forward auto-updater events to renderer
autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info)
    mainWindow?.webContents.send('update-available', info)
})

autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdater] Update not available')
    mainWindow?.webContents.send('update-not-available')
})

autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error:', err)
    mainWindow?.webContents.send('update-error', err.toString())
})

autoUpdater.on('download-progress', (progressObj) => {
    mainWindow?.webContents.send('auto-updater-progress', progressObj)
})

autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded:', info)
    mainWindow?.webContents.send('update-downloaded', info)
})
