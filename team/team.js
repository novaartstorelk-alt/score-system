// ==========================================
// TEAM.JS - V30.0 RTDB + CACHE OPTIMIZED
// Team Manager - Firebase RTDB + localStorage
// Zero Bandwidth After First Load!
// ==========================================

// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
    FIREBASE: {
        apiKey: "AIzaSyA3SPSsNTwK6doYq-lpKTozGgRha9HObFI",
        authDomain: "stc-score-v3.firebaseapp.com",
        databaseURL: "https://stc-score-v3-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "stc-score-v3",
        storageBucket: "stc-score-v3.firebasestorage.app",
        messagingSenderId: "626214005830",
        appId: "1:626214005830:web:bd50292e589b0d34896e47"
    },
    IMGBB_API_KEY: '1f0145c3062537c8dcecbf6203aa5b1f',

    // 🆕 Cache Configuration
    CACHE: {
        TEAMS_KEY: 'stc_teams_cache_v2',
        PLAYERS_KEY: 'stc_players_cache_v2',
        VERSION_KEY: 'stc_data_version_v2',
        // Cache valid for 24 hours (can increase this)
        MAX_AGE_MS: 24 * 60 * 60 * 1000
    }
};

// ==========================================
// GLOBAL STATE
// ==========================================
let db = null;
let firebaseApp = null;
let connectionListenerAttached = false;
let matchId = localStorage.getItem('matchId') || 'my_match_999';

let teams = [];
let editingTeamId = null;
let deleteTeamId = null;
let playerRowCount = 0;
let activePreviewRow = null;

let connectionState = {
    isConnected: false,
    lastSync: null,
    lastPing: null,
    teamsCount: 0,
    playersCount: 0,
    error: null,
    usingCache: false
};

let errorPopupTimeout = null;
let successPopupTimeout = null;

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initFirebase();
});

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================
async function initFirebase() {
    try {
        updateConnStatus('connecting', 'Initializing...');

        if (!window.firebase) {
            throw new Error('Firebase library not loaded');
        }

        if (!firebase.apps.length) {
            firebaseApp = firebase.initializeApp(CONFIG.FIREBASE);
        } else {
            firebaseApp = firebase.apps[0];
        }

        db = firebase.database();

        const connTitle = document.querySelector('.conn-panel-title span');
        if (connTitle) connTitle.textContent = '📡 Firebase + Cache';

        const urlDisplay = CONFIG.FIREBASE.databaseURL.replace('https://', '').replace(/\/$/, '');
        document.getElementById('connProjectUrl').textContent = urlDisplay;

        attachConnectionListener();
        await ensureFirebaseMeta();
        await testConnection();

    } catch (error) {
        console.error('Firebase init error:', error);
        updateConnStatus('error', 'Init Failed');
        showErrorPopup('Initialization Failed', 'Could not initialize Firebase: ' + error.message);
    }
}

async function ensureFirebaseMeta() {
    if (!db) return;
    try {
        await db.ref('app_meta').update({
            team_manager_ready: true,
            cache_mode: true,
            last_opened_at: firebase.database.ServerValue.TIMESTAMP
        });
    } catch (e) {
        console.warn('Meta init skipped:', e);
    }
}

// ==========================================
// 🆕 CACHE SYSTEM - Zero Bandwidth After First Load
// ==========================================

/**
 * Save data to localStorage cache
 */
function saveToCache(teamsData, playersData, version) {
    try {
        const cacheData = {
            teams: teamsData,
            players: playersData,
            version: version,
            timestamp: Date.now()
        };
        localStorage.setItem(CONFIG.CACHE.TEAMS_KEY, JSON.stringify(cacheData));
        console.log('💾 Data cached locally (bandwidth saved for next load!)');
    } catch (e) {
        console.warn('Cache save failed:', e);
    }
}

/**
 * Load data from localStorage cache
 */
function loadFromCache() {
    try {
        const cached = localStorage.getItem(CONFIG.CACHE.TEAMS_KEY);
        if (!cached) return null;

        const data = JSON.parse(cached);

        // Check if cache is expired
        const age = Date.now() - (data.timestamp || 0);
        if (age > CONFIG.CACHE.MAX_AGE_MS) {
            console.log('⏰ Cache expired, will refresh');
            return null;
        }

        return data;
    } catch (e) {
        console.warn('Cache load failed:', e);
        return null;
    }
}

/**
 * Get server version from RTDB
 */
async function getServerVersion() {
    try {
        const snap = await db.ref('data_version/teams').once('value');
        return snap.val() || 0;
    } catch (e) {
        return 0;
    }
}

/**
 * Update server version (notify other clients)
 */
async function updateServerVersion() {
    const version = Date.now();
    await db.ref('data_version/teams').set(version);
    return version;
}

/**
 * Clear local cache
 */
function clearCache() {
    localStorage.removeItem(CONFIG.CACHE.TEAMS_KEY);
    console.log('🗑️ Cache cleared');
}

/**
 * Check if cache is valid (compare versions)
 */
async function isCacheValid(cachedData) {
    if (!cachedData || !cachedData.version) return false;

    const serverVersion = await getServerVersion();

    // If server version is newer, cache is invalid
    if (serverVersion > cachedData.version) {
        console.log('🔄 Server has newer data, cache invalid');
        return false;
    }

    return true;
}

// ==========================================
// FIREBASE REALTIME CONNECTION (Zero Bandwidth Presence)
// ==========================================
function attachConnectionListener() {
    if (!db || connectionListenerAttached) return;
    connectionListenerAttached = true;

    const amOnline = db.ref('.info/connected');
    const myPresenceRef = db.ref(`presence/${matchId}/team`);

    amOnline.on('value', (snap) => {
        const isConnected = snap.val() === true;
        connectionState.isConnected = isConnected;

        if (isConnected) {
            updateConnStatus('connected', 'Connected');

            myPresenceRef.onDisconnect().set({
                online: false,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
            myPresenceRef.set({
                online: true,
                lastSeen: firebase.database.ServerValue.TIMESTAMP,
                version: '30.0'
            });
        } else {
            updateConnStatus('error', 'Offline');
            const stateEl = document.getElementById('connState');
            if (stateEl) {
                stateEl.textContent = 'No Internet / Firebase Offline';
                stateEl.className = 'conn-detail-value error';
            }
        }
    });

    // Listen for force reload commands
    db.ref(`matches/${matchId}/command`).on('value', (snap) => {
        const cmd = snap.val();
        if (!cmd || !cmd.ts) return;

        const cmdAge = Date.now() - cmd.ts;
        if (cmdAge > 5000) return;

        if (cmd.event === 'force_reload') {
            if (cmd.payload.target === 'team' || cmd.payload.target === 'all') {
                location.reload(true);
            }
        }
    });

    // 🆕 Listen for data version changes (auto-refresh when another client updates)
    db.ref('data_version/teams').on('value', (snap) => {
        const serverVersion = snap.val();
        const cached = loadFromCache();

        if (cached && serverVersion && serverVersion > cached.version) {
            console.log('🔔 Data updated elsewhere, refreshing...');
            loadTeams(true);  // Force refresh
        }
    });
}

// ==========================================
// IMGBB IMAGE UPLOAD
// ==========================================
async function uploadImageToImgBB(file) {
    return new Promise(async (resolve, reject) => {
        try {
            const resizedBase64 = await cropImageToSquare(file, 220);
            const base64Data = resizedBase64.split(',')[1];

            const formData = new FormData();
            formData.append('key', CONFIG.IMGBB_API_KEY);
            formData.append('image', base64Data);

            const response = await fetch('https://api.imgbb.com/1/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (data.success) {
                console.log('✅ Image uploaded to ImgBB:', data.data.url);
                resolve(data.data.url);
            } else {
                throw new Error(data.error?.message || 'ImgBB upload failed');
            }
        } catch (error) {
            console.error('ImgBB upload error:', error);
            reject(error);
        }
    });
}

function cropImageToSquare(file, size = 220) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = function (e) {
            const img = new Image();

            img.onload = function () {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;

                const ctx = canvas.getContext('2d');
                const minSide = Math.min(img.width, img.height);
                const sx = (img.width - minSide) / 2;
                const sy = (img.height - minSide) / 2;

                ctx.clearRect(0, 0, size, size);
                ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };

            img.onerror = reject;
            img.src = e.target.result;
        };

        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ==========================================
// POPUPS
// ==========================================
function showErrorPopup(title, message) {
    const popup = document.getElementById('errorPopup');
    document.getElementById('errorPopupTitle').textContent = title;
    document.getElementById('errorPopupMessage').textContent = message;

    popup.classList.remove('show');
    void popup.offsetWidth;
    setTimeout(() => popup.classList.add('show'), 10);

    clearTimeout(errorPopupTimeout);
    errorPopupTimeout = setTimeout(() => {
        hideErrorPopup();
    }, 5000);
}

function hideErrorPopup() {
    document.getElementById('errorPopup').classList.remove('show');
    clearTimeout(errorPopupTimeout);
}

function showSuccessPopup(title, message) {
    const popup = document.getElementById('successPopup');
    document.getElementById('successPopupTitle').textContent = title;
    document.getElementById('successPopupMessage').textContent = message || '';

    popup.classList.remove('show');
    void popup.offsetWidth;
    setTimeout(() => popup.classList.add('show'), 10);

    clearTimeout(successPopupTimeout);
    successPopupTimeout = setTimeout(() => {
        hideSuccessPopup();
    }, 3000);
}

function hideSuccessPopup() {
    document.getElementById('successPopup').classList.remove('show');
    clearTimeout(successPopupTimeout);
}

// ==========================================
// CONNECTION STATUS
// ==========================================
function updateConnStatus(status, text) {
    const panel = document.getElementById('connPanel');
    const badge = document.getElementById('connStatusBadge');
    const dot = document.getElementById('connDot');
    const statusText = document.getElementById('connStatusText');
    const stateEl = document.getElementById('connState');

    panel.classList.remove('connected', 'error', 'connecting');
    panel.classList.add(status);

    badge.className = 'conn-status-badge ' + status;
    dot.className = 'conn-dot ' + status;
    statusText.textContent = text;

    stateEl.textContent = text;
    stateEl.className = 'conn-detail-value';

    if (status === 'connected') {
        stateEl.classList.add('success');
    } else if (status === 'error') {
        stateEl.classList.add('error');
    }
}

// ==========================================
// TEST CONNECTION
// ==========================================
async function testConnection() {
    const btnTest = document.getElementById('btnTestConn');
    const originalText = btnTest.innerHTML;
    btnTest.innerHTML = '<span class="spinner-sm"></span> Testing...';
    btnTest.disabled = true;

    const startTime = Date.now();
    updateConnStatus('connecting', 'Testing...');

    try {
        await db.ref('app_meta').once('value');

        const pingTime = Date.now() - startTime;
        document.getElementById('connPing').textContent = pingTime + ' ms';
        connectionState.lastPing = pingTime;

        updateConnStatus('connected', 'Connected');
        connectionState.isConnected = true;

        showSuccessPopup('Connection Successful!', 'Response time: ' + pingTime + 'ms');
        await loadTeams();

    } catch (error) {
        console.error('Connection test failed:', error);
        updateConnStatus('error', 'Failed');
        connectionState.isConnected = false;
        showErrorPopup('Connection Failed', error.message || 'Could not connect to Firebase database.');
    }

    btnTest.innerHTML = originalText;
    btnTest.disabled = false;
}

// ==========================================
// 🆕 LOAD TEAMS (RTDB + Cache System)
// ==========================================
async function loadTeams(forceRefresh = false) {
    const btnRefresh = document.getElementById('btnRefresh');
    const originalText = btnRefresh.innerHTML;
    btnRefresh.innerHTML = '<span class="spinner-sm"></span> Loading...';
    btnRefresh.disabled = true;

    const startTime = Date.now();

    try {
        let teamsData = {};
        let playersData = {};
        let usedCache = false;
        let currentVersion = Date.now();

        // Step 1: Try to use cache (if not forcing refresh)
        if (!forceRefresh) {
            const cached = loadFromCache();

            if (cached) {
                const cacheValid = await isCacheValid(cached);

                if (cacheValid) {
                    teamsData = cached.teams || {};
                    playersData = cached.players || {};
                    currentVersion = cached.version;
                    usedCache = true;

                    console.log('⚡ Using cached data - ZERO BANDWIDTH USED!');
                    showLoading('Loading teams...', '⚡ Using cached data (0 bandwidth)');
                }
            }
        }

        // Step 2: If no valid cache, fetch from RTDB (using once() - single read)
        if (!usedCache) {
            showLoading('Loading teams...', '📥 Fetching from Firebase (once)');

            // 🔥 KEY: Using once() instead of on() - single read only!
            const [teamsSnap, playersSnap, versionSnap] = await Promise.all([
                db.ref('teams').once('value'),
                db.ref('players').once('value'),
                db.ref('data_version/teams').once('value')
            ]);

            teamsData = teamsSnap.val() || {};
            playersData = playersSnap.val() || {};
            currentVersion = versionSnap.val() || Date.now();

            // Save to cache for next time
            saveToCache(teamsData, playersData, currentVersion);

            console.log('📥 Data fetched from RTDB and cached');
        }

        // Step 3: Process data
        const playersArray = Object.entries(playersData).map(([id, player]) => ({
            id,
            ...player
        }));

        playersArray.sort((a, b) => {
            const teamCompare = String(a.team_id || '').localeCompare(String(b.team_id || ''));
            if (teamCompare !== 0) return teamCompare;

            const jerseyA = a.jersey_number === null || a.jersey_number === undefined ? 9999 : Number(a.jersey_number);
            const jerseyB = b.jersey_number === null || b.jersey_number === undefined ? 9999 : Number(b.jersey_number);
            if (jerseyA !== jerseyB) return jerseyA - jerseyB;

            return String(a.name || '').localeCompare(String(b.name || ''));
        });

        teams = Object.entries(teamsData).map(([id, team]) => {
            const teamPlayers = playersArray.filter(p => p.team_id === id);
            return {
                id,
                ...team,
                players: teamPlayers
            };
        });

        teams.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

        // Step 4: Update UI
        const pingTime = Date.now() - startTime;
        connectionState.teamsCount = teams.length;
        connectionState.playersCount = playersArray.length;
        connectionState.lastSync = new Date();
        connectionState.isConnected = true;
        connectionState.usingCache = usedCache;

        updateConnStatus('connected', usedCache ? 'Cached ⚡' : 'Connected');
        document.getElementById('connTeamsCount').textContent = teams.length;
        document.getElementById('connPlayersCount').textContent = playersArray.length;
        document.getElementById('connLastSync').textContent = new Date().toLocaleTimeString();
        document.getElementById('connPing').textContent = usedCache
            ? '0 ms (cache)'
            : pingTime + ' ms';

        updateStats();
        renderTeams();

        if (usedCache) {
            console.log('💰 Bandwidth saved: ~' + JSON.stringify(teamsData).length + ' bytes');
        }

    } catch (error) {
        console.error('Load teams error:', error);
        updateConnStatus('error', 'Load Failed');

        // Try to use cache as fallback (even if expired)
        const cached = loadFromCache();
        if (cached && cached.teams) {
            console.log('📴 Offline - using cached data');
            showErrorPopup('Using Offline Cache', 'Could not connect. Showing cached data.');

            const playersArray = Object.entries(cached.players || {}).map(([id, player]) => ({ id, ...player }));
            teams = Object.entries(cached.teams).map(([id, team]) => ({
                id,
                ...team,
                players: playersArray.filter(p => p.team_id === id)
            }));
            renderTeams();
        } else {
            showErrorPopup('Failed to Load Data', error.message || 'Could not fetch teams.');
        }
    }

    btnRefresh.innerHTML = originalText;
    btnRefresh.disabled = false;
    hideLoading();
}

/**
 * Force refresh - clear cache and reload
 */
async function forceRefreshTeams() {
    clearCache();
    await loadTeams(true);
    showSuccessPopup('Data Refreshed!', 'Downloaded fresh data from server');
}

// ==========================================
// RENDER TEAMS
// ==========================================
function renderTeams(filterText) {
    const grid = document.getElementById('teamsGrid');
    const empty = document.getElementById('emptyState');
    const countLabel = document.getElementById('teamsCountLabel');

    let filteredTeams = teams;

    if (filterText) {
        const search = filterText.toLowerCase();
        filteredTeams = teams.filter(function (t) {
            return String(t.name || '').toLowerCase().includes(search) ||
                String(t.short_name || '').toLowerCase().includes(search);
        });
    }

    countLabel.textContent = '(' + filteredTeams.length + ' team' + (filteredTeams.length !== 1 ? 's' : '') + ')';

    if (filteredTeams.length === 0) {
        grid.style.display = 'none';
        empty.style.display = 'block';

        if (filterText && teams.length > 0) {
            empty.innerHTML =
                '<div class="empty-state-icon">🔍</div>' +
                '<h3>No Results Found</h3>' +
                '<p>No teams match your search. Try a different keyword.</p>' +
                '<button class="btn btn-secondary" onclick="clearSearch()">Clear Search</button>';
        } else {
            empty.innerHTML =
                '<div class="empty-state-icon">🏏</div>' +
                '<h3>No Teams Yet!</h3>' +
                '<p>Add your first team to get started with the cricket scoring system.</p>' +
                '<button class="btn btn-primary" onclick="openTeamModal()">➕ Add Your First Team</button>';
        }
        return;
    }

    grid.style.display = 'grid';
    empty.style.display = 'none';

    let html = '';

    for (let i = 0; i < filteredTeams.length; i++) {
        const team = filteredTeams[i];
        let captain = null;

        for (let j = 0; j < team.players.length; j++) {
            if (team.players[j].is_captain) {
                captain = team.players[j];
                break;
            }
        }

        let playerTags = '';
        const maxTags = Math.min(4, team.players.length);

        for (let k = 0; k < maxTags; k++) {
            const p = team.players[k];
            const tagClass = p.is_captain ? 'player-tag captain' : 'player-tag';
            playerTags += '<span class="' + tagClass + '">' +
                escapeHtml(p.name) + (p.is_captain ? ' (C)' : '') + '</span>';
        }

        const moreCount = team.players.length - 4;
        const createdDate = formatDateSafe(team.created_at);

        const logoSrc = team.logo_url || team.logo_base64 || '';
        const logoHtml = logoSrc
            ? '<img src="' + logoSrc + '" alt="' + escapeHtml(team.short_name) + '">'
            : escapeHtml(team.short_name || '');

        const captainHtml = captain
            ? ' • ⭐ Captain: <span>' + escapeHtml(captain.name) + '</span>'
            : '';

        const moreHtml = moreCount > 0
            ? '<span class="player-tag more">+' + moreCount + ' more</span>'
            : '';

        html +=
            '<div class="team-card animate-scale-in" style="animation-delay: ' + (i * 0.08) + 's;">' +
            '<div class="team-header">' +
            '<div class="team-logo">' + logoHtml + '</div>' +
            '<div class="team-info">' +
            '<div class="team-name">' + escapeHtml(team.name) + '</div>' +
            '<div class="team-short">' + escapeHtml(team.short_name) + '</div>' +
            '</div>' +
            '</div>' +
            '<div class="team-body">' +
            '<div class="player-count">' +
            '👥 <span>' + team.players.length + '</span> players' + captainHtml +
            '</div>' +
            '<div class="player-tags">' + playerTags + moreHtml + '</div>' +
            '</div>' +
            '<div class="team-actions">' +
            '<button class="btn btn-sm btn-secondary" onclick="editTeam(\'' + team.id + '\')">✏️ Edit</button>' +
            '<button class="btn btn-sm btn-danger" onclick="openDeleteModal(\'' + team.id + '\')">🗑️ Delete</button>' +
            '</div>' +
            '<div class="team-created">📅 Created: ' + createdDate + '</div>' +
            '</div>';
    }

    grid.innerHTML = html;
}

// ==========================================
// SEARCH
// ==========================================
function filterTeamsSearch() {
    const searchText = document.getElementById('searchInput').value;
    renderTeams(searchText);
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    renderTeams();
}

// ==========================================
// STATS
// ==========================================
function updateStats() {
    document.getElementById('statTotalTeams').textContent = teams.length;

    let totalPlayers = 0;
    let teamsWithCaptain = 0;

    for (let i = 0; i < teams.length; i++) {
        totalPlayers += teams[i].players.length;

        for (let j = 0; j < teams[i].players.length; j++) {
            if (teams[i].players[j].is_captain) {
                teamsWithCaptain++;
                break;
            }
        }
    }

    document.getElementById('statTotalPlayers').textContent = totalPlayers;
    document.getElementById('statWithCaptains').textContent = teamsWithCaptain;
    document.getElementById('statLastUpdated').textContent = new Date().toLocaleTimeString();
}

// ==========================================
// TEAM MODAL
// ==========================================
function openTeamModal(teamId) {
    editingTeamId = teamId || null;
    playerRowCount = 0;
    activePreviewRow = null;

    const modal = document.getElementById('teamModal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('teamForm');

    form.reset();
    document.getElementById('editTeamId').value = '';
    document.getElementById('inputLogoUrl').value = '';
    document.getElementById('logoPreview').innerHTML =
        '<div class="placeholder"><div class="placeholder-icon">📷</div><div>No Logo</div></div>';
    document.getElementById('btnRemoveLogo').classList.remove('show');
    document.getElementById('playersList').innerHTML = '';
    clearPlayerPreview();

    if (teamId) {
        let team = null;
        for (let i = 0; i < teams.length; i++) {
            if (teams[i].id === teamId) {
                team = teams[i];
                break;
            }
        }

        if (team) {
            title.innerHTML = '✏️ Edit Team';
            document.getElementById('editTeamId').value = team.id;
            document.getElementById('inputTeamName').value = team.name || '';
            document.getElementById('inputShortName').value = team.short_name || '';

            const logoSrc = team.logo_url || team.logo_base64 || '';
            if (logoSrc) {
                document.getElementById('inputLogoUrl').value = logoSrc;
                document.getElementById('logoPreview').innerHTML = '<img src="' + logoSrc + '">';
                document.getElementById('btnRemoveLogo').classList.add('show');
            }

            for (let j = 0; j < team.players.length; j++) {
                addPlayerRow(team.players[j]);
            }

            const remaining = Math.max(0, 11 - team.players.length);
            for (let k = 0; k < remaining; k++) {
                addPlayerRow();
            }
        }
    } else {
        title.innerHTML = '➕ Add New Team';
        for (let m = 0; m < 11; m++) {
            addPlayerRow();
        }
    }

    modal.classList.add('show');

    setTimeout(() => {
        const firstRow = document.querySelector('#playersList .player-item');
        if (firstRow) {
            setActivePreviewRow(parseInt(firstRow.dataset.rowNum, 10));
        }
    }, 60);
}

function closeTeamModal() {
    document.getElementById('teamModal').classList.remove('show');
    editingTeamId = null;
    activePreviewRow = null;
}

// ==========================================
// PLAYER ROWS
// ==========================================
function addPlayerRow(player) {
    playerRowCount++;
    const list = document.getElementById('playersList');
    const num = playerRowCount;

    const playerName = player && player.name ? player.name : '';
    const jerseyNum = player && player.jersey_number ? player.jersey_number : '';
    const playerRole = player && player.role ? player.role : '';
    const playerSchool = player && player.school ? player.school : '';
    const playerAge = player && player.age ? player.age : '';
    const isCaptain = player && player.is_captain ? 'checked' : '';
    const photoUrl = player && (player.photo_url || player.photo_base64) ? (player.photo_url || player.photo_base64) : '';

    const row = document.createElement('div');
    row.className = 'player-item';
    row.id = 'player-row-' + num;
    row.dataset.rowNum = num;
    row.style.animation = 'fadeInUp 0.3s ease forwards';

    row.innerHTML =
        '<div class="player-photo-cell">' +
        '<div class="player-photo-preview" id="playerPhotoPreview-' + num + '">' +
        (photoUrl ? '<img src="' + photoUrl + '" alt="Player">' : '📷') +
        '</div>' +
        '<input type="hidden" data-field="photoUrl" value="' + escapeAttr(photoUrl) + '">' +
        '<input type="file" class="player-photo-input" id="playerPhotoFile-' + num + '" accept="image/*" onchange="handlePlayerPhotoUpload(this,' + num + ')">' +
        '<div class="player-photo-actions">' +
        '<button type="button" class="btn-photo-action" onclick="document.getElementById(\'playerPhotoFile-' + num + '\').click()">📷</button>' +
        '<button type="button" class="btn-photo-action btn-photo-remove ' + (photoUrl ? 'show' : '') + '" id="playerPhotoRemove-' + num + '" onclick="removePlayerPhoto(' + num + ')">🗑</button>' +
        '</div>' +
        '</div>' +

        '<div class="player-number">' + num + '</div>' +

        '<input type="text" placeholder="Player Name" value="' + escapeAttr(playerName) + '" data-field="name" onfocus="setActivePreviewRow(' + num + ')" oninput="updatePlayerPreviewFromRow(' + num + ')">' +

        '<input type="number" class="jersey-input" placeholder="#" min="0" max="999" value="' + escapeAttr(jerseyNum) + '" data-field="jersey" onfocus="setActivePreviewRow(' + num + ')" oninput="updatePlayerPreviewFromRow(' + num + ')">' +

        '<select data-field="role" onfocus="setActivePreviewRow(' + num + ')" onchange="updatePlayerPreviewFromRow(' + num + ')">' +
        '<option value="">Role</option>' +
        '<option value="Batsman"' + (playerRole === 'Batsman' ? ' selected' : '') + '>Batsman</option>' +
        '<option value="Bowler"' + (playerRole === 'Bowler' ? ' selected' : '') + '>Bowler</option>' +
        '<option value="All-rounder"' + (playerRole === 'All-rounder' ? ' selected' : '') + '>All-rounder</option>' +
        '<option value="Wicket-keeper"' + (playerRole === 'Wicket-keeper' ? ' selected' : '') + '>Wicket-keeper</option>' +
        '</select>' +

        '<input type="text" class="player-school-input" placeholder="School" value="' + escapeAttr(playerSchool) + '" data-field="school" onfocus="setActivePreviewRow(' + num + ')" oninput="updatePlayerPreviewFromRow(' + num + ')">' +

        '<input type="number" class="player-age-input" placeholder="Age" min="5" max="60" value="' + escapeAttr(playerAge) + '" data-field="age" onfocus="setActivePreviewRow(' + num + ')" oninput="updatePlayerPreviewFromRow(' + num + ')">' +

        '<label class="captain-checkbox">' +
        '<input type="checkbox" data-field="captain" ' + isCaptain + ' onchange="setActivePreviewRow(' + num + '); enforceSingleCaptain(' + num + '); updatePlayerPreviewFromRow(' + num + ')">' +
        '<span>Captain</span>' +
        '</label>' +

        '<button type="button" class="btn-remove-player" onclick="removePlayerRow(' + num + ')">✕</button>';

    list.appendChild(row);

    if (!activePreviewRow) {
        activePreviewRow = num;
        setTimeout(() => updatePlayerPreviewFromRow(num), 0);
    }
}

function removePlayerRow(num) {
    const row = document.getElementById('player-row-' + num);
    if (!row) return;

    row.style.animation = 'fadeOut 0.3s ease forwards';

    setTimeout(function () {
        if (row.parentNode) {
            row.parentNode.removeChild(row);
        }

        if (activePreviewRow === num) {
            const firstRow = document.querySelector('#playersList .player-item');
            if (firstRow) {
                setActivePreviewRow(parseInt(firstRow.dataset.rowNum, 10));
            } else {
                activePreviewRow = null;
                clearPlayerPreview();
            }
        }
    }, 300);
}

// ==========================================
// PLAYER PHOTO HANDLING
// ==========================================
async function handlePlayerPhotoUpload(input, rowNum) {
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];

    if (file.size > 5 * 1024 * 1024) {
        showErrorPopup('Photo Too Large', 'Please select a player photo smaller than 5MB.');
        input.value = '';
        return;
    }

    try {
        showLoading('Uploading player photo...', 'Uploading to ImgBB');

        const imgbbUrl = await uploadImageToImgBB(file);

        const row = document.getElementById('player-row-' + rowNum);
        if (!row) return;

        const hiddenInput = row.querySelector('[data-field="photoUrl"]');
        const preview = document.getElementById('playerPhotoPreview-' + rowNum);
        const removeBtn = document.getElementById('playerPhotoRemove-' + rowNum);

        hiddenInput.value = imgbbUrl;
        preview.innerHTML = '<img src="' + imgbbUrl + '" alt="Player">';
        removeBtn.classList.add('show');

        if (activePreviewRow === rowNum) {
            updatePlayerPreviewFromRow(rowNum);
        }

        hideLoading();
        showSuccessPopup('Photo Uploaded!', 'Saved to ImgBB');
    } catch (error) {
        console.error(error);
        hideLoading();
        showErrorPopup('Upload Failed', 'Could not upload to ImgBB. Please try again.');
    }

    input.value = '';
}

function removePlayerPhoto(rowNum) {
    const row = document.getElementById('player-row-' + rowNum);
    if (!row) return;

    const hiddenInput = row.querySelector('[data-field="photoUrl"]');
    const preview = document.getElementById('playerPhotoPreview-' + rowNum);
    const removeBtn = document.getElementById('playerPhotoRemove-' + rowNum);

    hiddenInput.value = '';
    preview.innerHTML = '📷';
    removeBtn.classList.remove('show');

    if (activePreviewRow === rowNum) {
        updatePlayerPreviewFromRow(rowNum);
    }
}

// ==========================================
// PREVIEW PANEL
// ==========================================
function setActivePreviewRow(rowNum) {
    activePreviewRow = rowNum;

    const rows = document.querySelectorAll('#playersList .player-item');
    rows.forEach(r => r.classList.remove('active-preview'));

    const row = document.getElementById('player-row-' + rowNum);
    if (row) row.classList.add('active-preview');

    updatePlayerPreviewFromRow(rowNum);
}

function clearPlayerPreview() {
    const photo = document.getElementById('previewPlayerPhoto');
    const role = document.getElementById('previewPlayerRole');
    const name = document.getElementById('previewPlayerName');
    const school = document.getElementById('previewPlayerSchool');
    const age = document.getElementById('previewPlayerAge');
    const jersey = document.getElementById('previewPlayerJersey');
    const captain = document.getElementById('previewPlayerCaptain');

    photo.innerHTML = '<span>👤</span>';
    role.textContent = 'PLAYER ROLE';
    name.textContent = 'Select or edit a player';
    school.textContent = 'School not set';
    age.textContent = 'Age --';
    jersey.textContent = '#--';
    captain.textContent = 'PLAYER';
    captain.classList.remove('captain');
}

function updatePlayerPreviewFromRow(rowNum) {
    const row = document.getElementById('player-row-' + rowNum);
    if (!row) {
        clearPlayerPreview();
        return;
    }

    const nameVal = row.querySelector('[data-field="name"]').value.trim();
    const jerseyVal = row.querySelector('[data-field="jersey"]').value.trim();
    const roleVal = row.querySelector('[data-field="role"]').value.trim();
    const schoolVal = row.querySelector('[data-field="school"]').value.trim();
    const ageVal = row.querySelector('[data-field="age"]').value.trim();
    const captainVal = row.querySelector('[data-field="captain"]').checked;
    const photoVal = row.querySelector('[data-field="photoUrl"]').value;

    const photo = document.getElementById('previewPlayerPhoto');
    const role = document.getElementById('previewPlayerRole');
    const name = document.getElementById('previewPlayerName');
    const school = document.getElementById('previewPlayerSchool');
    const age = document.getElementById('previewPlayerAge');
    const jersey = document.getElementById('previewPlayerJersey');
    const captain = document.getElementById('previewPlayerCaptain');

    if (photoVal) {
        photo.innerHTML = '<img src="' + photoVal + '" alt="Player">';
    } else {
        photo.innerHTML = '<span>👤</span>';
    }

    role.textContent = (roleVal || 'PLAYER').toUpperCase();
    name.textContent = nameVal || 'Unnamed Player';
    school.textContent = schoolVal || 'School not set';
    age.textContent = ageVal ? ('Age ' + ageVal) : 'Age --';
    jersey.textContent = jerseyVal ? ('#' + jerseyVal) : '#--';

    if (captainVal) {
        captain.textContent = 'TEAM CAPTAIN';
        captain.classList.add('captain');
    } else {
        captain.textContent = 'PLAYER';
        captain.classList.remove('captain');
    }
}

// ==========================================
// CAPTAIN SINGLE SELECT
// ==========================================
function enforceSingleCaptain(activeRowNum) {
    const activeRow = document.getElementById('player-row-' + activeRowNum);
    if (!activeRow) return;

    const activeCaptain = activeRow.querySelector('[data-field="captain"]');
    if (!activeCaptain || !activeCaptain.checked) return;

    const allChecks = document.querySelectorAll('#playersList [data-field="captain"]');
    allChecks.forEach(check => {
        const parentRow = check.closest('.player-item');
        if (parentRow && parentRow.id !== 'player-row-' + activeRowNum) {
            check.checked = false;
        }
    });
}

// ==========================================
// TEAM LOGO UPLOAD
// ==========================================
async function handleLogoUpload(input) {
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];

    if (file.size > 5 * 1024 * 1024) {
        showErrorPopup('File Too Large', 'Please select an image smaller than 5MB.');
        input.value = '';
        return;
    }

    showLoading('Uploading logo...', 'Uploading to ImgBB');

    try {
        const imgbbUrl = await uploadImageToImgBB(file);

        document.getElementById('inputLogoUrl').value = imgbbUrl;
        document.getElementById('logoPreview').innerHTML = '<img src="' + imgbbUrl + '">';
        document.getElementById('btnRemoveLogo').classList.add('show');

        hideLoading();
        showSuccessPopup('Logo Uploaded!', 'Saved to ImgBB');
    } catch (error) {
        console.error(error);
        hideLoading();
        showErrorPopup('Upload Failed', 'Could not upload to ImgBB. Please try again.');
    }

    input.value = '';
}

function removeLogo() {
    document.getElementById('inputLogoUrl').value = '';
    document.getElementById('inputLogoFile').value = '';
    document.getElementById('logoPreview').innerHTML =
        '<div class="placeholder">' +
        '<div class="placeholder-icon">📷</div>' +
        '<div>No Logo</div>' +
        '</div>';
    document.getElementById('btnRemoveLogo').classList.remove('show');
}

// ==========================================
// DELETE PLAYERS BY TEAM HELPER
// ==========================================
async function deletePlayersByTeam(teamId) {
    const snap = await db.ref('players').orderByChild('team_id').equalTo(teamId).once('value');
    const updates = {};

    snap.forEach(child => {
        updates['players/' + child.key] = null;
    });

    if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
    }
}

// ==========================================
// SAVE TEAM
// ==========================================
async function saveTeam() {
    const teamId = document.getElementById('editTeamId').value;
    const name = document.getElementById('inputTeamName').value.trim();
    const shortName = document.getElementById('inputShortName').value.trim().toUpperCase();
    const logoUrl = document.getElementById('inputLogoUrl').value;

    if (!name) {
        showErrorPopup('Validation Error', 'Team name is required!');
        document.getElementById('inputTeamName').focus();
        return;
    }

    if (!shortName || shortName.length < 2) {
        showErrorPopup('Validation Error', 'Short name must be at least 2 characters!');
        document.getElementById('inputShortName').focus();
        return;
    }

    if (shortName.length > 5) {
        showErrorPopup('Validation Error', 'Short name must be 5 characters or less!');
        document.getElementById('inputShortName').focus();
        return;
    }

    const playerRows = document.querySelectorAll('#playersList .player-item');
    const players = [];
    let captainCount = 0;

    for (let i = 0; i < playerRows.length; i++) {
        const row = playerRows[i];
        const nameInput = row.querySelector('[data-field="name"]');
        const jerseyInput = row.querySelector('[data-field="jersey"]');
        const roleSelect = row.querySelector('[data-field="role"]');
        const schoolInput = row.querySelector('[data-field="school"]');
        const ageInput = row.querySelector('[data-field="age"]');
        const captainCheck = row.querySelector('[data-field="captain"]');
        const photoInput = row.querySelector('[data-field="photoUrl"]');

        if (nameInput && nameInput.value.trim()) {
            const isCaptain = captainCheck && captainCheck.checked;
            if (isCaptain) captainCount++;

            players.push({
                name: nameInput.value.trim(),
                jersey_number: jerseyInput && jerseyInput.value ? parseInt(jerseyInput.value, 10) : null,
                role: roleSelect && roleSelect.value ? roleSelect.value : null,
                school: schoolInput && schoolInput.value ? schoolInput.value.trim() : null,
                age: ageInput && ageInput.value ? parseInt(ageInput.value, 10) : null,
                photo_url: photoInput && photoInput.value ? photoInput.value : null,
                is_captain: isCaptain
            });
        }
    }

    if (captainCount > 1) {
        showErrorPopup('Validation Error', 'Only one captain can be assigned per team!');
        return;
    }

    const btnSave = document.getElementById('btnSaveTeam');
    const originalText = btnSave.innerHTML;
    btnSave.innerHTML = '<span class="spinner-sm"></span> Saving...';
    btnSave.disabled = true;

    showLoading('Saving team...', 'Please wait');

    try {
        let savedTeamId = teamId;

        if (teamId) {
            await db.ref('teams/' + teamId).update({
                name: name,
                short_name: shortName,
                logo_url: logoUrl || '',
                updated_at: firebase.database.ServerValue.TIMESTAMP
            });

            await deletePlayersByTeam(teamId);

        } else {
            const newTeamRef = db.ref('teams').push();
            savedTeamId = newTeamRef.key;

            await newTeamRef.set({
                name: name,
                short_name: shortName,
                logo_url: logoUrl || '',
                created_at: firebase.database.ServerValue.TIMESTAMP,
                updated_at: firebase.database.ServerValue.TIMESTAMP
            });
        }

        if (players.length > 0) {
            const updates = {};

            players.forEach(p => {
                const newPlayerKey = db.ref('players').push().key;
                updates['players/' + newPlayerKey] = {
                    name: p.name,
                    jersey_number: p.jersey_number,
                    role: p.role,
                    school: p.school,
                    age: p.age,
                    photo_url: p.photo_url,
                    is_captain: p.is_captain,
                    team_id: savedTeamId,
                    created_at: firebase.database.ServerValue.TIMESTAMP
                };
            });

            await db.ref().update(updates);
        }

        // 🆕 Update version and clear cache
        await updateServerVersion();
        clearCache();

        hideLoading();
        showSuccessPopup(
            teamId ? 'Team Updated!' : 'Team Created!',
            name + ' saved with ' + players.length + ' players'
        );

        closeTeamModal();
        await loadTeams(true);  // Force refresh to get new data

    } catch (error) {
        console.error('Save error:', error);
        hideLoading();
        showErrorPopup('Save Failed', error.message || 'Could not save team to Firebase.');
    }

    btnSave.innerHTML = originalText;
    btnSave.disabled = false;
}

function editTeam(teamId) {
    openTeamModal(teamId);
}

// ==========================================
// DELETE TEAM
// ==========================================
function openDeleteModal(teamId) {
    deleteTeamId = teamId;

    let team = null;
    for (let i = 0; i < teams.length; i++) {
        if (teams[i].id === teamId) {
            team = teams[i];
            break;
        }
    }

    if (team) {
        document.getElementById('deleteTeamName').textContent = team.name;
        document.getElementById('deletePlayerCount').textContent = team.players.length;
        document.getElementById('deleteModal').classList.add('show');
    }
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('show');
    deleteTeamId = null;
}

async function confirmDelete() {
    if (!deleteTeamId) return;

    let teamName = 'Team';
    for (let i = 0; i < teams.length; i++) {
        if (teams[i].id === deleteTeamId) {
            teamName = teams[i].name;
            break;
        }
    }

    const btnDelete = document.getElementById('btnConfirmDelete');
    const originalText = btnDelete.innerHTML;
    btnDelete.innerHTML = '<span class="spinner-sm"></span> Deleting...';
    btnDelete.disabled = true;

    showLoading('Deleting team...', 'This cannot be undone');

    try {
        await deletePlayersByTeam(deleteTeamId);
        await db.ref('teams/' + deleteTeamId).remove();

        // 🆕 Update version and clear cache
        await updateServerVersion();
        clearCache();

        hideLoading();
        showSuccessPopup('Team Deleted!', teamName + ' has been removed');
        closeDeleteModal();
        await loadTeams(true);  // Force refresh

    } catch (error) {
        console.error('Delete error:', error);
        hideLoading();
        showErrorPopup('Delete Failed', error.message || 'Could not delete team from Firebase.');
    }

    btnDelete.innerHTML = originalText;
    btnDelete.disabled = false;
}

// ==========================================
// EXPORT FIREBASE DATA
// ==========================================
async function exportSupabaseData() {
    const btn = document.getElementById('btnExportData');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-sm"></span> Exporting...';
    btn.disabled = true;

    showLoading('Exporting data...', 'Downloading JSON backup');

    try {
        const [teamsSnap, playersSnap] = await Promise.all([
            db.ref('teams').once('value'),
            db.ref('players').once('value')
        ]);

        const teamsData = teamsSnap.val() || {};
        const playersData = playersSnap.val() || {};

        const teamsArray = Object.entries(teamsData).map(([id, team]) => ({ id, ...team }));
        const playersArray = Object.entries(playersData).map(([id, player]) => ({ id, ...player }));

        const payload = {
            exported_at: new Date().toISOString(),
            project: CONFIG.FIREBASE.databaseURL,
            teams_count: teamsArray.length,
            players_count: playersArray.length,
            teams: teamsArray,
            players: playersArray
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'cricket-teams-export-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        hideLoading();
        showSuccessPopup('Export Complete!', 'Firebase data exported successfully');

    } catch (error) {
        console.error(error);
        hideLoading();
        showErrorPopup('Export Failed', error.message || 'Could not export Firebase data.');
    }

    btn.innerHTML = originalText;
    btn.disabled = false;
}

// ==========================================
// LOADING OVERLAY
// ==========================================
function showLoading(text, subtext) {
    document.getElementById('loadingText').textContent = text || 'Loading...';
    document.getElementById('loadingSubtext').textContent = subtext || 'Please wait';
    document.getElementById('loadingOverlay').classList.add('show');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('show');
}

// ==========================================
// HELPERS
// ==========================================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatDateSafe(value) {
    if (!value) return '--';

    if (typeof value === 'number') {
        return new Date(value).toLocaleDateString();
    }

    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString();
    }

    return '--';
}

// ==========================================
// EVENT LISTENERS
// ==========================================
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        if (document.getElementById('teamModal').classList.contains('show')) {
            closeTeamModal();
        }
        if (document.getElementById('deleteModal').classList.contains('show')) {
            closeDeleteModal();
        }
        hideErrorPopup();
        hideSuccessPopup();
    }
});

document.getElementById('teamModal').addEventListener('click', function (e) {
    if (e.target === this) closeTeamModal();
});

document.getElementById('deleteModal').addEventListener('click', function (e) {
    if (e.target === this) closeDeleteModal();
});

window.addEventListener('online', () => {
    if (db) testConnection();
});

window.addEventListener('offline', () => {
    updateConnStatus('error', 'Offline');
    showErrorPopup('Internet Disconnected', 'Your device is offline.');
});

window.addEventListener('beforeunload', () => {
    if (db && matchId) {
        db.ref(`presence/${matchId}/team`).set({
            online: false,
            lastSeen: Date.now()
        });
    }
});

// ==========================================
// INITIALIZATION COMPLETE
// ==========================================
console.log('👥 Team Manager V30.0 RTDB + Cache Optimized Loaded');
console.log('💡 Tip: First load uses bandwidth, subsequent loads use cache (0 bandwidth)');