'use strict';

const Database = require('better-sqlite3');
const mm = require('music-metadata');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DB_PATH = path.join(__dirname, 'music.db');
const MUSIC_DIR = process.env.MUSIC_DIR || '/home/sann/music';

let db = null;
const scanEvents = new EventEmitter();
let scanning = false;
let scanAborted = false;

function getDb() {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -32000'); // 32MB cache
  initSchema();
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      path TEXT PRIMARY KEY,
      title TEXT,
      artist TEXT,
      album TEXT,
      album_artist TEXT,
      duration REAL,
      track_number INTEGER,
      year INTEGER,
      genre TEXT,
      mtime REAL,
      file_hash TEXT,
      indexed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
    CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
    CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
      title, artist, album, album_artist, genre,
      content='tracks',
      content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS tracks_ai AFTER INSERT ON tracks BEGIN
      INSERT INTO tracks_fts(rowid, title, artist, album, album_artist, genre)
      VALUES (new.rowid, new.title, new.artist, new.album, new.album_artist, new.genre);
    END;
    CREATE TRIGGER IF NOT EXISTS tracks_ad AFTER DELETE ON tracks BEGIN
      INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album, album_artist, genre)
      VALUES ('delete', old.rowid, old.title, old.artist, old.album, old.album_artist, old.genre);
    END;
    CREATE TRIGGER IF NOT EXISTS tracks_au AFTER UPDATE ON tracks BEGIN
      INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album, album_artist, genre)
      VALUES ('delete', old.rowid, old.title, old.artist, old.album, old.album_artist, old.genre);
      INSERT INTO tracks_fts(rowid, title, artist, album, album_artist, genre)
      VALUES (new.rowid, new.title, new.artist, new.album, new.album_artist, new.genre);
    END;
  `);
}

const AUDIO_EXTS = new Set(['.flac','.mp3','.ogg','.opus','.m4a','.aac','.wav','.wma','.alac','.aiff']);

function* walkDir(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkDir(full);
    } else if (e.isFile() && AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) {
      yield { dir, full };
    }
  }
}

function hashFile(filePath) {
  return new Promise((resolve) => {
    const h = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath, { start: 0, end: 65535 }); // first 64KB
    stream.on('data', (d) => h.update(d));
    stream.on('end', () => resolve(h.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}

async function scanLibrary(options = {}) {
  if (scanning) throw new Error('Scan already in progress');
  scanning = true;
  scanAborted = false;
  const dbInst = getDb();
  const progress = options.progress || (() => {});

  // Phase 1: enumerate
  const files = [];
  for (const f of walkDir(MUSIC_DIR)) files.push(f);
  const total = files.length;
  progress({ phase: 'enumerate', done: 0, total });

  // Known mtimes for incremental skip
  const known = {};
  const rows = dbInst.prepare('SELECT path, mtime FROM tracks').all();
  for (const r of rows) known[r.path] = r.mtime;

  let indexed = 0, skipped = 0, done = 0;

  // Phase 2: async batches of 8 for parallel metadata reads
  const BATCH = 8;
  const insertStmt = dbInst.prepare(`
    INSERT OR REPLACE INTO tracks
    (path, title, artist, album, album_artist, duration, track_number, year, genre, mtime, file_hash, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let bi = 0; bi < files.length; bi += BATCH) {
    if (scanAborted) break;
    const batch = files.slice(bi, bi + BATCH);

    const results = await Promise.all(batch.map(async (f) => {
      const rel = path.relative(MUSIC_DIR, f.full);
      try {
        const stat = fs.statSync(f.full);
        if (known[rel] === stat.mtimeMs) return { rel, skip: true };
        const meta = await mm.parseFile(f.full, { duration: true, skipCovers: true });
        const c = meta.common;
        return {
          rel,
          title: c.title || null,
          artist: c.artist || null,
          album: c.album || null,
          album_artist: c.albumartist || null,
          duration: meta.format.duration ? Math.round(meta.format.duration) : null,
          track_number: (c.track && c.track.no) || null,
          year: c.year || null,
          genre: (c.genre || []).join(', ') || null,
          mtime: stat.mtimeMs,
          skip: false
        };
      } catch (_) { return { rel, skip: true, error: true }; }
    }));

    // Sync insert inside transaction
    const toInsert = results.filter(r => r && !r.skip && !r.error);
    if (toInsert.length > 0) {
      const txn = dbInst.transaction(() => {
        for (const r of toInsert) {
          insertStmt.run(r.rel, r.title, r.artist, r.album, r.album_artist,
            r.duration, r.track_number, r.year, r.genre, r.mtime, null, Date.now());
        }
      });
      txn();
      indexed += toInsert.length;
    }
    skipped += results.filter(r => r && r.skip && !r.error).length;
    done += batch.length;
    progress({ phase: 'scan', done, total, indexed, skipped });
  }

  // Phase 3: remove deleted files
  const currentPaths = new Set(files.map(f => path.relative(MUSIC_DIR, f.full)));
  const toDelete = rows.filter(r => !currentPaths.has(r.path)).map(r => r.path);
  let deleted = 0;
  if (toDelete.length > 0) {
    const delStmt = dbInst.prepare('DELETE FROM tracks WHERE path = ?');
    const delTxn = dbInst.transaction(() => { for (const p of toDelete) delStmt.run(p); });
    delTxn();
    deleted = toDelete.length;
  }

  scanning = false;
  progress({ phase: 'done', done: total, total, indexed, skipped, deleted });
  return { total, indexed, skipped, deleted };
}

function abortScan() {
  scanAborted = true;
}

function isScanning() {
  return scanning;
}

function searchTracks(query, limit = 50) {
  const dbInst = getDb();
  // Try FTS5 first
  const ftsQuery = query.trim().split(/\s+/).map(w => '"' + w.replace(/"/g, '') + '"').join(' ');
  try {
    const rows = dbInst.prepare(`
      SELECT t.* FROM tracks t
      INNER JOIN tracks_fts fts ON t.rowid = fts.rowid
      WHERE tracks_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit);
    if (rows.length > 0) return rows;
  } catch (_) { /* FTS5 syntax error, fall through */ }

  // Fallback: LIKE search
  const likeQ = '%' + query.replace(/[%_]/g, '\\$&') + '%';
  return dbInst.prepare(`
    SELECT * FROM tracks
    WHERE title LIKE ? ESCAPE '\\'
       OR artist LIKE ? ESCAPE '\\'
       OR album LIKE ? ESCAPE '\\'
    ORDER BY indexed_at DESC
    LIMIT ?
  `).all(likeQ, likeQ, likeQ, limit);
}

function getTrackByPath(filePath) {
  const dbInst = getDb();
  return dbInst.prepare('SELECT * FROM tracks WHERE path = ?').get(filePath) || null;
}

function getTrackCount() {
  const dbInst = getDb();
  const row = dbInst.prepare('SELECT COUNT(*) as count FROM tracks').get();
  return row ? row.count : 0;
}

module.exports = {
  getDb,
  scanLibrary,
  abortScan,
  isScanning,
  searchTracks,
  getTrackByPath,
  getTrackCount,
  scanEvents,
  MUSIC_DIR
};
