# SannMusic

Music streaming PWA on port 5678, served at `https://music.3san.fyi` (Cloudflare Tunnel; `music.trisandrean.web.id` is dual-served until cutover).

## Architecture

- **Backend:** Express.js (`server.js`) — REST API, auth, streaming, transcoding, LRCLIB proxy, search, favorites enrichment
- **Frontend:** Vanilla JS SPA (`app.js`, `index.html`, `styles.css`) — Spotify-like UI with full-screen player, mobile bottom nav, collapsible sidebar, global topbar
- **Design:** Claude Design v3 — Montserrat font, emerald identity (#1fd981), floating rounded panels, full-bleed gradient heroes
- **Service worker:** `sw.js` — bump `CACHE_NAME` on every frontend change

## Running

- **Service:** `sudo systemctl {restart,status} sannmusic` — runs as user `sann`
- **Config:** `/etc/systemd/system/sannmusic.service` — `PORT=5678`, `MUSIC_DIR=/mnt/data/music`, `RequiresMountsFor=/mnt/data` (service refuses to start if the disk isn't mounted)
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

## Music library (`/mnt/data/music/`)

Moved off the OS NVMe to `/mnt/data` on 2026-09-18 (was `/home/sann/music`, 54GB on a 228GB root at 76% full). `/mnt/data` is a 1TB WD Blue 2.5" 5400rpm SATA drive (`sda`) that also carries a stale Nextcloud data dir (`/mnt/data/nextcloud`, ~37GB, untouched since 2026-06-27 — Nextcloud itself is gone). Expect slower folder listings than NVMe because listing parses tags per track.

### Layout (reorganized 2026-09-18)
The root holds exactly two music folders — previously artists and standalone albums were mixed at the root and the app guessed which was which:
- `Artists/Artist Name/YEAR - Album Name/` — one folder per artist, albums inside
- `Albums/Artist - Album/` — standalone albums, OSTs, compilations, misc groupings
- `.thumbnails/` and any other dot-prefixed entry is skipped by the server's listing and by `db.js` — nothing in the app can see it (including `.Feast/`, which lives under `Artists/` but stays invisible)

The server still sets `folderType` per folder (`artist` when it contains subdirectories, `album` when it holds only audio, `mixed` for both) and the client shows it as the card subtitle. The old curated-root grouping in `renderItems()` was removed — at root it would have labelled the two folders "Artists (2)", since both contain subdirectories.

### Current notable contents
- Ария — full discography 1985-2025 in FLAC (20 albums, ~160 tracks, ~6.7GB)
- Любэ — 2002 - Давай за, 1996 - Комбат
- 이희상, Bershy, Epitone Project, Sidney Gish, The Black Skirts, Dawid Podsiadło, мой друг магнитофон, Станислав Юрко, Денис Майданов
- Aimer, Radiohead, Tame Impala, wave to earth, Electric Light Orchestra, Keane, Carpenters, CCR, Tony Orlando and Dawn, Frankie Valli and The Four Seasons
- Cyberpunk 2077 radio compilations (in `Albums/`): 89.3 RADIO VEXELSTROM, 89.7 Growl FM, 98.7 Body Heat Radio (2020), plus SAMURAI (2020) and Vladivostok FM
- 2,334 indexed tracks (2,594 files incl. artwork), mix of FLAC and MP3 — 62 artist folders, 14 standalone albums

## slskd (Soulseek) downloads

- **Downloads dir:** `/home/sann/slskd-data/downloads/`
- **Incomplete dir:** `/home/sann/slskd-data/incomplete/`
- **No auto-move watcher** — the watcher was disabled (couldn't handle incremental downloads, moved first track then skipped rest when destination existed)
- **Manual workflow:** When an album finishes downloading — everything goes under `Artists/` (artist-owned albums) or `Albums/` (standalone, soundtracks, compilations):
  ```bash
  # For artist with existing folder:
  mv "/home/sann/slskd-data/downloads/Album Folder" "/mnt/data/music/Artists/Artist/YEAR - Album Name"

  # For new artist:
  mkdir -p "/mnt/data/music/Artists/Artist Name"
  mv "/home/sann/slskd-data/downloads/Album Folder" "/mnt/data/music/Artists/Artist Name/YEAR - Album Name"

  # Standalone album / OST / compilation (no artist folder):
  mv "/home/sann/slskd-data/downloads/Album Folder" "/mnt/data/music/Albums/Album Name"

  # Multi-disc albums: merge disc folders into one album folder
  mv "/home/sann/slskd-data/downloads/Disc 1/"* "/mnt/data/music/Artists/Artist/YEAR - Album/"
  mv "/home/sann/slskd-data/downloads/Disc 2/"* "/mnt/data/music/Artists/Artist/YEAR - Album/"
  ```
- **Moving or renaming anything breaks stored paths.** `favorites/`, `recent/`, and `playlists/` store library-relative paths, so a bare `mv` orphans every like/playlist entry pointing at that folder. Rewrite those JSON files in the same pass (see the 2026-09-18 reorg: `/mnt/green/BACKUP/pre-artists-move-2026-09-18/` holds the pre-move copies), and the SQLite index just needs a rescan.
- **Critical:** After any `mkdir`/`mv`, check ownership: `ls -la /mnt/data/music/` — if owned by `root`, run `sudo chown -R sann:sann "/mnt/data/music/New Folder"`. Also applies to files in `/home/sann/sannmusic/` — if the node server can't write to `users.json`, `hidden.json`, playlists, or lyrics cache, run `sudo chown -R sann:sann /home/sann/sannmusic/`.

### Other services that mounted the library
Both containers still reference the deleted `/home/sann/music` path — harmless, but stale:
- **Navidrome** — compose at `/home/sann/navidrome/docker-compose.yml` (`/music`, read-only). No longer used; its library empties/purges on the next scan. Safe to stop or delete.
- **slskd** — its `/music` mount was only ever a leftover: downloads live in `/home/sann/slskd-data/` (mounted as `/app`) and are moved into the library by hand. The stale mount can be dropped whenever the container is next recreated. Requires a manual `docker run` (no compose file) — ports 5030/5031/50300, `restart=always`.

### Non-slskd downloads
- Loose MP3s (no album folder): create `Artists/Artist/Синглы/` and place there.
- `/mnt/green/Music/` is now the **backup destination** (see Backups) — don't drop downloads there.

### Manual lyrics caching
- Server caches LRCLIB responses to `/home/sann/sannmusic/lyrics/<md5>.json`
- Cache key: `MD5(artist_name|track_name|album_name|duration)` — duration is `parseInt` of seconds
- To inject lyrics from a `.txt` file: compute the hash, write `{id, trackName, artistName, albumName, duration, plainLyrics, syncedLyrics: null, cached: true}`

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
| `/api/recent` | GET | yes | | Get recently played (per user, max 20, newest first) |
| `/api/recent` | POST/DELETE | yes | `{tracks: [...]}` / `{path}` | Record plays (array applied oldest→newest) / remove one |
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

### Recently played
- Per-user, stored server-side in `recent/<user>.json` (max 20, newest first) — shared across devices
- Frontend keeps `state.recentPlays` in sync and fires `POST /api/recent` on every track start
- Pre-server local plays (`localStorage.sannmusic_recent`) are migrated once, guarded by `sannmusic_recent_migrated`

### Playlist permissions
- **View access** (`checkPlaylistAccess`): owner, admin, or listed in `sharedWith` (`'*'` = everyone). Legacy playlists without `createdBy` are viewable by all
- **Write access** (`checkPlaylistOwnership`): owner or admin only — applies to PUT, `/tracks` POST/DELETE, playlist DELETE, `/share`, and cover upload. Legacy playlists without `createdBy` are admin-only for writes
- Non-admins can only set `sharedWith` to `admin`/`sann`; only admins can broadcast with `'*'`
- Frontend mirrors this with `canEditPlaylist()` — non-owners get no ⋯ menu, no drag handle, no per-track remove, and aren't offered non-editable playlists in "add to playlist" pickers

## UI layout (v3)

- **Topbar** (`#topbar`) — global bar with logo (→Home), Home button, search field, settings/upload buttons
- **Sidebar** — "Your Library" (collapses sidebar on click), Playlists, Favorites, Albums, Artists. Collapsible to icons-only
- **Main panel** — no more `#header` bar (removed); breadcrumbs gone from UI entirely
- **Mini-player** — always visible (vinyl placeholder when idle); expand button (↗) opens full-screen player; track area no longer clickable
- **Mobile** — bottom tab nav (Home/Playlists/Favorites/Albums/Artists); floating mini-player
- **Detail heroes** — full-bleed gradients edge-to-edge; artist name clickable (navigates to artist folder); green for albums, purple for Favorites
- **Select feature** — disabled/removed from UI (button gone from topbar)
- **Albums / Artists tabs (2026-09-18)** — there is only one folders DOM view (`#tab-folders`). `FOLDER_TABS` in app.js maps `albums`/`artists` to the library subfolder they scope to (`Albums`, `Artists`) and `folders` to `''`; `isFolderTab()` decides whether a tab renders into `#tab-folders`, hides the header brand, and shows the admin toolbar. The `folders` tab is still reachable programmatically (search results, folder chips, mini-player artist links) — its `switchTab` branch must stay, those callers rely on it. Clicking the sidebar Albums/Artists button again while inside that bucket resets to the bucket root.
- **Home "Recently Added"** — the library root holds only the two bucket folders, so `loadRecentlyAdded()` lists `Artists/` and `Albums/` and merges their children instead of showing the root (otherwise the section would show just those two folders as "new")

### Login screen (redesigned 2026-09-18)
- Three-pane `.login-shell` (grid `"brand card"/"info card"`): brand lockup + animated equalizer, glassy sign-in card, and an info column with feature list + `.apk-card` linking to `/SannMusic-v5.3.apk` (served by express.static from the repo root — unauthenticated, like all static files)
- Aurora radial gradients + fixed grain overlay (`::after`), `loginRise` staggered entrance; collapses to a single column ≤860px
- `DEFAULT_SERVER_URL = 'https://music.3san.fyi/'` in app.js — pre-fills `#server-url` when no saved URL. When the page is loaded over http(s), the origin-autofill in the boot path still wins
- **Post-login notice modal** (`maybeShowNotice()`/`showNoticeModal()` in app.js) — fires 600ms after `showBrowser()` on both the login-success and stored-token boot paths. Checkbox sets `localStorage.sannmusic_notice_v2_dismissed = 'true'`. Bump the `_v2_` suffix to re-show it to everyone

## Android app (native)

Lives at `/home/sann/sannmusic-android` — Kotlin, classic Views + viewBinding, media3 (ExoPlayer) 1.6.1, OkHttp, Coil, minSdk 26. Exists because Chrome's page-freeze kills web background playback. Not a git repo — no `git log` there.

- **Build:** `cd /home/sann/sannmusic-android && JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 /home/sann/gradle-8.11.1/bin/gradle assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`. Install: `/home/sann/android-sdk/platform-tools/adb install -r <apk>` (adb is not on PATH).
- **Nav parity with the web (v5.2):** bottom bar is Home / Playlists / Favorites / Albums / Artists. `nav_albums`/`nav_artists` are `LibraryFragment`s scoped by an `ARG_BUCKET` argument; re-tapping the active one calls `resetToRoot()`. `nav_folders` is a **phantom tab** — the id lives in `res/values/ids.xml` with no nav button; search results and Home folder chips open it via `MainActivity.openFolder()`. Since `setSelectedItemId` is a no-op for a menu-absent id, `clearNavSelection()` blanks the bar by hand (temporarily dropping group exclusivity) and `onItemReselectedListener` treats a reselect arriving while `selectedTab != item.itemId` as a normal tab switch — without both, the bar keeps a stale highlight and eats taps.
- **Home "Recently Added"** merges the `Artists/` + `Albums/` buckets client-side (`loadRecentlyAdded()` in HomeFragment), newest first, mirroring the web's `loadRecentlyAdded()`.
- **Offline listening (v5.2):** `MediaCache` wraps a media3 `SimpleCache` at `filesDir/media-cache` with a 4 GB `LeastRecentlyUsedCacheEvictor`; anything played is auto-cached. Explicit saves go through `OfflineManager` (plain Thread + main-Looper Handler) writing full blobs via `CacheWriter` with token-stripped cache keys (`util/OfflineKeys.kt`), then record the album in `OfflineStore` (`filesDir/offline.json`). Hero "save" button shows x/y progress; saved albums appear in OfflineActivity (overflow menu → Offline) and play from cache. Original quality — no transcoding. Blobs live in app-private storage, never user-visible files.
- **About dialog (v5.3):** overflow menu → About shows `AlertDialog` built in `MainActivity.showAbout()` — `about_text` (mirrors the web Settings → About copy, no boycott line), `about_version` (`BuildConfig.VERSION_NAME`, so `buildFeatures.buildConfig = true` in `app/build.gradle.kts`), copyright, and a `GitHub` neutral button opening `GITHUB_URL`. Keep the string in sync with the web About panel.
- **Release scheme:** `versionName = "X.Y"`, `versionCode = XY0` (v5.3 → 530), APK copied to the repo root as `SannMusic-vX.Y.apk` (`sudo chown sann:sann`), links updated in `index.html` + the notice modal in `app.js`. Bump the filename every release — never replace an existing APK in place. APKs stay untracked in git — the server serves them off disk via `express.static`, so a push doesn't ship them.

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
- `sw.js` — Service worker (bump CACHE_NAME on every frontend deploy; server serves with `no-cache` to prevent stale SW)
- `README.md` — Project README with screenshots
- `users.json` — Auth credentials
- `hidden.json` — Hidden folder paths
- `favorites/<user>.json` — Per-user favorites
- `recent/<user>.json` — Per-user recently played
- `playlists/*.json` — Playlist data
- `lyrics/*.json` — LRCLIB cache
- `ref/` — Staging directory for Claude Design iterations

## Known bugs fixed
- **Metadata race condition:** `items[audioIndices[tasks.length - 1]]` always wrote to the last audio file — fixed by using `items[i]` directly (the `let i` closure correctly captures each index)
- **Favorites durations missing:** Old likes stored without `duration`. Server now enriches GET /api/favorites with real file durations
- **Recently played was device-local (2026-09-16):** Recents lived only in `localStorage`, so they didn't follow the user across devices. Moved to per-user `recent/<user>.json` via `/api/recent`. Mini-player repeat-one also showed a bare "1" instead of the repeat arrows — it now keeps the icon and overlays the "1" like the fullscreen player
- **Playlist mutations used view access (2026-09-16):** PUT/`/tracks`/DELETE/`/share` only called `checkPlaylistAccess`, so any user could rename/reorder/delete a playlist shared with everyone (`'*'`) or a legacy one. Mutations now require `checkPlaylistOwnership` (owner or admin)
- **Cover upload path traversal (2026-09-16):** multer's `filename` used the raw `?playlist=` id before the ownership check ran, so a crafted id could write `<attacker-path>.cover.<img_ext>` outside `playlists/`. The id is now stripped to `[a-zA-Z0-9_-]`
- **Watcher incremental downloads:** `mv` on folder then `[[ -e $dst ]] && continue` blocked remaining tracks. Watcher disabled; manual moves only
- **Background playback stall (2026-07-29, root cause found 2026-09-16):** The July fix (5s keepalive + 3-retry backoff) did not actually work — the phone still stopped at the end of a track with the screen off. Root cause: the keepalive and the `visibilitychange` handler were both gated on `state.isPlaying`, but `playFromQueue()` sets `isPlaying = false` and only restores it inside `audio.play().then(...)`. With the screen off, `play()` was rejected or never settled, so `isPlaying` stayed false forever and both recovery paths early-returned — a permanent stuck state. Fixed by:
  - Gating recovery on a new `state.playIntent` (true whenever playback *should* be running; only an explicit user pause clears it) instead of `isPlaying`.
  - `handleTrackEnd()` as the single entry point for "track finished", idempotent via `state.endHandled`, and refusing to run unless `audio.ended || trackNearEnd()` — so a stale `ended` landing after an early advance can't skip a track.
  - Early advance while `document.hidden`: `timeupdate` calls `handleTrackEnd()` at `duration - 0.4s`. JS still runs then (the tab is audible); after the real `ended` Chrome may be frozen/throttled.
  - Keepalive still refuses to resume a mid-track pause (deliberate pause, or a phone call taking audio focus), and skips retrying when `audio.error` is set (bad source — retrying would hammer the server).
  - **`state.endHandled = false` must be reset on every seek** (np progress click, fullscreen `seek()`, mediaSession `seekto`, keyboard back-seek) or a track can never end again after seeking backwards.
- **Stale SW on mobile (2026-07-30):** Chrome cached old SW and wouldn't pick up UI updates without incognito. Fixed with `Cache-Control: no-cache, no-store` on `/sw.js`, `updateViaCache: 'none'` in registration, and `controllerchange` listener for reliable updates.

## Common gotchas
- **Permission errors** — `mkdir`/`mv` via Bash tool runs as root; always follow with `sudo chown -R sann:sann` on new directories in `/mnt/data/music/` and files in `/home/sann/sannmusic/`
- **Stale SW cache** — bump `CACHE_NAME` in `sw.js` on every frontend change; user may need hard refresh (Ctrl+Shift+R) or unregister SW in DevTools
- **Stale APK on Cloudflare** — Cloudflare edge-caches `.apk` by extension, so replacing `SannMusic-v5.apk` in place kept serving the old build. Bump the **filename** (`SannMusic-v5.2.apk`) on every APK release to get a fresh URL, and update the link in `index.html` + the notice modal in `app.js`
- **`safePath()`** in server.js blocks `..` traversal and resolves relative to `ROOT_DIR`
- **Hidden files** filtered by `isHiddenFile()` — .jpg, .nfo, .txt, .cue, .m3u, etc. are hidden from listing
- **Cover images** — server checks `cover.jpg/png/webp`, `folder.jpg`, `albumart.jpg`, then falls back to embedded cover art in audio files
- **`app.use('/api', authRequired)`** at line 263 — all `/api/*` routes after this line require auth
- **Non-admin users** restricted from upload, mkdir, rename, delete, hide/show, settings
- **Claude Design iterations** — new design files from bazzite overwrite app.js; must re-apply custom integrations: `getStreamUrl` with format/bitrate params, `shouldTranscode()`, `api.search()`, `api.getLyrics()`, `loadLyrics()` with LRCLIB fallback, `fetchLyricsFromLrclib()`, `playFromQueue()` transcoding check
- **View padding-top creates sidebar height mismatch** — `.playlists-view`, `.favorites-view`, and `#tab-folders` all had padding-top (8px or 16px) that pushed gradient heroes down, causing a visible height mismatch with the sidebar along their shared edge. All three now use `padding-top: 0`. If adding a new tab view with a hero, make sure padding-top is 0; if adding top breathing room to content without a hero, use margin on the first child element instead.
- **Emulator Chrome is 74 (2019)** — the `test29` AVD ships a system Chrome that predates `inset: 0` (Chrome 87), so every `.modal-backdrop` renders in static flow at the bottom of the page instead of as a fixed overlay — modals look "missing" when testing the web UI there. It is an emulator artifact, not an app bug: force `top/left/right/bottom: 0` at runtime to screenshot a modal, or use the native Android app for verification.
- **Library lives on `/mnt/data`** — moved off the OS NVMe on 2026-09-18. The old copy was checksum-verified against the mirror and then deleted; `/home/sann/music/` no longer exists. Don't recreate it — the app only serves `MUSIC_DIR`, and a stray copy there would silently go stale.
- **Library backup (added 2026-09-18)** — `/usr/local/bin/music-backup` mirrors `/mnt/data/music` → `/mnt/green/Music` (hard mirror, `rsync -a --delete`), run by `music-backup.timer` daily at 04:23 with `Persistent=true`. Two `mountpoint -q` guards abort if either disk is unmounted, because an empty source plus `--delete` would wipe the backup. Log via `journalctl -u music-backup`. Note the mirror propagates deletions — an accidental `rm` in the library reaches the backup on the next run.
