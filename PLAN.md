# AudRip — Plan de nuevas funciones (v2.x → v3.0)

## Estado actual (v2.0.2)

- Descarga de YouTube (videos + playlists) y SoundCloud (solo tracks individuales)
- Reproductor de música con playlists, shuffle, repeat, búsqueda, ordenamiento
- Efectos de audio (Bass, Reverb, Pitch, Stereo Width) con presets guardables
- Trimming visual con waveform
- Metadata editing (individual + bulk) con cover art personalizable
- Conversor M4A → MP3
- Historial de descargas
- Temas dark/light con accent color personalizable
- Media Session (controles del OS)
- Cross-platform: macOS (Intel + ARM) y Windows

## Tech stack

- Frontend: React 18 + TypeScript + Vite
- Desktop: Electron 33 + electron-builder
- Binarios bundleados: yt-dlp, ffmpeg, ffprobe
- Estilos: CSS variables (sistema de theming dinámico)
- Audio: Web Audio API (efectos), WaveSurfer.js (waveform)
- Metadata: music-metadata-browser

## Arquitectura relevante

- `electron/main.ts` (~2000 líneas): IPC handlers, descargas, file system, FFmpeg
- `src/App.tsx` (~789 líneas): Shell principal, estado global, navegación
- `src/components/MusicPlayer.tsx` (~520 líneas): Reproductor completo
- `src/components/PlaylistEditor.tsx`: Cola de descargas y metadata editing
- `src/components/SettingsModal.tsx`: Panel de configuración
- `src/styles/index.css`: Variables CSS, animaciones, theming

---

## Fase 1 — Descargas y fuentes

### 1.1 SoundCloud sets/likes
- Completar soporte que ya está parcialmente en la UI (muestra "not yet supported")
- yt-dlp ya soporta sets de SoundCloud, hay que habilitar el flujo en el backend
- Reutilizar el mismo flujo de playlist de YouTube (get-playlist-info → PlaylistEditor)

### 1.2 Cola de descargas paralelas
- Actualmente las descargas son secuenciales (una a la vez)
- Implementar N descargas simultáneas con límite configurable en Settings
- Cada descarga con su propio tracking de progreso, velocidad y ETA
- UI: mostrar progreso individual por cada descarga activa

### 1.3 Descarga desde URL directa
- Soportar cualquier URL de audio/video que yt-dlp pueda manejar
- No restringir validación a youtube.com/soundcloud.com
- Detectar automáticamente si la URL es válida con yt-dlp

---

## Fase 2 — Reproductor

### 2.1 Cola de reproducción (Queue)
- "Play Next": insertar track después del actual
- "Add to Queue": agregar al final de la cola
- Cola independiente de la playlist actual
- UI: vista de cola con posibilidad de reordenar y remover items

### 2.2 Crossfade
- Transición suave entre tracks
- Duración configurable en Settings (1-12 segundos)
- Implementar con Web Audio API (dos AudioContext o gain nodes)

### 2.3 Mini player
- Ventana flotante compacta siempre visible (Electron BrowserWindow always-on-top)
- Mostrar: cover art, título, controles básicos (play/pause, skip, timeline)
- Toggle desde el reproductor principal

### 2.4 Sleep timer
- Opciones: 15/30/45/60 min, fin del track actual, personalizado
- Indicador visual de que el timer está activo
- Fade out gradual al terminar (no corte abrupto)

---

## Fase 3 — Librería

### 3.1 Edición de metadata desde librería
- Editar título, artista, álbum y cover art de archivos ya descargados
- Usar FFmpeg para re-escribir metadata en el archivo
- UI: modo edición inline o modal al hacer click en un track del player
- Actualizar la librería en memoria después de guardar

---

## Fase 4 — UX e interfaz

### 4.1 Notificaciones nativas
- Notificación del OS al completar descarga(s)
- Usar Electron Notification API
- Configurable: on/off en Settings

### 4.2 Temas preset
- Mantener Dark y Light como base
- Agregar temas completos que redefinen toda la paleta de CSS variables:
  - **Synthwave**: dark con acentos neón púrpura/magenta/cyan
  - **Nord**: tonos azulados suaves, muted
  - **Solarized**: paleta equilibrada (variante dark y light)
  - **Ocean Blue**: azules profundos, acentos cyan
  - **Sunset**: tonos cálidos naranjas/rojos
  - **Forest**: verdes oscuros naturales
  - **Rose**: tonos rosados/mauve
- Cada tema define: --bg-primary/secondary/tertiary, --text-*, --accent-*, --shadow-*, etc.
- UI: selector de temas en Settings con preview

### 4.3 Modo compacto
- Vista reducida tipo lista para la librería del reproductor
- Menos espacio por track (sin cover art grande, solo texto + duración)
- Toggle en la UI del player

---

## Fase 5 — Sistema

### 5.1 Auto-update via GitHub Releases
- Agregar dependencia: `electron-updater`
- Configurar `electron-builder` para publicar a GitHub Releases
- GitHub Actions workflow: push tag `v*` → build macOS (x64 + arm64) + Windows → publish release
- Lógica en main process: checkear updates al iniciar la app
- UX: notificación "Nueva versión disponible" con botón para instalar
- El usuario confirma antes de instalar (no silencioso)
- Requiere: repo en GitHub, PAT con scope `repo` como secret en Actions
- Pendiente: code signing (macOS/Windows mostrarán warnings sin firma)

### 5.2 Normalización de audio
- Toggle en Settings (on/off)
- Nivelar volumen entre tracks para que no haya saltos bruscos
- Opciones de implementación:
  - ReplayGain (análisis previo del archivo)
  - Loudness normalization en tiempo real con Web Audio API (DynamicsCompressorNode + GainNode)
- La opción en tiempo real es más simple y no modifica archivos

---

## Orden sugerido de implementación

1. **Fase 5.1** (Auto-update) — Infraestructura base para distribuir todo lo demás
2. **Fase 1** (Descargas) — Core de la app, alto impacto
3. **Fase 2** (Reproductor) — Mejora la experiencia diaria
4. **Fase 4** (UX) — Polish visual
5. **Fase 3** (Librería) — Complementario
6. **Fase 5.2** (Normalización) — Nice to have

## Notas para implementación

- Los CSS variables ya están centralizados en `src/styles/index.css` — el sistema de theming está listo para extender
- `electron/main.ts` maneja toda la lógica de descarga con yt-dlp y FFmpeg via child_process
- El IPC API ya tiene handlers para settings, playlists, FX presets — seguir el mismo patrón para nuevos features
- Las notificaciones de Electron requieren permisos en macOS (se piden automáticamente)
- El mini player requiere crear un segundo BrowserWindow en Electron con `alwaysOnTop: true`
