'use strict';

/* ══════════════════════════════════════════════════════════════
   File Server API Client
   ══════════════════════════════════════════════════════════════ */

class FileServerAPI {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this._token = null;
  }

  setToken(token) { this._token = token; }
  getToken() { return this._token; }

  _authHeader() {
    return this._token ? { 'Authorization': 'Bearer ' + this._token } : {};
  }

  _get(url) {
    var headers = this._authHeader();
    var self = this;
    return fetch(this.baseUrl + url, { headers: headers }).then(function(r) {
      if (r.status === 401) {
        window.dispatchEvent(new CustomEvent('auth:expired'));
        return r.json().then(function(e) { throw new Error(e.error || 'Session expired'); });
      }
      if (!r.ok) {
        return r.json().then(function(e) { throw new Error(e.error || 'HTTP ' + r.status); });
      }
      return r.json();
    });
  }

  _request(url, method, body) {
    var opts = { method: method || 'GET', headers: Object.assign({}, this._authHeader()) };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var self = this;
    return fetch(this.baseUrl + url, opts).then(function(r) {
      if (r.status === 401) { window.dispatchEvent(new CustomEvent('auth:expired')); return r.json().then(function(e) { throw new Error(e.error || 'Session expired'); }); }
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'HTTP ' + r.status); });
      return r.json();
    });
  }

  list(dir) {
    return this._get('/api/list?dir=' + encodeURIComponent(dir || ''));
  }

  getStreamUrl(filePath, format, bitrate) {
    var url = this.baseUrl + '/api/stream?path=' + encodeURIComponent(filePath);
    if (format) url += '&format=' + format;
    if (bitrate) url += '&bitrate=' + bitrate;
    if (this._token) url += '&token=' + encodeURIComponent(this._token);
    return url;
  }

  getCoverUrl(filePath) {
    var url = this.baseUrl + '/api/cover?path=' + encodeURIComponent(filePath);
    if (this._token) url += '&token=' + encodeURIComponent(this._token);
    return url;
  }

  upload(dir, file, onProgress) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var fd = new FormData();
      fd.append('files', file);
      var xhr = new XMLHttpRequest();
      var url = self.baseUrl + '/api/upload?dir=' + encodeURIComponent(dir || '');
      if (self._token) url += '&token=' + encodeURIComponent(self._token);
      xhr.open('POST', url);
      if (onProgress) {
        xhr.upload.onprogress = function(e) {
          if (e.lengthComputable) onProgress(e.loaded, e.total);
        };
      }
      xhr.onload = function() {
        if (xhr.status === 200) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          if (xhr.status === 401) { window.dispatchEvent(new CustomEvent('auth:expired')); }
          try { reject(new Error(JSON.parse(xhr.responseText).error)); }
          catch (e) { reject(new Error('Upload failed')); }
        }
      };
      xhr.onerror = function() { reject(new Error('Upload failed')); };
      xhr.send(fd);
    });
  }

  mkdir(dirPath) {
    return this._request('/api/mkdir', 'POST', { path: dirPath });
  }

  rename(oldPath, newPath) {
    return this._request('/api/rename', 'POST', { oldPath: oldPath, newPath: newPath });
  }

  del(itemPath) {
    return this._request('/api/delete', 'POST', { path: itemPath });
  }

  test() {
    return this._get('/api/list');
  }

  // --- Metadata ---

  getMetadata(path) {
    return this._get('/api/metadata?path=' + encodeURIComponent(path));
  }

  writeMetadata(path, tags) {
    return this._request('/api/metadata', 'POST', { path: path, tags: tags });
  }

  // --- Playlists ---

  listPlaylists() {
    return this._get('/api/playlists');
  }

  getPlaylist(id) {
    return this._get('/api/playlists/' + encodeURIComponent(id));
  }

  createPlaylist(name) {
    return this._request('/api/playlists', 'POST', { name: name });
  }

  updatePlaylist(id, data) {
    return this._request('/api/playlists/' + encodeURIComponent(id), 'PUT', data);
  }

  deletePlaylist(id) {
    return this._request('/api/playlists/' + encodeURIComponent(id), 'DELETE');
  }

  addTracksToPlaylist(id, tracks) {
    return this._request('/api/playlists/' + encodeURIComponent(id) + '/tracks', 'POST', { tracks: tracks });
  }

  removeTracksFromPlaylist(id, indices) {
    return this._request('/api/playlists/' + encodeURIComponent(id) + '/tracks', 'DELETE', { indices: indices });
  }

  getPlaylistCoverUrl(id, version) {
    var v = version ? '?v=' + version : '';
    var url = this.baseUrl + '/api/playlist-cover/' + encodeURIComponent(id) + v;
    if (this._token) url += (v ? '&' : '?') + 'token=' + encodeURIComponent(this._token);
    return url;
  }

  uploadCover(pathOrPlaylistId, file, isPlaylist) {
    var url = this.baseUrl + '/api/cover?';
    if (isPlaylist) {
      url += 'playlist=' + encodeURIComponent(pathOrPlaylistId);
    } else {
      url += 'path=' + encodeURIComponent(pathOrPlaylistId);
    }
    if (this._token) url += '&token=' + encodeURIComponent(this._token);
    var fd = new FormData();
    fd.append('cover', file);
    return fetch(url, { method: 'POST', body: fd }).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error); });
      return r.json();
    });
  }

  // --- Auth ---

  login(username, password) {
    var self = this;
    return fetch(this.baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'Login failed'); });
      return r.json();
    }).then(function(data) {
      self._token = data.token;
      sessionStorage.setItem('sannmusic_token', data.token);
      return data;
    });
  }

  logout() {
    if (!this._token) return Promise.resolve();
    var self = this;
    return fetch(this.baseUrl + '/api/auth/logout', {
      method: 'POST',
      headers: this._authHeader()
    }).then(function(r) { return r.json(); }).catch(function() {}).then(function() {
      self._token = null;
      sessionStorage.removeItem('sannmusic_token');
      sessionStorage.removeItem('sannmusic_username');
      sessionStorage.removeItem('sannmusic_isAdmin');
    });
  }

  getMe() {
    return this._request('/api/auth/me');
  }

  getUsers() {
    return this._request('/api/auth/users');
  }

  createUser(username, password, isAdmin) {
    return this._request('/api/auth/users', 'POST', { username: username, password: password, isAdmin: isAdmin });
  }

  deleteUser(username) {
    return this._request('/api/auth/users/' + encodeURIComponent(username), 'DELETE');
  }

  changeUserPassword(username, password) {
    return this._request('/api/auth/users/' + encodeURIComponent(username), 'PUT', { password: password });
  }

  changeOwnPassword(currentPassword, newPassword) {
    return this._request('/api/auth/password', 'PUT', { currentPassword: currentPassword, newPassword: newPassword });
  }

  // --- Hidden paths (admin) ---

  getHidden() {
    return this._request('/api/admin/hidden');
  }

  hidePath(targetPath) {
    return this._request('/api/admin/hidden', 'POST', { path: targetPath });
  }

  unhidePath(targetPath) {
    return this._request('/api/admin/hidden', 'DELETE', { path: targetPath });
  }

  // --- Favorites ---

  getFavorites() {
    return this._request('/api/favorites');
  }

  addFavorites(tracks) {
    return this._request('/api/favorites', 'POST', { tracks: tracks });
  }

  removeFavorite(path) {
    return this._request('/api/favorites', 'DELETE', { path: path });
  }

  // --- Search ---

  search(q) {
    return this._get('/api/search?q=' + encodeURIComponent(q));
  }

  // --- Lyrics (LRCLIB proxy) ---

  getLyrics(track_name, artist_name, album_name, duration) {
    var params = [];
    if (track_name) params.push('track_name=' + encodeURIComponent(track_name));
    if (artist_name) params.push('artist_name=' + encodeURIComponent(artist_name));
    if (album_name) params.push('album_name=' + encodeURIComponent(album_name));
    if (duration) params.push('duration=' + duration);
    return this._get('/api/lyrics?' + params.join('&'));
  }
}


/* ══════════════════════════════════════════════════════════════
   Application
   ══════════════════════════════════════════════════════════════ */

var app = (function() {

  function playIcon(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="currentColor" style="display:block"><path d="M8 5v14l11-7z"/></svg>';
  }
  var PI = playIcon;

  var api = null;
  var audio = new Audio();

  var state = {
    path:           [{ path: '', name: 'Home' }],
    items:          [],
    nowPlaying:     null,
    isPlaying:      false,
    repeat:         0,
    shuffle:        false,
    activeTab:      'home',
    queue:          [],
    queueIndex:     -1,
    queueSource:    null,
    selectedPaths:  [],
    selectionMode:  false,
    playlists:      [],
    currentPlaylist: null,
    recentPlays:    [],
    likedTracks:    []
  };

  var authState = {
    token: sessionStorage.getItem('sannmusic_token') || null,
    username: sessionStorage.getItem('sannmusic_username') || null,
    isAdmin: sessionStorage.getItem('sannmusic_isAdmin') === 'true'
  };

  /* ─── DOM Cache ─── */

  function $(id) { return document.getElementById(id); }
  var dom = {
    loginScreen:       $('login-screen'),
    browserScreen:     $('browser-screen'),
    loadingOverlay:    $('loading-overlay'),
    serverUrl:         $('server-url'),
    usernameField:     $('username'),
    passwordField:     $('password'),
    connectBtn:        $('connect-btn'),
    loginError:        $('login-error'),
    settingsBtn:       $('btn-settings'),
    sidebar:           $('sidebar'),
    sidebarBackdrop:   $('sidebar-backdrop'),
    sidebarToggle:     $('sidebar-toggle'),
    headerBack:        $('header-back'),
    header:            $('header'),
    breadcrumb:        $('breadcrumb'),
    selectToggle:      $('btn-select-toggle'),
    toolbarBtn:        $('btn-toolbar'),
    mainContent:       $('main-content'),
    tabHome:           $('tab-home'),
    tabPlaylists:      $('tab-playlists'),
    itemsList:         $('items-list'),
    playlistsView:     $('playlists-view'),
    homeView:          $('home-view'),
    tabFavorites:      $('tab-favorites'),
    favoritesView:     $('favorites-view'),
    selectionBar:      $('selection-bar'),
    selectionCount:    $('selection-count'),
    nowPlaying:        $('now-playing'),
    npCover:           $('np-cover'),
    npTitle:           $('np-title'),
    npArtist:          $('np-artist'),
    npPlayBtn:         $('np-play-btn'),
    npPlayIcon:        $('np-play-icon'),
    npPauseIcon:       $('np-pause-icon'),
    npPrevBtn:         $('np-prev-btn'),
    npNextBtn:         $('np-next-btn'),
    npShuffleBtn:      $('np-shuffle-btn'),
    npRepeatBtn:       $('np-repeat-btn'),
    npRepeatIcon:      $('np-repeat-icon'),
    npRepeatOne:       $('np-repeat-one'),
    npCloseBtn:        $('np-close-btn'),
    npLikeBtn:         $('np-like-btn'),
    npCurrentTime:     $('np-current-time'),
    npDuration:        $('np-duration'),
    npProgressClick:   $('np-progress-click'),
    npProgressClickFill: $('np-progress-click-fill'),
    npQueueBtn:        $('np-queue-btn'),
    npVolumeBtn:       $('np-volume-btn'),
    npVolumeIcon:      $('np-volume-icon'),
    npVolumeWaves:     $('np-volume-waves'),
    npVolumeSlider:    $('np-volume-slider'),
    loadingText:       $('loading-text'),
    fileInput:         $('file-input'),
    coverInput:        $('cover-input'),
    topbarHome:        $('topbar-home'),
    topbarLogo:        $('topbar-logo'),
    globalSearch:      $('global-search'),
    searchClear:       $('topbar-search-clear'),
    searchOverlay:     $('search-overlay'),
    searchResults:     $('search-results'),
  };

  /* ─── Audio Events ─── */

  audio.addEventListener('ended', function() {
    state.isPlaying = false;
    if (state.repeat === 1) {
      audio.currentTime = 0;
      audio.play().catch(function() {});
    } else if (state.repeat === 2) {
      playNextInQueue(true);
    } else {
      if (!playNextInQueue(false)) {
        state.nowPlaying = null;
        renderNowPlaying();
      }
    }
    updatePlayButtons();
  });

  audio.addEventListener('pause', function() {
    state.isPlaying = false;
    renderNowPlaying();
    updatePlayButtons();
  });

  audio.addEventListener('play', function() {
    state.isPlaying = true;
    renderNowPlaying();
    updatePlayButtons();
  });

  audio.addEventListener('error', function() {
    state.isPlaying = false;
    state.nowPlaying = null;
    renderNowPlaying();
    updatePlayButtons();
  });

  audio.addEventListener('loadedmetadata', function() {
    if (audio.duration && isFinite(audio.duration)) {
      dom.npDuration.textContent = formatTime(audio.duration);
    }
  });

  audio.addEventListener('timeupdate', function() {
    if (audio.duration && isFinite(audio.duration)) {
      var pct = (audio.currentTime / audio.duration) * 100;
      dom.npProgressClickFill.style.width = pct + '%';
      dom.npCurrentTime.textContent = formatTime(audio.currentTime);
    }
  });

  /* ─── Utilities ─── */

  function escapeHtml(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(1) + ' GB';
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function stripExt(name) {
    var dot = name.lastIndexOf('.');
    return dot > 0 ? name.substring(0, dot) : name;
  }

  function formatLongDuration(seconds) {
    seconds = Math.round(seconds || 0);
    if (seconds <= 0) return '';
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    if (h > 0) return h + ' hr ' + m + ' min';
    var out = m + ' min';
    if (s > 0) out += ' ' + s + ' sec';
    return out;
  }

  function currentDir() {
    return state.path[state.path.length - 1].path;
  }

  function isHiddenFile(name) {
    var ext = name ? name.toLowerCase().split('.').pop() : '';
    var base = name ? name.toLowerCase() : '';
    if (['jpg','jpeg','png','gif','webp','bmp','tiff','svg'].indexOf(ext) !== -1) return true;
    if (['nfo','txt','log','cue','m3u','m3u8','db','ini','url','sfv','accurip'].indexOf(ext) !== -1) return true;
    if (base === '.ds_store' || base === 'thumbs.db' || base === 'desktop.ini') return true;
    return false;
  }

  function commonMeta(files, key) {
    var v = null;
    for (var i = 0; i < files.length; i++) {
      var m = files[i].metadata || {};
      if (!m[key]) continue;
      if (v === null) v = m[key];
      else if (v !== m[key]) return null;
    }
    return v;
  }

  var FILE_GLYPH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  var FOLDER_GLYPH = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  var SHUFFLE_GLYPH = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>';
  var CLOCK_GLYPH = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>';
  var EQ_HTML = '<span class="track-eq"><span></span><span></span><span></span></span>';

  /* ─── Loading Overlay ─── */

  function showLoading(msg) {
    dom.loadingText.textContent = msg || 'Loading...';
    dom.loadingOverlay.classList.add('visible');
  }

  function hideLoading() {
    dom.loadingOverlay.classList.remove('visible');
  }

  /* ─── Login ─── */

  function showLogin() {
    dom.loginScreen.classList.add('visible');
    dom.browserScreen.classList.remove('visible');
    state.nowPlaying = null;
    state.isPlaying = false;
    renderNowPlaying();
    var savedUrl = localStorage.getItem('sannmusic_server') || sessionStorage.getItem('sannmusic_server');
    if (savedUrl) {
      dom.serverUrl.value = savedUrl;
    }
  }

  function showLoginError(msg) {
    dom.loginError.textContent = msg;
    dom.loginError.classList.add('visible');
  }

  function hideLoginError() {
    dom.loginError.classList.remove('visible');
  }

  function handleLogin() {
    var serverUrl = dom.serverUrl.value.trim();
    var username = dom.usernameField.value.trim();
    var password = dom.passwordField.value;

    if (!serverUrl) { showLoginError('Enter the server URL'); return; }
    if (!username)  { showLoginError('Enter your username'); return; }
    if (!password)  { showLoginError('Enter your password'); return; }

    hideLoginError();
    dom.connectBtn.disabled = true;
    dom.connectBtn.textContent = 'Connecting...';

    api = new FileServerAPI(serverUrl);
    api.login(username, password).then(function(data) {
      sessionStorage.setItem('sannmusic_server', serverUrl);
      sessionStorage.setItem('sannmusic_username', data.username);
      sessionStorage.setItem('sannmusic_isAdmin', data.isAdmin ? 'true' : 'false');
      authState.username = data.username;
      authState.isAdmin = data.isAdmin;
      dom.connectBtn.textContent = 'Connect';
      dom.connectBtn.disabled = false;
      dom.settingsBtn.style.display = '';
      showBrowser();
      loadHome();
      return loadRoot();
    }).catch(function(err) {
      dom.connectBtn.textContent = 'Connect';
      dom.connectBtn.disabled = false;
      api = null;
      showLoginError(err.message || 'Login failed');
    });
  }

  /* ─── Browser ─── */

  function showBrowser() {
    dom.loginScreen.classList.remove('visible');
    dom.browserScreen.classList.add('visible');
    renderNowPlaying(); // set up initial mini-player state
    // Ensure Home tab is active on first show
    if (!state.activeTab || state.activeTab === 'home') {
      switchTab('home');
    }
  }

  function loadRoot() {
    return loadDirectory('');
  }

  function loadDirectory(dir) {
    showLoading('Loading...');
    return api.list(dir).then(function(data) {
      state.items = data.items || [];
      renderBreadcrumb();
      renderItems();
      hideLoading();
      dom.tabHome.scrollTop = 0;
    }).catch(function(err) {
      hideLoading();
      handleError('Failed to load', err);
    });
  }

  /* ─── Navigation ─── */

  function openFolder(dirPath, name) {
    state.path.push({ path: dirPath, name: name });
    renderBreadcrumb();
    loadDirectory(dirPath).catch(function() {
      state.path.pop();
      renderBreadcrumb();
    });
  }

  function navigateTo(index) {
    state.path = state.path.slice(0, index + 1);
    renderBreadcrumb();
    loadDirectory(state.path[index].path);
  }

  /* ─── Breadcrumb ─── */

  function renderBreadcrumb() {
    var html = '';
    for (var i = 0; i < state.path.length; i++) {
      if (i > 0) html += '<span class="sep">&#8249;</span>';
      html += '<span class="crumb" data-idx="' + i + '">' + escapeHtml(state.path[i].name) + '</span>';
    }
    if (dom.breadcrumb) dom.breadcrumb.innerHTML = html;
  }

  function renderHeroBreadcrumbHTML() {
    var h = '<div class="hero-breadcrumb">';
    for (var i = 0; i < state.path.length; i++) {
      if (i > 0) h += '<span class="sep">&#8249;</span>';
      h += '<span class="crumb" data-idx="' + i + '">' + escapeHtml(state.path[i].name) + '</span>';
    }
    h += '</div>';
    return h;
  }

  /* ─── Tab System ─── */

  function switchTab(tabId) {
    hideHeaderBack();
    state.activeTab = tabId;
    state.selectionMode = false;
    state.selectedPaths = [];
    renderSelectionBar();

    // Update sidebar nav
    dom.sidebar.querySelectorAll('.nav-item').forEach(function(el) {
      el.classList.toggle('active', el.dataset.tab === tabId);
    });
    document.querySelectorAll('#mobile-nav .mnav-item').forEach(function(el) {
      el.classList.toggle('active', el.dataset.tab === tabId);
    });
    if (dom.topbarHome) dom.topbarHome.classList.toggle('active', tabId === 'home');
    closeSearch();
    var _hb = document.getElementById('header-brand');
    if (_hb) _hb.style.display = (tabId === 'folders') ? 'none' : '';

    // Update tab visibility
    document.querySelectorAll('.tab-content').forEach(function(el) {
      el.classList.toggle('active', el.id === 'tab-' + tabId);
    });

    // Header visibility: breadcrumb, select, toolbar only on Folders (and admin only for select/toolbar)
    var isAdmin = authState.isAdmin;
    if (dom.breadcrumb) dom.breadcrumb.style.display = 'none';
    dom.toolbarBtn.style.display = (tabId === 'folders' && isAdmin) ? '' : 'none';
    updateHeaderChrome();

    if (tabId === 'playlists') {
      loadPlaylists();
    } else if (tabId === 'home') {
      loadHome();
    } else if (tabId === 'favorites') {
      loadFavorites();
    } else if (tabId === 'folders') {
      if (state.path.length > 1) {
        state.path = [{ path: '', name: 'Home' }];
        renderBreadcrumb();
        loadDirectory('');
      } else if (state.items.length === 0) {
        loadDirectory(currentDir());
      } else {
        renderItems();
      }
    }
  }

  /* ─── Home Dashboard ─── */

  function loadHome() {
    loadRecentPlays();
    if (state.playlists.length === 0) {
      api.listPlaylists().then(function(data) {
        state.playlists = data.playlists || [];
        renderHome();
      }).catch(function() { renderHome(); });
    } else {
      renderHome();
    }
  }

  function loadRecentPlays() {
    try {
      state.recentPlays = JSON.parse(localStorage.getItem('sannmusic_recent') || '[]');
    } catch(e) { state.recentPlays = []; }
  }

  function loadFavorites() {
    loadRecentPlays();
    api.getFavorites().then(function(data) {
      state.likedTracks = data.tracks || [];
      // Migrate old localStorage favorites to server if empty on server
      if (state.likedTracks.length === 0 && !localStorage.getItem('sannmusic_favorites_migrated')) {
        try {
          var raw = JSON.parse(localStorage.getItem('sannmusic_liked') || '[]');
          if (raw.length > 0) {
            var tracks = raw.map(function(item) {
              if (typeof item === 'string') {
                var slashIdx = item.lastIndexOf('/');
                var name = slashIdx >= 0 ? item.substring(slashIdx + 1) : item;
                return { path: item, name: name, title: stripExt(name), artist: '', album: '' };
              }
              return item;
            });
            api.addFavorites(tracks).then(function(data2) {
              state.likedTracks = data2.tracks || [];
              localStorage.setItem('sannmusic_favorites_migrated', '1');
              renderFavorites();
              renderNowPlaying();
            }).catch(function() { renderFavorites(); });
            return;
          }
        } catch(e) {}
        localStorage.setItem('sannmusic_favorites_migrated', '1');
      }
      renderFavorites();
    }).catch(function() {
      renderFavorites();
    });
  }


  function favDateOf(track) {
    var v = track.addedAt != null ? track.addedAt
      : track.dateAdded != null ? track.dateAdded
      : track.added != null ? track.added
      : track.likedAt != null ? track.likedAt : null;
    if (v == null) return null;
    var t = (typeof v === 'number') ? (v > 1e12 ? v : v * 1000) : Date.parse(v);
    return isNaN(t) ? null : t;
  }
  function formatShortDate(ms) {
    try {
      return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return ''; }
  }
  function favTotalDuration(sec) {
    var h = Math.floor(sec / 3600);
    var m = Math.round((sec % 3600) / 60);
    if (h > 0) return 'about ' + h + ' hr ' + (m > 0 ? m + ' min' : '');
    return m + ' min';
  }

  function renderFavorites() {
    if (state.likedTracks.length === 0) {
      dom.favoritesView.innerHTML =
        '<div class="album-detail-header favorites-hero">' +
          '<div class="favorites-cover"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></div>' +
          '<div class="album-detail-info">' +
            '<div class="album-detail-label">Playlist</div>' +
            '<h1 class="album-detail-title">Favorites</h1>' +
            '<div class="favorites-meta-row">Songs you love will collect here.</div>' +
          '</div>' +
        '</div>' +
        '<div style="padding:48px 24px;text-align:center">' +
          '<div style="font-size:44px;margin-bottom:14px;opacity:0.35">♡</div>' +
          '<div style="font-size:20px;font-weight:800;margin-bottom:8px;color:var(--text)">No liked songs yet</div>' +
          '<div style="font-size:14px;color:var(--text-dim);max-width:340px;margin:0 auto;line-height:1.55">Tap the heart on the now-playing bar or in the full-screen player to save songs here.</div>' +
        '</div>';
      return;
    }

    var owner = (authState && authState.username) ? authState.username : 'You';
    var ownerInitial = owner.charAt(0).toUpperCase();
    var count = state.likedTracks.length;

    var totalDur = 0, haveDur = false, haveDate = false;
    for (var d = 0; d < state.likedTracks.length; d++) {
      var tk = state.likedTracks[d];
      var du = tk.duration || (tk.metadata && tk.metadata.duration);
      if (du) { totalDur += du; haveDur = true; }
      if (favDateOf(tk) != null) haveDate = true;
    }

    var html = '<div class="album-detail-header favorites-hero">';
    html += '<div class="favorites-cover"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></div>';
    html += '<div class="album-detail-info">';
    html += '<div class="album-detail-label">Playlist</div>';
    html += '<h1 class="album-detail-title">Favorites</h1>';
    html += '<div class="favorites-meta-row">';
    html += '<span class="favorites-owner"><span class="favorites-owner-avatar">' + escapeHtml(ownerInitial) + '</span>' + escapeHtml(owner) + '</span>';
    html += '<span>•</span><span>' + count + ' song' + (count !== 1 ? 's' : '') + '</span>';
    if (haveDur) html += '<span>•</span><span>' + favTotalDuration(totalDur) + '</span>';
    html += '</div>';
    html += '</div></div>';

    html += '<div class="album-detail-actions">';
    html += '<button class="album-play-all-btn" id="fav-play-all" aria-label="Play all" title="Play all">' + PI(28) + '</button>';
    html += '<button class="favorites-shuffle-btn' + (state.shuffle ? ' active' : '') + '" id="fav-shuffle" aria-label="Shuffle" title="Shuffle">';
    html += '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg></button>';
    html += '</div>';

    html += '<div class="track-head track-head--fav"><span class="th-num">#</span><span class="th-thumb"></span><span class="th-title">Title</span><span class="th-album">Album</span>';
    if (haveDate) html += '<span class="th-date">Date added</span>';
    html += '<span class="th-dur">' + CLOCK_GLYPH + '</span><span class="th-more"></span></div>';
    html += '<div class="items-list track-list fav-table">';
    for (var i = 0; i < state.likedTracks.length; i++) {
      var track = state.likedTracks[i];
      var isCurrent = state.nowPlaying && state.nowPlaying.path === track.path;
      var tdur = track.duration || (track.metadata && track.metadata.duration);
      var tdate = favDateOf(track);
      html += '<div class="item item-file track-row' + (isCurrent ? ' currently-playing' : '') + (isCurrent && state.isPlaying ? ' row-playing' : '') + '" data-idx="' + i + '" data-path="' + escapeHtml(track.path) + '">';
      html += '<div class="track-num"><span class="track-num-index">' + (i + 1) + '</span>' + EQ_HTML + '<button class="track-num-play" data-action="play-track" aria-label="Play">' + PI(14) + '</button></div>';
      html += '<img class="item-thumb" src="' + api.getCoverUrl(track.path) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
      html += '<div class="item-icon item-fallback-note" style="display:none">♫</div>';
      html += '<div class="item-info"><div class="item-name">' + escapeHtml(track.title || stripExt(track.name)) + '</div>';
      html += '<div class="item-meta">' + escapeHtml(track.artist || 'Unknown Artist') + '</div></div>';
      var albumPath = track.path.substring(0, track.path.lastIndexOf('/'));
      html += '<span class="item-album album-link" data-album-path="' + escapeHtml(albumPath) + '">' + escapeHtml(track.album || albumPath.split('/').pop() || '') + '</span>';
      if (haveDate) html += '<span class="item-date">' + (tdate != null ? escapeHtml(formatShortDate(tdate)) : '') + '</span>';
      html += '<span class="item-duration">' + (tdur ? formatTime(tdur) : '') + '</span>';
      html += '<button class="btn-more liked" data-action="unlike" aria-label="Remove from Favorites" title="Remove from Favorites">';
      html += '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></button>';
      html += '</div>';
    }
    html += '</div>';

    dom.favoritesView.innerHTML = html;

    var playAllBtn = dom.favoritesView.querySelector('#fav-play-all');
    if (playAllBtn) {
      playAllBtn.addEventListener('click', function() {
        setQueueFromFavorites();
        playFromQueue(0);
      });
    }
    var shuffleBtn = dom.favoritesView.querySelector('#fav-shuffle');
    if (shuffleBtn) {
      shuffleBtn.addEventListener('click', function() {
        setQueueFromFavorites();
        state.shuffle = true;
        playFromQueue(0);
      });
    }

    setTimeout(function() {
      dom.favoritesView.querySelectorAll('.item-file').forEach(function(itemEl) {
        itemEl.addEventListener('click', function(e) {
          var actionBtn = e.target.closest('[data-action]');
          var idx = parseInt(itemEl.dataset.idx, 10);
          if (actionBtn) {
            e.stopPropagation();
            if (actionBtn.dataset.action === 'play-track') {
              setQueueFromFavorites();
              playFromQueue(idx);
            } else if (actionBtn.dataset.action === 'unlike') {
              var track = state.likedTracks[idx];
              state.likedTracks.splice(idx, 1);
              api.removeFavorite(track.path).catch(function() {});
              renderFavorites();
              renderNowPlaying();
            }
            return;
          }
          var albumLink = e.target.closest('.album-link');
          if (albumLink) {
            e.stopPropagation();
            var p = albumLink.dataset.albumPath;
            switchTab('folders');
            setTimeout(function() {
              state.path = [{ path: '', name: 'Home' }];
              var parts = p.split('/');
              for (var pi = 0; pi < parts.length; pi++) {
                state.path.push({ path: parts.slice(0, pi + 1).join('/'), name: parts[pi] });
              }
              renderBreadcrumb();
              loadDirectory(p);
            }, 100);
            return;
          }
          setQueueFromFavorites();
          playFromQueue(idx);
        });
      });
    }, 0);
  }

  function setQueueFromFavorites() {
    state.queue = state.likedTracks.map(function(t) { return t; });
    state.queueIndex = -1;
    state.queueSource = 'favorites';
  }

  function renderHome() {
    var html = '';

    // Recently Played
    if (state.recentPlays.length > 0) {
      html += '<div class="home-section">';
      html += '<div class="home-section-header"><h2 class="home-section-title">Recently Played</h2></div>';
      html += '<div class="home-horizontal-scroll">';
      for (var i = 0; i < Math.min(state.recentPlays.length, 20); i++) {
        var rp = state.recentPlays[i];
        html += '<div class="recent-card" data-path="' + escapeHtml(rp.path) + '">';
        html += '<div class="card-cover-wrap">';
        html += '<img class="recent-card-cover" src="' + api.getCoverUrl(rp.path) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
        html += '<div class="recent-card-placeholder" style="display:none">♫</div>';
        html += '<button class="card-play-btn" data-play-recent="' + escapeHtml(rp.path) + '" aria-label="Play">' + PI(22) + '</button>';
        html += '</div>';
        html += '<div class="recent-card-title">' + escapeHtml(rp.title || stripExt(rp.name)) + '</div>';
        if (rp.artist) html += '<div class="recent-card-artist">' + escapeHtml(rp.artist) + '</div>';
        html += '</div>';
      }
      html += '</div></div>';
    }

    // Playlists
    if (state.playlists.length > 0) {
      html += '<div class="home-section">';
      html += '<div class="home-section-header"><h2 class="home-section-title">Playlists</h2><span class="home-section-link" id="home-go-playlists">Show all</span></div>';
      html += '<div class="home-horizontal-scroll">';
      for (var i = 0; i < Math.min(state.playlists.length, 6); i++) {
        var pl = state.playlists[i];
        html += '<div class="playlist-card" style="width:160px;flex-shrink:0" data-plid="' + pl.id + '">';
        html += '<div class="card-cover-wrap">';
        html += renderPlaylistCoverHTML(pl.coverDirs, pl);
        html += '<button class="card-play-btn" data-play-plid="' + pl.id + '" aria-label="Play">' + PI(22) + '</button>';
        html += '</div>';
        html += '<div class="playlist-card-name">' + escapeHtml(pl.name) + '</div>';
        html += '<div class="playlist-card-meta">' + pl.trackCount + ' tracks</div>';
        html += '</div>';
      }
      html += '</div></div>';
    }

    // Recent Folders
    var folders = {};
    for (var i = 0; i < state.recentPlays.length; i++) {
      var slashIdx = state.recentPlays[i].path.lastIndexOf('/');
      var dir = slashIdx >= 0 ? state.recentPlays[i].path.substring(0, slashIdx) : '';
      if (dir) folders[dir] = (folders[dir] || 0) + 1;
    }
    var folderEntries = Object.keys(folders).sort(function(a,b) { return folders[b] - folders[a]; }).slice(0, 8);
    if (folderEntries.length > 0) {
      html += '<div class="home-section">';
      html += '<div class="home-section-header"><h2 class="home-section-title">Recent Folders</h2><span class="home-section-link" id="home-go-folders">Browse all</span></div>';
      html += '<div class="home-horizontal-scroll">';
      for (var i = 0; i < folderEntries.length; i++) {
        html += '<div class="folder-chip" data-folder="' + escapeHtml(folderEntries[i]) + '">' + escapeHtml(folderEntries[i].split('/').pop()) + '</div>';
      }
      html += '</div></div>';
    }

    if (html === '') {
      html = '<div id="home-welcome" style="padding:64px 20px;text-align:center">';
      html += '<div style="font-size:48px;margin-bottom:16px;opacity:0.4">🎵</div>';
      html += '<div style="font-size:20px;font-weight:700;margin-bottom:8px;color:var(--text)">Welcome to SannMusic</div>';
      html += '<div style="font-size:13px;color:var(--text-dim);max-width:320px;margin:0 auto;line-height:1.5">Browse your library by album or artist, or open the Folders view to navigate your music directory.</div>';
      html += '</div>';
    }

    dom.homeView.innerHTML = '<div id="home-recently-added"></div>' + html;
    loadRecentlyAdded();

    setTimeout(function() {
      // Recent card clicks
      dom.homeView.querySelectorAll('.recent-card').forEach(function(card) {
        card.addEventListener('click', function(e) {
          if (e.target.closest('.card-play-btn')) return;
          playRecentTrack(card.dataset.path);
        });
      });
      dom.homeView.querySelectorAll('.recent-card .card-play-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          playRecentTrack(btn.dataset.playRecent);
        });
      });
      // Playlist card clicks
      dom.homeView.querySelectorAll('.playlist-card').forEach(function(card) {
        card.addEventListener('click', function(e) {
          if (e.target.closest('.card-play-btn')) return;
          switchTab('playlists');
          setTimeout(function() { viewPlaylist(card.dataset.plid); }, 100);
        });
      });
      dom.homeView.querySelectorAll('.playlist-card .card-play-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          loadAndPlayPlaylist(btn.dataset.playPlid);
        });
      });
      // Folder chip clicks
      dom.homeView.querySelectorAll('.folder-chip').forEach(function(chip) {
        chip.addEventListener('click', function() {
          switchTab('folders');
          var folder = chip.dataset.folder;
          setTimeout(function() {
            state.path = [{ path: '', name: 'Home' }];
            if (folder) {
              var parts = folder.split('/');
              for (var p = 0; p < parts.length; p++) {
                state.path.push({ path: parts.slice(0, p + 1).join('/'), name: parts[p] });
              }
            }
            renderBreadcrumb();
            loadDirectory(folder);
          }, 100);
        });
      });
      // Section links
      var goPlaylists = document.getElementById('home-go-playlists');
      if (goPlaylists) goPlaylists.addEventListener('click', function(e) { e.preventDefault(); switchTab('playlists'); });
      var goFolders = document.getElementById('home-go-folders');
      if (goFolders) goFolders.addEventListener('click', function(e) { e.preventDefault(); switchTab('folders'); });
    }, 0);
  }

  function playRecentTrack(path) {
    if (state.nowPlaying && state.nowPlaying.path === path) {
      if (state.isPlaying) { audio.pause(); } else { audio.play().catch(function(){}); }
      return;
    }
    var slashIdx = path.lastIndexOf('/');
    var dir = slashIdx >= 0 ? path.substring(0, slashIdx) : '';
    showLoading('Loading...');
    api.list(dir).then(function(data) {
      hideLoading();
      setQueueFromDirectory(dir, data.items);
      var idx = state.queue.findIndex(function(t) { return t.path === path; });
      if (idx >= 0) { playFromQueue(idx); }
    }).catch(function(err) {
      hideLoading();
      removeRecentPlay(path);
      loadHome();
    });
  }

  function removeRecentPlay(path) {
    try {
      var recent = JSON.parse(localStorage.getItem('sannmusic_recent') || '[]');
      recent = recent.filter(function(r) { return r.path !== path; });
      localStorage.setItem('sannmusic_recent', JSON.stringify(recent));
      state.recentPlays = recent;
    } catch(e) {}
  }

  function loadAndPlayPlaylist(plid) {
    showLoading('Loading...');
    api.getPlaylist(plid).then(function(playlist) {
      hideLoading();
      setQueueFromPlaylist(playlist);
      playFromQueue(0);
    }).catch(function(err) {
      hideLoading();
      handleError('Cannot play playlist', err);
    });
  }

  /* ─── Sidebar ─── */

  function openSidebar() {
    dom.sidebar.classList.add('open');
    dom.sidebarBackdrop.classList.add('visible');
  }

  function closeSidebar() {
    dom.sidebar.classList.remove('open');
    dom.sidebarBackdrop.classList.remove('visible');
  }

  function toggleSidebarCollapse() {
    var collapsed = dom.sidebar.classList.toggle('collapsed');
    try { localStorage.setItem('sannmusic_sidebar_collapsed', collapsed ? '1' : '0'); } catch(e) {}
  }

  // Load collapsed preference
  try {
    if (localStorage.getItem('sannmusic_sidebar_collapsed') === '1') {
      dom.sidebar.classList.add('collapsed');
    }
  } catch(e) {}

  if (dom.sidebarToggle) {
    dom.sidebarToggle.addEventListener('click', function(e) {
      e.stopPropagation();
      if (dom.sidebar.classList.contains('open')) closeSidebar();
      else openSidebar();
    });
  }

  dom.sidebarBackdrop.addEventListener('click', closeSidebar);

  dom.sidebar.addEventListener('click', function(e) {
    var navItem = e.target.closest('.nav-item');
    if (!navItem) return;
    if (navItem.dataset.tab === 'home') {
      toggleSidebarCollapse();
    } else {
      closeSidebar();
      switchTab(navItem.dataset.tab);
    }
  });

  /* ─── Header Back Button ─── */

  function updateHeaderChrome() {} // no-op: header bar removed
  function showHeaderBack(onClick) { if (onClick) onClick(); }
  function hideHeaderBack() {}

  /* ─── Selection System ─── */

  function toggleSelectionMode() {
    state.selectionMode = !state.selectionMode;
    state.selectedPaths = [];
    renderItems();
    renderSelectionBar();
  }

  function toggleItemSelection(path) {
    var idx = state.selectedPaths.indexOf(path);
    if (idx === -1) {
      state.selectedPaths.push(path);
    } else {
      state.selectedPaths.splice(idx, 1);
    }
    renderItems();
    renderSelectionBar();
  }

  function selectAllAudioFiles() {
    var audioFiles = getAudioFilesFromItems(state.items);
    var allSelected = audioFiles.every(function(f) {
      return state.selectedPaths.indexOf(f.path) !== -1;
    });
    if (allSelected) {
      // Deselect all audio files
      var audioPaths = new Set(audioFiles.map(function(f) { return f.path; }));
      state.selectedPaths = state.selectedPaths.filter(function(p) { return !audioPaths.has(p); });
    } else {
      // Add all audio files to selection
      audioFiles.forEach(function(f) {
        if (state.selectedPaths.indexOf(f.path) === -1) {
          state.selectedPaths.push(f.path);
        }
      });
    }
    renderItems();
    renderSelectionBar();
  }

  function getAudioFilesFromItems(items) {
    return sortItems(items).filter(function(item) {
      return !item.isDir && isAudio(item.name);
    });
  }

  function renderSelectionBar() {
    if (state.selectionMode && state.selectedPaths.length > 0) {
      dom.selectionBar.classList.add('visible');
      dom.selectionCount.textContent = state.selectedPaths.length + ' selected';
    } else {
      dom.selectionBar.classList.remove('visible');
    }
  }

  if (dom.selectToggle) {
    dom.selectToggle.addEventListener('click', function() {
      toggleSelectionMode();
    });
  }

  dom.itemsList.addEventListener('click', function(e) {
    var target = e.target;

    // Folder hero: play-all / shuffle-all
    var heroBtn = target.closest('[data-action="play-all"],[data-action="shuffle-all"]');
    if (heroBtn) {
      e.stopPropagation();
      setQueueFromDirectory(currentDir(), state.items);
      if (state.queue.length === 0) return;
      if (heroBtn.dataset.action === 'shuffle-all') {
        state.shuffle = true;
        renderNowPlaying();
        playFromQueue(Math.floor(Math.random() * state.queue.length));
      } else {
        playFromQueue(0);
      }
      return;
    }

    // Sub-folder card: handle action buttons first, then navigate
    var folderCard = target.closest('.folder-card');
    if (folderCard) {
      var folderActionBtn = target.closest('[data-action]');
      if (folderActionBtn && folderActionBtn.dataset.action === 'more-folder') {
        e.stopPropagation();
        var folderPath = folderActionBtn.dataset.folderPath;
        var dirItem = state.items.find(function(s) { return s.path === folderPath && s.isDir; });
        if (dirItem) showItemMenu(dirItem, folderActionBtn);
        return;
      }
      // Navigate into folder (unless clicking the play-btn doesn't stop it)
      if (!target.closest('[data-action]')) {
        e.stopPropagation();
        openFolder(folderCard.dataset.folderPath, folderCard.dataset.folderName);
        return;
      }
    }

    var itemEl = target.closest('.item');
    if (!itemEl) return;

    var actionBtn = target.closest('[data-action]');
    var checkbox = target.closest('.item-checkbox');
    var path = itemEl.dataset.path;
    var isDir = itemEl.classList.contains('item-folder');

    // Remove error bar on interaction
    var errBar = dom.itemsList.querySelector('.error-bar');
    if (errBar) errBar.remove();

    // Checkbox click
    if (checkbox) {
      e.stopPropagation();
      toggleItemSelection(path);
      return;
    }

    // Selection mode: clicking the row toggles selection (for audio files)
    if (state.selectionMode && !isDir) {
      toggleItemSelection(path);
      return;
    }

    if (actionBtn) {
      e.stopPropagation();
      var action = actionBtn.dataset.action;
      var sorted = sortItems(state.items);
      var item = sorted.find(function(s) { return s.path === path; });
      if (!item) return;

      if (action === 'play') {
        // Play from directory queue
        setQueueFromDirectory(currentDir(), state.items);
        var idx = state.queue.findIndex(function(t) { return t.path === path; });
        if (idx >= 0) playFromQueue(idx);
      } else if (action === 'more') {
        showItemMenu(item, actionBtn);
      }
      return;
    }

    // Folder tap: navigate
    if (isDir) {
      var name = itemEl.querySelector('.item-name').textContent;
      openFolder(path, name);
    } else if (isAudio(path)) {
      // Tap on audio file row — play from directory
      var sorted = sortItems(state.items);
      var item = sorted.find(function(s) { return s.path === path; });
      if (item) {
        setQueueFromDirectory(currentDir(), state.items);
        var idx = state.queue.findIndex(function(t) { return t.path === path; });
        if (idx >= 0) playFromQueue(idx);
      }
    }
  });

  /* ─── Items List ─── */

  function sortItems(items) {
    var dirs = items.filter(function(i) { return i.isDir; });
    var files = items.filter(function(i) { return !i.isDir; });
    dirs.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    files.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    return dirs.concat(files);
  }

  function isAudio(name) {
    var ext = name ? name.toLowerCase().split('.').pop() : '';
    return ['mp3','ogg','wav','flac','m4a','aac','opus','wma','webm'].indexOf(ext) !== -1;
  }

  function renderFolderCardGrid(dirs) {
    var html = '<div class="folder-card-grid">';
    for (var d = 0; d < dirs.length; d++) {
      var dir = dirs[d];
      var hiddenClass = dir.hidden ? ' folder-card-hidden' : '';
      html += '<div class="folder-card' + hiddenClass + '" data-folder-path="' + escapeHtml(dir.path) + '" data-folder-name="' + escapeHtml(dir.name) + '">';
      html += '<div class="card-cover-wrap">';
      html += '<img class="album-card-cover" src="' + api.getCoverUrl(dir.path) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
      html += '<div class="album-card-placeholder folder-card-ph" style="display:none">' + FOLDER_GLYPH + '</div>';
      html += '<button class="card-play-btn" data-open-folder="1" aria-label="Open">' + PI(20) + '</button>';
      if (dir.hidden) html += '<div class="hidden-badge" title="Hidden from users">◉</div>';
      html += '<button class="card-more-btn" data-action="more-folder" data-folder-path="' + escapeHtml(dir.path) + '" aria-label="More" title="More">•••</button>';
      html += '</div>';
      html += '<div class="album-card-title">' + escapeHtml(dir.name) + '</div>';
      var subLabel = dir.folderType === 'artist' ? 'Folder · Artist'
        : dir.folderType === 'album' ? 'Folder · Album'
        : dir.folderType === 'mixed' ? 'Folder · Artist/Album'
        : 'Folder';
      html += '<div class="album-card-artist">' + (dir.hidden ? 'Hidden · ' : '') + subLabel + '</div>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderItems() {
    if (state.items.length === 0) {
      dom.itemsList.innerHTML = '<div class="empty-state">Empty folder</div>';
      return;
    }

    // Selection mode keeps the simple flat list (checkboxes + select-all)
    if (state.selectionMode) { renderItemsFlat(); return; }

    var currentPath = state.nowPlaying ? state.nowPlaying.path : null;
    var dirs = state.items.filter(function(i) { return i.isDir; })
      .sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    var audioFiles = getAudioFilesFromItems(state.items); // sorted audio only
    var otherFiles = state.items.filter(function(i) {
      return !i.isDir && !isAudio(i.name) && !isHiddenFile(i.name);
    }).sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    var atRoot = state.path.length <= 1;
    if (dom.header) dom.header.style.display = atRoot ? '' : 'none';
    if (dom.breadcrumb) { dom.breadcrumb.innerHTML = ''; if (atRoot) dom.breadcrumb.style.display = 'none'; }
    var html = '';

    // ── Album-style hero for a music sub-folder ──
    if (!atRoot && audioFiles.length > 0) {
      var folderName = state.path[state.path.length - 1].name;
      var artist = commonMeta(audioFiles, 'artist');
      var totalDur = audioFiles.reduce(function(s, f) {
        return s + ((f.metadata && f.metadata.duration) || 0);
      }, 0);
      var songLine = audioFiles.length + ' song' + (audioFiles.length !== 1 ? 's' : '');
      var durTxt = formatLongDuration(totalDur);
      if (durTxt) songLine += ', ' + durTxt;

      html += '<div class="album-detail-header folder-hero">';
      html += '<img class="album-detail-cover" src="' + api.getCoverUrl(audioFiles[0].path) + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
      html += '<div class="album-card-placeholder folder-hero-ph" style="display:none">' + FOLDER_GLYPH + '</div>';
      html += '<div class="album-detail-info">';
      var hasSubdirs = dirs.length > 0;
      var hasAudio = audioFiles.length > 0;
      var folderLabel = hasSubdirs && hasAudio ? 'Folder · Artist/Album'
        : hasSubdirs ? 'Folder · Artist'
        : hasAudio ? 'Folder · Album'
        : 'Folder';
      html += '<div class="album-detail-label">' + folderLabel + '</div>';
      html += '<h1 class="album-detail-title">' + escapeHtml(folderName) + '</h1>';
      html += '<div class="album-detail-meta">';
      if (artist && state.path.length >= 3) {
        var artistIdx = state.path.length - 2;
        html += '<span class="adm-artist adm-artist-link" data-nav="' + artistIdx + '">' + escapeHtml(artist) + '</span><span class="adm-dot"> · </span>';
      } else if (artist) {
        html += '<span class="adm-artist">' + escapeHtml(artist) + '</span><span class="adm-dot"> · </span>';
      }
      html += '<span class="adm-sub">' + songLine + '</span></div>';
      html += '</div></div>';
      html += '<div class="album-detail-actions folder-hero-actions">';
      html += '<button class="album-play-all-btn" data-action="play-all" aria-label="Play all" title="Play all">' + PI(28) + '</button>';
      html += '<button class="folder-shuffle-btn" data-action="shuffle-all" aria-label="Shuffle" title="Shuffle">' + SHUFFLE_GLYPH + '</button>';
      html += '</div>';
    }

    // ── Sub-folders as cards ──
    if (dirs.length > 0) {
      if (atRoot) {
        // Curated root: artists on top, albums at bottom
        var artistDirs = dirs.filter(function(d) { return d.folderType === 'artist' || d.folderType === 'mixed'; });
        var albumDirs = dirs.filter(function(d) { return d.folderType === 'album'; });

        if (artistDirs.length > 0) {
          html += '<div class="subhead">Artists</div>' + renderFolderCardGrid(artistDirs);
        }
        if (albumDirs.length > 0) {
          html += '<div class="subhead">Albums</div>' + renderFolderCardGrid(albumDirs);
        }
      } else {
        if (audioFiles.length > 0) html += '<div class="subhead">Folders</div>';
        html += renderFolderCardGrid(dirs);
      }
    }

    // ── Track table ──
    if (audioFiles.length > 0) {
      html += '<div class="track-head"><span class="th-num">#</span><span class="th-title">Title</span><span class="th-dur">' + CLOCK_GLYPH + '</span><span class="th-more"></span></div>';
      html += '<div class="items-list track-list">';
      for (var t = 0; t < audioFiles.length; t++) {
        var tr = audioFiles[t];
        var tm = tr.metadata || {};
        var isCur = currentPath === tr.path;
        var isHidden = tr.hidden;
        var nm = tm.title || stripExt(tr.name);
        html += '<div class="item item-file track-row' + (isCur ? ' currently-playing' : '') + (isCur && state.isPlaying ? ' row-playing' : '') + (isHidden ? ' track-hidden' : '') + '" data-path="' + escapeHtml(tr.path) + '">';
        html += '<div class="track-num"><span class="track-num-index">' + (tm.trackNo || (t + 1)) + '</span>' + EQ_HTML + '<button class="track-num-play" data-action="play" aria-label="Play">' + PI(14) + '</button></div>';
        html += '<div class="item-info"><div class="item-name">' + escapeHtml(nm) + '</div>';
        if (tm.artist) html += '<div class="item-meta">' + escapeHtml(tm.artist) + '</div>';
        html += '</div>';
        if (tm.duration) html += '<span class="item-duration">' + formatTime(tm.duration) + '</span>';
        html += '<button class="btn-more" data-action="more" aria-label="More">•••</button>';
        html += '</div>';
      }
      html += '</div>';
    } else if (otherFiles.length > 0) {
      // Non-music folder: plain list of remaining files
      html += '<div class="items-list">';
      for (var o = 0; o < otherFiles.length; o++) {
        var of = otherFiles[o];
        html += '<div class="item item-file" data-path="' + escapeHtml(of.path) + '">';
        html += '<div class="item-icon">' + FILE_GLYPH + '</div>';
        html += '<div class="item-info"><div class="item-name">' + escapeHtml(stripExt(of.name)) + '</div>';
        html += '<div class="item-meta">' + formatSize(of.size) + '</div></div>';
        html += '<button class="btn-more" data-action="more" aria-label="More">•••</button>';
        html += '</div>';
      }
      html += '</div>';
    } else if (dirs.length === 0) {
      html += '<div class="empty-state">Empty folder</div>';
    }

    dom.itemsList.innerHTML = html;

    // Wire hero breadcrumb clicks and artist link clicks
    setTimeout(function() {
      var hb = dom.itemsList.querySelector('.hero-breadcrumb');
      if (hb) {
        hb.addEventListener('click', function(e) {
          var crumb = e.target.closest('.crumb');
          if (!crumb) return;
          closeItemMenu();
          navigateTo(parseInt(crumb.dataset.idx, 10));
        });
      }
      var al = dom.itemsList.querySelector('.adm-artist-link');
      if (al) {
        al.addEventListener('click', function(e) {
          e.stopPropagation();
          closeItemMenu();
          navigateTo(parseInt(al.dataset.nav, 10));
        });
      }
    }, 0);
  }

  // Flat row list — used during selection mode (preserves checkboxes/select-all)
  function renderItemsFlat() {
    var sorted = sortItems(state.items);
    var currentPath = state.nowPlaying ? state.nowPlaying.path : null;

    var html = '';
    for (var i = 0; i < sorted.length; i++) {
      var item = sorted[i];
      var isAudioFile = !item.isDir && isAudio(item.name);
      var isCurrent = currentPath === item.path;
      var isPlaying = isCurrent && state.isPlaying;
      var isSelected = state.selectedPaths.indexOf(item.path) !== -1;

      html += '<div class="item ' + (item.isDir ? 'item-folder' : 'item-file') + (isCurrent ? ' currently-playing' : '') + '" data-path="' + escapeHtml(item.path) + '">';

      if (!item.isDir) {
        html += '<div class="item-checkbox' + (isSelected ? ' checked' : '') + '">' + (isSelected ? '✓' : '') + '</div>';
      }

      if (item.isDir) {
        html += '<div class="item-icon">▸</div>';
      } else if (isAudioFile) {
        html += '<img class="item-thumb" src="' + api.getCoverUrl(item.path) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
        html += '<div class="item-icon item-fallback-note" style="display:none">♫</div>';
      } else {
        html += '<div class="item-icon">' + FILE_GLYPH + '</div>';
      }

      html += '<div class="item-info">';
      var displayName = item.isDir ? item.name : (item.metadata && item.metadata.title ? item.metadata.title : stripExt(item.name));
      html += '<div class="item-name">' + escapeHtml(displayName) + '</div>';
      if (!item.isDir) {
        var meta = item.metadata || {};
        var metaParts = [];
        if (meta.artist) metaParts.push(escapeHtml(meta.artist));
        if (meta.album) metaParts.push(escapeHtml(meta.album));
        if (item.size != null) metaParts.push(formatSize(item.size));
        html += '<div class="item-meta">' + (metaParts.length ? metaParts.join(' · ') : formatSize(item.size)) + '</div>';
      }
      html += '</div>';

      if (item.metadata && item.metadata.duration) {
        html += '<span class="item-duration">' + formatTime(item.metadata.duration) + '</span>';
      }

      if (isAudioFile) {
        html += '<button class="btn-play' + (isPlaying ? ' is-playing' : '') + '" data-action="play" aria-label="' + (isPlaying ? 'Pause' : 'Play') + '">';
        html += isPlaying ? '⏸' : PI(14);
        html += '</button>';
      }

      html += '<button class="btn-more" data-action="more" aria-label="More">•••</button>';
      html += '</div>';
    }

    var allAudio = getAudioFilesFromItems(state.items);
    var allSelected = allAudio.length > 0 && allAudio.every(function(f) { return state.selectedPaths.indexOf(f.path) !== -1; });
    var selectAllHtml = '<div class="item" style="cursor:pointer" id="select-all-row">';
    selectAllHtml += '<div class="item-checkbox' + (allSelected ? ' checked' : '') + '" style="display:flex">' + (allSelected ? '✓' : '') + '</div>';
    selectAllHtml += '<div class="item-info"><div class="item-name" style="color:var(--accent);font-weight:700">' + (allSelected ? 'Deselect all' : 'Select all') + '</div></div>';
    selectAllHtml += '</div>';
    html = selectAllHtml + html;

    setTimeout(function() {
      var row = document.getElementById('select-all-row');
      if (row) {
        row.addEventListener('click', function(e) {
          e.stopPropagation();
          selectAllAudioFiles();
        });
      }
    }, 0);

    dom.itemsList.innerHTML = html;
  }

  function updatePlayButtons() {
    var currentPath = state.nowPlaying ? state.nowPlaying.path : null;
    var rows = document.querySelectorAll('.item[data-path]');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var isCurrent = currentPath && row.dataset.path === currentPath;
      row.classList.toggle('currently-playing', !!isCurrent);
      row.classList.toggle('row-playing', !!(isCurrent && state.isPlaying));
      var btn = row.querySelector('.btn-play');
      if (btn) {
        if (isCurrent && state.isPlaying) {
          btn.classList.add('is-playing');
          btn.textContent = '⏸';
          btn.setAttribute('aria-label', 'Pause');
        } else {
          btn.classList.remove('is-playing');
          btn.innerHTML = PI(14);
          btn.setAttribute('aria-label', 'Play');
        }
      }
    }
  }

  /* ─── Breadcrumb Events ─── */

  if (dom.breadcrumb) {
    dom.breadcrumb.addEventListener('click', function(e) {
      var crumb = e.target.closest('.crumb');
      if (!crumb) return;
      closeItemMenu();
      navigateTo(parseInt(crumb.dataset.idx, 10));
    });
  }

  /* ─── Toolbar ─── */

  dom.toolbarBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    closeItemMenu();

    // Show a compact dropdown with upload + new folder
    var menu = document.createElement('div');
    menu.className = 'dropdown';
    menu.innerHTML =
      '<button class="dropdown-item" data-action="tb-upload">📁 Upload files</button>' +
      '<button class="dropdown-item" data-action="tb-mkdir">📂 New folder</button>';

    var rect = dom.toolbarBtn.getBoundingClientRect();
    menu.style.top = rect.bottom + 4 + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';

    var backdrop = document.createElement('div');
    backdrop.className = 'dropdown-backdrop';
    backdrop.addEventListener('click', closeItemMenu);
    document.body.appendChild(backdrop);
    document.body.appendChild(menu);

    menu.addEventListener('click', function(ev) {
      var btn = ev.target.closest('.dropdown-item');
      if (!btn) return;
      ev.stopPropagation();
      var action = btn.dataset.action;
      // Fire the action before closing menu — some browsers block
      // programmatic fileInput.click() if the originating element is gone
      if (action === 'tb-upload') {
        dom.fileInput.click();
      }
      closeItemMenu();
      if (action === 'tb-mkdir') {
        promptMkdir();
      }
    });
  });

  /* ─── Item context menu (•••) ─── */

  function showItemMenu(item, anchorEl) {
    closeItemMenu();

    var menu = document.createElement('div');
    menu.className = 'dropdown';
    menu.dataset.itemMenu = '1';

    var isAdmin = authState.isAdmin;
    var items = [];
    if (isAudio(item.name)) {
      items.push({ label: 'Play', action: 'play-now', cls: '' });
      items.push({ label: 'Add to playlist', action: 'add-playlist', cls: 'has-submenu' });
      items.push({ label: 'Download', action: 'download', cls: '' });
      if (isAdmin) items.push({ label: 'Edit tags', action: 'edittags', cls: '' });
    }
    if (item.isDir) {
      if (isAdmin) {
        items.push({ label: 'Change cover', action: 'change-cover', cls: '' });
        items.push({ label: item.hidden ? 'Unhide' : 'Hide', action: 'toggle-hide', cls: '' });
      }
    }
    if (isAdmin) {
      items.push({ label: 'Rename', action: 'rename', cls: '' });
      items.push({ label: 'Delete', action: 'delete', cls: 'dropdown-item-danger' });
    }
    if (!item.isDir && isAudio(item.name)) {
      items.push({ label: 'Add folder to playlist', action: 'add-folder-playlist', cls: '' });
    }

    menu.innerHTML = items.map(function(itm) {
      return '<button class="dropdown-item ' + itm.cls + '" data-action="' + itm.action + '">' + itm.label + '</button>';
    }).join('');

    var rect = anchorEl.getBoundingClientRect();
    menu.style.top = Math.min(rect.bottom + 2, window.innerHeight - 300) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';

    // On mobile, prefer left-align to avoid clipping
    if (window.innerWidth < 480) {
      menu.style.right = 'auto';
      menu.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
    }

    var backdrop = document.createElement('div');
    backdrop.className = 'dropdown-backdrop';
    backdrop.addEventListener('click', closeItemMenu);
    document.body.appendChild(backdrop);
    document.body.appendChild(menu);

    menu.addEventListener('click', function(ev) {
      var btn = ev.target.closest('.dropdown-item');
      if (!btn) return;
      var action = btn.dataset.action;
      closeItemMenu();
      if (action === 'play-now') {
        setQueueFromDirectory(currentDir(), state.items);
        var idx = state.queue.findIndex(function(t) { return t.path === item.path; });
        if (idx >= 0) playFromQueue(idx);
      } else if (action === 'download') downloadFile(item);
      else if (action === 'rename') promptRename(item);
      else if (action === 'delete') promptDelete(item);
      else if (action === 'edittags') promptEditMetadata(item);
      else if (action === 'add-playlist') showAddToPlaylistMenu(item, anchorEl);
      else if (action === 'add-folder-playlist') {
        addFolderToPlaylist(currentDir(), state.items);
      } else if (action === 'change-cover') {
        promptUploadCover(item.path, false, function() { loadDirectory(currentDir()); });
      } else if (action === 'toggle-hide') {
        toggleHideItem(item);
      }
    });
  }

  function showAddToPlaylistMenu(item, anchorEl) {
    closeItemMenu();

    var menu = document.createElement('div');
    menu.className = 'dropdown';
    menu.dataset.itemMenu = '1';

    // Fetch playlists for the submenu
    api.listPlaylists().then(function(data) {
      var pls = data.playlists || [];
      var html = '';
      for (var i = 0; i < pls.length; i++) {
        html += '<button class="dropdown-item" data-action="add-to" data-plid="' + pls[i].id + '">' + escapeHtml(pls[i].name) + '</button>';
      }
      html += '<div class="dropdown-divider"></div>';
      html += '<button class="dropdown-item" data-action="new-playlist" style="color:var(--accent-green)">+ New playlist</button>';
      menu.innerHTML = html;

      var rect = anchorEl.getBoundingClientRect();
      menu.style.top = Math.min(rect.bottom + 2, window.innerHeight - 300) + 'px';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      if (window.innerWidth < 480) {
        menu.style.right = 'auto';
        menu.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
      }

      var backdrop = document.createElement('div');
      backdrop.className = 'dropdown-backdrop';
      backdrop.addEventListener('click', closeItemMenu);
      document.body.appendChild(backdrop);
      document.body.appendChild(menu);

      menu.addEventListener('click', function(ev) {
        var btn = ev.target.closest('.dropdown-item');
        if (!btn) return;
        closeItemMenu();
        if (btn.dataset.action === 'add-to') {
          api.addTracksToPlaylist(btn.dataset.plid, [{ path: item.path, name: item.name }])
            .then(function() {
              if (state.activeTab === 'playlists') loadPlaylists();
            }).catch(function(err) { handleError('Cannot add to playlist', err); });
        } else if (btn.dataset.action === 'new-playlist') {
          promptNewPlaylistAndAdd([{ path: item.path, name: item.name }]);
        }
      });
    }).catch(function(err) {
      closeItemMenu();
      handleError('Cannot load playlists', err);
    });
  }

  /* ─── Add folder contents to playlist ─── */

  function addFolderToPlaylist(dir, items) {
    var tracks = getAudioFilesFromItems(items);
    if (tracks.length === 0) {
      handleError('No audio files', new Error('No audio files in this folder'));
      return;
    }

    api.listPlaylists().then(function(data) {
      var pls = data.playlists || [];
      if (pls.length === 0) {
        // No playlists — create one
        var folderName = dir ? dir.split('/').pop() : 'New playlist';
        var tracksData = tracks.map(function(t) { return { path: t.path, name: t.name }; });
        api.createPlaylist(folderName).then(function(newPl) {
          return api.addTracksToPlaylist(newPl.id, tracksData);
        }).then(function() {
          if (state.activeTab === 'playlists') loadPlaylists();
        }).catch(function(err) { handleError('Cannot create playlist', err); });
        return;
      }

      // Show playlist picker modal
      promptPickPlaylist(tracks, pls);
    }).catch(function(err) {
      handleError('Cannot load playlists', err);
    });
  }

  function promptPickPlaylist(tracks, playlists) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    var html = '<div class="modal-box" style="max-height:70vh;overflow-y:auto">';
    html += '<div class="modal-title">Add ' + tracks.length + ' tracks to playlist</div>';
    for (var i = 0; i < playlists.length; i++) {
      html += '<button class="dropdown-item" style="border-bottom:1px solid var(--border)" data-action="pick" data-plid="' + playlists[i].id + '">' + escapeHtml(playlists[i].name) + ' <span style="margin-left:auto;color:var(--text-dim);font-size:11px">' + playlists[i].trackCount + '</span></button>';
    }
    html += '<div style="padding-top:8px"><button class="dropdown-item" style="color:var(--accent-green)" data-action="new-and-add">+ New playlist</button></div>';
    html += '</div>';
    backdrop.innerHTML = html;
    document.body.appendChild(backdrop);

    function close() { backdrop.remove(); }
    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) close(); });

    backdrop.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var tracksData = tracks.map(function(t) { return { path: t.path, name: t.name }; });
      close();
      if (btn.dataset.action === 'pick') {
        showLoading('Adding...');
        api.addTracksToPlaylist(btn.dataset.plid, tracksData).then(function() {
          hideLoading();
          if (state.activeTab === 'playlists') loadPlaylists();
        }).catch(function(err) { hideLoading(); handleError('Cannot add', err); });
      } else if (btn.dataset.action === 'new-and-add') {
        promptNewPlaylistAndAdd(tracksData);
      }
    });
  }

  function promptNewPlaylistAndAdd(tracks) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML =
      '<div class="modal-box">' +
        '<div class="modal-title">New playlist</div>' +
        '<input class="modal-input" id="modal-input" placeholder="Playlist name" maxlength="200">' +
        '<div class="modal-actions">' +
          '<button class="modal-btn modal-btn-secondary" id="modal-cancel">Cancel</button>' +
          '<button class="modal-btn modal-btn-primary" id="modal-confirm">Create & Add</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    var input = backdrop.querySelector('#modal-input');
    var cancel = backdrop.querySelector('#modal-cancel');
    var confirm = backdrop.querySelector('#modal-confirm');
    function close() { backdrop.remove(); }

    cancel.addEventListener('click', close);
    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) close(); });
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') confirm.click(); });
    setTimeout(function() { input.focus(); }, 100);

    confirm.addEventListener('click', function() {
      var name = input.value.trim();
      if (!name) return;
      close();
      showLoading('Creating...');
      api.createPlaylist(name).then(function(newPl) {
        return api.addTracksToPlaylist(newPl.id, tracks);
      }).then(function() {
        hideLoading();
        if (state.activeTab === 'playlists') loadPlaylists();
      }).catch(function(err) { hideLoading(); handleError('Cannot create', err); });
    });
  }

  /* ─── Selection batch actions ─── */

  dom.selectionBar.querySelector('#selection-playlist-btn').addEventListener('click', function() {
    var tracks = state.selectedPaths.map(function(p) {
      return { path: p, name: p.split('/').pop() };
    });

    api.listPlaylists().then(function(data) {
      var pls = data.playlists || [];
      if (pls.length === 0) {
        promptNewPlaylistAndAdd(tracks);
      } else {
        promptPickPlaylistForSelection(tracks, pls);
      }
    }).catch(function(err) { handleError('Cannot load playlists', err); });
  });

  function promptPickPlaylistForSelection(tracks, playlists) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    var html = '<div class="modal-box" style="max-height:70vh;overflow-y:auto">';
    html += '<div class="modal-title">Add ' + tracks.length + ' tracks to playlist</div>';
    for (var i = 0; i < playlists.length; i++) {
      html += '<button class="dropdown-item" style="border-bottom:1px solid var(--border)" data-action="pick" data-plid="' + playlists[i].id + '">' + escapeHtml(playlists[i].name) + ' <span style="margin-left:auto;color:var(--text-dim);font-size:11px">' + playlists[i].trackCount + '</span></button>';
    }
    html += '<div style="padding-top:8px"><button class="dropdown-item" style="color:var(--accent-green)" data-action="new-and-add">+ New playlist</button></div>';
    html += '</div>';
    backdrop.innerHTML = html;
    document.body.appendChild(backdrop);

    function close() { backdrop.remove(); }
    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) close(); });

    backdrop.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      close();
      if (btn.dataset.action === 'pick') {
        showLoading('Adding...');
        api.addTracksToPlaylist(btn.dataset.plid, tracks).then(function() {
          hideLoading();
          state.selectionMode = false;
          state.selectedPaths = [];
          renderItems();
          renderSelectionBar();
          if (state.activeTab === 'playlists') loadPlaylists();
        }).catch(function(err) { hideLoading(); handleError('Cannot add', err); });
      } else if (btn.dataset.action === 'new-and-add') {
        promptNewPlaylistAndAdd(tracks);
        state.selectionMode = false;
        state.selectedPaths = [];
        renderItems();
        renderSelectionBar();
      }
    });
  }

  dom.selectionBar.querySelector('#selection-cancel-btn').addEventListener('click', function() {
    state.selectionMode = false;
    state.selectedPaths = [];
    renderItems();
    renderSelectionBar();
  });

  dom.selectionBar.querySelector('#selection-delete-btn').addEventListener('click', function() {
    if (state.selectedPaths.length === 0) return;
    var msg = 'Delete ' + state.selectedPaths.length + ' file' + (state.selectedPaths.length > 1 ? 's' : '') + '?';
    if (!confirm(msg)) return;
    showLoading('Deleting...');
    var total = state.selectedPaths.length;
    var done = 0;
    function deleteNext(i) {
      if (i >= total) {
        hideLoading();
        state.selectionMode = false;
        state.selectedPaths = [];
        loadDirectory(currentDir());
        return;
      }
      api.del(state.selectedPaths[i]).then(function() {
        done++;
        deleteNext(i + 1);
      }).catch(function(err) {
        handleError('Cannot delete ' + state.selectedPaths[i], err);
        done++;
        deleteNext(i + 1);
      });
    }
    deleteNext(0);
  });

  /* ─── Playlists Tab UI ─── */

  function renderPlaylistCoverHTML(coverDirs, pl) {
  // Custom playlist cover
  if (pl && pl.hasCustomCover) {
    return '<div class="pl-cover"><img class="pl-cover-img" style="grid-column:1/-1;grid-row:1/-1" src="' + api.getPlaylistCoverUrl(pl.id, pl.coverVersion) + '" loading="lazy" onerror="this.style.display=\'none\'"></div>';
  }
  if (!coverDirs || coverDirs.length === 0) {
    return '<div class="pl-cover pl-cover-empty"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>';
  }
  var n = Math.min(coverDirs.length, 4);
  var html = '<div class="pl-cover">';
  for (var i = 0; i < n; i++) {
    var style = '';
    if (n === 1) {
      style = 'grid-column:1/-1;grid-row:1/-1';
    } else if (n === 2) {
      style = 'grid-row:1/-1';
    } else if (n === 3 && i === 0) {
      style = 'grid-row:1/-1';
    }
    html += '<img class="pl-cover-img" style="' + style + '" src="' + api.getCoverUrl(coverDirs[i]) + '" loading="lazy" onerror="this.style.display=\'none\'">';
  }
  html += '</div>';
  return html;
}

function loadPlaylists() {
    hideHeaderBack();
    showLoading('Loading playlists...');
    api.listPlaylists().then(function(data) {
      state.playlists = data.playlists || [];
      state.currentPlaylist = null;
      renderPlaylistsList();
      hideLoading();
    }).catch(function(err) {
      hideLoading();
      handleError('Cannot load playlists', err);
    });
  }

  function renderPlaylistsList() {
    if (state.playlists.length === 0) {
      dom.playlistsView.innerHTML =
        '<div style="padding:48px 20px;text-align:center;">' +
          '<div style="font-size:40px;margin-bottom:16px;opacity:0.5">🎵</div>' +
          '<div style="font-size:18px;font-weight:600;margin-bottom:8px;color:var(--text)">No playlists yet</div>' +
          '<div style="font-size:13px;color:var(--text-dim);margin-bottom:20px">Create a playlist to organize your music</div>' +
          '<button class="selection-btn" id="create-first-playlist" style="font-size:14px;height:38px;padding:0 24px">Create playlist</button>' +
        '</div>';

      setTimeout(function() {
        var btn = document.getElementById('create-first-playlist');
        if (btn) {
          btn.addEventListener('click', function() {
            promptNewPlaylistAndAdd([]);
          });
        }
      }, 0);
      return;
    }

    var html = '<div class="playlists-header"><h2 class="playlists-title">Playlists</h2>';
    html += '<button class="selection-btn" id="new-playlist-btn" style="font-size:13px">+ New</button></div>';
    html += '<div class="playlist-grid">';

    for (var i = 0; i < state.playlists.length; i++) {
      var pl = state.playlists[i];
      html += '<div class="playlist-card" data-plid="' + pl.id + '">';
      html += '<div class="card-cover-wrap">';
      html += renderPlaylistCoverHTML(pl.coverDirs, pl);
      html += '<button class="card-play-btn" data-play-plid="' + pl.id + '" aria-label="Play">' + PI(22) + '</button>';
      html += '</div>';
      html += '<div class="playlist-card-name">' + escapeHtml(pl.name) + '</div>';
      html += '<div class="playlist-card-meta">' + pl.trackCount + ' tracks</div>';
      html += '</div>';
    }

    html += '</div>';
    dom.playlistsView.innerHTML = html;

    // Attach handlers
    setTimeout(function() {
      dom.playlistsView.querySelectorAll('.playlist-card').forEach(function(card) {
        card.addEventListener('click', function(e) {
          if (e.target.closest('.card-play-btn')) return;
          viewPlaylist(card.dataset.plid);
        });
      });
      dom.playlistsView.querySelectorAll('.card-play-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          loadAndPlayPlaylist(btn.dataset.playPlid);
        });
      });
      var newBtn = document.getElementById('new-playlist-btn');
      if (newBtn) {
        newBtn.addEventListener('click', function() {
          promptNewPlaylistAndAdd([]);
        });
      }
    }, 0);
  }

  function viewPlaylist(id) {
    showLoading('Loading...');
    api.getPlaylist(id).then(function(playlist) {
      state.currentPlaylist = playlist;
      renderPlaylistDetail();
      hideLoading();
    }).catch(function(err) {
      hideLoading();
      handleError('Cannot open playlist', err);
    });
  }

  function renderPlaylistDetail() {
    var pl = state.currentPlaylist;
    if (!pl) return;

    if (dom.header) dom.header.style.display = 'none';
    var count = pl.tracks ? pl.tracks.length : 0;
    var html = '<div class="album-detail-header playlist-hero">';
    html += '<div class="playlist-hero-cover">' + renderPlaylistCoverHTML(pl.coverDirs, pl) + '</div>';
    html += '<div class="album-detail-info">';
    html += '<div class="album-detail-label">Playlist</div>';
    html += '<h1 class="album-detail-title">' + escapeHtml(pl.name) + '</h1>';
    html += '<div class="album-detail-meta">' + count + ' song' + (count !== 1 ? 's' : '') + '</div>';
    html += '</div></div>';
    html += '<div class="album-detail-actions">';
    html += '<button class="album-play-all-btn" id="playlist-play-all" aria-label="Play all" title="Play all">' + PI(28) + '</button>';
    html += '<button class="playlist-action-btn playlist-more-btn" id="playlist-more" aria-label="More">•••</button>';
    html += '</div>';

    if (!pl.tracks || pl.tracks.length === 0) {
      html += '<div class="empty-state">No tracks</div>';
    } else {
      html += '<div class="track-head"><span class="th-num">#</span><span class="th-title">Title</span><span class="th-dur">' + CLOCK_GLYPH + '</span><span class="th-more"></span></div>';
      html += '<div class="items-list track-list">';
      for (var i = 0; i < pl.tracks.length; i++) {
        var track = pl.tracks[i];
        var isCurrent = state.nowPlaying && state.nowPlaying.path === track.path;
        var tnm = (track.metadata && track.metadata.title) || stripExt(track.name);
        var tartist = track.artist || (track.metadata && track.metadata.artist) || '';
        var tdur = track.duration || (track.metadata && track.metadata.duration);
        html += '<div class="item item-file track-row' + (isCurrent ? ' currently-playing' : '') + (isCurrent && state.isPlaying ? ' row-playing' : '') + '" data-idx="' + i + '" data-path="' + escapeHtml(track.path) + '">';
        html += '<span class="pl-drag-handle" data-reorder-handle aria-label="Reorder">' + GRIP_SVG + '</span>';
        html += '<div class="track-num"><span class="track-num-index">' + (i + 1) + '</span>' + EQ_HTML + '<button class="track-num-play" data-action="play-track" aria-label="Play">' + PI(14) + '</button></div>';
        html += '<img class="item-thumb" src="' + api.getCoverUrl(track.path) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
        html += '<div class="item-icon item-fallback-note" style="display:none">♫</div>';
        html += '<div class="item-info"><div class="item-name">' + escapeHtml(tnm) + '</div>';
        if (tartist) html += '<div class="item-meta">' + escapeHtml(tartist) + '</div>';
        html += '</div>';
        if (tdur) html += '<span class="item-duration">' + formatTime(tdur) + '</span>';
        html += '<button class="btn-more" data-action="more-track" aria-label="More">•••</button>';
        html += '</div>';
      }
      html += '</div>';
    }

    dom.playlistsView.innerHTML = html;

    // Attach handlers
    setTimeout(function() {
      showHeaderBack(loadPlaylists);
      setupPlaylistReorder(pl);

      var playAllBtn = document.getElementById('playlist-play-all');
      if (playAllBtn) playAllBtn.addEventListener('click', function() {
        setQueueFromPlaylist(pl);
        playFromQueue(0);
      });

      var moreBtn = document.getElementById('playlist-more');
      if (moreBtn) moreBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        showPlaylistOptionsMenu(pl, moreBtn);
      });

      // Track click handlers
      dom.playlistsView.querySelectorAll('.item-file').forEach(function(itemEl) {
        itemEl.addEventListener('click', function(e) {
          var actionBtn = e.target.closest('[data-action]');
          var idx = parseInt(itemEl.dataset.idx, 10);
          if (actionBtn) {
            e.stopPropagation();
            if (actionBtn.dataset.action === 'play-track') {
              setQueueFromPlaylist(pl);
              playFromQueue(idx);
            } else if (actionBtn.dataset.action === 'more-track') {
              showPlaylistTrackMenu(pl, idx, actionBtn);
            }
            return;
          }
          // Click row to play
          setQueueFromPlaylist(pl);
          playFromQueue(idx);
        });
      });
    }, 0);
  }

  function showPlaylistOptionsMenu(pl, anchorEl) {
    closeItemMenu();
    var menu = document.createElement('div');
    menu.className = 'dropdown';
    menu.innerHTML =
      '<button class="dropdown-item" data-action="edit-name">Edit name</button>' +
      '<button class="dropdown-item" data-action="change-cover-pl">Change cover</button>' +
      '<div class="dropdown-divider"></div>' +
      '<button class="dropdown-item dropdown-item-danger" data-action="delete-pl">Delete playlist</button>';

    var rect = anchorEl.getBoundingClientRect();
    menu.style.top = Math.min(rect.bottom + 4, window.innerHeight - 200) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';

    var backdrop = document.createElement('div');
    backdrop.className = 'dropdown-backdrop';
    backdrop.addEventListener('click', closeItemMenu);
    document.body.appendChild(backdrop);
    document.body.appendChild(menu);

    menu.addEventListener('click', function(ev) {
      var btn = ev.target.closest('.dropdown-item');
      if (!btn) return;
      closeItemMenu();
      if (btn.dataset.action === 'edit-name') {
        promptModalInput('Edit playlist name', pl.name, function(newName) {
          if (!newName || newName === pl.name) return;
          showLoading('Renaming...');
          api.updatePlaylist(pl.id, { name: newName }).then(function(updated) {
            hideLoading();
            state.currentPlaylist = updated;
            for (var k = 0; k < state.playlists.length; k++) {
              if (state.playlists[k].id === updated.id) {
                state.playlists[k] = { id: updated.id, name: updated.name, createdAt: updated.createdAt, trackCount: updated.tracks.length };
                break;
              }
            }
            renderPlaylistDetail();
          }).catch(function(err) { hideLoading(); handleError('Cannot rename', err); });
        });
      } else if (btn.dataset.action === 'change-cover-pl') {
        promptUploadCover(pl.id, true, function() {
          showLoading('Updating...');
          api.getPlaylist(pl.id).then(function(updated) {
            hideLoading();
            state.currentPlaylist = updated;
            for (var k = 0; k < state.playlists.length; k++) {
              if (state.playlists[k].id === updated.id) {
                state.playlists[k] = { id: updated.id, name: updated.name, createdAt: updated.createdAt, trackCount: updated.tracks.length, coverDirs: updated.coverDirs, hasCustomCover: updated.hasCustomCover, coverVersion: updated.coverVersion };
                break;
              }
            }
            renderPlaylistDetail();
            if (state.activeTab === 'playlists') loadPlaylists();
          }).catch(function(err) { hideLoading(); handleError('Cannot refresh', err); });
        });
      } else if (btn.dataset.action === 'delete-pl') {
        if (!confirm('Delete playlist "' + pl.name + '"?')) return;
        showLoading('Deleting...');
        api.deletePlaylist(pl.id).then(function() {
          hideLoading();
          state.currentPlaylist = null;
          loadPlaylists();
        }).catch(function(err) { hideLoading(); handleError('Cannot delete', err); });
      }
    });
  }

  function showPlaylistTrackMenu(playlist, idx, anchorEl) {
    closeItemMenu();
    var menu = document.createElement('div');
    menu.className = 'dropdown';
    menu.dataset.itemMenu = '1';
    menu.innerHTML =
      '<button class="dropdown-item" data-action="remove-track">Remove from playlist</button>';

    var rect = anchorEl.getBoundingClientRect();
    menu.style.top = Math.min(rect.bottom + 2, window.innerHeight - 200) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';

    var backdrop = document.createElement('div');
    backdrop.className = 'dropdown-backdrop';
    backdrop.addEventListener('click', closeItemMenu);
    document.body.appendChild(backdrop);
    document.body.appendChild(menu);

    menu.addEventListener('click', function(ev) {
      var btn = ev.target.closest('.dropdown-item');
      if (!btn) return;
      closeItemMenu();
      if (btn.dataset.action === 'remove-track') {
        showLoading('Removing...');
        api.removeTracksFromPlaylist(playlist.id, [idx]).then(function(updated) {
          hideLoading();
          state.currentPlaylist = updated;
          renderPlaylistDetail();
          // Also update cached list
          for (var k = 0; k < state.playlists.length; k++) {
            if (state.playlists[k].id === updated.id) {
              state.playlists[k] = { id: updated.id, name: updated.name, createdAt: updated.createdAt, trackCount: updated.tracks.length };
              break;
            }
          }
        }).catch(function(err) { hideLoading(); handleError('Cannot remove', err); });
      }
    });
  }

  /* ─── Queue-based Playback ─── */

  function setQueueFromDirectory(dir, items) {
    state.queue = getAudioFilesFromItems(items).map(function(item) {
      return { path: item.path, name: item.name };
    });
    state.queueSource = { type: 'directory', dir: dir };
  }

  function setQueueFromPlaylist(playlist) {
    state.queue = playlist.tracks.slice();
    state.queueSource = { type: 'playlist', id: playlist.id };
  }

  function shouldTranscode(path) {
    var ext = (path || '').split('.').pop().toLowerCase();
    if (ext !== 'flac') return null;
    try {
      var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn) {
        if (conn.saveData) return { format: 'opus', bitrate: 64 };
        var type = conn.effectiveType || conn.type || '';
        if (type === 'cellular' || type === 'slow-2g' || type === '2g' || type === '3g') {
          return { format: 'opus', bitrate: 96 };
        }
      }
    } catch(e) {}
    return null;
  }

  function playFromQueue(index) {
    if (index < 0 || index >= state.queue.length) return false;
    state.queueIndex = index;
    var item = state.queue[index];
    state.nowPlaying = { path: item.path, name: item.name };
    state.isPlaying = false;
    renderNowPlaying();
    loadNowPlayingMetadata();

    var tc = shouldTranscode(item.path);
    var url = tc ? api.getStreamUrl(item.path, tc.format, tc.bitrate) : api.getStreamUrl(item.path);
    audio.src = url;
    audio.play().then(function() {
      state.isPlaying = true;
      renderNowPlaying();
      updatePlayButtons();
      recordRecentPlay(item.path, item.name);
    }).catch(function(err) {
      handleError('Playback failed', err);
    });
    return true;
  }

  function recordRecentPlay(path, name) {
    try {
      var recent = JSON.parse(localStorage.getItem('sannmusic_recent') || '[]');
      for (var i = 0; i < recent.length; i++) {
        if (recent[i].path === path) { recent.splice(i, 1); break; }
      }
      var entry = { path: path, name: name, timestamp: Date.now() };
      if (state.nowPlaying && state.nowPlaying.tags) {
        if (state.nowPlaying.tags.title) entry.title = state.nowPlaying.tags.title;
        if (state.nowPlaying.tags.artist) entry.artist = state.nowPlaying.tags.artist;
      }
      recent.unshift(entry);
      if (recent.length > 20) recent = recent.slice(0, 20);
      localStorage.setItem('sannmusic_recent', JSON.stringify(recent));
      state.recentPlays = recent;
    } catch(e) {}
  }

  function playNextInQueue(allowWrap) {
    if (state.queue.length === 0) return false;
    var nextIdx;
    if (state.shuffle) {
      if (state.queue.length === 1) {
        if (!allowWrap) return false;
        nextIdx = 0;
      } else {
        do { nextIdx = Math.floor(Math.random() * state.queue.length); }
        while (nextIdx === state.queueIndex);
      }
    } else {
      nextIdx = state.queueIndex + 1;
      if (nextIdx >= state.queue.length) {
        if (!allowWrap) return false;
        nextIdx = 0;
      }
    }
    return playFromQueue(nextIdx);
  }

  function playPrevInQueue() {
    if (state.queue.length === 0) return;
    var prevIdx;
    if (state.shuffle) {
      prevIdx = Math.floor(Math.random() * state.queue.length);
    } else {
      prevIdx = state.queueIndex <= 0 ? state.queue.length - 1 : state.queueIndex - 1;
    }
    playFromQueue(prevIdx);
  }

  /* ─── Now Playing Metadata ─── */

  function loadNowPlayingMetadata() {
    if (!state.nowPlaying) return;
    api.getMetadata(state.nowPlaying.path).then(function(data) {
      if (state.nowPlaying && state.nowPlaying.path === data.path) {
        state.nowPlaying.tags = data.tags;
        renderNowPlaying();
      }
    }).catch(function() {});
  }

  /* ─── Now Playing Bar ─── */

  function renderNowPlaying() {
    dom.nowPlaying.classList.add('visible');

    if (!state.nowPlaying) {
      dom.npCover.src = '';
      dom.npCover.style.display = 'none';
      if (!document.getElementById('np-placeholder')) {
        dom.npCover.insertAdjacentHTML('afterend', '<div class="np-placeholder" id="np-placeholder"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><path d="M12 2v10"/></svg></div>');
      }
      dom.npTitle.textContent = 'Not playing';
      dom.npArtist.textContent = '';
      dom.npProgressClickFill.style.width = '0%';
      dom.npCurrentTime.textContent = '0:00';
      dom.npDuration.textContent = '0:00';
      dom.npPlayIcon.style.display = '';
      dom.npPauseIcon.style.display = 'none';
      dom.npShuffleBtn.classList.remove('active');
      dom.npRepeatBtn.classList.remove('active');
      dom.npRepeatOne.style.display = 'none';
      return;
    }

    var ph = document.getElementById('np-placeholder');
    if (ph) ph.remove();
    dom.npCover.style.display = '';
    dom.npCover.src = api.getCoverUrl(state.nowPlaying.path);
    dom.npCover.onerror = function() { dom.npCover.style.display = 'none'; };
    dom.npCover.onload = function() { dom.npCover.style.display = ''; };

    var tags = state.nowPlaying.tags || {};
    if (tags.title) {
      dom.npTitle.textContent = tags.title;
    } else {
      dom.npTitle.textContent = stripExt(state.nowPlaying.name);
    }

    var artistParts = [];
    if (tags.artist) artistParts.push(tags.artist);
    if (tags.album) artistParts.push(tags.album);
    dom.npArtist.textContent = artistParts.join(' · ') || '';

    // Play/Pause icon
    if (state.isPlaying) {
      dom.npPlayIcon.style.display = 'none';
      dom.npPauseIcon.style.display = '';
    } else {
      dom.npPlayIcon.style.display = '';
      dom.npPauseIcon.style.display = 'none';
    }

    // Shuffle indicator
    dom.npShuffleBtn.classList.toggle('active', state.shuffle);

    // Repeat indicator
    if (state.repeat === 1) {
      dom.npRepeatIcon.style.display = 'none';
      dom.npRepeatOne.style.display = '';
    } else {
      dom.npRepeatIcon.style.display = '';
      dom.npRepeatOne.style.display = 'none';
    }
    dom.npRepeatBtn.classList.toggle('active', state.repeat > 0);

    // Like button
    var isLiked = false;
    if (state.nowPlaying) {
      var npPath = state.nowPlaying.path;
      for (var li = 0; li < state.likedTracks.length; li++) {
        var lt = state.likedTracks[li];
        if ((typeof lt === 'string' ? lt : lt.path) === npPath) { isLiked = true; break; }
      }
    }
    if (isLiked) {
      dom.npLikeBtn.classList.add('liked');
    } else {
      dom.npLikeBtn.classList.remove('liked');
    }

    updateMediaSession();
    syncFullscreen();
  }

  dom.npPlayBtn.addEventListener('click', function() {
    if (!state.nowPlaying) return;
    if (state.isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(function() {});
    }
  });

  dom.npCloseBtn.addEventListener('click', function() {
    if (state.nowPlaying) openFullscreen();
  });

  dom.npPrevBtn.addEventListener('click', function() { playPrevInQueue(); });
  dom.npNextBtn.addEventListener('click', function() { playNextInQueue(true); });

  dom.npShuffleBtn.addEventListener('click', function() {
    state.shuffle = !state.shuffle;
    renderNowPlaying();
  });

  dom.npRepeatBtn.addEventListener('click', function() {
    state.repeat = (state.repeat + 1) % 3;
    renderNowPlaying();
  });

  dom.npLikeBtn.addEventListener('click', function() {
    if (!state.nowPlaying) return;
    var np = state.nowPlaying;
    var path = np.path;
    var idx = -1;
    for (var i = 0; i < state.likedTracks.length; i++) {
      if ((typeof state.likedTracks[i] === 'string' ? state.likedTracks[i] : state.likedTracks[i].path) === path) {
        idx = i;
        break;
      }
    }
    if (idx !== -1) {
      state.likedTracks.splice(idx, 1);
      api.removeFavorite(path).catch(function() {});
    } else {
      var track = {
        path: path,
        name: np.name,
        title: (np.tags && np.tags.title) || stripExt(np.name),
        artist: (np.tags && np.tags.artist) || '',
        album: (np.tags && np.tags.album) || '',
        duration: Math.round(audio.duration) || (np.tags && np.tags.duration) || 0
      };
      state.likedTracks.push(track);
      api.addFavorites([track]).catch(function() {});
    }
    renderNowPlaying();
  });

  dom.npProgressClick.addEventListener('click', function(e) {
    if (!audio.duration) return;
    var rect = this.getBoundingClientRect();
    var pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  });

  /* ─── Volume Control ─── */

  var savedVolume = parseFloat(localStorage.getItem('sannmusic_volume') || '1');
  audio.volume = savedVolume;
  dom.npVolumeSlider.value = Math.round(savedVolume * 100);
  updateVolumeIcon(savedVolume);

  function updateVolumeIcon(vol) {
    var path = dom.npVolumeWaves;
    if (vol === 0) {
      path.setAttribute('d', '');
      dom.npVolumeIcon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
    } else {
      if (vol < 0.5) {
        path.setAttribute('d', 'M15.54 8.46a5 5 0 0 1 0 7.07');
      } else {
        path.setAttribute('d', 'M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07');
      }
      dom.npVolumeIcon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path id="np-volume-waves" d="' + path.getAttribute('d') + '"/>';
    }
  }

  dom.npVolumeSlider.addEventListener('input', function() {
    var vol = parseInt(this.value, 10) / 100;
    audio.volume = vol;
    localStorage.setItem('sannmusic_volume', String(vol));
    updateVolumeIcon(vol);
  });

  dom.npVolumeBtn.addEventListener('click', function() {
    if (audio.volume > 0) {
      audio.volume = 0;
      dom.npVolumeSlider.value = 0;
    } else {
      audio.volume = savedVolume || 1;
      dom.npVolumeSlider.value = Math.round((savedVolume || 1) * 100);
    }
    localStorage.setItem('sannmusic_volume', String(audio.volume));
    updateVolumeIcon(audio.volume);
  });

  /* ─── Queue Panel ─── */

  function renderQueuePanel() {
    var existing = document.getElementById('queue-panel');
    if (existing) existing.remove();

    var panel = document.createElement('div');
    panel.className = 'queue-panel';
    panel.id = 'queue-panel';

    var header = '<div class="queue-panel-header">';
    header += '<span class="queue-panel-title">Queue</span>';
    header += '<button class="queue-clear-btn" id="queue-clear">Clear</button>';
    header += '</div>';

    var list = '<div class="queue-panel-list">';
    if (state.queue.length === 0) {
      list += '<div style="padding:32px 16px;text-align:center;color:var(--text-dim);font-size:13px">Queue is empty</div>';
    } else {
      for (var i = 0; i < state.queue.length; i++) {
        var t = state.queue[i];
        var isCurrent = i === state.queueIndex;
        var nm = t.name ? stripExt(t.name) : 'Track ' + (i + 1);
        list += '<div class="item item-file' + (isCurrent ? ' currently-playing' : '') + '" data-qidx="' + i + '">';
        list += '<span class="item-queue-drag">' + (i + 1) + '</span>';
        list += '<div class="item-info"><div class="item-name">' + escapeHtml(nm) + '</div></div>';
        if (isCurrent) list += '<span style="font-size:11px;color:var(--accent);padding:0 8px">Now</span>';
        list += '</div>';
      }
    }
    list += '</div>';

    panel.innerHTML = header + list;

    // Close button behavior: remove on backdrop click
    var backdrop = document.createElement('div');
    backdrop.className = 'dropdown-backdrop';
    backdrop.id = 'queue-backdrop';
    backdrop.addEventListener('click', function() { closeQueuePanel(); });
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    setTimeout(function() {
      panel.classList.add('visible');
      document.getElementById('queue-backdrop').style.display = 'block';
    }, 10);

    panel.querySelectorAll('.item-file').forEach(function(el) {
      el.addEventListener('click', function() {
        var idx = parseInt(el.dataset.qidx, 10);
        playFromQueue(idx);
        closeQueuePanel();
      });
    });

    var clearBtn = document.getElementById('queue-clear');
    if (clearBtn) clearBtn.addEventListener('click', function() {
      state.queue = [];
      state.queueIndex = -1;
      state.queueSource = null;
      closeQueuePanel();
      renderNowPlaying();
    });

    makeReorderable(panel.querySelector('.queue-panel-list'), { handle: '.item-queue-drag', item: '.item', key: 'data-qidx', onDrop: function(order) { reorderQueue(order); renderQueuePanel(); } });
  }

  function closeQueuePanel() {
    var panel = document.getElementById('queue-panel');
    var backdrop = document.getElementById('queue-backdrop');
    if (panel) panel.remove();
    if (backdrop) backdrop.remove();
  }

  dom.npQueueBtn.addEventListener('click', function() {
    if (document.getElementById('queue-panel')) {
      closeQueuePanel();
    } else {
      renderQueuePanel();
    }
  });

  /* ─── Media Session API ─── */

  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;

    if (!state.nowPlaying) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      return;
    }

    var tags = state.nowPlaying.tags || {};
    var title = tags.title || stripExt(state.nowPlaying.name);
    var artist = tags.artist || '';
    var album = tags.album || '';

    navigator.mediaSession.metadata = new MediaMetadata({
      title: title,
      artist: artist || 'Unknown Artist',
      album: album || 'SannMusic',
      artwork: [{ src: api.getCoverUrl(state.nowPlaying.path), sizes: '512x512', type: 'image/jpeg' }]
    });

    navigator.mediaSession.setActionHandler('play', function() {
      audio.play().catch(function() {});
    });
    navigator.mediaSession.setActionHandler('pause', function() {
      audio.pause();
    });
    navigator.mediaSession.setActionHandler('previoustrack', function() {
      playPrevInQueue();
    });
    navigator.mediaSession.setActionHandler('nexttrack', function() {
      playNextInQueue(true);
    });
    navigator.mediaSession.setActionHandler('seekto', function(details) {
      if (details.seekTime != null) {
        audio.currentTime = details.seekTime;
      }
    });
  }

  /* ─── Keyboard Shortcuts ─── */

  document.addEventListener('keydown', function(e) {
    // Don't capture when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (!state.nowPlaying) return;
        if (state.isPlaying) audio.pause();
        else audio.play().catch(function() {});
        break;
      case 'ArrowLeft':
        if (e.shiftKey) {
          audio.currentTime = Math.max(0, audio.currentTime - 10);
        } else {
          audio.currentTime = Math.max(0, audio.currentTime - 5);
        }
        break;
      case 'ArrowRight':
        if (e.shiftKey) {
          audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
        } else {
          audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        audio.volume = Math.min(1, audio.volume + 0.05);
        dom.npVolumeSlider.value = Math.round(audio.volume * 100);
        localStorage.setItem('sannmusic_volume', String(audio.volume));
        updateVolumeIcon(audio.volume);
        break;
      case 'ArrowDown':
        e.preventDefault();
        audio.volume = Math.max(0, audio.volume - 0.05);
        dom.npVolumeSlider.value = Math.round(audio.volume * 100);
        localStorage.setItem('sannmusic_volume', String(audio.volume));
        updateVolumeIcon(audio.volume);
        break;
      case 'm':
      case 'M':
        if (audio.volume > 0) {
          audio.volume = 0;
          dom.npVolumeSlider.value = 0;
        } else {
          var vol = parseFloat(localStorage.getItem('sannmusic_volume') || '1');
          audio.volume = vol;
          dom.npVolumeSlider.value = Math.round(vol * 100);
        }
        localStorage.setItem('sannmusic_volume', String(audio.volume));
        updateVolumeIcon(audio.volume);
        break;
      default:
        break;
    }
  });

  /* ─── Metadata Editing ─── */

  function promptEditMetadata(item) {
    showLoading('Loading tags...');
    api.getMetadata(item.path).then(function(data) {
      hideLoading();
      showMetadataModal(item, data.tags || {});
    }).catch(function(err) {
      hideLoading();
      handleError('Cannot load metadata', err);
    });
  }

  function showMetadataModal(item, tags) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML =
      '<div class="modal-box" style="max-width:420px">' +
        '<div class="modal-title">Edit tags — ' + escapeHtml(stripExt(item.name)) + '</div>' +
        '<div class="metadata-form">' +
          '<div class="field full"><span class="field-label">Title</span><input class="input" id="meta-title" maxlength="200" value="' + escapeHtml(tags.title || '') + '"></div>' +
          '<div class="field"><span class="field-label">Artist</span><input class="input" id="meta-artist" maxlength="200" value="' + escapeHtml(tags.artist || '') + '"></div>' +
          '<div class="field"><span class="field-label">Album</span><input class="input" id="meta-album" maxlength="200" value="' + escapeHtml(tags.album || '') + '"></div>' +
          '<div class="field"><span class="field-label">Track #</span><input class="input" id="meta-track" type="number" min="1" value="' + (tags.track ? (tags.track.no || tags.track) : '') + '"></div>' +
          '<div class="field"><span class="field-label">Year</span><input class="input" id="meta-year" type="number" min="1900" max="2099" value="' + (tags.year || '') + '"></div>' +
          '<div class="field full"><span class="field-label">Genre</span><input class="input" id="meta-genre" maxlength="200" value="' + escapeHtml(Array.isArray(tags.genre) ? tags.genre.join(', ') : (tags.genre || '')) + '"></div>' +
        '</div>' +
        '<div class="modal-actions">' +
          '<button class="modal-btn modal-btn-secondary" id="modal-cancel">Cancel</button>' +
          '<button class="modal-btn modal-btn-primary" id="modal-confirm">Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    var cancel = backdrop.querySelector('#modal-cancel');
    var confirm = backdrop.querySelector('#modal-confirm');
    var mTitle = backdrop.querySelector('#meta-title');
    var mArtist = backdrop.querySelector('#meta-artist');
    var mAlbum = backdrop.querySelector('#meta-album');
    var mTrack = backdrop.querySelector('#meta-track');
    var mYear = backdrop.querySelector('#meta-year');
    var mGenre = backdrop.querySelector('#meta-genre');

    function close() { backdrop.remove(); }
    cancel.addEventListener('click', close);
    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) close(); });
    setTimeout(function() { mTitle.focus(); mTitle.select(); }, 100);

    confirm.addEventListener('click', function() {
      var newTags = {};
      var t = mTitle.value.trim();
      if (t) newTags.title = t;
      var a = mArtist.value.trim();
      if (a) newTags.artist = a;
      var al = mAlbum.value.trim();
      if (al) newTags.album = al;
      var tk = parseInt(mTrack.value, 10);
      if (tk > 0) newTags.track = tk;
      var yr = parseInt(mYear.value, 10);
      if (yr >= 1900 && yr <= 2099) newTags.year = yr;
      var g = mGenre.value.trim();
      if (g) newTags.genre = g;

      close();
      showLoading('Saving tags...');
      api.writeMetadata(item.path, newTags).then(function() {
        hideLoading();
        // Refresh item metadata in state
        loadDirectory(currentDir());
        if (state.nowPlaying && state.nowPlaying.path === item.path) {
          loadNowPlayingMetadata();
        }
      }).catch(function(err) {
        hideLoading();
        handleError('Cannot save tags', err);
      });
    });
  }

  /* ─── Deprecated — these now delegate to queue ─── */

  function togglePlay(item) {
    // Used by backward-compat or direct calls
    setQueueFromDirectory(currentDir(), state.items);
    var idx = state.queue.findIndex(function(t) { return t.path === item.path; });
    if (idx >= 0) playFromQueue(idx);
  }

  function getAudioFiles() {
    return state.queue.length > 0 ? state.queue : getAudioFilesFromItems(state.items).map(function(i) { return { path: i.path, name: i.name }; });
  }

  function findCurrentIndex() {
    if (!state.nowPlaying) return -1;
    if (state.queue.length > 0) {
      for (var i = 0; i < state.queue.length; i++) {
        if (state.queue[i].path === state.nowPlaying.path) return i;
      }
    }
    return -1;
  }

  function playNext(allowWrap) {
    if (state.queue.length > 0) return playNextInQueue(allowWrap);
    return false;
  }

  function playPrev() {
    if (state.queue.length > 0) { playPrevInQueue(); return; }
    var files = getAudioFilesFromItems(state.items);
    if (!files.length) return;
    togglePlay(files[0]);
  }

  function downloadFile(item) {
    var url = api.getStreamUrl(item.path) + '&download=1';
    var a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* ─── Upload ─── */

  dom.fileInput.addEventListener('change', function() {
    var files = dom.fileInput.files;
    if (!files || !files.length) return;

    var dir = currentDir();
    var total = files.length;
    var completed = 0;

    var progEl = document.createElement('div');
    progEl.className = 'upload-progress';
    progEl.innerHTML = '<span>Uploading <span class="upload-count">0</span>/' + total + '</span><div class="upload-track"><div class="upload-fill"></div></div>';
    dom.itemsList.prepend(progEl);

    var fill = progEl.querySelector('.upload-fill');
    var count = progEl.querySelector('.upload-count');

    function uploadNext(i) {
      if (i >= total) {
        dom.fileInput.value = '';
        return Promise.resolve();
      }
      return api.upload(dir, files[i], function(loaded, totalSize) {
        var pct = Math.min(100, Math.round((loaded / totalSize) * 100));
        fill.style.width = pct + '%';
      }).then(function() {
        completed++;
        count.textContent = completed;
        fill.style.width = '100%';
        return uploadNext(i + 1);
      }).catch(function(err) {
        completed++;
        count.textContent = completed;
        fill.style.width = '100%';
        return uploadNext(i + 1);
      });
    }

    uploadNext(0).then(function() {
      setTimeout(function() {
        progEl.remove();
        loadDirectory(dir);
      }, 500);
    });
  });

  /* ─── Cover Upload ─── */

  var _coverUploadIsPlaylist = false;
  var _coverUploadPath = '';
  var _coverUploadOnDone = null;

  function toggleHideItem(item) {
    if (item.hidden) {
      api.unhidePath(item.path).then(function() {
        item.hidden = false;
        renderItems();
      }).catch(function(err) {
        handleError('Failed to unhide', err);
      });
    } else {
      api.hidePath(item.path).then(function() {
        item.hidden = true;
        renderItems();
      }).catch(function(err) {
        handleError('Failed to hide', err);
      });
    }
  }

  function promptUploadCover(targetPath, isPlaylist, onDone) {
    _coverUploadIsPlaylist = isPlaylist;
    _coverUploadPath = targetPath;
    _coverUploadOnDone = onDone || null;
    dom.coverInput.value = '';
    dom.coverInput.click();
  }

  dom.coverInput.addEventListener('change', function() {
    var file = dom.coverInput.files[0];
    if (!file) return;
    showLoading('Uploading cover...');
    api.uploadCover(_coverUploadPath, file, _coverUploadIsPlaylist).then(function() {
      hideLoading();
      dom.coverInput.value = '';
      if (_coverUploadOnDone) _coverUploadOnDone();
    }).catch(function(err) {
      hideLoading();
      handleError('Cover upload failed', err);
      dom.coverInput.value = '';
    });
  });

  /* ─── Generic modal input (reusable) ─── */

  function promptModalInput(title, defaultValue, onConfirm) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML =
      '<div class="modal-box">' +
        '<div class="modal-title">' + escapeHtml(title) + '</div>' +
        '<input class="modal-input" id="modal-input" value="' + escapeHtml(defaultValue || '') + '" maxlength="200">' +
        '<div class="modal-actions">' +
          '<button class="modal-btn modal-btn-secondary" id="modal-cancel">Cancel</button>' +
          '<button class="modal-btn modal-btn-primary" id="modal-confirm">Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    var input = backdrop.querySelector('#modal-input');
    var cancel = backdrop.querySelector('#modal-cancel');
    var confirm = backdrop.querySelector('#modal-confirm');
    function close() { backdrop.remove(); }

    cancel.addEventListener('click', close);
    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) close(); });
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') confirm.click(); });
    setTimeout(function() { input.focus(); input.select(); }, 100);

    confirm.addEventListener('click', function() {
      var val = input.value.trim();
      if (!val) return;
      close();
      if (onConfirm) onConfirm(val);
    });
  }

  /* ─── New Folder ─── */

  function promptMkdir() {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML =
      '<div class="modal-box">' +
        '<div class="modal-title">New folder</div>' +
        '<input class="modal-input" id="modal-input" placeholder="Folder name" maxlength="200">' +
        '<div class="modal-actions">' +
          '<button class="modal-btn modal-btn-secondary" id="modal-cancel">Cancel</button>' +
          '<button class="modal-btn modal-btn-primary" id="modal-confirm">Create</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    var input = backdrop.querySelector('#modal-input');
    var cancel = backdrop.querySelector('#modal-cancel');
    var confirm = backdrop.querySelector('#modal-confirm');
    function close() { backdrop.remove(); }

    cancel.addEventListener('click', close);
    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) close(); });
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') confirm.click(); });
    setTimeout(function() { input.focus(); }, 100);

    confirm.addEventListener('click', function() {
      var name = input.value.trim();
      if (!name) return;
      var dir = currentDir();
      var newPath = dir ? dir + '/' + name : name;
      close();
      showLoading('Creating folder...');
      api.mkdir(newPath).then(function() {
        hideLoading();
        loadDirectory(dir);
      }).catch(function(err) {
        hideLoading();
        handleError('Cannot create folder', err);
      });
    });
  }

  /* ─── Rename ─── */

  function promptRename(item) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML =
      '<div class="modal-box">' +
        '<div class="modal-title">Rename</div>' +
        '<input class="modal-input" id="modal-input" value="' + escapeHtml(item.name) + '" maxlength="200">' +
        '<div class="modal-actions">' +
          '<button class="modal-btn modal-btn-secondary" id="modal-cancel">Cancel</button>' +
          '<button class="modal-btn modal-btn-primary" id="modal-confirm">Rename</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    var input = backdrop.querySelector('#modal-input');
    var cancel = backdrop.querySelector('#modal-cancel');
    var confirm = backdrop.querySelector('#modal-confirm');
    function close() { backdrop.remove(); }

    if (!item.isDir) {
      var dot = item.name.lastIndexOf('.');
      if (dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    } else { input.select(); }

    cancel.addEventListener('click', close);
    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) close(); });
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') confirm.click(); });
    setTimeout(function() { input.focus(); }, 100);

    confirm.addEventListener('click', function() {
      var newName = input.value.trim();
      if (!newName || newName === item.name) { close(); return; }
      var dir = currentDir();
      var newPath = dir ? dir + '/' + newName : newName;
      close();
      showLoading('Renaming...');
      api.rename(item.path, newPath).then(function() {
        hideLoading();
        loadDirectory(dir);
      }).catch(function(err) {
        hideLoading();
        handleError('Cannot rename', err);
      });
    });
  }

  /* ─── Delete ─── */

  function promptDelete(item) {
    var isDir = item.isDir;
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML =
      '<div class="modal-box">' +
        '<div class="modal-title">Delete</div>' +
        '<div style="font-size:14px;color:var(--text-dim);line-height:1.4">Delete <strong>' + escapeHtml(item.name) + '</strong>' + (isDir ? ' <span style="color:var(--error)">and all its contents</span>' : '') + '?</div>' +
        (isDir ?
          '<div style="font-size:13px;color:var(--error);font-weight:600;margin-top:4px">This action is irreversible!</div>' +
          '<label class="field" style="margin-top:8px"><span class="field-label">Type <strong>CONFIRM</strong> to proceed</span>' +
          '<input type="text" id="del-confirm-input" class="modal-input" placeholder="CONFIRM" autocomplete="off" spellcheck="false"></label>' +
          '<div id="del-error" style="font-size:12px;color:var(--error);min-height:16px"></div>'
        : '') +
        '<div class="modal-actions">' +
          '<button class="modal-btn modal-btn-secondary" id="modal-cancel">Cancel</button>' +
          '<button class="modal-btn modal-btn-danger" id="modal-confirm" ' + (isDir ? 'disabled style="opacity:0.5"' : '') + '>Delete</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    var cancel = backdrop.querySelector('#modal-cancel');
    var confirmBtn = backdrop.querySelector('#modal-confirm');
    var delInput = backdrop.querySelector('#del-confirm-input');
    var delError = backdrop.querySelector('#del-error');
    function close() { backdrop.remove(); }

    cancel.addEventListener('click', close);
    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) close(); });

    if (delInput) {
      delInput.addEventListener('input', function() {
        var ok = delInput.value === 'CONFIRM';
        confirmBtn.disabled = !ok;
        confirmBtn.style.opacity = ok ? '' : '0.5';
        delError.textContent = '';
      });
      delInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && delInput.value === 'CONFIRM') {
          confirmBtn.click();
        }
      });
      setTimeout(function() { delInput.focus(); }, 100);
    }

    confirmBtn.addEventListener('click', function() {
      if (confirmBtn.disabled) return;
      close();
      showLoading('Deleting...');
      api.del(item.path).then(function() {
        hideLoading();
        loadDirectory(currentDir());
      }).catch(function(err) {
        hideLoading();
        handleError('Cannot delete', err);
      });
    });
  }

  /* ─── Settings Modal ─── */

  function showSettingsModal() {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    var usersTabHtml = authState.isAdmin ? '<button class="settings-tab" data-tab="users">Users</button>' : '';
    var usersPanelHtml = authState.isAdmin ? '' +
      '<div id="settings-users" class="settings-panel">' +
        '<div id="settings-users-list" style="margin-bottom:12px"></div>' +
        '<div style="border-top:1px solid var(--border);padding-top:12px">' +
          '<div class="modal-title" style="font-size:16px;margin-bottom:8px">Add User</div>' +
          '<label class="field"><span class="field-label">Username</span><input type="text" id="settings-new-username" class="modal-input" placeholder="Username"></label>' +
          '<label class="field"><span class="field-label">Password</span><input type="password" id="settings-new-password" class="modal-input" placeholder="Password"></label>' +
          '<label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:13px;color:var(--text-dim);cursor:pointer">' +
            '<input type="checkbox" id="settings-new-isadmin"> Admin</label>' +
          '<div class="modal-actions">' +
            '<button class="modal-btn modal-btn-primary" id="settings-add-user">Add User</button>' +
          '</div>' +
          '<div id="settings-add-result" style="font-size:13px;margin-top:4px"></div>' +
        '</div>' +
      '</div>' : '';

    backdrop.innerHTML =
      '<div class="modal-box" style="max-width:500px;max-height:80vh;overflow-y:auto">' +
        '<div class="modal-title">Settings</div>' +
        '<div id="settings-tabs" style="display:flex;gap:8px;border-bottom:1px solid var(--border);padding-bottom:8px">' +
          '<button class="settings-tab active" data-tab="account">Account</button>' +
          usersTabHtml +
        '</div>' +
        '<div id="settings-account" class="settings-panel active">' +
          '<p style="color:var(--text-dim);font-size:13px;margin-bottom:12px">Logged in as <strong style="color:var(--text)">' + escapeHtml(authState.username) + '</strong></p>' +
          '<label class="field"><span class="field-label">Current Password</span><input type="password" id="settings-curr-pw" class="modal-input" placeholder="Current password"></label>' +
          '<label class="field"><span class="field-label">New Password</span><input type="password" id="settings-new-pw" class="modal-input" placeholder="New password"></label>' +
          '<div class="modal-actions">' +
            '<button class="modal-btn modal-btn-primary" id="settings-change-pw">Change Password</button>' +
          '</div>' +
          '<div id="settings-change-result" style="font-size:13px;margin-top:4px"></div>' +
          '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)"><button class="modal-btn modal-btn-danger" id="settings-logout">Log Out</button></div>' +
        '</div>' +
        usersPanelHtml +
        '<div class="modal-actions" style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">' +
          '<button class="modal-btn modal-btn-secondary" id="settings-close">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    function close() { backdrop.remove(); }
    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) close(); });

    // Tab switching
    var tabs = backdrop.querySelectorAll('.settings-tab');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        backdrop.querySelectorAll('.settings-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        backdrop.querySelectorAll('.settings-panel').forEach(function(p) { p.classList.remove('active'); });
        var panel = backdrop.querySelector('#settings-' + tab.dataset.tab);
        if (panel) panel.classList.add('active');
        if (tab.dataset.tab === 'users') renderUsersList(backdrop);
      });
    });

    // Change password
    var changePwBtn = backdrop.querySelector('#settings-change-pw');
    if (changePwBtn) {
      changePwBtn.addEventListener('click', function() {
        var currPw = backdrop.querySelector('#settings-curr-pw').value;
        var newPw = backdrop.querySelector('#settings-new-pw').value;
        var result = backdrop.querySelector('#settings-change-result');
        if (!currPw || !newPw) { result.textContent = 'Fill in both fields'; result.style.color = 'var(--error)'; return; }
        if (newPw.length < 3) { result.textContent = 'Password must be at least 3 characters'; result.style.color = 'var(--error)'; return; }
        showLoading('Changing password...');
        api.changeOwnPassword(currPw, newPw).then(function() {
          hideLoading();
          result.textContent = 'Password changed';
          result.style.color = 'var(--accent)';
          backdrop.querySelector('#settings-curr-pw').value = '';
          backdrop.querySelector('#settings-new-pw').value = '';
        }).catch(function(err) {
          hideLoading();
          result.textContent = err.message || 'Failed';
          result.style.color = 'var(--error)';
        });
      });
    }

    // Logout
    var logoutBtn = backdrop.querySelector('#settings-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function() {
        close();
        api.logout().then(function() {
          api = null;
          authState.token = null;
          authState.username = null;
          authState.isAdmin = false;
          sessionStorage.removeItem('sannmusic_token');
          sessionStorage.removeItem('sannmusic_username');
          sessionStorage.removeItem('sannmusic_isAdmin');
          dom.settingsBtn.style.display = 'none';
          showLogin();
        }).catch(function() {
          api = null;
          sessionStorage.clear();
          dom.settingsBtn.style.display = 'none';
          showLogin();
        });
      });
    }

    // Add user (admin)
    var addUserBtn = backdrop.querySelector('#settings-add-user');
    if (addUserBtn) {
      addUserBtn.addEventListener('click', function() {
        var username = backdrop.querySelector('#settings-new-username').value.trim();
        var password = backdrop.querySelector('#settings-new-password').value;
        var isAdmin = backdrop.querySelector('#settings-new-isadmin').checked;
        var result = backdrop.querySelector('#settings-add-result');
        if (!username || !password) { result.textContent = 'Fill in both fields'; result.style.color = 'var(--error)'; return; }
        if (password.length < 3) { result.textContent = 'Password must be at least 3 characters'; result.style.color = 'var(--error)'; return; }
        showLoading('Adding user...');
        api.createUser(username, password, isAdmin).then(function() {
          hideLoading();
          backdrop.querySelector('#settings-new-username').value = '';
          backdrop.querySelector('#settings-new-password').value = '';
          backdrop.querySelector('#settings-new-isadmin').checked = false;
          result.textContent = 'User added';
          result.style.color = 'var(--accent)';
          renderUsersList(backdrop);
        }).catch(function(err) {
          hideLoading();
          result.textContent = err.message || 'Failed';
          result.style.color = 'var(--error)';
        });
      });
    }

    // Close button
    backdrop.querySelector('#settings-close').addEventListener('click', close);

    // Render users list initially if admin
    if (authState.isAdmin) renderUsersList(backdrop);
  }

  function renderUsersList(backdrop) {
    var container = backdrop.querySelector('#settings-users-list');
    if (!container) return;
    api.getUsers().then(function(data) {
      var html = '<div style="font-size:13px;color:var(--text-dim);margin-bottom:8px">' + data.users.length + ' user(s)</div>';
      data.users.forEach(function(u) {
        var isSelf = u.username === authState.username;
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">' +
          '<div><strong>' + escapeHtml(u.username) + '</strong>' +
          (u.isAdmin ? ' <span style="font-size:11px;color:var(--accent);font-weight:600">admin</span>' : '') +
          (isSelf ? ' <span style="font-size:11px;color:var(--text-dim)">(you)</span>' : '') +
          '</div>' +
          (isSelf ? '' :
            '<div style="display:flex;gap:6px">' +
              '<button class="modal-btn modal-btn-secondary settings-reset-pw" data-username="' + escapeHtml(u.username) + '" style="height:32px;padding:0 12px;font-size:12px">Reset PW</button>' +
              '<button class="modal-btn modal-btn-danger settings-del-user" data-username="' + escapeHtml(u.username) + '" style="height:32px;padding:0 12px;font-size:12px">Remove</button>' +
            '</div>') +
          '</div>';
      });
      container.innerHTML = html;

      container.querySelectorAll('.settings-reset-pw').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var targetUser = btn.dataset.username;
          var newPw = prompt('New password for ' + targetUser + ':');
          if (!newPw || newPw.length < 3) return;
          showLoading('Resetting password...');
          api.changeUserPassword(targetUser, newPw).then(function() {
            hideLoading();
            alert('Password changed for ' + targetUser);
          }).catch(function(err) {
            hideLoading();
            alert('Failed: ' + err.message);
          });
        });
      });

      container.querySelectorAll('.settings-del-user').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var targetUser = btn.dataset.username;
          if (!confirm('Remove user "' + targetUser + '"?')) return;
          showLoading('Removing user...');
          api.deleteUser(targetUser).then(function() {
            hideLoading();
            renderUsersList(backdrop);
          }).catch(function(err) {
            hideLoading();
            alert('Failed: ' + err.message);
          });
        });
      });
    }).catch(function(err) {
      container.innerHTML = '<div style="color:var(--error);font-size:13px">Failed to load users: ' + escapeHtml(err.message) + '</div>';
    });
  }

  /* ─── Menus ─── */

  function closeItemMenu() {
    var menus = document.querySelectorAll('.dropdown, .dropdown-backdrop');
    for (var i = 0; i < menus.length; i++) menus[i].remove();
  }

  dom.itemsList.addEventListener('scroll', closeItemMenu);
  dom.itemsList.addEventListener('touchmove', closeItemMenu, { passive: true });

  /* ─── Error ─── */

  function handleError(msg, err) {
    if (console) console.error(msg, err && err.message ? err.message : err);
    var old = dom.itemsList.querySelector('.error-bar');
    if (old) old.remove();
    var bar = document.createElement('div');
    bar.className = 'error-bar';
    bar.textContent = msg + (err && err.message ? ': ' + err.message : '');
    dom.itemsList.prepend(bar);
    setTimeout(function() { if (bar.parentNode) bar.remove(); }, 6000);
  }

  /* ─── Init ─── */

  function init() {
    window.addEventListener('error', function(e) {
      handleError('Script error', e.error || e.message);
    });
    window.addEventListener('unhandledrejection', function(e) {
      handleError('Unhandled error', e.reason);
    });

    if (dom.breadcrumb) dom.breadcrumb.style.display = 'none';
    if (dom.selectToggle) dom.selectToggle.style.display = 'none';

    dom.connectBtn.addEventListener('click', handleLogin);
    dom.serverUrl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleLogin();
    });
    dom.usernameField.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleLogin();
    });
    dom.passwordField.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleLogin();
    });

    // Check for stored session
    var storedServer = sessionStorage.getItem('sannmusic_server') || localStorage.getItem('sannmusic_server');
    var storedToken = sessionStorage.getItem('sannmusic_token');

    if (storedServer && storedToken) {
      api = new FileServerAPI(storedServer);
      api.setToken(storedToken);
      showLoading('Connecting...');
      api.getMe().then(function(data) {
        authState.username = data.username;
        authState.isAdmin = data.isAdmin;
        sessionStorage.setItem('sannmusic_username', data.username);
        sessionStorage.setItem('sannmusic_isAdmin', data.isAdmin ? 'true' : 'false');
        dom.settingsBtn.style.display = '';
        hideLoading();
        showBrowser();
        loadHome();
        return loadRoot();
      }).catch(function() {
        hideLoading();
        api = null;
        sessionStorage.removeItem('sannmusic_token');
        sessionStorage.removeItem('sannmusic_username');
        sessionStorage.removeItem('sannmusic_isAdmin');
        showLogin();
      });
    } else if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      // Auto-detect server URL from current origin
      var origin = window.location.origin;
      showLoading('Connecting...');
      // Try connection without auth to pre-fill URL only
      fetch(origin + '/api/list').then(function(r) { return r.ok; }).then(function(ok) {
        hideLoading();
        if (!storedToken) {
          showLogin();
          dom.serverUrl.value = origin;
        }
      }).catch(function() {
        hideLoading();
        showLogin();
        dom.serverUrl.value = origin;
      });
    } else {
      showLogin();
    }

    // Auth expired handler
    window.addEventListener('auth:expired', function() {
      api = null;
      authState.token = null;
      authState.username = null;
      authState.isAdmin = false;
      sessionStorage.removeItem('sannmusic_token');
      sessionStorage.removeItem('sannmusic_username');
      sessionStorage.removeItem('sannmusic_isAdmin');
      dom.settingsBtn.style.display = 'none';
      showLogin();
    });

    // Settings button
    dom.settingsBtn.addEventListener('click', showSettingsModal);
  }

  /* ══════════════════════════════════════════════════════════════
     v2 ENHANCEMENTS — full-screen player, lyrics, sleep, reorder
     ══════════════════════════════════════════════════════════════ */

  var GRIP_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

  var fs = {
    el:        $('fullscreen-player'),
    bg:        $('fs-bg'),
    art:       $('fs-art'),
    artPh:     $('fs-art-ph'),
    title:     $('fs-title'),
    artist:    $('fs-artist'),
    source:    $('fs-source'),
    cur:       $('fs-current'),
    dur:       $('fs-duration'),
    prog:      $('fs-progress'),
    progFill:  $('fs-progress-fill'),
    playIcon:  $('fs-play-icon'),
    pauseIcon: $('fs-pause-icon'),
    shuffle:   $('fs-shuffle'),
    repeat:    $('fs-repeat'),
    repeatOne: $('fs-repeat-one'),
    like:      $('fs-like'),
    lyricsPanel:   $('fs-lyrics-panel'),
    lyricsContent: $('fs-lyrics-content'),
    queuePanel:    $('fs-queue-panel'),
    queueList:     $('fs-queue-list'),
    sleepBadge:    $('fs-sleep-badge')
  };

  function isTrackLiked(path) {
    for (var i = 0; i < state.likedTracks.length; i++) {
      var lt = state.likedTracks[i];
      if ((typeof lt === 'string' ? lt : lt.path) === path) return true;
    }
    return false;
  }

  function queueSourceLabel() {
    var s = state.queueSource;
    if (!s) return 'Library';
    if (s === 'favorites') return 'Favorites';
    if (s.type === 'playlist') {
      var p = (state.playlists || []).filter(function(x) { return x.id === s.id; })[0];
      return p ? p.name : 'Playlist';
    }
    if (s.type === 'directory') { return s.dir ? s.dir.split('/').pop() : 'Library'; }
    return 'Library';
  }

  function openFullscreen() {
    if (!state.nowPlaying || !fs.el) return;
    setFsTab(null);
    syncFullscreen();
    fs.el.classList.add('open');
    fs.el.setAttribute('aria-hidden', 'false');
  }
  function closeFullscreen() {
    if (!fs.el) return;
    fs.el.classList.remove('open');
    fs.el.setAttribute('aria-hidden', 'true');
  }

  function syncFullscreen() {
    if (!fs.el) return;
    if (!state.nowPlaying) { closeFullscreen(); return; }
    var tags = state.nowPlaying.tags || {};
    fs.title.textContent = tags.title || stripExt(state.nowPlaying.name);
    fs.artist.textContent = [tags.artist, tags.album].filter(Boolean).join(' · ');
    var cov = api.getCoverUrl(state.nowPlaying.path);
    if (fs.art.getAttribute('src') !== cov) {
      fs.art.src = cov;
      fs.bg.style.backgroundImage = 'url("' + cov + '")';
    }
    fs.art.onerror = function() { fs.art.style.display = 'none'; fs.artPh.style.display = 'flex'; };
    fs.art.onload = function() { fs.art.style.display = ''; fs.artPh.style.display = 'none'; };
    fs.playIcon.style.display = state.isPlaying ? 'none' : '';
    fs.pauseIcon.style.display = state.isPlaying ? '' : 'none';
    fs.shuffle.classList.toggle('active', state.shuffle);
    fs.repeat.classList.toggle('active', state.repeat > 0);
    fs.repeatOne.style.display = state.repeat === 1 ? '' : 'none';
    fs.like.classList.toggle('liked', isTrackLiked(state.nowPlaying.path));
    fs.source.textContent = queueSourceLabel();
    if (fs.lyricsPanel.classList.contains('visible')) loadLyrics();
    if (fs.queuePanel.classList.contains('visible')) renderFsQueue();
  }

  function setFsTab(tab) {
    var L = tab === 'lyrics', Q = tab === 'queue';
    fs.lyricsPanel.classList.toggle('visible', L);
    fs.queuePanel.classList.toggle('visible', Q);
    fs.el.classList.toggle('panel-open', L || Q);
    $('fs-tab-lyrics').classList.toggle('active', L);
    $('fs-tab-queue').classList.toggle('active', Q);
    if (L) loadLyrics();
    if (Q) renderFsQueue();
  }
  function toggleFsTab(tab) {
    var on = (tab === 'lyrics' ? fs.lyricsPanel : fs.queuePanel).classList.contains('visible');
    setFsTab(on ? null : tab);
  }

  /* ─── Lyrics ─── */
  function extractLyrics(tags) {
    if (!tags) return '';
    var v = tags.lyrics || tags.unsyncedLyrics || tags.unsynchronisedLyrics || tags.USLT || tags.LYRICS || '';
    if (!v) return '';
    if (Array.isArray(v)) {
      v = v.map(function(x) { return typeof x === 'string' ? x : (x && (x.text || x.lyrics)) || ''; }).join('\n');
    } else if (typeof v === 'object') {
      v = v.text || v.lyrics || '';
    }
    return String(v || '');
  }
  function renderLyricsText(text) {
    if (!text || !text.trim()) {
      fs.lyricsContent.innerHTML =
        '<div class="fs-lyrics-empty">' +
          '<svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' +
          '<div>No lyrics found for this track</div>' +
          '<div style="font-size:12px;font-weight:500;opacity:0.7;max-width:260px">Lyrics show here when they\'re embedded in the file\'s tags.</div>' +
        '</div>';
      return;
    }
    var lines = text.replace(/\r/g, '').split('\n');
    var html = '';
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].replace(/^\s*\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*/, '').trim();
      html += '<div class="lyric-line">' + (ln ? escapeHtml(ln) : '&nbsp;') + '</div>';
    }
    fs.lyricsContent.innerHTML = html;
  }
  function loadLyrics() {
    var np = state.nowPlaying;
    if (!np) { renderLyricsText(''); return; }

    if (np._cachedLyrics !== undefined) {
      renderLyricsText(np._cachedLyrics);
      return;
    }

    var embedded = extractLyrics(np.tags);
    if (embedded) {
      np._cachedLyrics = embedded;
      renderLyricsText(embedded);
      return;
    }

    fs.lyricsContent.innerHTML =
      '<div class="fs-lyrics-empty"><div class="spinner" style="width:28px;height:28px;margin-bottom:12px"></div><div style="font-size:13px;color:var(--text-dim)">Searching for lyrics...</div></div>';

    api.getMetadata(np.path).then(function(d) {
      if (state.nowPlaying && state.nowPlaying.path === d.path) {
        state.nowPlaying.tags = Object.assign({}, state.nowPlaying.tags, d.tags);
        var embedded2 = extractLyrics(state.nowPlaying.tags);
        if (embedded2) {
          state.nowPlaying._cachedLyrics = embedded2;
          if (fs.lyricsPanel.classList.contains('visible')) renderLyricsText(embedded2);
          return;
        }
      }
      fetchLyricsFromLrclib(np);
    }).catch(function() {
      fetchLyricsFromLrclib(np);
    });
  }

  function fetchLyricsFromLrclib(np) {
    var tags = np.tags || {};
    var track = tags.title || stripExt(np.name) || '';
    var artist = tags.artist || '';
    var album = tags.album || '';
    var duration = Math.round(audio.duration) || 0;

    var parts = np.path.split('/');
    if (!artist) {
      if (parts.length >= 2) artist = parts[parts.length - 2];
    }
    if (!album && parts.length >= 3) album = parts[parts.length - 3] === artist ? parts[parts.length - 2] : '';
    if (!track) track = stripExt(parts[parts.length - 1]);

    api.getLyrics(track, artist, album, duration).then(function(data) {
      if (state.nowPlaying && state.nowPlaying.path === np.path) {
        var text = (data.syncedLyrics || data.plainLyrics || '').trim();
        state.nowPlaying._cachedLyrics = text;
        if (fs.lyricsPanel.classList.contains('visible')) renderLyricsText(text);
      }
    }).catch(function() {
      if (state.nowPlaying && state.nowPlaying.path === np.path) {
        state.nowPlaying._cachedLyrics = '';
        if (fs.lyricsPanel.classList.contains('visible')) renderLyricsText('');
      }
    });
  }

  /* ─── Full-screen Up Next ─── */
  function renderFsQueue() {
    if (!fs.queueList) return;
    if (!state.queue.length) { fs.queueList.innerHTML = '<div class="fs-queue-empty">Queue is empty</div>'; return; }
    var h = '';
    for (var i = 0; i < state.queue.length; i++) {
      var t = state.queue[i];
      var cur = i === state.queueIndex;
      var nm = t.name ? stripExt(t.name) : 'Track ' + (i + 1);
      h += '<div class="fs-q-item' + (cur ? ' current' : '') + '" data-qidx="' + i + '">';
      h += '<span class="fs-q-grip" data-reorder-handle>' + GRIP_SVG + '</span>';
      h += '<img class="fs-q-cover" src="' + api.getCoverUrl(t.path) + '" loading="lazy" onerror="this.style.visibility=\'hidden\'">';
      h += '<div class="fs-q-info"><div class="fs-q-title">' + escapeHtml(nm) + '</div></div>';
      if (cur) h += '<span class="fs-q-eq">' + EQ_HTML + '</span>';
      h += '</div>';
    }
    fs.queueList.innerHTML = h;
    fs.queueList.querySelectorAll('.fs-q-item').forEach(function(el) {
      el.addEventListener('click', function() {
        if (el.querySelector('[data-reorder-handle]').matches(':active')) return;
        playFromQueue(parseInt(el.dataset.qidx, 10));
      });
    });
    makeReorderable(fs.queueList, { handle: '[data-reorder-handle]', item: '.fs-q-item', key: 'data-qidx', onDrop: function(order) { reorderQueue(order); renderFsQueue(); } });
  }

  function reorderQueue(order) {
    var curPath = state.nowPlaying ? state.nowPlaying.path : null;
    var nq = order.map(function(k) { return state.queue[parseInt(k, 10)]; }).filter(Boolean);
    if (nq.length !== state.queue.length) return;
    state.queue = nq;
    if (curPath) state.queueIndex = nq.map(function(t) { return t.path; }).indexOf(curPath);
    renderNowPlaying();
  }

  /* ─── Generic pointer-based reorder ─── */
  function makeReorderable(listEl, opts) {
    if (!listEl) return;
    var handleSel = opts.handle, itemSel = opts.item, keyAttr = opts.key || 'data-idx', onDrop = opts.onDrop;
    var dragEl = null, moved = false;
    function items(excludeDrag) {
      return Array.prototype.slice.call(listEl.querySelectorAll(itemSel)).filter(function(el) {
        return !excludeDrag || !el.classList.contains('reorder-dragging');
      });
    }
    function getAfter(y) {
      var els = items(true);
      for (var i = 0; i < els.length; i++) {
        var r = els[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) return els[i];
      }
      return null;
    }
    function onMove(e) {
      if (!dragEl) return;
      moved = true;
      var y = e.clientY != null ? e.clientY : (e.touches && e.touches[0].clientY);
      var after = getAfter(y);
      if (after == null) listEl.appendChild(dragEl);
      else if (after !== dragEl) listEl.insertBefore(dragEl, after);
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      if (dragEl) dragEl.classList.remove('reorder-dragging');
      var swallow = function(ev) { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener('click', swallow, true);
      setTimeout(function() { document.removeEventListener('click', swallow, true); }, 80);
      if (moved && onDrop) { onDrop(items(false).map(function(el) { return el.getAttribute(keyAttr); })); }
      dragEl = null; moved = false;
    }
    listEl.addEventListener('pointerdown', function(e) {
      var handle = e.target.closest(handleSel);
      if (!handle || !listEl.contains(handle)) return;
      dragEl = handle.closest(itemSel);
      if (!dragEl) return;
      e.preventDefault();
      moved = false;
      dragEl.classList.add('reorder-dragging');
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp, { once: true });
    });
  }

  function setupPlaylistReorder(pl) {
    var listEl = dom.playlistsView.querySelector('.track-list');
    if (!listEl || !pl.tracks) return;
    makeReorderable(listEl, { handle: '.pl-drag-handle', item: '.track-row', key: 'data-idx', onDrop: function(order) {
      var nt = order.map(function(k) { return pl.tracks[parseInt(k, 10)]; }).filter(Boolean);
      if (nt.length !== pl.tracks.length) return;
      pl.tracks = nt;
      state.currentPlaylist = pl;
      var payload = nt.map(function(t) { return { path: t.path, name: t.name }; });
      if (api && api.updatePlaylist) { api.updatePlaylist(pl.id, { tracks: payload }).catch(function() {}); }
      if (state.queueSource && state.queueSource.type === 'playlist' && state.queueSource.id === pl.id) {
        var curPath = state.nowPlaying ? state.nowPlaying.path : null;
        state.queue = nt.slice();
        if (curPath) state.queueIndex = nt.map(function(t) { return t.path; }).indexOf(curPath);
      }
      renderPlaylistDetail();
    } });
  }

  /* ─── Recently Added (home) ─── */
  function getItemDate(it) {
    var v = it.modified != null ? it.modified
      : it.mtime != null ? it.mtime
      : it.mtimeMs != null ? it.mtimeMs
      : it.modifiedAt != null ? it.modifiedAt
      : it.modTime != null ? it.modTime
      : it.ctime != null ? it.ctime : null;
    if (v == null) return null;
    if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
    var t = Date.parse(v);
    return isNaN(t) ? null : t;
  }
  function loadRecentlyAdded() {
    var c = document.getElementById('home-recently-added');
    if (!c || !api) return;
    api.list('').then(function(data) {
      var items = (data.items || []).filter(function(it) { return !it.hidden; });
      var dated = items.filter(function(it) { return getItemDate(it) != null; });
      if (dated.length < 2) { c.innerHTML = ''; return; }
      dated.sort(function(a, b) { return getItemDate(b) - getItemDate(a); });
      var top = dated.slice(0, 12);
      var w = document.getElementById('home-welcome'); if (w) w.remove();
      var h = '<div class="home-section"><div class="home-section-header"><h2 class="home-section-title">Recently Added</h2></div><div class="home-horizontal-scroll">';
      top.forEach(function(it) {
        var isDir = it.isDir;
        h += '<div class="recent-card" data-ra-path="' + escapeHtml(it.path) + '" data-ra-dir="' + (isDir ? '1' : '0') + '" data-ra-name="' + escapeHtml(it.name) + '">';
        h += '<div class="card-cover-wrap">';
        h += '<img class="recent-card-cover" src="' + api.getCoverUrl(it.path) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
        h += '<div class="recent-card-placeholder" style="display:none">♫</div>';
        h += '<button class="card-play-btn" data-ra-play="1" aria-label="Open">' + PI(22) + '</button>';
        h += '</div>';
        h += '<div class="ra-badge">New</div>';
        h += '<div class="recent-card-title">' + escapeHtml(isDir ? it.name : stripExt(it.name)) + '</div>';
        h += '</div>';
      });
      h += '</div></div>';
      c.innerHTML = h;
      c.querySelectorAll('.recent-card').forEach(function(card) {
        card.addEventListener('click', function() {
          var isDir = card.dataset.raDir === '1';
          if (isDir) {
            var p = card.dataset.raPath;
            switchTab('folders');
            setTimeout(function() {
              state.path = [{ path: '', name: 'Home' }];
              var parts = p.split('/');
              for (var i = 0; i < parts.length; i++) { state.path.push({ path: parts.slice(0, i + 1).join('/'), name: parts[i] }); }
              renderBreadcrumb();
              loadDirectory(p);
            }, 100);
          } else {
            playRecentTrack(card.dataset.raPath);
          }
        });
      });
    }).catch(function() { if (c) c.innerHTML = ''; });
  }

  /* ─── Sleep timer ─── */
  var _sleep = { id: null, tickId: null, endAt: 0, endOfTrack: false, sel: 0 };
  function clearSleep() {
    if (_sleep.id) clearTimeout(_sleep.id);
    if (_sleep.tickId) clearInterval(_sleep.tickId);
    _sleep = { id: null, tickId: null, endAt: 0, endOfTrack: false, sel: 0 };
    updateSleepBadge();
  }
  function setSleepMinutes(min) {
    clearSleep();
    if (min <= 0) return;
    _sleep.sel = min;
    _sleep.endAt = Date.now() + min * 60000;
    _sleep.id = setTimeout(function() { audio.pause(); clearSleep(); }, min * 60000);
    _sleep.tickId = setInterval(updateSleepBadge, 1000);
    updateSleepBadge();
  }
  function scheduleEndOfTrack() {
    if (!_sleep.endOfTrack) return;
    if (_sleep.id) clearTimeout(_sleep.id);
    if (!audio.duration || !isFinite(audio.duration)) return;
    var rem = audio.duration - audio.currentTime;
    _sleep.id = setTimeout(function() { audio.pause(); clearSleep(); }, Math.max(200, (rem - 0.4) * 1000));
  }
  function setSleepEndOfTrack() {
    clearSleep();
    _sleep.endOfTrack = true;
    _sleep.sel = 'eot';
    scheduleEndOfTrack();
    updateSleepBadge();
  }
  function updateSleepBadge() {
    if (!fs.sleepBadge) return;
    var btn = $('fs-sleep');
    if (_sleep.endOfTrack) { fs.sleepBadge.textContent = ' · track'; if (btn) btn.classList.add('active'); return; }
    if (_sleep.endAt) {
      var rem = Math.max(0, Math.round((_sleep.endAt - Date.now()) / 60000));
      fs.sleepBadge.textContent = ' ' + (rem > 0 ? rem + 'm' : '<1m');
      if (btn) btn.classList.add('active');
    } else {
      fs.sleepBadge.textContent = '';
      if (btn) btn.classList.remove('active');
    }
  }
  function openSleepMenu(anchor) {
    closeItemMenu();
    var menu = document.createElement('div');
    menu.className = 'dropdown';
    var opts = [['Off', 0], ['15 minutes', 15], ['30 minutes', 30], ['45 minutes', 45], ['1 hour', 60], ['End of track', 'eot']];
    menu.innerHTML = opts.map(function(o) {
      var active = o[1] === _sleep.sel || (o[1] === 0 && !_sleep.sel);
      return '<button class="dropdown-item' + (active ? ' sleep-active' : '') + '" data-sleep="' + o[1] + '">' + o[0] + '</button>';
    }).join('');
    var rect = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 220)) + 'px';
    menu.style.top = (rect.top - 8) + 'px';
    menu.style.transform = 'translateY(-100%)';
    var backdrop = document.createElement('div');
    backdrop.className = 'dropdown-backdrop';
    backdrop.addEventListener('click', closeItemMenu);
    document.body.appendChild(backdrop);
    document.body.appendChild(menu);
    menu.addEventListener('click', function(ev) {
      var b = ev.target.closest('.dropdown-item');
      if (!b) return;
      closeItemMenu();
      var val = b.dataset.sleep;
      if (val === 'eot') setSleepEndOfTrack();
      else setSleepMinutes(parseInt(val, 10));
    });
  }

  /* ─── Global Search ─── */
  var searchIdx = { built: false, building: false, files: [], dirs: [] };
  var _searchTimer = null;
  var _searchActive = false;

  function buildSearchIndex() {
    if (searchIdx.built || searchIdx.building || !api) return Promise.resolve();
    searchIdx.building = true;
    var DIR_CAP = 350, FILE_CAP = 6000, START = Date.now(), TIME_CAP = 18000;
    var queue = [''], seen = {};
    var AUDIO_RE = /\.(mp3|flac|m4a|aac|ogg|opus|wav|wma|alac|aiff?)$/i;
    function step() {
      if (!queue.length || searchIdx.dirs.length >= DIR_CAP || searchIdx.files.length >= FILE_CAP || (Date.now() - START) > TIME_CAP) {
        return Promise.resolve();
      }
      var dir = queue.shift();
      return api.list(dir).then(function(data) {
        var items = (data.items || []);
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (it.hidden) continue;
          if (it.isDir) {
            if (!seen[it.path]) { seen[it.path] = 1; searchIdx.dirs.push({ path: it.path, name: it.name }); queue.push(it.path); }
          } else if (AUDIO_RE.test(it.name)) {
            searchIdx.files.push({ path: it.path, name: it.name });
          }
        }
        return step();
      }).catch(function() { return step(); });
    }
    return step().then(function() {
      searchIdx.built = true;
      searchIdx.building = false;
      if (_searchActive && dom.globalSearch) runSearch(dom.globalSearch.value);
    });
  }

  function openSearch() {
    _searchActive = true;
    if (dom.searchOverlay) dom.searchOverlay.classList.add('active');
    if (!searchIdx.built && !searchIdx.building) buildSearchIndex();
  }
  function closeSearch() {
    _searchActive = false;
    if (dom.searchOverlay) dom.searchOverlay.classList.remove('active');
    if (dom.globalSearch) dom.globalSearch.value = '';
    if (dom.searchClear) dom.searchClear.style.display = 'none';
  }

  function runSearch(raw) {
    var q = (raw || '').trim().toLowerCase();
    if (dom.searchClear) dom.searchClear.style.display = q ? '' : 'none';
    if (!q) {
      if (_searchActive) closeSearch();
      return;
    }
    openSearch();

    function match(s) { return s && s.toLowerCase().indexOf(q) !== -1; }

    // Songs: favorites + recent + indexed files
    var songMap = {}, songs = [];
    function addSong(t) {
      if (!t || !t.path || songMap[t.path]) return;
      songMap[t.path] = 1; songs.push(t);
    }
    (state.likedTracks || []).forEach(function(t) {
      if (match(t.title) || match(t.name) || match(t.artist) || match(t.album)) addSong(t);
    });
    (state.recentPlays || []).forEach(function(t) {
      if (match(t.title) || match(t.name) || match(t.artist)) addSong(t);
    });
    searchIdx.files.forEach(function(f) {
      if (songs.length >= 60) return;
      if (match(f.name)) addSong({ path: f.path, name: f.name, title: stripExt(f.name) });
    });

    // Albums / folders
    var albums = searchIdx.dirs.filter(function(d) { return match(d.name); }).slice(0, 24);

    // Playlists
    var playlists = (state.playlists || []).filter(function(p) { return match(p.name); }).slice(0, 24);

    renderSearchResults(q, songs.slice(0, 50), albums, playlists);
  }

  function renderSearchResults(q, songs, albums, playlists) {
    if (!dom.searchResults) return;
    var html = '';

    if (searchIdx.building) {
      html += '<div class="search-status"><span class="spinner-sm"></span>Indexing your library…</div>';
    }

    if (!songs.length && !albums.length && !playlists.length) {
      html += '<div class="search-empty"><div class="search-empty-icon">🔍</div>' +
        '<div class="search-empty-title">No results for “' + escapeHtml(q) + '”</div>' +
        '<div class="search-empty-sub">' + (searchIdx.building ? 'Still indexing — results will fill in shortly.' : 'Try a different spelling, an artist, album, folder or playlist name.') + '</div></div>';
      dom.searchResults.innerHTML = html;
      return;
    }

    if (songs.length) {
      html += '<div class="search-section"><h2 class="search-section-title">Songs</h2><div class="items-list">';
      for (var i = 0; i < songs.length; i++) {
        var t = songs[i];
        var cur = state.nowPlaying && state.nowPlaying.path === t.path;
        html += '<div class="item item-file' + (cur ? ' currently-playing' : '') + '" data-search-song="' + i + '" data-path="' + escapeHtml(t.path) + '">';
        html += '<img class="item-thumb" src="' + api.getCoverUrl(t.path) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
        html += '<div class="item-icon item-fallback-note" style="display:none">♫</div>';
        html += '<div class="item-info"><div class="item-name">' + escapeHtml(t.title || stripExt(t.name)) + '</div>';
        html += '<div class="item-meta">' + escapeHtml(t.artist || (t.album || 'Song')) + '</div></div>';
        html += '<button class="btn-play" data-search-song="' + i + '" aria-label="Play">' + PI(14) + '</button>';
        html += '</div>';
      }
      html += '</div></div>';
    }

    if (albums.length) {
      html += '<div class="search-section"><h2 class="search-section-title">Albums &amp; Folders</h2><div class="search-grid">';
      albums.forEach(function(d) {
        html += '<div class="recent-card" data-search-folder="' + escapeHtml(d.path) + '" data-search-name="' + escapeHtml(d.name) + '">';
        html += '<div class="card-cover-wrap">';
        html += '<img class="recent-card-cover" src="' + api.getCoverUrl(d.path) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
        html += '<div class="recent-card-placeholder" style="display:none">' + FOLDER_GLYPH + '</div>';
        html += '<button class="card-play-btn" data-search-folder="' + escapeHtml(d.path) + '" aria-label="Open">' + PI(22) + '</button>';
        html += '</div>';
        html += '<div class="recent-card-title">' + escapeHtml(d.name) + '</div>';
        html += '<div class="search-card-sub">Folder</div>';
        html += '</div>';
      });
      html += '</div></div>';
    }

    if (playlists.length) {
      html += '<div class="search-section"><h2 class="search-section-title">Playlists</h2><div class="search-grid">';
      playlists.forEach(function(p) {
        html += '<div class="recent-card" data-search-plid="' + p.id + '">';
        html += '<div class="card-cover-wrap">' + renderPlaylistCoverHTML(p.coverDirs, p);
        html += '<button class="card-play-btn" data-search-plid="' + p.id + '" aria-label="Open">' + PI(22) + '</button></div>';
        html += '<div class="recent-card-title">' + escapeHtml(p.name) + '</div>';
        html += '<div class="search-card-sub">' + (p.trackCount != null ? p.trackCount + ' tracks' : 'Playlist') + '</div>';
        html += '</div>';
      });
      html += '</div></div>';
    }

    dom.searchResults.innerHTML = html;

    // Wire songs
    dom.searchResults.querySelectorAll('[data-search-song]').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        var idx = parseInt(el.getAttribute('data-search-song'), 10);
        var t = songs[idx];
        if (!t) return;
        state.queue = songs.slice();
        state.queueIndex = -1;
        state.queueSource = null;
        playFromQueue(idx);
      });
    });
    // Wire folders
    dom.searchResults.querySelectorAll('[data-search-folder]').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        var p = el.getAttribute('data-search-folder');
        closeSearch();
        switchTab('folders');
        setTimeout(function() {
          state.path = [{ path: '', name: 'Home' }];
          var parts = p.split('/');
          for (var i = 0; i < parts.length; i++) { state.path.push({ path: parts.slice(0, i + 1).join('/'), name: parts[i] }); }
          renderBreadcrumb();
          loadDirectory(p);
        }, 80);
      });
    });
    // Wire playlists
    dom.searchResults.querySelectorAll('[data-search-plid]').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        var pid = el.getAttribute('data-search-plid');
        closeSearch();
        switchTab('playlists');
        setTimeout(function() { viewPlaylist(pid); }, 100);
      });
    });
  }

  /* ─── Wiring ─── */
  function wireEnhancements() {
    if (!fs.el) return;
    $('fs-collapse').addEventListener('click', closeFullscreen);
    $('fs-more').addEventListener('click', function() {
      if (!state.nowPlaying) return;
      showItemMenu({ path: state.nowPlaying.path, name: state.nowPlaying.name }, this);
    });
    $('fs-play').addEventListener('click', function() { dom.npPlayBtn.click(); });
    $('fs-prev').addEventListener('click', function() { dom.npPrevBtn.click(); });
    $('fs-next').addEventListener('click', function() { dom.npNextBtn.click(); });
    $('fs-shuffle').addEventListener('click', function() { dom.npShuffleBtn.click(); });
    $('fs-repeat').addEventListener('click', function() { dom.npRepeatBtn.click(); });
    $('fs-like').addEventListener('click', function() { dom.npLikeBtn.click(); });
    $('fs-tab-lyrics').addEventListener('click', function() { toggleFsTab('lyrics'); });
    $('fs-tab-queue').addEventListener('click', function() { toggleFsTab('queue'); });
    $('fs-sleep').addEventListener('click', function() { openSleepMenu(this); });

    var prog = $('fs-progress'), dragging = false;
    function seek(clientX) {
      if (!audio.duration) return;
      var r = prog.getBoundingClientRect();
      var pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      audio.currentTime = pct * audio.duration;
      fs.progFill.style.width = (pct * 100) + '%';
    }
    prog.addEventListener('pointerdown', function(e) { dragging = true; try { prog.setPointerCapture(e.pointerId); } catch (x) {} seek(e.clientX); });
    prog.addEventListener('pointermove', function(e) { if (dragging) seek(e.clientX); });
    prog.addEventListener('pointerup', function() { dragging = false; });
    prog.addEventListener('pointercancel', function() { dragging = false; });

    var mnav = $('mobile-nav');
    if (mnav) mnav.addEventListener('click', function(e) {
      var b = e.target.closest('.mnav-item');
      if (!b) return;
      switchTab(b.dataset.tab);
    });

    // Top bar: logo + home → Home
    if (dom.topbarLogo) dom.topbarLogo.addEventListener('click', function() { switchTab('home'); });
    if (dom.topbarHome) dom.topbarHome.addEventListener('click', function() { switchTab('home'); });

    // Global search
    if (dom.globalSearch) {
      dom.globalSearch.addEventListener('input', function() {
        var v = this.value;
        if (dom.searchClear) dom.searchClear.style.display = v ? '' : 'none';
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(function() { runSearch(v); }, 180);
      });
      dom.globalSearch.addEventListener('focus', function() {
        if (!searchIdx.built && !searchIdx.building) buildSearchIndex();
      });
      dom.globalSearch.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { this.blur(); closeSearch(); }
      });
    }
    if (dom.searchClear) dom.searchClear.addEventListener('click', function() {
      closeSearch();
      if (dom.globalSearch) dom.globalSearch.focus();
    });

    document.addEventListener('keydown', function(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.key === 'Escape' && fs.el.classList.contains('open')) { closeFullscreen(); }
      else if ((e.key === 'f' || e.key === 'F') && state.nowPlaying) {
        if (fs.el.classList.contains('open')) closeFullscreen(); else openFullscreen();
      }
    });

    audio.addEventListener('timeupdate', function() {
      if (audio.duration && isFinite(audio.duration)) {
        var pct = (audio.currentTime / audio.duration) * 100;
        if (fs.progFill) fs.progFill.style.width = pct + '%';
        if (fs.cur) fs.cur.textContent = formatTime(audio.currentTime);
      }
    });
    audio.addEventListener('loadedmetadata', function() {
      if (audio.duration && isFinite(audio.duration) && fs.dur) fs.dur.textContent = formatTime(audio.duration);
      if (_sleep.endOfTrack) scheduleEndOfTrack();
    });
    audio.addEventListener('play', function() { if (_sleep.endOfTrack) scheduleEndOfTrack(); });
  }
  wireEnhancements();

  return { init: init };
})();

document.addEventListener('DOMContentLoaded', app.init);
