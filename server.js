'use strict';

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mm = require('music-metadata');
const NodeID3 = require('node-id3');
const db = require('./db');

const PORT = process.env.PORT || 8080;
const ROOT_DIR = path.resolve(process.env.MUSIC_DIR || process.env.ROOT_DIR || path.join(__dirname, 'music'));
const PLAYLISTS_DIR = path.join(__dirname, 'playlists');

// Ensure dirs exist
try { fs.mkdirSync(ROOT_DIR, { recursive: true }); } catch (e) {}
try { fs.mkdirSync(PLAYLISTS_DIR, { recursive: true }); } catch (e) {}

const app = express();
app.use(express.json());

/* ─── Static files (PWA shell) ─── */
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'sw.js'));
});
app.use(express.static(__dirname));

/* ─── Auth Configuration ─── */

const USERS_FILE = path.join(__dirname, 'users.json');
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const sessions = new Map(); // token → { username, isAdmin, expiresAt }

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to load users.json:', e.message);
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function createToken() {
  return crypto.randomBytes(48).toString('hex');
}

/* ─── Auth Middleware ─── */

function authRequired(req, res, next) {
  let token = null;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (req.query.token) {
    token = req.query.token;
  }
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const session = sessions.get(token);
  if (!session || Date.now() > session.expiresAt) {
    if (session) sessions.delete(token);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = { username: session.username, isAdmin: session.isAdmin };
  next();
}

function adminRequired(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/* ─── Auth Routes ─── */

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  let users = loadUsers();

  // Bootstrap: if no users exist, first login creates admin account
  if (users.length === 0) {
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const newUser = {
      username,
      passwordHash,
      salt,
      isAdmin: true,
      createdAt: Date.now()
    };
    users.push(newUser);
    saveUsers(users);
    const token = createToken();
    sessions.set(token, { username, isAdmin: true, expiresAt: Date.now() + TOKEN_EXPIRY_MS });
    console.log('First user created (admin): ' + username);
    return res.json({ token, username, isAdmin: true });
  }

  const user = users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  if (hashPassword(password, user.salt) !== user.passwordHash) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = createToken();
  sessions.set(token, { username, isAdmin: user.isAdmin, expiresAt: Date.now() + TOKEN_EXPIRY_MS });
  res.json({ token, username, isAdmin: user.isAdmin });
});

// GET /api/auth/me
app.get('/api/auth/me', authRequired, (req, res) => {
  res.json({ username: req.user.username, isAdmin: req.user.isAdmin });
});

// POST /api/auth/logout
app.post('/api/auth/logout', authRequired, (req, res) => {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    sessions.delete(header.slice(7));
  }
  res.json({ ok: true });
});

// PUT /api/auth/password — change own password
app.put('/api/auth/password', authRequired, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (newPassword.length < 3) {
    return res.status(400).json({ error: 'New password must be at least 3 characters' });
  }
  const users = loadUsers();
  const user = users.find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (hashPassword(currentPassword, user.salt) !== user.passwordHash) {
    return res.status(403).json({ error: 'Current password is incorrect' });
  }
  user.salt = crypto.randomBytes(16).toString('hex');
  user.passwordHash = hashPassword(newPassword, user.salt);
  saveUsers(users);
  res.json({ ok: true });
});

// GET /api/auth/users (admin only)
app.get('/api/auth/users', authRequired, adminRequired, (req, res) => {
  const users = loadUsers();
  const safe = users.map(u => ({ username: u.username, isAdmin: u.isAdmin, createdAt: u.createdAt }));
  res.json({ users: safe });
});

// POST /api/auth/users (admin only — create user)
app.post('/api/auth/users', authRequired, adminRequired, (req, res) => {
  const { username, password, isAdmin } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (password.length < 3) {
    return res.status(400).json({ error: 'Password must be at least 3 characters' });
  }
  const users = loadUsers();
  if (users.find(u => u.username === username)) {
    return res.status(409).json({ error: 'User already exists' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const newUser = { username, passwordHash, salt, isAdmin: !!isAdmin, createdAt: Date.now() };
  users.push(newUser);
  saveUsers(users);
  res.status(201).json({ username: newUser.username, isAdmin: newUser.isAdmin, createdAt: newUser.createdAt });
});

// DELETE /api/auth/users/:username (admin only)
app.delete('/api/auth/users/:username', authRequired, adminRequired, (req, res) => {
  const target = req.params.username;
  if (target === req.user.username) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  let users = loadUsers();
  const idx = users.findIndex(u => u.username === target);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users.splice(idx, 1);
  saveUsers(users);
  // Clear any sessions for this user
  for (const [token, session] of sessions) {
    if (session.username === target) sessions.delete(token);
  }
  res.json({ ok: true });
});

// PUT /api/auth/users/:username (admin only — reset user password)
app.put('/api/auth/users/:username', authRequired, adminRequired, (req, res) => {
  const target = req.params.username;
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required' });
  if (password.length < 3) return res.status(400).json({ error: 'Password must be at least 3 characters' });
  const users = loadUsers();
  const user = users.find(u => u.username === target);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.salt = crypto.randomBytes(16).toString('hex');
  user.passwordHash = hashPassword(password, user.salt);
  saveUsers(users);
  res.json({ ok: true });
});

/* ─── Hidden paths (admin visibility control) ─── */

const HIDDEN_FILE = path.join(__dirname, 'hidden.json');

function loadHidden() {
  try {
    if (!fs.existsSync(HIDDEN_FILE)) return [];
    return JSON.parse(fs.readFileSync(HIDDEN_FILE, 'utf8'));
  } catch (e) { return []; }
}

function saveHidden(paths) {
  fs.writeFileSync(HIDDEN_FILE, JSON.stringify(paths, null, 2), 'utf8');
}

app.get('/api/admin/hidden', authRequired, adminRequired, (req, res) => {
  res.json({ paths: loadHidden() });
});

app.post('/api/admin/hidden', authRequired, adminRequired, (req, res) => {
  const targetPath = (req.body.path || '').replace(/\\/g, '/');
  if (!targetPath) return res.status(400).json({ error: 'path is required' });
  let hidden = loadHidden();
  if (!hidden.includes(targetPath)) {
    hidden.push(targetPath);
    saveHidden(hidden);
  }
  res.json({ paths: hidden });
});

app.delete('/api/admin/hidden', authRequired, adminRequired, (req, res) => {
  const targetPath = (req.body.path || '').replace(/\\/g, '/');
  if (!targetPath) return res.status(400).json({ error: 'path is required' });
  let hidden = loadHidden();
  hidden = hidden.filter(p => p !== targetPath);
  saveHidden(hidden);
  res.json({ paths: hidden });
});

// Apply auth middleware to all subsequent /api/* routes
app.use('/api', authRequired);

// Clean up expired sessions every hour
setInterval(function() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now > session.expiresAt) sessions.delete(token);
  }
}, 60 * 60 * 1000);

/* ─── Helpers ─── */

function safePath(userPath) {
  // userPath is a relative path, clean it and resolve within ROOT_DIR
  const cleaned = path.normalize('/' + (userPath || '')).replace(/^\//, '');
  const resolved = path.resolve(ROOT_DIR, cleaned);
  if (!resolved.startsWith(ROOT_DIR)) return null;
  return resolved;
}

function mimeForExt(ext) {
  const map = {
    '.mp3':  'audio/mpeg',
    '.ogg':  'audio/ogg',
    '.wav':  'audio/wav',
    '.flac': 'audio/flac',
    '.m4a':  'audio/mp4',
    '.aac':  'audio/aac',
    '.opus': 'audio/ogg',
    '.wma':  'audio/x-ms-wma',
    '.webm': 'audio/webm'
  };
  return map[ext.toLowerCase()] || null;
}

const AUDIO_EXTS = new Set(['.mp3','.ogg','.wav','.flac','.m4a','.aac','.opus','.wma','.webm']);

function isAudioFile(name) {
  return AUDIO_EXTS.has(path.extname(name).toLowerCase());
}

function safePlaylistPath(filename) {
  const cleaned = path.normalize('/' + filename).replace(/^\//, '');
  const resolved = path.resolve(PLAYLISTS_DIR, cleaned);
  if (!resolved.startsWith(PLAYLISTS_DIR)) return null;
  return resolved;
}

/* ─── GET /api/list?dir=... ─── */

function promisePool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let i = 0;
  return new Promise(resolve => {
    let running = 0;
    function next() {
      while (running < concurrency && i < tasks.length) {
        const idx = i++;
        running++;
        tasks[idx]().then(r => { results[idx] = r; running--; next(); });
      }
      if (running === 0 && i === tasks.length) resolve(results);
    }
    next();
  });
}

app.get('/api/list', async (req, res) => {
  const target = safePath(req.query.dir);
  if (!target) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Directory not found' });
  if (!fs.statSync(target).isDirectory()) return res.status(400).json({ error: 'Not a directory' });

  const entries = fs.readdirSync(target, { withFileTypes: true });
  const items = [];

  // Build base entries first (no metadata yet)
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const filePath = path.join(target, e.name);
    const stat = fs.statSync(filePath);
    const relPath = req.query.dir
      ? (String(req.query.dir) + '/' + e.name).replace(/^\//, '')
      : e.name;
    items.push({
      name: e.name,
      isDir: e.isDirectory(),
      path: relPath,
      size: e.isFile() ? stat.size : null,
      mtime: stat.mtimeMs
    });
  }

  // Peek inside directories to determine folder type
  for (const item of items) {
    if (!item.isDir) continue;
    try {
      const inner = fs.readdirSync(path.join(target, item.name), { withFileTypes: true });
      let hasDirs = false, hasAudio = false;
      for (const e of inner) {
        if (e.name.startsWith('.')) continue;
        if (e.isDirectory()) hasDirs = true;
        else if (isAudioFile(e.name)) hasAudio = true;
        if (hasDirs && hasAudio) break;
      }
      if (hasDirs && hasAudio) item.folderType = 'mixed';
      else if (hasDirs) item.folderType = 'artist';
      else if (hasAudio) item.folderType = 'album';
    } catch (_) {}
  }

  // Parse metadata in parallel for audio files (concurrency 6)
  const audioIndices = [];
  const tasks = [];
  for (let i = 0; i < items.length; i++) {
    if (!items[i].isDir && isAudioFile(items[i].name)) {
      audioIndices.push(i);
      const filePath = path.join(target, items[i].name);
      tasks.push(() => mm.parseFile(filePath, { duration: true, skipCovers: true })
        .then(meta => {
          const md = {};
          if (meta.common.title) md.title = meta.common.title;
          if (meta.common.artist) md.artist = meta.common.artist;
          if (meta.common.album) md.album = meta.common.album;
          if (meta.format && meta.format.duration) md.duration = Math.round(meta.format.duration);
          if (meta.common.lyrics) md.lyrics = meta.common.lyrics;
          items[i].metadata = md;
        })
        .catch(() => {}));
    }
  }

  if (tasks.length > 0) await promisePool(tasks, 6);

  // Apply hidden-paths filtering
  const hiddenPaths = loadHidden();
  const hiddenSet = new Set(hiddenPaths);
  const isAdmin = req.user && req.user.isAdmin;

  if (!isAdmin) {
    // Non-admin: remove hidden items
    for (let i = items.length - 1; i >= 0; i--) {
      if (hiddenSet.has(items[i].path)) items.splice(i, 1);
    }
  } else {
    // Admin: flag hidden items
    for (const item of items) {
      if (hiddenSet.has(item.path)) item.hidden = true;
    }
  }

  res.json({
    path: req.query.dir || '',
    parent: req.query.dir
      ? path.dirname(req.query.dir).replace(/^\/?\.$/, '')
      : null,
    items
  });
});

/* ─── GET /api/stream?path=... ─── */

app.get('/api/stream', (req, res) => {
  const target = safePath(req.query.path);
  if (!target) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'File not found' });
  if (fs.statSync(target).isDirectory()) return res.status(400).json({ error: 'Cannot stream a directory' });

  if (req.query.download) {
    return res.download(target, path.basename(target));
  }

  const format = req.query.format;
  const bitrate = parseInt(req.query.bitrate) || 128;
  const srcExt = path.extname(target).toLowerCase();

  // Only transcode if format is requested and different from source
  const transcodeFormats = { opus: true, aac: true, mp3: true };
  if (format && transcodeFormats[format] && srcExt !== '.' + format) {
    const { spawn } = require('child_process');
    const args = ['-i', target, '-c:a', format === 'opus' ? 'libopus' : format === 'aac' ? 'aac' : 'libmp3lame', '-b:a', bitrate + 'k'];

    if (format === 'opus') {
      args.push('-f', 'ogg', '-map_metadata', '-1', 'pipe:1');
      res.type('audio/ogg');
    } else if (format === 'aac') {
      args.push('-f', 'adts', '-map_metadata', '-1', 'pipe:1');
      res.type('audio/aac');
    } else {
      args.push('-f', 'mp3', '-map_metadata', '-1', 'pipe:1');
      res.type('audio/mpeg');
    }

    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    ff.stdout.pipe(res);
    ff.stderr.on('data', () => {}); // swallow ffmpeg progress
    ff.on('error', () => { if (!res.headersSent) res.status(500).end(); });
    ff.on('exit', (code) => { if (code !== 0 && !res.headersSent) res.status(500).end(); });
    req.on('close', () => { ff.kill(); });
    return;
  }

  const mime = mimeForExt(srcExt) || 'application/octet-stream';
  res.type(mime);
  res.sendFile(target);
});

/* ─── POST /api/upload?dir=... (multipart) ─── */

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const target = safePath(req.query.dir);
      if (!target) return cb(new Error('Access denied'));
      if (!fs.existsSync(target)) return cb(new Error('Target directory does not exist'));
      cb(null, target);
    },
    filename: (req, file, cb) => {
      // Avoid overwriting: add suffix if name exists
      const target = safePath(req.query.dir);
      let name = file.originalname;
      const fp = path.join(target, name);
      if (fs.existsSync(fp)) {
        const ext = path.extname(name);
        const base = name.slice(0, -ext.length);
        let n = 1;
        while (fs.existsSync(path.join(target, base + '_' + n + ext))) n++;
        name = base + '_' + n + ext;
      }
      cb(null, name);
    }
  })
});

app.post('/api/upload', authRequired, adminRequired, upload.array('files'), (req, res) => {
  const files = req.files || [];
  res.json({ uploaded: files.map(f => ({ name: f.originalname, size: f.size })) });
});

/* ─── POST /api/mkdir ─── */

app.post('/api/mkdir', authRequired, adminRequired, (req, res) => {
  const target = safePath(req.body.path);
  if (!target) return res.status(403).json({ error: 'Access denied' });
  if (fs.existsSync(target)) return res.status(400).json({ error: 'Already exists' });
  try {
    fs.mkdirSync(target, { recursive: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─── POST /api/rename ─── */

app.post('/api/rename', authRequired, adminRequired, (req, res) => {
  const oldTarget = safePath(req.body.oldPath);
  const newTarget = safePath(req.body.newPath);
  if (!oldTarget || !newTarget) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(oldTarget)) return res.status(404).json({ error: 'Source not found' });
  if (fs.existsSync(newTarget)) return res.status(400).json({ error: 'Destination already exists' });
  try {
    fs.renameSync(oldTarget, newTarget);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─── POST /api/delete ─── */

app.post('/api/delete', authRequired, adminRequired, (req, res) => {
  const target = safePath(req.body.path);
  if (!target) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Not found' });
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: false });
    } else {
      fs.unlinkSync(target);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─── POST /api/cover — upload custom cover for folder or playlist ─── */

const coverUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (req.query.playlist) {
        cb(null, PLAYLISTS_DIR);
      } else {
        const target = safePath(req.query.path);
        if (!target) return cb(new Error('Access denied'));
        cb(null, target);
      }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (req.query.playlist) {
        cb(null, req.query.playlist + '.cover' + ext);
      } else {
        cb(null, 'cover' + ext);
      }
    }
  }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.jpg','.jpeg','.png','.webp','.gif'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

app.post('/api/cover', authRequired, coverUpload.single('cover'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No image file provided' });
  if (req.query.playlist) {
    const plPath = safePlaylistPath(req.query.playlist + '.json');
    if (!plPath || !fs.existsSync(plPath)) {
      try { fs.unlinkSync(file.path); } catch (_) {}
      return res.status(404).json({ error: 'Playlist not found' });
    }
    // Allow owner or admin to upload playlist cover
    const data = JSON.parse(fs.readFileSync(plPath, 'utf8'));
    if (!req.user.isAdmin && data.createdBy !== req.user.username) {
      try { fs.unlinkSync(file.path); } catch (_) {}
      return res.status(403).json({ error: 'Access denied' });
    }
    data.hasCustomCover = true;
    data.coverVersion = Date.now();
    fs.writeFileSync(plPath, JSON.stringify(data, null, 2), 'utf8');
  }
  res.json({ ok: true });
});

/* ─── GET /api/playlist-cover/:id ─── */

app.get('/api/playlist-cover/:id', (req, res) => {
  const plPath = safePlaylistPath(req.params.id + '.json');
  if (!plPath || !fs.existsSync(plPath)) return res.status(404).json({ error: 'Playlist not found' });
  // Look for any .cover.* file
  try {
    const entries = fs.readdirSync(PLAYLISTS_DIR, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.startsWith(req.params.id + '.cover.')) {
        const ext = path.extname(e.name).toLowerCase();
        res.type(mimeByExt[ext] || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(path.join(PLAYLISTS_DIR, e.name));
      }
    }
  } catch (_) {}
  res.status(404).json({ error: 'No custom cover' });
});

/* ─── GET /api/cover?path=... ─── */

const COVER_NAMES = ['cover', 'folder', 'albumart', 'front', 'album', 'artwork', 'coverart'];

function findCoverInDir(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        const base = path.basename(e.name, ext).toLowerCase();
        if (['.jpg','.jpeg','.png','.webp','.gif'].includes(ext) && COVER_NAMES.includes(base)) {
          return path.join(dir, e.name);
        }
      }
    }
  } catch (_) {}
  return null;
}

const mimeByExt = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif' };

app.get('/api/cover', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const target = safePath(req.query.path);
    if (!target) return res.status(403).json({ error: 'Access denied' });
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'File not found' });

    const isDir = fs.statSync(target).isDirectory();

    // 1. Check for cover image in the directory
    const searchDir = isDir ? target : path.dirname(target);
    const dirCover = findCoverInDir(searchDir);
    if (dirCover) {
      const ext = path.extname(dirCover).toLowerCase();
      res.type(mimeByExt[ext] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(dirCover);
    }

    // 2. Try embedded cover art (files only)
    if (!isDir) {
      const mime = mimeForExt(path.extname(target));
      if (mime) {
        const meta = await mm.parseFile(target);
        const picture = mm.selectCover(meta.common.picture);
        if (picture) {
          res.type(picture.format || 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.send(Buffer.from(picture.data));
        }
      }
    } else {
      // 3. For directories: fall back to first audio file's embedded cover
      const entries = fs.readdirSync(target, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && isAudioFile(e.name)) {
          try {
            const meta = await mm.parseFile(path.join(target, e.name));
            const picture = mm.selectCover(meta.common.picture);
            if (picture) {
              res.type(picture.format || 'image/jpeg');
              res.setHeader('Cache-Control', 'public, max-age=86400');
              return res.send(Buffer.from(picture.data));
            }
          } catch (_) { /* skip */ }
          break; // Only try first audio file
        }
      }
    }

    res.status(404).json({ error: 'No cover found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─── GET /api/metadata?path=... ─── */

app.get('/api/metadata', async (req, res) => {
  try {
    const target = safePath(req.query.path);
    if (!target) return res.status(403).json({ error: 'Access denied' });
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'File not found' });
    if (!isAudioFile(path.basename(target))) return res.status(400).json({ error: 'Not an audio file' });

    const meta = await mm.parseFile(target, { duration: true, skipCovers: true });
    const tags = {};
    if (meta.common.title) tags.title = meta.common.title;
    if (meta.common.artist) tags.artist = meta.common.artist;
    if (meta.common.album) tags.album = meta.common.album;
    if (meta.common.track && meta.common.track.no) tags.track = meta.common.track;
    if (meta.common.year) tags.year = meta.common.year;
    if (meta.common.genre) tags.genre = meta.common.genre;
    if (meta.format && meta.format.duration) tags.duration = Math.round(meta.format.duration);
    if (meta.format && meta.format.bitrate) tags.bitrate = meta.format.bitrate;
    if (meta.format && meta.format.sampleRate) tags.sampleRate = meta.format.sampleRate;
    if (meta.common.lyrics) tags.lyrics = meta.common.lyrics;

    res.json({ path: req.query.path, tags });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─── POST /api/metadata ─── */

app.post('/api/metadata', authRequired, adminRequired, async (req, res) => {
  try {
    const target = safePath(req.body.path);
    if (!target) return res.status(403).json({ error: 'Access denied' });
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'File not found' });
    if (!isAudioFile(path.basename(target))) return res.status(400).json({ error: 'Not an audio file' });

    const ext = path.extname(target).toLowerCase();
    const tags = req.body.tags || {};

    if (ext === '.mp3') {
      // Read existing tags, merge with new
      const existing = NodeID3.read(target) || {};
      const update = {};
      if (tags.title !== undefined) update.title = tags.title;
      if (tags.artist !== undefined) update.artist = tags.artist;
      if (tags.album !== undefined) update.album = tags.album;
      if (tags.track !== undefined) {
        const t = tags.track;
        update.trackNumber = typeof t === 'object' ? (String(t.no || '') + (t.of ? '/' + t.of : '')) : String(t);
      }
      if (tags.year !== undefined) update.year = String(tags.year);
      if (tags.genre !== undefined) {
        update.genre = Array.isArray(tags.genre) ? tags.genre.join(', ') : String(tags.genre);
      }
      NodeID3.write(update, target);
      res.json({ ok: true, format: 'MP3' });
    } else if (ext === '.flac') {
      // FLAC writing: remove old VORBIS_COMMENT, inject new one
      const flacMeta = require('flac-metadata');
      const tempFile = target + '.tmp';

      const existingMeta = await mm.parseFile(target, { skipCovers: true });
      const oldTags = existingMeta.common || {};

      // Merge old and new tags
      const merged = {};
      merged.title = tags.title !== undefined ? tags.title : oldTags.title;
      merged.artist = tags.artist !== undefined ? tags.artist : oldTags.artist;
      merged.album = tags.album !== undefined ? tags.album : oldTags.album;
      merged.track = tags.track !== undefined ? tags.track : (oldTags.track && oldTags.track.no);
      merged.year = tags.year !== undefined ? tags.year : oldTags.year;
      const genreVal = tags.genre !== undefined ? tags.genre : oldTags.genre;
      merged.genre = Array.isArray(genreVal) ? genreVal.join(', ') : genreVal;

      const vendor = 'SannMusic';
      const comments = [];
      if (merged.title) comments.push('TITLE=' + merged.title);
      if (merged.artist) comments.push('ARTIST=' + merged.artist);
      if (merged.album) comments.push('ALBUM=' + merged.album);
      if (merged.track) {
        const tn = typeof merged.track === 'object' ? merged.track.no || '' : String(merged.track);
        comments.push('TRACKNUMBER=' + tn);
      }
      if (merged.year) comments.push('DATE=' + String(merged.year));
      if (merged.genre) comments.push('GENRE=' + merged.genre);

      await new Promise((resolve, reject) => {
        const reader = fs.createReadStream(target);
        const writer = fs.createWriteStream(tempFile);
        const processor = new flacMeta.Processor({ parseMetaDataBlocks: true });
        let newBlock;

        processor.on('preprocess', function(mdb) {
          // Remove existing VORBIS_COMMENT block
          if (mdb.type === 4) mdb.remove();
          // Unset isLast so we can append our own block after
          if (mdb.isLast) {
            mdb.isLast = false;
            newBlock = flacMeta.data.MetaDataBlockVorbisComment.create(true, vendor, comments);
          }
        });

        processor.on('postprocess', function(mdb) {
          if (newBlock) {
            this.push(newBlock.publish());
          }
        });

        writer.on('finish', () => resolve());
        processor.on('error', reject);
        writer.on('error', reject);
        reader.pipe(processor).pipe(writer);
      });

      try {
        fs.renameSync(tempFile, target);
        res.json({ ok: true, format: 'FLAC' });
      } catch (e2) {
        try { fs.unlinkSync(tempFile); } catch (_) {}
        throw e2;
      }
    } else {
      res.status(400).json({ error: 'Metadata writing not supported for ' + ext + ' files. Only MP3 and FLAC are supported.' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─── GET /api/lyrics LRCLIB proxy with local cache ─── */

const LYRICS_DIR = path.join(__dirname, 'lyrics');
if (!fs.existsSync(LYRICS_DIR)) fs.mkdirSync(LYRICS_DIR, { recursive: true });

app.get('/api/lyrics', async (req, res) => {
  try {
    const track_name = (req.query.track_name || '').trim();
    const artist_name = (req.query.artist_name || '').trim();
    const album_name = (req.query.album_name || '').trim();
    const duration = parseInt(req.query.duration) || 0;

    if (!track_name && !artist_name) {
      return res.status(400).json({ error: 'track_name or artist_name required' });
    }

    const crypto = require('crypto');
    const cacheKey = crypto.createHash('md5')
      .update(artist_name + '|' + track_name + '|' + album_name + '|' + duration)
      .digest('hex');
    const cacheFile = path.join(LYRICS_DIR, cacheKey + '.json');

    if (fs.existsSync(cacheFile)) {
      return res.json(JSON.parse(fs.readFileSync(cacheFile, 'utf-8')));
    }

    const params = new URLSearchParams();
    if (track_name) params.set('track_name', track_name);
    if (artist_name) params.set('artist_name', artist_name);
    if (album_name) params.set('album_name', album_name);
    if (duration > 0) params.set('duration', String(duration));

    const url = 'https://lrclib.net/api/get?' + params.toString();
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'SannMusic/1.0 (lyrics cache)' }
    });

    if (!resp.ok) {
      const miss = { cached: true, notFound: true };
      fs.writeFileSync(cacheFile, JSON.stringify(miss));
      return res.json(miss);
    }

    const data = await resp.json();
    fs.writeFileSync(cacheFile, JSON.stringify(data));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─── GET /api/search?q=... ─── */

/* ─── Scan endpoints ─── */

app.get('/api/scan/status', authRequired, (req, res) => {
  res.json({
    scanning: db.isScanning(),
    trackCount: db.getTrackCount()
  });
});

app.post('/api/scan', authRequired, adminRequired, (req, res) => {
  if (db.isScanning()) return res.status(409).json({ error: 'Scan already in progress' });
  res.json({ ok: true });
  // Run scan in background
  db.scanLibrary({
    progress: (p) => db.scanEvents.emit('progress', p)
  }).catch((e) => {
    db.scanEvents.emit('error', e.message);
  });
});

app.get('/api/scan/progress', authRequired, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const onProgress = (p) => {
    res.write('data: ' + JSON.stringify(p) + '\n\n');
    if (p.phase === 'done') {
      res.end();
      db.scanEvents.off('progress', onProgress);
      db.scanEvents.off('error', onError);
    }
  };
  const onError = (msg) => {
    res.write('data: ' + JSON.stringify({ phase: 'error', error: msg }) + '\n\n');
    res.end();
    db.scanEvents.off('progress', onProgress);
    db.scanEvents.off('error', onError);
  };

  db.scanEvents.on('progress', onProgress);
  db.scanEvents.on('error', onError);

  req.on('close', () => {
    db.scanEvents.off('progress', onProgress);
    db.scanEvents.off('error', onError);
  });
});

/* ─── Search ─── */

app.get('/api/search', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ results: [] });

    const count = db.getTrackCount();
    if (count > 0 && req.query.source !== 'fs') {
      // Use SQLite index
      const rows = db.searchTracks(q, 50);
      const results = rows.map(r => ({
        name: r.path.split('/').pop(),
        path: r.path,
        type: 'track',
        album: r.album || undefined,
        artist: r.artist || undefined,
        title: r.title || undefined,
        duration: r.duration || undefined
      }));
      return res.json({ results });
    }

    // Filesystem fallback
    const qLower = q.toLowerCase();
    const results = [];
    const maxResults = 50;

    function walk(dirPath, relPath) {
      if (results.length >= maxResults) return;
      let entries;
      try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
      catch (e) { return; }

      for (const entry of entries) {
        if (results.length >= maxResults) break;
        const name = entry.name;
        if (name.startsWith('.')) continue;
        const nameLower = name.toLowerCase();
        const rel = relPath ? relPath + '/' + name : name;

        if (nameLower.includes(qLower)) {
          if (entry.isDirectory()) {
            results.push({ name, path: rel, type: 'folder' });
          } else if (isAudioFile(name)) {
            results.push({ name, path: rel, type: 'track' });
          }
        }

        if (entry.isDirectory()) {
          const hiddenPaths = loadHidden();
          if (hiddenPaths.includes(rel)) continue;
          walk(path.join(dirPath, name), rel);
        }
      }
    }

    walk(ROOT_DIR, '');
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─── Playlist endpoints ─── */

function readPlaylistFile(id) {
  const fp = safePlaylistPath(id + '.json');
  if (!fp || !fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function writePlaylistFile(id, data) {
  const fp = safePlaylistPath(id + '.json');
  if (!fp) throw new Error('Invalid playlist id');
  // Atomic write: tmp then rename
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

function computeCoverDirs(tracks) {
  const dirs = new Set();
  for (const t of tracks) {
    const dir = path.posix.dirname((t.path || '').replace(/\\/g, '/'));
    if (dir && dir !== '.') dirs.add(dir);
    if (dirs.size >= 4) break;
  }
  return Array.from(dirs).slice(0, 4);
}

function checkPlaylistAccess(req, playlist) {
  if (req.user.isAdmin) return true;
  if (playlist.createdBy === req.user.username) return true;
  // Legacy playlists without createdBy: grant access
  if (!playlist.createdBy) return true;
  // Check sharedWith: ['*'] means all users, ['admin'] means any admin, or specific username match
  if (playlist.sharedWith && playlist.sharedWith.length > 0) {
    if (playlist.sharedWith.includes('*')) return true;
    if (playlist.sharedWith.includes('admin') && req.user.isAdmin) return true;
    if (playlist.sharedWith.includes(req.user.username)) return true;
  }
  return false;
}

// GET /api/playlists — list all
app.get('/api/playlists', authRequired, (req, res) => {
  try {
    const files = fs.readdirSync(PLAYLISTS_DIR, { withFileTypes: true });
    const playlists = files
      .filter(f => f.isFile() && f.name.endsWith('.json'))
      .map(f => {
        const data = JSON.parse(fs.readFileSync(path.join(PLAYLISTS_DIR, f.name), 'utf8'));
        // Filter: admins see all, users see own + legacy + shared
        if (!req.user.isAdmin && data.createdBy && data.createdBy !== req.user.username) {
          const sw = data.sharedWith || [];
          if (!sw.includes('*') && !(sw.includes('admin') && req.user.isAdmin) && !sw.includes(req.user.username)) return null;
        }
        let coverDirs = data.coverDirs;
        if (!coverDirs && data.tracks && data.tracks.length > 0) {
          coverDirs = computeCoverDirs(data.tracks);
          data.coverDirs = coverDirs;
          const fp = path.join(PLAYLISTS_DIR, f.name);
          fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
        }
        return {
          id: data.id,
          name: data.name,
          createdAt: data.createdAt,
          trackCount: (data.tracks || []).length,
          coverDirs: coverDirs || [],
          hasCustomCover: !!data.hasCustomCover,
          coverVersion: data.coverVersion || 0,
          createdBy: data.createdBy || null,
          sharedWith: data.sharedWith || null
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ playlists });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/playlists — create
app.post('/api/playlists', authRequired, (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const id = crypto.randomUUID();
    const playlist = {
      id,
      name,
      createdBy: req.user.username,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tracks: [],
      coverDirs: []
    };
    writePlaylistFile(id, playlist);
    res.json(playlist);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper: enrich a track with metadata from the audio file (async)
async function enrichTrack(track) {
  if (track.metadata && track.metadata.title && track.metadata.duration) return track;
  try {
    const filePath = safePath(track.path);
    if (!filePath || !fs.existsSync(filePath)) return track;
    const meta = await mm.parseFile(filePath, { duration: true, skipCovers: true });
    track.metadata = track.metadata || {};
    if (!track.metadata.title && meta.common.title) track.metadata.title = meta.common.title;
    if (!track.metadata.artist && meta.common.artist) track.metadata.artist = meta.common.artist;
    if (!track.metadata.album && meta.common.album) track.metadata.album = meta.common.album;
    if (!track.metadata.duration && meta.format.duration) track.metadata.duration = Math.round(meta.format.duration);
    if (!track.artist && meta.common.artist) track.artist = meta.common.artist;
    if (!track.album && meta.common.album) track.album = meta.common.album;
    if (!track.duration && meta.format.duration) track.duration = Math.round(meta.format.duration);
  } catch (_) { /* file unreadable, skip */ }
  return track;
}

// GET /api/playlists/:id — get one
app.get('/api/playlists/:id', authRequired, async (req, res) => {
  try {
    const playlist = readPlaylistFile(req.params.id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    if (!checkPlaylistAccess(req, playlist)) return res.status(403).json({ error: 'Access denied' });
    // Lazy-migrate missing coverDirs
    if (!playlist.coverDirs) {
      playlist.coverDirs = computeCoverDirs(playlist.tracks || []);
      writePlaylistFile(req.params.id, playlist);
    }
    // Enrich tracks with metadata
    if (playlist.tracks && playlist.tracks.length > 0) {
      playlist.tracks = await Promise.all(playlist.tracks.map(enrichTrack));
    }
    res.json(playlist);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/playlists/:id — update
app.put('/api/playlists/:id', authRequired, (req, res) => {
  try {
    const playlist = readPlaylistFile(req.params.id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    if (!checkPlaylistAccess(req, playlist)) return res.status(403).json({ error: 'Access denied' });

    if (req.body.name !== undefined) {
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Name is required' });
      playlist.name = name;
    }
    if (req.body.tracks !== undefined) {
      playlist.tracks = req.body.tracks;
      playlist.coverDirs = computeCoverDirs(playlist.tracks);
    }
    playlist.updatedAt = Date.now();
    writePlaylistFile(req.params.id, playlist);
    res.json(playlist);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/playlists/:id/share — toggle sharing
app.post('/api/playlists/:id/share', authRequired, (req, res) => {
  try {
    const playlist = readPlaylistFile(req.params.id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    if (!checkPlaylistAccess(req, playlist)) return res.status(403).json({ error: 'Access denied' });

    const sharedWith = req.body.sharedWith || [];
    if (!Array.isArray(sharedWith)) return res.status(400).json({ error: 'sharedWith must be an array' });

    // Non-admin users can only share with admin
    if (!req.user.isAdmin) {
      const cleaned = sharedWith.filter(u => u === 'admin' || u === 'sann');
      playlist.sharedWith = cleaned.length > 0 ? cleaned : [];
    } else {
      // Admin can share with all ('*') or clear
      playlist.sharedWith = sharedWith.includes('*') ? ['*'] : sharedWith;
    }

    playlist.updatedAt = Date.now();
    writePlaylistFile(req.params.id, playlist);
    res.json({ sharedWith: playlist.sharedWith });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/playlists/:id
app.delete('/api/playlists/:id', authRequired, (req, res) => {
  try {
    const playlist = readPlaylistFile(req.params.id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    if (!checkPlaylistAccess(req, playlist)) return res.status(403).json({ error: 'Access denied' });
    const fp = safePlaylistPath(req.params.id + '.json');
    fs.unlinkSync(fp);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/playlists/:id/tracks — append tracks
app.post('/api/playlists/:id/tracks', authRequired, (req, res) => {
  try {
    const playlist = readPlaylistFile(req.params.id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    if (!checkPlaylistAccess(req, playlist)) return res.status(403).json({ error: 'Access denied' });

    const newTracks = req.body.tracks || [];
    const existingPaths = new Set(playlist.tracks.map(t => t.path));
    for (const t of newTracks) {
      if (!existingPaths.has(t.path)) {
        playlist.tracks.push({ path: t.path, name: t.name });
        existingPaths.add(t.path);
      }
    }
    playlist.updatedAt = Date.now();
    playlist.coverDirs = computeCoverDirs(playlist.tracks);
    writePlaylistFile(req.params.id, playlist);
    res.json(playlist);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/playlists/:id/tracks — remove tracks by index
app.delete('/api/playlists/:id/tracks', authRequired, (req, res) => {
  try {
    const playlist = readPlaylistFile(req.params.id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    if (!checkPlaylistAccess(req, playlist)) return res.status(403).json({ error: 'Access denied' });

    const indices = req.body.indices || [];
    if (!Array.isArray(indices)) return res.status(400).json({ error: 'indices must be an array' });

    // Remove in descending order to avoid index shift
    const sorted = indices.slice().sort((a, b) => b - a);
    for (const i of sorted) {
      if (i >= 0 && i < playlist.tracks.length) {
        playlist.tracks.splice(i, 1);
      }
    }
    playlist.updatedAt = Date.now();
    playlist.coverDirs = computeCoverDirs(playlist.tracks);
    writePlaylistFile(req.params.id, playlist);
    res.json(playlist);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─── Favorites endpoints ─── */

const FAVORITES_DIR = path.join(__dirname, 'favorites');
try { fs.mkdirSync(FAVORITES_DIR, { recursive: true }); } catch (e) {}

function getFavoritesPath(username) {
  // Sanitize: only allow alphanumeric, dash, underscore
  const safe = username.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(FAVORITES_DIR, safe + '.json');
}

function loadFavorites(username) {
  try {
    const fp = getFavoritesPath(username);
    if (!fs.existsSync(fp)) return [];
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    console.error('Failed to load favorites for ' + username + ':', e.message);
    return [];
  }
}

function saveFavorites(username, tracks) {
  const fp = getFavoritesPath(username);
  fs.writeFileSync(fp, JSON.stringify(tracks, null, 2), 'utf8');
}

app.get('/api/favorites', authRequired, async (req, res) => {
  const tracks = loadFavorites(req.user.username);

  // Enrich with duration from actual files (backfill for tracks liked before duration was stored)
  for (const t of tracks) {
    if (!t.duration) {
      const filePath = safePath(t.path);
      if (filePath && fs.existsSync(filePath) && isAudioFile(path.basename(filePath))) {
        try {
          const meta = await mm.parseFile(filePath, { duration: true, skipCovers: true });
          if (meta.format && meta.format.duration) {
            t.duration = Math.round(meta.format.duration);
          }
        } catch (e) { /* skip */ }
      }
    }
  }

  res.json({ tracks });
});

app.post('/api/favorites', authRequired, (req, res) => {
  const tracks = req.body.tracks;
  if (!Array.isArray(tracks)) return res.status(400).json({ error: 'tracks must be an array' });
  const existing = loadFavorites(req.user.username);
  const existingPaths = new Set(existing.map(t => t.path));
  for (const t of tracks) {
    if (!existingPaths.has(t.path)) {
      existing.push(t);
      existingPaths.add(t.path);
    }
  }
  saveFavorites(req.user.username, existing);
  res.json({ tracks: existing });
});

app.delete('/api/favorites', authRequired, (req, res) => {
  const targetPath = req.body.path;
  if (!targetPath) return res.status(400).json({ error: 'path is required' });
  let existing = loadFavorites(req.user.username);
  existing = existing.filter(t => t.path !== targetPath);
  saveFavorites(req.user.username, existing);
  res.json({ tracks: existing });
});

/* ─── Start ─── */

app.listen(PORT, '0.0.0.0', () => {
  console.log('SannMusic file server running on http://0.0.0.0:' + PORT);
  console.log('Serving directory: ' + ROOT_DIR);
});
