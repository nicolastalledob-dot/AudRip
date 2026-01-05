# AudRip

Una aplicación de escritorio para descargar audio de **YouTube** y **SoundCloud** en formato MP3 o M4A, con edición de metadatos completa y recorte de audio.

![Screenshot](./docs/screenshot.png)

## ✨ Características

### Plataformas Soportadas
- 📺 **YouTube**: Videos individuales y playlists completas
- 🔊 **SoundCloud**: Canciones individuales (playlists próximamente)

### Funcionalidades
- 🎵 **Formatos**: MP3 o M4A (AAC) con alta calidad
- ✏️ **Metadatos**: Edita título, artista y álbum antes de descargar
- 🖼️ **Carátulas**: Selecciona frames del video, sube imágenes propias, o usa el thumbnail
- ✂️ **Recorte**: Ajusta inicio y fin del audio con visualización de waveform
- 📚 **Playlists**: Descarga playlists completas de YouTube con edición en lote
- 📜 **Historial**: Accede a tus descargas recientes organizadas por fecha
- 🎨 **UI Moderna**: Diseño glassmorphism con tema oscuro y animaciones fluidas

## 📋 Requisitos

### Para desarrollo
- Node.js 18+
- yt-dlp (instalado globalmente o en PATH)
- ffmpeg (instalado globalmente o en PATH)

### Instalación de dependencias externas

**macOS:**
```bash
brew install yt-dlp ffmpeg
```

**Windows:**
```powershell
winget install yt-dlp.yt-dlp
winget install FFmpeg.FFmpeg
```

## 🚀 Desarrollo

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/audrip.git
cd audrip

# Instalar dependencias
npm install

# Iniciar en modo desarrollo
npm run dev
```

## 📦 Empaquetado

```bash
# Crear ejecutable para tu plataforma actual
npm run electron:build
```

Los ejecutables se guardarán en la carpeta `release/`.

## 📁 Estructura del Proyecto

```
├── electron/           # Proceso principal de Electron
│   ├── main.ts        # Entry point, IPC handlers
│   └── preload.ts     # API bridge al renderer
├── src/               # Frontend React
│   ├── components/    # Componentes UI
│   │   ├── PlaylistEditor.tsx
│   │   ├── DownloadHistory.tsx
│   │   ├── AudioTrimmer.tsx
│   │   ├── AlbumArtEditor.tsx
│   │   └── ...
│   ├── styles/        # CSS
│   └── App.tsx        # Componente principal
├── bin/               # Binarios bundled (yt-dlp, ffmpeg)
│   ├── mac/
│   └── win/
└── release/           # Ejecutables empaquetados
```

## 📖 Uso

### YouTube
1. **Pegar URL**: Copia un link de YouTube (video o playlist)
2. **Seleccionar**: Si es una playlist, elige descargar un video o toda la playlist
3. **Editar**: Modifica metadatos, selecciona carátula, ajusta recorte
4. **Descargar**: Click en "Download Now"

### SoundCloud
1. **Pegar URL**: Copia el link de una canción de SoundCloud
2. **Editar**: Modifica los metadatos como desees
3. **Descargar**: Click en "Download Now"

> **Nota**: Las playlists/sets de SoundCloud aún no están soportadas debido a limitaciones de la API.

Los archivos se guardan en `~/Downloads/AudRip/`.

## 🛠️ Tecnologías

- **Electron** - Framework de aplicación desktop
- **Vite** - Build tool con HMR
- **React + TypeScript** - UI y tipado
- **yt-dlp** - Descarga de YouTube y SoundCloud
- **FFmpeg** - Conversión, recorte y embedding de metadatos
- **wavesurfer.js** - Visualización de waveform

## 📄 Licencia

MIT
