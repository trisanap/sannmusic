# SannMusic

Music streaming PWA on port 5678, served at `https://music.trisandrean.web.id` (Cloudflare Tunnel).

## Architecture

- **Backend:** Express.js (`server.js`) — REST API, auth, streaming, transcoding, LRCLIB proxy, search, favorites enrichment
- **Frontend:** Vanilla JS SPA (`app.js`, `index.html`, `styles.css`) — Spotify-like UI with full-screen player, mobile bottom nav, collapsible sidebar, global topbar
- **Design:** Claude Design v3 — Montserrat font, emerald identity (#1fd981), floating rounded panels, full-bleed gradient heroes
- **Service worker:** `sw.js` cache v11 — bump `CACHE_NAME` on every frontend change

## Running

- **Service:** `sudo systemctl {restart,status} sannmusic` — runs as user `sann`
- **Config:** `/etc/systemd/system/sannmusic.service` — `PORT=5678`, `MUSIC_DIR=/home/sann/music`
- **Working dir:** `/home/sann/sannmusic/`

## Network

- **Server:** `sannserver` = `192.168.0.100`
- **Gaming PC (bazzite):** `192.168.0.188`, user `sann`, home = `/var/home/sann/` (Fedora-based)
- **SSH:** ed25519 key at `/root/.ssh/id_ed25519`, also on bazzite for passwordless access
- **Tailscale:** MagicDNS hijacks `.ts` hostnames — use IPs for local network

## SCP between machines

From bazzite to server (run on bazzite, NOT on server):
```bash
rsync -av /var/home/sann/path/ sann@sannserver:/home/sann/path/
```
If `sannserver` hostname doesn't resolve, use `192.168.0.100`.

Common mistake: using `192.168.0.188` from bazzite SCPs to itself, creating self-referencing `ref/ref/ref/...` loops.

To send design files for Claude Design to work on, copy current app to ref/:
```bash
rsync -av /home/sann/sannmusic/app.js /home/sann/sannmusic/styles.css /home/sann/sannmusic/index.html /home/sann/sannmusic/ref/
```
Then SCP from bazzite to pull them.

## Music library (`/home/sann/music/`)

### Naming conventions
- **Artist folders:** `Artist Name/` (contains subdirectories → classified as 'artist')
- **Album folders inside artists:** `YEAR - Album Name/` (e.g., `2015 - DAWN/`)
- **Standalone albums at root:** `Artist - Album/` (no subdirectories → classified as 'album')

### Current notable contents
- Ария — full discography 1985-2025 in FLAC (20 albums, ~160 tracks, ~6.7GB)
- Aimer, Radiohead, Tame Impala, wave to earth, Electric Light Orchestra, Keane, Carpenters, CCR, Carpenters, Tony Orlando and Dawn, Frankie Valli and The Four Seasons
- ~1000+ tracks total, mix of FLAC and MP3

## slskd (Soulseek) downloads

- **Downloads dir:** `/home/sann/slskd-data/downloads/`
- **Incomplete dir:** `/home/sann/slskd-data/incomplete/`
- **No auto-move watcher** — the watcher was disabled (couldn't handle incremental downloads, moved first track then skipped rest when destination existed)
- **Manual workflow:** When an album finishes downloading:
  ```bash
  # For artist with existing folder:
  mv "/home/sann/slskd-data/downloads/Album Folder" "/home/sann/music/Artist/YEAR - Album Name"

  # For new artist:
  mkdir -p "/home/sann/music/Artist Name"
  mv "/home/sann/slskd-data/downloads/Album Folder" "/home/sann/music/Artist Name/YEAR - Album Name"
  
  # Multi-disc albums: merge disc folders into one album folder
  mv "/home/sann/slskd-data/downloads/Disc 1/"* "/home/sann/music/Artist/YEAR - Album/"
  mv "/home/sann/slskd-data/downloads/Disc 2/"* "/home/sann/music/Artist/YEAR - Album/"
  ```
- **Critical:** After any `mkdir`/`mv`, check ownership: `ls -la /home/sann/music/` — if owned by `root`, run `sudo chown -R sann:sann "/home/sann/music/New Folder"`. Also applies to files in `/home/sann/sannmusic/` — if the node server can't write to `users.json`, `hidden.json`, playlists, or lyrics cache, run `sudo chown -R sann:sann /home/sann/sannmusic/`.

## API Reference

### Auth
All `/api/*` routes require authentication (Bearer token or `?token=` query param). Sessions are in-memory, 7-day expiry, pbkdf2-hashed passwords in `users.json`.

### Endpoints

| Endpoint | Method | Auth | Params | Description |
|----------|--------|------|--------|-------------|
| `/api/list` | GET | yes | `?dir=` | List directory with metadata (mtime, folderType, duration, lyrics, etc.) |
| `/api/stream` | GET | yes | `?path=&format=opus&bitrate=128` | Stream audio, optional on-the-fly FLAC→Opus transcoding |
| `/api/cover` | GET | yes | `?path=` | Get cover art (folder image or embedded) |
| `/api/cover` | POST | admin | `?path=`, multipart | Upload custom cover image |
| `/api/upload` | POST | admin | `?dir=`, multipart | Upload audio files |
| `/api/mkdir` | POST | admin | `{path}` | Create directory |
| `/api/rename` | POST | admin | `{oldPath, newPath}` | Rename file/folder |
| `/api/delete` | POST | admin | `{path}` | Delete file/folder |
| `/api/metadata` | GET | yes | `?path=` | Read audio tags (title, artist, album, year, genre, duration, lyrics) |
| `/api/metadata` | POST | admin | `{path, tags}` | Write audio tags |
| `/api/lyrics` | GET | yes | `?track_name=&artist_name=&album_name=&duration=` | LRCLIB proxy with local disk cache |
| `/api/search` | GET | yes | `?q=` | Case-insensitive filename search (50 results max) |
| `/api/playlists` | GET/POST | yes | | List/create playlists |
| `/api/playlists/:id` | GET/PUT/DELETE | yes | | Get/update/delete playlist (owner or admin). PUT with `{tracks: [...]}` supports reorder |
| `/api/playlists/:id/tracks` | POST/DELETE | yes | | Add/remove playlist tracks |
| `/api/playlist-cover/:id` | GET | yes | | Get playlist cover |
| `/api/favorites` | GET | yes | | Get favorites — **enriches with real file durations** if missing from stored data |
| `/api/favorites` | POST/DELETE | yes | | Add/remove favorites |
| `/api/auth/login` | POST | no | `{username, password}` | Login, returns token |
| `/api/auth/logout` | POST | yes | | Logout |
| `/api/auth/me` | GET | yes | | Current user info |
| `/api/auth/password` | PUT | yes | `{currentPassword, newPassword}` | Change own password |
| `/api/auth/users` | GET/POST | admin | | List/create users |
| `/api/auth/users/:username` | PUT/DELETE | admin | | Change user password / delete user |
| `/api/admin/hidden` | GET/POST/DELETE | admin | `{path}` | Manage hidden folders |

### Transcoding
- FLAC → Opus 128k: ~5× smaller. Opus 64k: ~10× smaller
- Supported formats: `opus`, `aac`, `mp3`
- Frontend auto-detects mobile data via `navigator.connection`:
  - Data saver → Opus 64k
  - Cellular/2G/3G → Opus 96k
  - WiFi → direct stream (no transcode)
- Only transcodes FLAC files (MP3/OGG are already small)

### Lyrics flow
1. Check embedded tags in audio file (via music-metadata)
2. If not found, call LRCLIB API via server proxy (`/api/lyrics`)
3. Server caches all LRCLIB results (hits and misses) to `/home/sann/sannmusic/lyrics/<md5>.json`

### Favorites
- Per-user, stored server-side in `favorites/<user>.json`
- GET endpoint enriches tracks with actual file durations (backfill for tracks liked before 2026-06-24)
- Album names in Favorites view are clickable → navigate to the album folder

## UI layout (v3)

- **Topbar** (`#topbar`) — global bar with logo (→Home), Home button, search field, settings/upload buttons
- **Sidebar** — "Your Library" (collapses sidebar on click), Playlists, Favorites, Folders. Collapsible to icons-only
- **Main panel** — no more `#header` bar (removed); breadcrumbs gone from UI entirely
- **Mini-player** — always visible (vinyl placeholder when idle); expand button (↗) opens full-screen player; track area no longer clickable
- **Mobile** — bottom tab nav (Home/Playlists/Favorites/Folders); floating mini-player
- **Detail heroes** — full-bleed gradients edge-to-edge; artist name clickable (navigates to artist folder); green for albums, purple for Favorites
- **Select feature** — disabled/removed from UI (button gone from topbar)

## Auth system
- **Users:** `users.json` — pbkdf2 hashed passwords with per-user salt. **Must be writable by user `sann`**
- **Sessions:** in-memory Map, 7-day expiry
- **Bootstrap:** first login to fresh server creates admin account
- **Admin:** user `sann` is admin

## Key files
- `server.js` — Backend (Express routes, auth middleware, music-metadata, ffmpeg)
- `app.js` — Frontend (FileServerAPI class, player state machine, UI rendering)
- `index.html` — Structure (login screen, topbar, sidebar, main panel, full-screen player, mobile nav, mini-player)
- `styles.css` — Complete Spotify-like theme (2,200+ lines)
- `sw.js` — Service worker (bump CACHE_NAME on every frontend deploy)
- `users.json` — Auth credentials
- `hidden.json` — Hidden folder paths
- `favorites/<user>.json` — Per-user favorites
- `playlists/*.json` — Playlist data
- `lyrics/*.json` — LRCLIB cache
- `ref/` — Staging directory for Claude Design iterations

## Known bugs fixed
- **Metadata race condition:** `items[audioIndices[tasks.length - 1]]` always wrote to the last audio file — fixed by using `items[i]` directly (the `let i` closure correctly captures each index)
- **Favorites durations missing:** Old likes stored without `duration`. Server now enriches GET /api/favorites with real file durations
- **Watcher incremental downloads:** `mv` on folder then `[[ -e $dst ]] && continue` blocked remaining tracks. Watcher disabled; manual moves only
- **users.json root-owned:** Direct shell edits left files owned by root → node couldn't write. Fixed with `chown -R sann:sann`

## Common gotchas
- **Permission errors** — `mkdir`/`mv` via Bash tool runs as root; always follow with `sudo chown -R sann:sann` on new directories in `/home/sann/music/` and files in `/home/sann/sannmusic/`
- **Stale SW cache** — bump `CACHE_NAME` in `sw.js` on every frontend change; user may need hard refresh (Ctrl+Shift+R) or unregister SW in DevTools
- **`safePath()`** in server.js blocks `..` traversal and resolves relative to `ROOT_DIR`
- **Hidden files** filtered by `isHiddenFile()` — .jpg, .nfo, .txt, .cue, .m3u, etc. are hidden from listing
- **Cover images** — server checks `cover.jpg/png/webp`, `folder.jpg`, `albumart.jpg`, then falls back to embedded cover art in audio files
- **`app.use('/api', authRequired)`** at line 263 — all `/api/*` routes after this line require auth
- **Non-admin users** restricted from upload, mkdir, rename, delete, hide/show, settings
- **Claude Design iterations** — new design files from bazzite overwrite app.js; must re-apply custom integrations: `getStreamUrl` with format/bitrate params, `shouldTranscode()`, `api.search()`, `api.getLyrics()`, `loadLyrics()` with LRCLIB fallback, `fetchLyricsFromLrclib()`, `playFromQueue()` transcoding check
