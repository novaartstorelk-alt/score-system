// ==========================================
// SCORER.JS - V32.0 FIREBASE OPTIMIZED
// Mobile Score Updater - 100% Firebase
// Auto Profile + Auto Result + Auto Over End
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

    CACHE: {
        TEAMS_KEY: 'stc_teams_cache_v2',
        VERSION_KEY: 'stc_data_version_v2',
        MAX_AGE_MS: 24 * 60 * 60 * 1000
    },

    TIMING: {
        HYPE_FOUR: 2500,
        HYPE_SIX: 2500,
        HYPE_WICKET: 3000,
        PROFILE_DURATION: 5000,
        RESULT_DELAY: 3000,
        ALL_OUT_DELAY: 4000,
        AUTO_BOWLER_POPUP_DELAY: 800
    }
};

// ==========================================
// GLOBAL STATE
// ==========================================
let matchId = '';
let scorerName = '';

// ==========================================
// REALTIME / DEVICE MONITOR STATE
// ==========================================
let autoRealtimeEnabled = localStorage.getItem('scorer_auto_realtime') !== '0';
let hasPendingManualPush = false;
let pendingCommandQueue = [];

let batteryManager = null;
let deviceWatchInterval = null;
let lastScorebarPingMs = null;

let batteryState = {
    supported: false,
    level: null,
    charging: null,
    low: false,
    critical: false
};

let networkState = {
    online: navigator.onLine,
    rawType: 'unknown',
    effectiveType: 'unknown',
    label: 'Unknown',
    signalBars: 0,
    signalPct: 0,
    downlink: 0,
    rtt: 0,
    unstable: false
};

let deviceAlertFlags = {
    lowShown: false,
    criticalShown: false,
    unstableShown: false
};

// 🆕 Track previous target for chase detection
let previousTarget = 0;

let firebaseApp = null;
let database = null;

let isConnected = false;
let adminOnline = false;
let scorebarOnline = false;

let messagesSent = 0;

let selfPingMs = null;
let presenceRefreshInterval = null;

let currentTeamsVersion = 0;

let activeMatchListeners = [];

let matchState = {
    runs: 0,
    wkts: 0,
    overs: '0.0',
    balls: 0,
    thisOver: [],
    target: 0,
    totOvers: 20,
    crr: '0.00',
    striker: 1,
    isFreeHit: false,
    partRuns: 0,
    partBalls: 0,
    bat1: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
    bat2: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
    bowler: { name: '', overs: '0.0', runs: 0, wickets: 0, balls: 0 },
    battingTeam: '',
    bowlingTeam: '',
    prevInnings: null,
    isMatchEnded: false,
    dismissedPlayers: []
};

let lockStates = {
    score: false,
    batsmen: false,
    bowler: false,
    full: false
};

let battingPlayers = [];
let bowlingPlayers = [];
let bowlerHistory = [];

let allTeams = [];
let allPlayersData = [];

let currentExtrasType = '';
let currentPickerSlot = 0;
let selectedNextBowler = null;

// 🆕 Pending bowler popup flag (for after wicket)
let pendingBowlerPopup = false;

// ==========================================
// CACHE HELPER FUNCTIONS
// ==========================================
function loadTeamsFromCache() {
    try {
        const cached = localStorage.getItem(CONFIG.CACHE.TEAMS_KEY);
        if (!cached) return null;

        const data = JSON.parse(cached);
        const age = Date.now() - (data.timestamp || 0);
        if (age > CONFIG.CACHE.MAX_AGE_MS) {
            console.log('⏰ Teams cache expired');
            return null;
        }
        return data;
    } catch (e) {
        console.warn('Cache load failed:', e);
        return null;
    }
}

function saveTeamsToCache(teamsData, playersData, version) {
    try {
        const cacheData = {
            teams: teamsData,
            players: playersData,
            version: version,
            timestamp: Date.now()
        };
        localStorage.setItem(CONFIG.CACHE.TEAMS_KEY, JSON.stringify(cacheData));
        console.log('💾 Teams cached locally');
    } catch (e) {
        console.warn('Cache save failed:', e);
    }
}

async function getTeamsServerVersion() {
    try {
        const snap = await database.ref('data_version/teams').once('value');
        return snap.val() || 0;
    } catch (e) {
        return 0;
    }
}

async function isTeamsCacheValid(cachedData) {
    if (!cachedData || !cachedData.version) return false;
    const serverVersion = await getTeamsServerVersion();
    if (serverVersion > cachedData.version) {
        console.log('🔄 Server has newer team data');
        return false;
    }
    return true;
}

function clearTeamsCache() {
    localStorage.removeItem(CONFIG.CACHE.TEAMS_KEY);
    console.log('🗑️ Teams cache cleared');
}

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🏏 Scorer Firebase Initializing...');

    initFirebase();
    loadRecentMatches();

    const savedMatchId = localStorage.getItem('scorer_matchId');
    const savedScorerName = localStorage.getItem('scorer_name');

    if (savedMatchId) {
        document.getElementById('inputMatchId').value = savedMatchId;
    }
    if (savedScorerName) {
        document.getElementById('inputScorerName').value = savedScorerName;
    }

    setupRealtimeModeUI();
    bindDeviceAlertEvents();
    await initDeviceMonitoring();
    updatePingDisplay();
    updateDeviceStatusUI();
});

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================
function initFirebase() {
    try {
        if (typeof firebase === 'undefined') {
            throw new Error('Firebase SDK not loaded');
        }

        if (!firebase.apps.length) {
            firebaseApp = firebase.initializeApp(CONFIG.FIREBASE);
        } else {
            firebaseApp = firebase.apps[0];
        }

        database = firebase.database();
        setupLoginConnectionStatus();

        console.log('✅ Firebase initialized');
        return true;

    } catch (e) {
        console.error('❌ Firebase init failed:', e);
        updateLoginDbStatus('error', 'Firebase failed to load');
        return false;
    }
}

function setupLoginConnectionStatus() {
    if (!database) return;

    const connectedRef = database.ref('.info/connected');
    connectedRef.on('value', (snap) => {
        if (snap.val() === true) {
            updateLoginDbStatus('connected', 'Connected to Database');
        } else {
            updateLoginDbStatus('connecting', 'Connecting...');
        }
    });
}

function updateLoginDbStatus(status, text) {
    const dot = document.getElementById('loginDbDot');
    const textEl = document.getElementById('loginDbText');

    if (dot) dot.className = 'db-dot ' + status;
    if (textEl) textEl.innerText = text;
}

// ==========================================
// LISTENER HELPERS
// ==========================================
function addMatchValueListener(path, callback) {
    if (!database) return null;
    const ref = database.ref(path);
    const handler = (snap) => callback(snap);
    ref.on('value', handler);
    activeMatchListeners.push({ ref, handler });
    return ref;
}

function clearMatchListeners() {
    activeMatchListeners.forEach(({ ref, handler }) => {
        ref.off('value', handler);
    });
    activeMatchListeners = [];
}

// ==========================================
// PING DISPLAY UI
// ==========================================
// ==========================================
// PING DISPLAY UI
// ==========================================
function renderPingBar(textId, fillId, ms, isOnline = true) {
    const pingText = document.getElementById(textId);
    const pingFill = document.getElementById(fillId);

    if (!pingText || !pingFill) return;

    if (!isOnline || ms === null || ms === undefined || Number.isNaN(ms) || ms <= 0) {
        pingText.innerText = '-- ms';
        pingFill.style.width = '0%';
        pingFill.style.background = 'var(--danger)';
        return;
    }

    pingText.innerText = `${ms} ms`;

    let pct = 100;
    let color = 'var(--success)';

    if (ms <= 60) {
        pct = 100;
        color = 'var(--success)';
    } else if (ms <= 120) {
        pct = 80;
        color = 'var(--success)';
    } else if (ms <= 220) {
        pct = 60;
        color = 'var(--warning)';
    } else if (ms <= 350) {
        pct = 40;
        color = 'var(--warning)';
    } else {
        pct = 18;
        color = 'var(--danger)';
    }

    pingFill.style.width = `${pct}%`;
    pingFill.style.background = color;
}

function updateScorebarPingDisplay() {
    renderPingBar(
        'scorebarPingMsText',
        'scorebarPingFill',
        lastScorebarPingMs,
        scorebarOnline
    );
}

function updatePingDisplay() {
    renderPingBar(
        'realtimePingMsText',
        'realtimePingFill',
        selfPingMs,
        isConnected && navigator.onLine
    );

    updateScorebarPingDisplay();
}

// ==========================================
// DEVICE MONITORING + REALTIME MODE
// ==========================================
function bindDeviceAlertEvents() {
    const overlay = document.getElementById('deviceAlertOverlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeDeviceAlert();
        });
    }
}

function setupRealtimeModeUI() {
    const toggle = document.getElementById('realtimeToggle');
    if (toggle) toggle.checked = autoRealtimeEnabled;
    updateRealtimeModeUI();
}

function toggleRealtimeMode(forceValue = null) {
    const toggle = document.getElementById('realtimeToggle');

    autoRealtimeEnabled =
        typeof forceValue === 'boolean'
            ? forceValue
            : !!toggle?.checked;

    localStorage.setItem('scorer_auto_realtime', autoRealtimeEnabled ? '1' : '0');
    updateRealtimeModeUI();
    refreshUpdaterPresence();

    if (autoRealtimeEnabled) {
        showToast('Realtime ON', 'success');
        if (hasPendingManualPush) {
            manualPushNow();
        }
    } else {
        showToast('Realtime OFF - use Manual Push', 'success');
    }
}

function updateRealtimeModeUI() {
    const fab = document.getElementById('manualPushFab');
    const fabText = document.getElementById('manualPushFabText');
    const modeLabel = document.getElementById('deviceRealtimeLabel');

    if (modeLabel) {
        modeLabel.innerText = autoRealtimeEnabled
            ? 'AUTO'
            : (hasPendingManualPush ? 'MANUAL • PENDING' : 'MANUAL');
    }

    if (fab) {
        fab.classList.toggle('show', !autoRealtimeEnabled);
        fab.classList.toggle('pending', hasPendingManualPush);
    }

    if (fabText) {
        fabText.innerText = hasPendingManualPush ? 'Manual Push • Pending' : 'Manual Push';
    }
}

function setPendingManualPush(flag = true) {
    hasPendingManualPush = !!flag;
    updateRealtimeModeUI();
    refreshUpdaterPresence();
}

async function pushPayloadNow(payload) {
    await Promise.all([
        database.ref(`matches/${matchId}/scorer_update`).set(payload),
        database.ref(`matches/${matchId}/live`).update(payload)
    ]);

    messagesSent++;
    updateTechPanel();
}

async function flushQueuedCommands() {
    if (!pendingCommandQueue.length || !database || !isConnected) return;

    const queue = [...pendingCommandQueue];
    pendingCommandQueue = [];

    for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        const cmd = {
            event: item.event,
            payload: item.payload,
            ts: firebase.database.ServerValue.TIMESTAMP
        };

        await database.ref(`matches/${matchId}/command`).set(cmd);
        messagesSent++;
        updateTechPanel();

        await new Promise(resolve => setTimeout(resolve, 120));
    }
}

async function manualPushNow() {
    if (!database || !isConnected) {
        showToast('Not connected', 'error');
        return;
    }

    const fab = document.getElementById('manualPushFab');
    if (fab) fab.classList.add('loading');

    try {
        const payload = buildUpdatePayload();
        await pushPayloadNow(payload);
        await flushQueuedCommands();
        setPendingManualPush(false);
        showToast('Manual push sent', 'success');
    } catch (e) {
        console.error('Manual push failed:', e);
        showToast('Manual push failed', 'error');
    } finally {
        if (fab) fab.classList.remove('loading');
        refreshUpdaterPresence();
    }
}

async function initDeviceMonitoring() {
    await setupBatteryMonitoring();
    readNetworkInfo();
    updateDeviceStatusUI();

    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && typeof conn.addEventListener === 'function') {
        conn.addEventListener('change', handleConnectionInfoChange);
    }

    if (deviceWatchInterval) clearInterval(deviceWatchInterval);
    deviceWatchInterval = setInterval(() => {
        readNetworkInfo();
        refreshUpdaterPresence();
    }, 15000);
}

async function setupBatteryMonitoring() {
    if (!('getBattery' in navigator)) {
        batteryState.supported = false;
        updateDeviceStatusUI();
        return;
    }

    try {
        batteryManager = await navigator.getBattery();
        batteryState.supported = true;
        syncBatteryState();

        batteryManager.addEventListener('levelchange', syncBatteryState);
        batteryManager.addEventListener('chargingchange', syncBatteryState);
    } catch (e) {
        console.warn('Battery API unavailable:', e);
        batteryState.supported = false;
        updateDeviceStatusUI();
    }
}

function syncBatteryState() {
    if (!batteryManager) return;

    const level = Math.round((batteryManager.level || 0) * 100);
    const charging = !!batteryManager.charging;

    batteryState = {
        supported: true,
        level,
        charging,
        low: !charging && level <= 30,
        critical: !charging && level <= 15
    };

    updateDeviceStatusUI();
    evaluateDeviceAlerts();
    refreshUpdaterPresence();
}

function handleConnectionInfoChange() {
    readNetworkInfo();
    refreshUpdaterPresence();
}

function normalizeConnectionLabel(rawType, effectiveType, downlink, rtt) {
    if (!navigator.onLine) return 'OFFLINE';

    const type = String(rawType || '').toLowerCase();
    const eff = String(effectiveType || '').toLowerCase();

    if (type.includes('wifi')) return 'WIFI';
    if (type.includes('ethernet')) return 'LAN';

    if (type.includes('cellular')) {
        if (eff === 'slow-2g' || eff === '2g') return '2G';
        if (eff === '3g') return '3G';
        if (eff === '4g') {
            if ((downlink || 0) >= 20 && (rtt || 999) <= 80) return '5G';
            return '4G';
        }
        return 'CELLULAR';
    }

    if (eff === 'slow-2g' || eff === '2g') return '2G';
    if (eff === '3g') return '3G';
    if (eff === '4g') {
        if ((downlink || 0) >= 20 && (rtt || 999) <= 80) return '5G';
        return '4G';
    }

    return 'ONLINE';
}

function calculateSignalBars(rawType, effectiveType, downlink, rtt, pingMs) {
    if (!navigator.onLine) return 0;

    let score = 2;
    const type = String(rawType || '').toLowerCase();
    const eff = String(effectiveType || '').toLowerCase();

    if (type.includes('wifi') || type.includes('ethernet')) {
        score = 4;
    } else if (eff === 'slow-2g' || eff === '2g') {
        score = 1;
    } else if (eff === '3g') {
        score = 2;
    } else if (eff === '4g') {
        score = 3;
    }

    if ((downlink || 0) >= 15) score += 1;
    if ((rtt || 0) > 250) score -= 1;
    if (pingMs !== null && pingMs > 300) score -= 1;
    if (pingMs !== null && pingMs > 500) score -= 1;

    return Math.max(0, Math.min(4, score));
}

function readNetworkInfo() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    const rawType = conn?.type || (navigator.onLine ? 'unknown' : 'offline');
    const effectiveType = conn?.effectiveType || 'unknown';
    const downlink = Number(conn?.downlink || 0);
    const rtt = Number(conn?.rtt || 0);

    const label = normalizeConnectionLabel(rawType, effectiveType, downlink, rtt);
    const signalBars = calculateSignalBars(rawType, effectiveType, downlink, rtt, selfPingMs);
    const signalPct = Math.round((signalBars / 4) * 100);

    const unstable = navigator.onLine && (
        signalBars <= 1 ||
        (selfPingMs !== null && selfPingMs > 450) ||
        rtt > 700 ||
        String(effectiveType || '').toLowerCase() === 'slow-2g'
    );

    networkState = {
        online: navigator.onLine,
        rawType,
        effectiveType,
        label,
        signalBars,
        signalPct,
        downlink,
        rtt,
        unstable
    };

    updateDeviceStatusUI();
    evaluateDeviceAlerts();
    return networkState;
}

function signalBarsText(bars) {
    const map = ['○○○○', '●○○○', '●●○○', '●●●○', '●●●●'];
    return map[bars] || '○○○○';
}

function updateDeviceStatusUI() {
    const batteryEl = document.getElementById('deviceBatteryText');
    const networkEl = document.getElementById('deviceNetworkText');
    const signalEl = document.getElementById('deviceSignalText');

    // NEW: Visual Battery Fill
    const visualBat = document.getElementById('visualBatteryFill');

    if (batteryEl) {
        let batLevel = batteryState.level ?? 0;
        batteryEl.innerText = batteryState.supported
            ? `${batLevel}%${batteryState.charging ? ' ⚡' : ''}`
            : 'Unsupported';

        // Animate the visual battery color and width
        if (visualBat && batteryState.supported) {
            visualBat.style.width = `${batLevel}%`;
            if (batLevel <= 20 && !batteryState.charging) {
                visualBat.style.background = '#ff3366'; // Red for low
            } else if (batteryState.charging) {
                visualBat.style.background = '#00ffcc'; // Neon Cyan for charging/good
            } else {
                visualBat.style.background = '#00ffcc';
            }
        }
    }

    if (networkEl) {
        networkEl.innerText = networkState.online ? networkState.label : 'OFFLINE';
    }

    if (signalEl) {
        signalEl.innerText = networkState.online
            ? `${signalBarsText(networkState.signalBars)} (${networkState.signalPct}%)${networkState.unstable ? ' • unstable' : ''}`
            : 'No signal';
    }
}

function safeVibrate(pattern = [180, 100, 220]) {
    if (navigator.vibrate) {
        navigator.vibrate(pattern);
    }
}

function showDeviceAlert(type, title, message, meta = '') {
    const overlay = document.getElementById('deviceAlertOverlay');
    const card = document.getElementById('deviceAlertCard');
    const titleEl = document.getElementById('deviceAlertTitle');
    const msgEl = document.getElementById('deviceAlertMessage');
    const metaEl = document.getElementById('deviceAlertMeta');

    if (!overlay || !card) return;

    card.classList.remove('alert-low', 'alert-critical', 'alert-network');

    if (type === 'critical') card.classList.add('alert-critical');
    else if (type === 'low') card.classList.add('alert-low');
    else card.classList.add('alert-network');

    if (titleEl) titleEl.innerText = title;
    if (msgEl) msgEl.innerText = message;
    if (metaEl) metaEl.innerText = meta;

    overlay.classList.add('show');
    safeVibrate([120, 80, 120, 80, 260]);
}

function closeDeviceAlert() {
    const overlay = document.getElementById('deviceAlertOverlay');
    if (overlay) overlay.classList.remove('show');
}

function openDeviceAlertPanel() {
    closeDeviceAlert();

    const connDetails = document.getElementById('connDetails');
    if (connDetails && !connDetails.classList.contains('show')) {
        toggleConnPanel();
    }

    document.getElementById('connPanel')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
}

function evaluateDeviceAlerts() {
    const level = batteryState.level;

    const isCriticalBattery =
        batteryState.supported &&
        level !== null &&
        !batteryState.charging &&
        level <= 15;

    const isLowBattery =
        batteryState.supported &&
        level !== null &&
        !batteryState.charging &&
        level <= 30;

    const isUnstableNet = networkState.online && networkState.unstable;

    if (!batteryState.supported || batteryState.charging || level === null || level > 18) {
        deviceAlertFlags.criticalShown = false;
    }

    if (!batteryState.supported || batteryState.charging || level === null || level > 35) {
        deviceAlertFlags.lowShown = false;
    }

    if (!isUnstableNet) {
        deviceAlertFlags.unstableShown = false;
    }

    if (isCriticalBattery && !deviceAlertFlags.criticalShown) {
        showDeviceAlert(
            'critical',
            'Critical Battery',
            `Battery level is only ${level}%. Please connect charger now.`,
            `Battery ${level}% • Realtime may become unstable`
        );
        deviceAlertFlags.criticalShown = true;
        return;
    }

    if (isLowBattery && !deviceAlertFlags.lowShown) {
        showDeviceAlert(
            'low',
            'Low Battery',
            `Battery level dropped to ${level}%. Please prepare a charger.`,
            `Battery ${level}% • Low power warning`
        );
        deviceAlertFlags.lowShown = true;
        return;
    }

    if (isUnstableNet && !deviceAlertFlags.unstableShown) {
        showDeviceAlert(
            'network',
            'Internet Unstable',
            'Signal is weak or latency is high. Switch network or use Manual Push mode.',
            `${networkState.label} • ${signalBarsText(networkState.signalBars)} • ${selfPingMs ?? '--'} ms`
        );
        deviceAlertFlags.unstableShown = true;
    }
}

// ==========================================
// LIGHTWEIGHT SELF PING
// ==========================================
async function measureOwnFirebasePing() {
    if (!database || !navigator.onLine || !matchId) {
        selfPingMs = null;
        updatePingDisplay();
        return null;
    }

    try {
        const start = performance.now();
        await database.ref(`ping/${matchId}/updater_probe`).set({
            t: firebase.database.ServerValue.TIMESTAMP
        });
        selfPingMs = Math.max(1, Math.round(performance.now() - start));
        updatePingDisplay();
        return selfPingMs;
    } catch (e) {
        selfPingMs = null;
        updatePingDisplay();
        return null;
    }
}

// ==========================================
// LOW-BANDWIDTH PRESENCE REFRESH
// ==========================================
async function refreshUpdaterPresence() {
    if (!database || !matchId || !navigator.onLine) return;

    const ping = await measureOwnFirebasePing();
    readNetworkInfo();

    try {
        await database.ref(`presence/${matchId}/updater`).update({
            online: true,
            lastSeen: firebase.database.ServerValue.TIMESTAMP,
            name: scorerName || '',
            version: '32.5',
            pingMs: ping ?? 0,
            device: {
                battery: {
                    supported: batteryState.supported,
                    level: batteryState.level,
                    charging: batteryState.charging,
                    low: batteryState.low,
                    critical: batteryState.critical
                },
                network: {
                    online: networkState.online,
                    rawType: networkState.rawType,
                    effectiveType: networkState.effectiveType,
                    label: networkState.label,
                    signalBars: networkState.signalBars,
                    signalPct: networkState.signalPct,
                    downlink: networkState.downlink,
                    rtt: networkState.rtt,
                    unstable: networkState.unstable
                },
                autoRealtimeEnabled,
                pendingManualPush: hasPendingManualPush
            }
        });
    } catch (e) { }
}

function startPresenceRefresh() {
    stopPresenceRefresh();
    refreshUpdaterPresence();
    presenceRefreshInterval = setInterval(refreshUpdaterPresence, 10000);
}

function stopPresenceRefresh() {
    if (presenceRefreshInterval) {
        clearInterval(presenceRefreshInterval);
        presenceRefreshInterval = null;
    }
}

// ==========================================
// JOIN MATCH
// ==========================================
function joinMatch() {
    const inputMatchId = document.getElementById('inputMatchId').value.trim();
    const inputScorerName = document.getElementById('inputScorerName').value.trim();

    if (!inputMatchId) {
        showToast('Please enter Match ID', 'error');
        return;
    }
    if (!inputScorerName) {
        showToast('Please enter your name', 'error');
        return;
    }

    matchId = inputMatchId;
    scorerName = inputScorerName;

    localStorage.setItem('scorer_matchId', matchId);
    localStorage.setItem('scorer_name', scorerName);
    addToRecentMatches(matchId);

    console.log('🔄 Joining match:', matchId);
    connectToMatch();
}

// ==========================================
// LOAD TEAMS FROM FIREBASE (With Cache)
// ==========================================
async function loadTeamsFromFirebase(forceRefresh = false) {
    if (!database) {
        console.warn('Database not initialized');
        return;
    }

    try {
        let teamsData = {};
        let playersData = {};
        let usedCache = false;
        let currentVersion = Date.now();

        if (!forceRefresh) {
            const cached = loadTeamsFromCache();
            if (cached && cached.teams) {
                const cacheValid = await isTeamsCacheValid(cached);
                if (cacheValid) {
                    teamsData = cached.teams || {};
                    playersData = cached.players || {};
                    currentVersion = cached.version;
                    usedCache = true;
                    console.log('⚡ Using cached teams - ZERO BANDWIDTH!');
                }
            }
        }

        if (!usedCache) {
            console.log('☁️ Fetching teams from Firebase...');

            const [teamsSnap, playersSnap, versionSnap] = await Promise.all([
                database.ref('teams').once('value'),
                database.ref('players').once('value'),
                database.ref('data_version/teams').once('value')
            ]);

            teamsData = teamsSnap.val() || {};
            playersData = playersSnap.val() || {};
            currentVersion = versionSnap.val() || Date.now();

            saveTeamsToCache(teamsData, playersData, currentVersion);
            console.log('📥 Teams fetched from Firebase and cached');
        }

        allPlayersData = Object.entries(playersData).map(([id, player]) => ({
            id,
            ...player
        }));

        allTeams = Object.entries(teamsData).map(([id, team]) => ({
            id,
            ...team,
            players: allPlayersData.filter(p => p.team_id === id)
        }));

        const teamsCountEl = document.getElementById('teamsLoadedCount');
        const playersCountEl = document.getElementById('playersLoadedCount');

        if (teamsCountEl) teamsCountEl.innerText = allTeams.length > 0 ? '✓' : '0';
        if (playersCountEl) playersCountEl.innerText = allPlayersData.length;

        if (usedCache) {
            console.log(`✅ Teams loaded from cache: ${allTeams.length} teams, ${allPlayersData.length} players`);
        } else {
            console.log(`✅ Teams loaded from Firebase: ${allTeams.length} teams, ${allPlayersData.length} players`);
        }

    } catch (e) {
        console.error('Failed to load teams:', e);

        const cached = loadTeamsFromCache();
        if (cached && cached.teams) {
            console.log('📴 Using expired cache as fallback');

            allPlayersData = Object.entries(cached.players || {}).map(([id, player]) => ({
                id,
                ...player
            }));

            allTeams = Object.entries(cached.teams).map(([id, team]) => ({
                id,
                ...team,
                players: allPlayersData.filter(p => p.team_id === id)
            }));

            const teamsCountEl = document.getElementById('teamsLoadedCount');
            const playersCountEl = document.getElementById('playersLoadedCount');

            if (teamsCountEl) teamsCountEl.innerText = allTeams.length > 0 ? '⚠' : '0';
            if (playersCountEl) playersCountEl.innerText = allPlayersData.length;

            showToast('Using offline team data', 'error');
        } else {
            showToast('Failed to load teams', 'error');
        }
    }
}

async function forceRefreshTeams() {
    clearTeamsCache();
    await loadTeamsFromFirebase(true);
    showToast('Teams refreshed from server', 'success');
}

function updateTeamPlayers(batFlag, bowlFlag) {
    if (!batFlag || !bowlFlag) return;

    const battingTeam = allTeams.find(t =>
        t.short_name === batFlag || t.name === batFlag
    );

    const bowlingTeam = allTeams.find(t =>
        t.short_name === bowlFlag || t.name === bowlFlag
    );

    if (battingTeam && battingTeam.players) {
        battingPlayers = battingTeam.players.map(p => ({
            name: p.name || '',
            role: p.role || 'Batsman',
            isOut: matchState.dismissedPlayers.includes(p.name),
            isPlaying: false
        }));

        // Mark current batsmen as playing
        if (matchState.bat1.name) {
            const b1 = battingPlayers.find(p => p.name === matchState.bat1.name);
            if (b1) b1.isPlaying = true;
        }
        if (matchState.bat2.name) {
            const b2 = battingPlayers.find(p => p.name === matchState.bat2.name);
            if (b2) b2.isPlaying = true;
        }

        console.log(`🏏 Batting team: ${batFlag} (${battingPlayers.length} players)`);
    } else {
        battingPlayers = [];
        console.warn(`⚠️ Batting team not found: ${batFlag}`);
    }

    if (bowlingTeam && bowlingTeam.players) {
        bowlingPlayers = bowlingTeam.players.map(p => ({
            name: p.name || '',
            role: p.role || 'Bowler'
        }));
        console.log(`⚾ Bowling team: ${bowlFlag} (${bowlingPlayers.length} players)`);
    } else {
        bowlingPlayers = [];
        console.warn(`⚠️ Bowling team not found: ${bowlFlag}`);
    }

    const playersCountEl = document.getElementById('playersLoadedCount');
    if (playersCountEl) playersCountEl.innerText = battingPlayers.length;

    matchState.battingTeam = batFlag;
    matchState.bowlingTeam = bowlFlag;
}

// ==========================================
// TEAM VERSION LISTENER (Auto-Refresh)
// ==========================================
function setupTeamsVersionListener() {
    if (!database) return;

    addMatchValueListener('data_version/teams', async (snap) => {
        const serverVersion = snap.val() || 0;
        if (!serverVersion) return;

        if (currentTeamsVersion === 0) {
            currentTeamsVersion = serverVersion;
            return;
        }

        if (serverVersion !== currentTeamsVersion) {
            currentTeamsVersion = serverVersion;
            console.log('🔔 Team data updated by Team Manager, refreshing...');

            clearTeamsCache();
            await loadTeamsFromFirebase(true);

            if (matchState.battingTeam && matchState.bowlingTeam) {
                updateTeamPlayers(matchState.battingTeam, matchState.bowlingTeam);
            }

            showToast('Teams auto-updated!', 'success');
        }
    });
}

// ==========================================
// CONNECT TO MATCH (Firebase Realtime)
// ==========================================
async function connectToMatch() {
    try {
        if (!database) {
            showToast('Firebase not ready', 'error');
            return;
        }

        clearMatchListeners();
        stopPresenceRefresh();
        updateLoginDbStatus('connecting', 'Connecting to Match...');

        await loadTeamsFromFirebase();
        setupTeamsVersionListener();

        const myPresenceRef = database.ref(`presence/${matchId}/updater`);

        addMatchValueListener('.info/connected', (snapshot) => {
            if (snapshot.val()) {
                const wasConnected = isConnected;
                isConnected = true;

                myPresenceRef.onDisconnect().set({
                    online: false,
                    lastSeen: firebase.database.ServerValue.TIMESTAMP
                });

                myPresenceRef.set({
                    online: true,
                    lastSeen: firebase.database.ServerValue.TIMESTAMP,
                    name: scorerName,
                    version: '32.0',
                    pingMs: 0
                });

                showScorerScreen();
                startPresenceRefresh();
                updatePingDisplay();

                if (!wasConnected) {
                    showToast('Connected to match!', 'success');
                }

                const realtimeDot = document.getElementById('realtimeDot');
                const realtimeStatusText = document.getElementById('realtimeStatusText');
                if (realtimeDot) realtimeDot.className = 'conn-dot connected';
                if (realtimeStatusText) realtimeStatusText.innerText = 'Connected';
            } else {
                isConnected = false;
                stopPresenceRefresh();
                selfPingMs = null;
                updatePingDisplay();

                const realtimeDot = document.getElementById('realtimeDot');
                const realtimeStatusText = document.getElementById('realtimeStatusText');
                if (realtimeDot) realtimeDot.className = 'conn-dot offline';
                if (realtimeStatusText) realtimeStatusText.innerText = 'Offline';
            }
        });

        addMatchValueListener(`presence/${matchId}/admin`, (snap) => {
            const data = snap.val();
            adminOnline = data?.online || false;
            updateAdminStatus();
        });

        addMatchValueListener(`presence/${matchId}/scorebar`, (snap) => {
            const data = snap.val();
            scorebarOnline = data?.online || false;
            lastScorebarPingMs = data?.pingMs ?? null;
            updateScorebarStatus();
            updateScorebarPingDisplay();
        });

        addMatchValueListener(`matches/${matchId}/live`, (snap) => {
            const data = snap.val();
            if (data && data.timestamp) {
                // ✅ IMPORTANT: Team players first, then load state
                if (data.batFlag) {
                    updateTeamPlayers(data.batFlag, data.bowlFlag);
                }

                loadMatchState(data);
                rerenderOpenPopupLists();

                const lastAdminSync = document.getElementById('lastAdminSync');
                if (lastAdminSync) {
                    lastAdminSync.innerText = new Date().toLocaleTimeString();
                }
            }
        });

        addMatchValueListener(`matches/${matchId}/command`, (snap) => {
            const cmd = snap.val();
            if (!cmd || !cmd.ts) return;

            const cmdAge = Date.now() - cmd.ts;
            if (cmdAge > 5000) return;

            if (cmd.event === 'force_reload') {
                if (
                    cmd.payload?.target === 'updater' ||
                    cmd.payload?.target === 'scorer' ||
                    cmd.payload?.target === 'all'
                ) {
                    location.reload(true);
                }
            }
        });

    } catch (error) {
        console.error('❌ Failed to connect:', error);
        showToast('Failed to connect: ' + error.message, 'error');
    }
}

function showScorerScreen() {
    const loginScreen = document.getElementById('loginScreen');
    const scorerScreen = document.getElementById('scorerScreen');

    if (loginScreen) loginScreen.style.display = 'none';
    if (scorerScreen) scorerScreen.classList.add('active');

    const displayMatchId = document.getElementById('displayMatchId');
    const displayScorerName = document.getElementById('displayScorerName');
    const connMatchId = document.getElementById('connMatchId');

    if (displayMatchId) displayMatchId.innerText = matchId;
    if (displayScorerName) displayScorerName.innerText = scorerName;
    if (connMatchId) connMatchId.innerText = matchId;

    updateConnectionStatus();
}

function showLoginScreen() {
    const loginScreen = document.getElementById('loginScreen');
    const scorerScreen = document.getElementById('scorerScreen');

    if (loginScreen) loginScreen.style.display = 'flex';
    if (scorerScreen) scorerScreen.classList.remove('active');

    isConnected = false;
}

// ==========================================
// CONNECTION STATUS UI
// ==========================================
function updateConnectionStatus() {
    const realtimeDot = document.getElementById('realtimeDot');
    const realtimeText = document.getElementById('realtimeStatusText');

    if (realtimeDot && realtimeText) {
        if (isConnected) {
            realtimeDot.className = 'conn-dot connected';
            realtimeText.innerText = 'Connected';
        } else {
            realtimeDot.className = 'conn-dot connecting';
            realtimeText.innerText = 'Connecting...';
        }
    }

    const dbDot = document.getElementById('dbDot');
    const dbText = document.getElementById('dbStatusText');

    if (dbDot && dbText) {
        if (database) {
            dbDot.className = 'conn-dot connected';
            dbText.innerText = 'Connected';
        } else {
            dbDot.className = 'conn-dot error';
            dbText.innerText = 'Error';
        }
    }

    updateAdminStatus();
    updateScorebarStatus();
    updatePingDisplay();
    updateScorebarPingDisplay();
}

function updateAdminStatus() {
    const adminDot = document.getElementById('adminDot');
    const adminText = document.getElementById('adminStatusText');
    const adminPinDot = document.getElementById('adminPinDot');
    const adminPinText = document.getElementById('adminPinText');

    if (adminOnline) {
        if (adminDot) adminDot.className = 'conn-dot connected';
        if (adminText) adminText.innerText = 'Online';
        if (adminPinDot) adminPinDot.className = 'pin-dot online';
        if (adminPinText) adminPinText.innerText = 'Admin ✓';
    } else {
        if (adminDot) adminDot.className = 'conn-dot offline';
        if (adminText) adminText.innerText = 'Offline';
        if (adminPinDot) adminPinDot.className = 'pin-dot offline';
        if (adminPinText) adminPinText.innerText = 'Admin';
    }
}

function updateScorebarStatus() {
    const sbDot = document.getElementById('scorebarDot');
    const sbText = document.getElementById('scorebarStatusText');
    const sbPinDot = document.getElementById('scorebarPinDot');
    const sbPinText = document.getElementById('scorebarPinText');

    if (scorebarOnline) {
        if (sbDot) sbDot.className = 'conn-dot connected';
        if (sbText) sbText.innerText = 'Online';
        if (sbPinDot) sbPinDot.className = 'pin-dot online';
        if (sbPinText) sbPinText.innerText = 'ScoreBar ✓';
    } else {
        if (sbDot) sbDot.className = 'conn-dot offline';
        if (sbText) sbText.innerText = 'Offline';
        if (sbPinDot) sbPinDot.className = 'pin-dot offline';
        if (sbPinText) sbPinText.innerText = 'ScoreBar';
    }
}


// ==========================================
// 🆕 CHASE START POPUP
// ==========================================
function showChaseStartPopup(target, battingTeam) {
    const targetEl = document.getElementById('chasePopupTarget');
    const teamEl = document.getElementById('chasePopupBatTeam');
    const popup = document.getElementById('chaseStartPopup');

    if (targetEl) targetEl.innerText = target;
    if (teamEl) teamEl.innerText = `${battingTeam || 'BATTING TEAM'} NEEDS TO CHASE`;

    if (popup) {
        popup.classList.add('show');

        // Optional: Play a sound or vibrate
        if (navigator.vibrate) {
            navigator.vibrate([200, 100, 200]);
        }
    }

    showToast(`🎯 Chase Started! Target: ${target}`, 'success');
}

function closeChaseStartPopup() {
    const popup = document.getElementById('chaseStartPopup');
    if (popup) popup.classList.remove('show');
}

// ==========================================
// LOAD MATCH STATE
// ==========================================
// ==========================================
// LOAD MATCH STATE (Real-time sync from Admin)
// ==========================================
// ==========================================
// LOAD MATCH STATE (Remote Sync from Admin/Live)
// ==========================================
function loadMatchState(data) {
    if (!data) return;

    const newTarget = parseInt(data.target) || 0;
    const oldTarget = previousTarget;

    // Chase popup detect
    if (oldTarget === 0 && newTarget > 0) {
        showChaseStartPopup(newTarget, data.batFlag);
    }
    previousTarget = newTarget;

    matchState.runs = parseInt(data.runs) || 0;
    matchState.wkts = parseInt(data.wkts) || 0;
    matchState.overs = data.overs || '0.0';
    matchState.target = parseInt(data.target) || 0;
    matchState.totOvers = parseInt(data.totOvers) || 20;
    matchState.crr = data.crr || '0.00';
    matchState.striker = data.striker === '2' ? 2 : 1;
    matchState.isFreeHit = data.isFreeHit === true;
    matchState.partRuns = parseInt(data.partRuns) || 0;
    matchState.partBalls = parseInt(data.partBalls) || 0;

    if (data.dismissedPlayers && Array.isArray(data.dismissedPlayers)) {
        matchState.dismissedPlayers = [...data.dismissedPlayers];
    } else {
        matchState.dismissedPlayers = [];
    }

    if (data.bat1) {
        matchState.bat1 = {
            name: data.bat1.name || '',
            runs: parseInt(data.bat1.runs) || 0,
            balls: parseInt(data.bat1.balls) || 0,
            fours: parseInt(data.bat1.fours) || 0,
            sixes: parseInt(data.bat1.sixes) || 0,
            isOut: !!data.bat1.isOut
        };
    } else {
        matchState.bat1 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };
    }

    if (data.bat2) {
        matchState.bat2 = {
            name: data.bat2.name || '',
            runs: parseInt(data.bat2.runs) || 0,
            balls: parseInt(data.bat2.balls) || 0,
            fours: parseInt(data.bat2.fours) || 0,
            sixes: parseInt(data.bat2.sixes) || 0,
            isOut: !!data.bat2.isOut
        };
    } else {
        matchState.bat2 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };
    }

    if (data.bowler) {
        let bowlerOvers = '0.0';
        let bowlerRuns = 0;
        let bowlerWickets = 0;
        let bowlerBalls = 0;

        if (data.bowler.figs) {
            const figs = String(data.bowler.figs).trim().split(' ');
            const wr = (figs[0] || '0-0').split('-');
            bowlerWickets = parseInt(wr[0], 10) || 0;
            bowlerRuns = parseInt(wr[1], 10) || 0;
            bowlerOvers = figs[1] || '0.0';

            const ovParts = bowlerOvers.split('.');
            bowlerBalls = ((parseInt(ovParts[0], 10) || 0) * 6) + (parseInt(ovParts[1], 10) || 0);
        } else {
            bowlerOvers = data.bowler.overs || '0.0';
            bowlerRuns = parseInt(data.bowler.runs) || 0;
            bowlerWickets = parseInt(data.bowler.wickets) || 0;
            bowlerBalls = parseInt(data.bowler.balls) || 0;
        }

        matchState.bowler = {
            name: data.bowler.name || '',
            overs: bowlerOvers,
            runs: bowlerRuns,
            wickets: bowlerWickets,
            balls: bowlerBalls
        };
    } else {
        matchState.bowler = { name: '', overs: '0.0', runs: 0, wickets: 0, balls: 0 };
    }

    matchState.battingTeam = data.batFlag || '';
    matchState.bowlingTeam = data.bowlFlag || '';

    if (data.thisOver) {
        const overStr = String(data.thisOver).trim();
        matchState.thisOver = overStr ? overStr.split(' ').filter(Boolean) : [];
    } else {
        matchState.thisOver = [];
    }

    if (data.prevInnings) {
        matchState.prevInnings = data.prevInnings;
    } else {
        matchState.prevInnings = null;
    }

    matchState.balls = oversToBalls(matchState.overs);

    syncDismissedPlayers();
    updateDisplay();
}

// 🆕 Sync dismissed players to batting players array
function syncDismissedPlayers() {
    battingPlayers.forEach(player => {
        player.isOut = matchState.dismissedPlayers.includes(player.name);
        player.isPlaying = (player.name === matchState.bat1.name || player.name === matchState.bat2.name) && !player.isOut;
    });
}

// ==========================================
// 🆕 REFRESH OPEN POPUPS AFTER REMOTE SYNC
// ==========================================
function rerenderOpenPopupLists() {
    const playerPickerPopup = document.getElementById('playerPickerPopup');
    const newBatterPopup = document.getElementById('newBatterPopup');
    const bowlerPickerPopup = document.getElementById('bowlerPickerPopup');
    const nextBowlerPopup = document.getElementById('nextBowlerPopup');

    if (playerPickerPopup && playerPickerPopup.classList.contains('show')) {
        renderPlayerList();
    }

    if (newBatterPopup && newBatterPopup.classList.contains('show')) {
        renderNewBatterList();
    }

    if (bowlerPickerPopup && bowlerPickerPopup.classList.contains('show')) {
        renderBowlerPickerList();
    }

    if (nextBowlerPopup && nextBowlerPopup.classList.contains('show')) {
        renderNextBowlerList();
    }
}

// ==========================================
// UPDATE DISPLAY
// ==========================================
function updateDisplay() {
    const displayRuns = document.getElementById('displayRuns');
    const displayWkts = document.getElementById('displayWkts');
    const displayOvers = document.getElementById('displayOvers');
    const displayCrr = document.getElementById('displayCrr');
    const battingTeamBadge = document.getElementById('battingTeamBadge');

    if (displayRuns) displayRuns.innerText = matchState.runs;
    if (displayWkts) displayWkts.innerText = matchState.wkts;
    if (displayOvers) displayOvers.innerText = matchState.overs;
    if (displayCrr) displayCrr.innerText = matchState.crr;
    if (battingTeamBadge) battingTeamBadge.innerText = matchState.battingTeam || 'BAT';

    const targetDisplay = document.getElementById('targetDisplay');
    const targetValueMini = document.getElementById('targetValueMini');

    if (matchState.target > 0) {
        const need = matchState.target - matchState.runs;
        if (targetDisplay) targetDisplay.innerText = need > 0 ? `Need ${need} runs` : 'TARGET ACHIEVED!';
        if (targetValueMini) targetValueMini.innerText = matchState.target;
    } else {
        if (targetDisplay) targetDisplay.innerText = '';
        if (targetValueMini) targetValueMini.innerText = '--';
    }

    const partnershipValue = document.getElementById('partnershipValue');
    if (partnershipValue) {
        partnershipValue.innerText = `${matchState.partRuns} (${matchState.partBalls})`;
    }

    const lastBallValue = document.getElementById('lastBallValue');
    const lastBall = matchState.thisOver.length > 0 ? matchState.thisOver[matchState.thisOver.length - 1] : '--';
    if (lastBallValue) lastBallValue.innerText = lastBall;

    const freeHitBanner = document.getElementById('freeHitBanner');
    const freeHitChip = document.getElementById('freeHitChip');
    if (matchState.isFreeHit) {
        if (freeHitBanner) freeHitBanner.classList.add('show');
        if (freeHitChip) freeHitChip.classList.add('show');
    } else {
        if (freeHitBanner) freeHitBanner.classList.remove('show');
        if (freeHitChip) freeHitChip.classList.remove('show');
    }

    if (matchState.prevInnings) {
        const prevBox = document.getElementById('prevInningsBox');
        const prevInningsTeam = document.getElementById('prevInningsTeam');
        const prevInningsScore = document.getElementById('prevInningsScore');

        if (prevInningsTeam) prevInningsTeam.innerText = matchState.prevInnings.team || 'TEAM 1';
        if (prevInningsScore) {
            prevInningsScore.innerHTML =
                `${matchState.prevInnings.runs}/${matchState.prevInnings.wkts} <span>(${matchState.prevInnings.overs})</span>`;
        }
        if (prevBox) prevBox.classList.add('show');
    }

    renderOverBalls();
    updateBatsmenDisplay();
    updateBowlerDisplay();
    updateStrikerIndicator();
    updateTechPanel();
}

function renderOverBalls() {
    const container = document.getElementById('overBalls');
    if (!container) return;

    container.innerHTML = '';
    let legalBalls = 0;

    matchState.thisOver.forEach((ball, idx) => {
        const div = document.createElement('div');
        div.className = 'ball-slot';

        const ballUpper = ball.toUpperCase();

        if (ballUpper === '0' || ballUpper === '.') {
            div.classList.add('dot');
            div.innerText = '•';
        } else if (ballUpper === '4') {
            div.classList.add('four');
            div.innerText = '4';
        } else if (ballUpper === '6') {
            div.classList.add('six');
            div.innerText = '6';
        } else if (ballUpper.includes('W') && !ballUpper.includes('WD')) {
            div.classList.add('wicket');
            div.innerText = 'W';
        } else if (ballUpper.includes('WD')) {
            div.classList.add('wide');
            div.innerText = ballUpper;
        } else if (ballUpper.includes('NB')) {
            div.classList.add('noball');
            div.innerText = ballUpper;
        } else {
            div.classList.add('runs');
            div.innerText = ball;
        }

        if (idx === matchState.thisOver.length - 1) div.classList.add('last');

        // 🆕 Only count legal balls (not WD or NB)
        if (!ballUpper.includes('WD') && !ballUpper.includes('NB')) {
            legalBalls++;
        }

        container.appendChild(div);
    });

    // Fill remaining empty slots
    for (let i = legalBalls; i < 6; i++) {
        const div = document.createElement('div');
        div.className = 'ball-slot empty';
        container.appendChild(div);
    }
}

function updateBatsmenDisplay() {
    const b1Name = document.getElementById('b1Name');
    const b2Name = document.getElementById('b2Name');
    if (b1Name) b1Name.value = matchState.bat1.name || '';
    if (b2Name) b2Name.value = matchState.bat2.name || '';

    const b1Runs = document.getElementById('b1Runs');
    const b1Balls = document.getElementById('b1Balls');
    const b1Fours = document.getElementById('b1Fours');
    const b1Sixes = document.getElementById('b1Sixes');
    const b1SR = document.getElementById('b1SR');
    const b1Avatar = document.getElementById('b1Avatar');

    if (b1Runs) b1Runs.innerText = matchState.bat1.runs;
    if (b1Balls) b1Balls.innerText = matchState.bat1.balls;
    if (b1Fours) b1Fours.innerText = matchState.bat1.fours;
    if (b1Sixes) b1Sixes.innerText = matchState.bat1.sixes;
    if (b1SR) b1SR.innerText = matchState.bat1.balls > 0 ? ((matchState.bat1.runs / matchState.bat1.balls) * 100).toFixed(2) : '0.00';
    if (b1Avatar) b1Avatar.innerText = matchState.bat1.name ? matchState.bat1.name.charAt(0).toUpperCase() : '?';

    const b2Runs = document.getElementById('b2Runs');
    const b2Balls = document.getElementById('b2Balls');
    const b2Fours = document.getElementById('b2Fours');
    const b2Sixes = document.getElementById('b2Sixes');
    const b2SR = document.getElementById('b2SR');
    const b2Avatar = document.getElementById('b2Avatar');

    if (b2Runs) b2Runs.innerText = matchState.bat2.runs;
    if (b2Balls) b2Balls.innerText = matchState.bat2.balls;
    if (b2Fours) b2Fours.innerText = matchState.bat2.fours;
    if (b2Sixes) b2Sixes.innerText = matchState.bat2.sixes;
    if (b2SR) b2SR.innerText = matchState.bat2.balls > 0 ? ((matchState.bat2.runs / matchState.bat2.balls) * 100).toFixed(2) : '0.00';
    if (b2Avatar) b2Avatar.innerText = matchState.bat2.name ? matchState.bat2.name.charAt(0).toUpperCase() : '?';
}

function updateBowlerDisplay() {
    const bowlName = document.getElementById('bowlName');
    const bowlOvers = document.getElementById('bowlOvers');
    const bowlRuns = document.getElementById('bowlRuns');
    const bowlWickets = document.getElementById('bowlWickets');
    const bowlEcon = document.getElementById('bowlEcon');
    const bowlAvatar = document.getElementById('bowlAvatar');

    if (bowlName) bowlName.value = matchState.bowler.name || '';
    if (bowlOvers) bowlOvers.innerText = matchState.bowler.overs || '0.0';
    if (bowlRuns) bowlRuns.innerText = matchState.bowler.runs;
    if (bowlWickets) bowlWickets.innerText = matchState.bowler.wickets;

    const overs = parseFloat(matchState.bowler.overs) || 0;
    const econ = overs > 0 ? (matchState.bowler.runs / overs).toFixed(2) : '0.00';
    if (bowlEcon) bowlEcon.innerText = econ;
    if (bowlAvatar) bowlAvatar.innerText = matchState.bowler.name ? matchState.bowler.name.charAt(0).toUpperCase() : '?';
}

function updateStrikerIndicator() {
    const btn1 = document.getElementById('strikerBtn1');
    const btn2 = document.getElementById('strikerBtn2');
    const badge1 = document.getElementById('strikeBadge1');
    const badge2 = document.getElementById('strikeBadge2');

    if (matchState.striker === 1) {
        if (btn1) btn1.classList.add('active');
        if (btn2) btn2.classList.remove('active');
        if (badge1) badge1.classList.remove('hidden');
        if (badge2) badge2.classList.add('hidden');
    } else {
        if (btn1) btn1.classList.remove('active');
        if (btn2) btn2.classList.add('active');
        if (badge1) badge1.classList.add('hidden');
        if (badge2) badge2.classList.remove('hidden');
    }
}

function updateTechPanel() {
    const techLocalScore = document.getElementById('techLocalScore');
    const techChannel = document.getElementById('techChannel');
    const techMsgCount = document.getElementById('techMsgCount');
    const techPreviewJson = document.getElementById('techPreviewJson');

    if (techLocalScore) techLocalScore.innerText = `${matchState.runs}/${matchState.wkts} (${matchState.overs})`;
    if (techChannel) techChannel.innerText = matchId;
    if (techMsgCount) techMsgCount.innerText = messagesSent;
    if (techPreviewJson) techPreviewJson.innerText = JSON.stringify(matchState, null, 2);
}

// ==========================================
// HELPER: OVERS TO BALLS CONVERSION
// ==========================================
function oversToBalls(oversStr) {
    const parts = String(oversStr || '0.0').split('.');
    const o = parseInt(parts[0] || '0', 10);
    const b = parseInt(parts[1] || '0', 10);
    return o * 6 + b;
}

function ballsToOversString(totalBalls) {
    const ovs = Math.floor((totalBalls || 0) / 6);
    const balls = (totalBalls || 0) % 6;
    return `${ovs}.${balls}`;
}

// ==========================================
// 🆕 COUNT LEGAL BALLS IN CURRENT OVER
// ==========================================
function countLegalBallsInOver() {
    let count = 0;
    matchState.thisOver.forEach(ball => {
        const b = String(ball).toUpperCase();
        // WD and NB are NOT legal balls
        if (!b.includes('WD') && !b.includes('NB')) {
            count++;
        }
    });
    return count;
}

// ==========================================
// 🆕 CHECK IF OVER IS COMPLETE
// ==========================================
function isOverComplete() {
    return countLegalBallsInOver() >= 6;
}

// ==========================================
// GET AVAILABLE BATSMEN (Not Out)
// ==========================================
function getAvailableBatsmen() {
    const currentB1 = matchState.bat1.name;
    const currentB2 = matchState.bat2.name;

    return battingPlayers.filter(p => {
        if (!p.name) return false;
        if (p.isOut) return false;
        if (matchState.dismissedPlayers.includes(p.name)) return false;
        if (p.name === currentB1 || p.name === currentB2) return false;
        return true;
    });
}

// ==========================================
// CHECK IF INNINGS SHOULD END
// ==========================================
function shouldInningsEnd() {
    if (matchState.wkts >= 10) return 'allout';
    if (getAvailableBatsmen().length === 0 && matchState.wkts > 0) return 'allout';

    const ballsBowled = oversToBalls(matchState.overs);
    const maxBalls = matchState.totOvers * 6;
    if (ballsBowled >= maxBalls) return 'overs_complete';

    if (matchState.target > 0 && matchState.runs >= matchState.target) return 'target_achieved';

    return false;
}

// ==========================================
// BUILD RESULT CARD HTML
// ==========================================
function buildResultCardHtml() {
    let winnerName = '';
    let marginText = '';
    let detailsText = '';

    const defendedScore = Math.max((matchState.target || 1) - 1, 0);

    if (matchState.target > 0) {
        if (matchState.runs >= matchState.target) {
            winnerName = matchState.battingTeam || 'BATTING TEAM';
            const wktsLeft = Math.max(0, 10 - matchState.wkts);
            marginText = `WON BY ${wktsLeft} WICKET${wktsLeft === 1 ? '' : 'S'}`;
            detailsText = `${matchState.runs}/${matchState.wkts} • ${matchState.overs} OVERS`;
        } else {
            winnerName = matchState.bowlingTeam || 'BOWLING TEAM';
            const runsShort = Math.max(1, matchState.target - matchState.runs);
            marginText = `WON BY ${runsShort} RUN${runsShort === 1 ? '' : 'S'}`;
            detailsText = `DEFENDED ${defendedScore} • ${matchState.battingTeam} ${matchState.runs}/${matchState.wkts}`;
        }
    } else {
        winnerName = matchState.battingTeam || 'TEAM';
        marginText = 'MATCH FINISHED';
        detailsText = `${matchState.runs}/${matchState.wkts} • ${matchState.overs} OVERS`;
    }

    return `
        <div class="result-card-wrap">
            <div class="result-card-kicker">MATCH RESULT</div>
            <div class="result-card-winner">
                <span class="result-card-team">${winnerName}</span>
            </div>
            <div class="result-card-line">${marginText}</div>
            <div class="result-card-sub">${detailsText}</div>
        </div>
    `;
}

// ==========================================
// BUILD INNINGS OVER CARD HTML
// ==========================================
function buildInningsOverCardHtml() {
    const teamName = matchState.battingTeam || 'TEAM';
    const score = `${matchState.runs}/${matchState.wkts}`;
    const target = matchState.runs + 1;

    return `
        <div class="result-card-wrap">
            <div class="result-card-kicker">END OF INNINGS</div>
            <div class="result-card-winner">
                <span class="result-card-team">${teamName}</span>
                <span class="result-card-team">${score}</span>
            </div>
            <div class="result-card-line">TARGET ${target}</div>
            <div class="result-card-sub">${matchState.overs} OVERS</div>
        </div>
    `;
}

// ==========================================
// BUILD ALL OUT CARD HTML
// ==========================================
function buildAllOutCardHtml() {
    const teamName = matchState.battingTeam || 'TEAM';
    const score = `${matchState.runs}/${matchState.wkts}`;

    return `
        <div class="result-card-wrap">
            <div class="result-card-kicker">INNINGS OVER</div>
            <div class="result-card-winner">
                <span class="result-card-team">${teamName}</span>
                <span class="result-card-team">${score}</span>
            </div>
            <div class="result-card-line">ALL OUT</div>
            <div class="result-card-sub">${matchState.overs} OVERS</div>
        </div>
    `;
}

// ==========================================
// SEND SPECIAL OVERLAY TO SCOREBAR
// ==========================================
function sendSpecialOverlay(htmlContent, duration = 5000) {
    if (!database || !isConnected) return;

    console.log('📺 Sending special overlay to scorebar');

    const payload = buildUpdatePayload();
    payload.isSpecial = true;
    payload.specialText = htmlContent;

    database.ref(`matches/${matchId}/live`).update(payload);

    setTimeout(() => {
        hideSpecialOverlay();
    }, duration);

    messagesSent++;
    updateTechPanel();
}

// ==========================================
// HIDE SPECIAL OVERLAY
// ==========================================
function hideSpecialOverlay() {
    if (!database || !isConnected) return;

    const payload = buildUpdatePayload();
    payload.isSpecial = false;
    payload.specialText = '';

    database.ref(`matches/${matchId}/live`).update(payload);
}

// ==========================================
// SEND ALL OUT CARD
// ==========================================
function sendAllOutCard() {
    if (!database || !isConnected) return;

    console.log('📺 Sending All Out card to scorebar');

    const payload = buildUpdatePayload();
    payload.showAllOutCard = true;
    payload.allOutData = {
        teamName: matchState.battingTeam || 'TEAM',
        score: `${matchState.runs}/${matchState.wkts}`,
        overs: matchState.overs || '0.0'
    };

    database.ref(`matches/${matchId}/live`).update(payload);

    messagesSent++;
    updateTechPanel();
}

// ==========================================
// HANDLE MATCH END CONDITIONS
// ==========================================
function handleMatchEndConditions(afterHypeDelay = 0) {
    if (matchState.isMatchEnded) return;

    const endReason = shouldInningsEnd();
    if (!endReason) return;

    const delay = afterHypeDelay + CONFIG.TIMING.RESULT_DELAY;

    if (endReason === 'target_achieved') {
        matchState.isMatchEnded = true;
        console.log('🏆 Target achieved! Showing result card...');

        setTimeout(() => {
            sendSpecialOverlay(buildResultCardHtml(), 8000);
            showToast('🏆 Match Won!', 'success');
        }, delay);

    } else if (endReason === 'allout') {
        console.log('❌ All Out!');

        if (matchState.target > 0) {
            matchState.isMatchEnded = true;

            setTimeout(() => {
                sendSpecialOverlay(buildResultCardHtml(), 8000);
                showToast('Match Over - Defended!', 'success');
            }, delay);

        } else {
            setTimeout(() => {
                sendSpecialOverlay(buildInningsOverCardHtml(), 6000);
                showToast('Innings Over - All Out!', 'success');
            }, delay);
        }

    } else if (endReason === 'overs_complete') {
        console.log('⏱️ Overs completed!');

        if (matchState.target > 0 && matchState.runs < matchState.target) {
            matchState.isMatchEnded = true;

            setTimeout(() => {
                sendSpecialOverlay(buildResultCardHtml(), 8000);
                showToast('Match Over - Target Defended!', 'success');
            }, delay);

        } else if (matchState.target <= 0) {
            setTimeout(() => {
                sendSpecialOverlay(buildInningsOverCardHtml(), 6000);
                showToast('Innings Over!', 'success');
            }, delay);
        }
    }
}

// ==========================================
// 🆕 MARK PLAYER AS OUT
// ==========================================
function markPlayerAsOut(playerName) {
    if (!playerName) return;

    // Add to dismissed list if not already there
    if (!matchState.dismissedPlayers.includes(playerName)) {
        matchState.dismissedPlayers.push(playerName);
    }

    // Update batting players array
    const player = battingPlayers.find(p => p.name === playerName);
    if (player) {
        player.isOut = true;
        player.isPlaying = false;
    }

    console.log(`❌ Player marked as OUT: ${playerName}`);
}

// ==========================================
// SCORING ACTIONS
// ==========================================
function addBall(value) {
    if (lockStates.score || lockStates.full) {
        showToast('Scoring is locked', 'error');
        return;
    }

    if (matchState.isMatchEnded) {
        showToast('Match has ended!', 'error');
        return;
    }

    if (matchState.target > 0 && matchState.runs >= matchState.target) {
        showToast('Target already achieved!', 'error');
        return;
    }

    if (matchState.wkts >= 10) {
        showToast('Innings over - All Out!', 'error');
        return;
    }

    const currentBalls = oversToBalls(matchState.overs);
    const maxBalls = matchState.totOvers * 6;
    if (currentBalls >= maxBalls) {
        showToast('Overs completed!', 'error');
        return;
    }

    const val = String(value).toUpperCase();
    const runs = parseInt(val) || 0;

    // 🆕 Check if WD or NB (not legal balls)
    const isWide = val.includes('WD');
    const isNoBall = val.includes('NB');
    const isLegal = !isWide && !isNoBall;

    matchState.thisOver.push(val);
    matchState.runs += runs;

    if (isLegal) {
        matchState.balls++;
        const striker = matchState.striker === 1 ? matchState.bat1 : matchState.bat2;
        striker.balls++;
        striker.runs += runs;

        if (runs === 4) striker.fours++;
        if (runs === 6) striker.sixes++;

        matchState.partBalls++;
        matchState.partRuns += runs;

        if (runs % 2 === 1) matchState.striker = matchState.striker === 1 ? 2 : 1;

        updateOvers();
        matchState.isFreeHit = false;

        // Update bowler
        matchState.bowler.balls++;
        updateBowlerOvers();
    } else {
        // Wide or No Ball - add 1 extra run
        matchState.runs++;
        matchState.partRuns++;

        // For NB with runs (e.g., NB4), add batter runs
        if (isNoBall) {
            matchState.isFreeHit = true;
            const striker = matchState.striker === 1 ? matchState.bat1 : matchState.bat2;
            if (runs > 0) {
                striker.runs += runs;
                if (runs === 4) striker.fours++;
                if (runs === 6) striker.sixes++;
            }
        }
    }

    // Add runs to bowler
    matchState.bowler.runs += runs + (isLegal ? 0 : 1);

    calculateCRR();
    updateDisplay();
    sendUpdate();

    // Send hype and track delay
    let hypeDelay = 0;
    if (runs === 4) {
        sendHype('FOUR');
        hypeDelay = CONFIG.TIMING.HYPE_FOUR;
    } else if (runs === 6) {
        sendHype('SIX');
        hypeDelay = CONFIG.TIMING.HYPE_SIX;
    }

    // Check match end conditions
    handleMatchEndConditions(hypeDelay);

    // 🆕 AUTO BOWLER POPUP: Check if over is complete (6 legal balls)
    if (isOverComplete()) {
        console.log('🎯 Over complete! Opening next bowler popup...');
        setTimeout(() => {
            openNextBowlerPopup();
        }, CONFIG.TIMING.AUTO_BOWLER_POPUP_DELAY);
    }
}

function addCustomBall() {
    const input = document.getElementById('customBallInput');
    const value = input.value.trim();
    if (!value) return;
    addBall(value);
    input.value = '';
}

function undoBall() {
    if (lockStates.score || lockStates.full) return showToast('Scoring is locked', 'error');
    if (matchState.thisOver.length === 0) return showToast('No balls to undo', 'error');

    matchState.isMatchEnded = false;
    hideSpecialOverlay();

    const lastBall = matchState.thisOver.pop();
    const val = lastBall.toUpperCase();
    const runs = parseInt(val) || 0;

    const isWide = val.includes('WD');
    const isNoBall = val.includes('NB');
    const isLegal = !isWide && !isNoBall;

    matchState.runs -= runs;

    if (isLegal) {
        matchState.balls--;
        const striker = matchState.striker === 1 ? matchState.bat1 : matchState.bat2;
        striker.balls--;
        striker.runs -= runs;

        if (runs === 4) striker.fours--;
        if (runs === 6) striker.sixes--;

        matchState.partBalls--;
        matchState.partRuns -= runs;

        if (runs % 2 === 1) matchState.striker = matchState.striker === 1 ? 2 : 1;

        matchState.bowler.balls--;
        updateBowlerOvers();
        updateOvers();
    } else {
        matchState.runs--;
        matchState.partRuns--;

        if (isNoBall && runs > 0) {
            const striker = matchState.striker === 1 ? matchState.bat1 : matchState.bat2;
            striker.runs -= runs;
            if (runs === 4) striker.fours--;
            if (runs === 6) striker.sixes--;
        }
    }

    matchState.bowler.runs -= runs + (isLegal ? 0 : 1);

    calculateCRR();
    updateDisplay();
    sendUpdate();
    showToast('Ball undone', 'success');
}

function clearOver() {
    if (lockStates.score || lockStates.full) return showToast('Scoring is locked', 'error');
    if (matchState.thisOver.length === 0) return showToast('Over is empty', 'error');
    while (matchState.thisOver.length > 0) undoBall();
    showToast('Over cleared', 'success');
}

function swapStriker() {
    if (lockStates.batsmen || lockStates.full) return showToast('Batsmen locked', 'error');
    matchState.striker = matchState.striker === 1 ? 2 : 1;
    updateDisplay();
    sendUpdate();
    showToast('Striker swapped', 'success');
}

function endOver() {
    if (lockStates.score || lockStates.full) return showToast('Scoring is locked', 'error');

    const legalBalls = countLegalBallsInOver();

    if (legalBalls < 6) {
        return showToast(`Only ${legalBalls} legal balls bowled`, 'error');
    }

    openNextBowlerPopup();
}

function updateOvers() {
    const fullOvers = Math.floor(matchState.balls / 6);
    const ballsInOver = matchState.balls % 6;
    matchState.overs = `${fullOvers}.${ballsInOver}`;
}

function updateBowlerOvers() {
    const bowlerBalls = matchState.bowler.balls || 0;
    const bowlerFullOvers = Math.floor(bowlerBalls / 6);
    const bowlerBallsInOver = bowlerBalls % 6;
    matchState.bowler.overs = `${bowlerFullOvers}.${bowlerBallsInOver}`;
}

function calculateCRR() {
    const overs = parseFloat(matchState.overs) || 0;
    if (overs > 0) {
        const fullOvers = Math.floor(overs);
        const balls = Math.round((overs % 1) * 10);
        const totalOvers = fullOvers + (balls / 6);
        matchState.crr = (matchState.runs / totalOvers).toFixed(2);
    } else {
        matchState.crr = '0.00';
    }
}

// ==========================================
// POPUPS
// ==========================================
function openExtrasPopup(type) {
    currentExtrasType = type;
    document.getElementById('extrasTitle').innerText = type === 'Wd' ? 'Wide' : 'No Ball';
    document.getElementById('extrasType').innerText = type === 'Wd' ? 'Wide' : 'No Ball';
    document.getElementById('extrasPopup').classList.add('show');
}

function closeExtrasPopup() {
    document.getElementById('extrasPopup').classList.remove('show');
    currentExtrasType = '';
}

function confirmExtras(extraRuns) {
    addBall(currentExtrasType + (extraRuns > 0 ? extraRuns : ''));
    closeExtrasPopup();
}

function openWicketPopup() {
    if (lockStates.score || lockStates.full) return showToast('Scoring is locked', 'error');

    if (matchState.isMatchEnded) {
        showToast('Match has ended!', 'error');
        return;
    }

    document.getElementById('wicketPopup').classList.add('show');
}

function closeWicketPopup() {
    document.getElementById('wicketPopup').classList.remove('show');
}

// ==========================================
// 🆕 CONFIRM WICKET (With Fade Effect + Auto All Out)
// ==========================================
function confirmWicket(type) {
    closeWicketPopup();

    matchState.thisOver.push('W');
    matchState.wkts++;
    matchState.balls++;

    const strikerSlot = matchState.striker === 1 ? 'bat1' : 'bat2';
    const striker = matchState[strikerSlot];
    striker.balls++;

    // 🆕 Mark striker as OUT (for scorebar fade effect)
    const outBatterName = striker.name;
    striker.isOut = true;
    markPlayerAsOut(outBatterName);

    // Increment bowler wickets (except run out)
    if (type !== 'Run Out') {
        matchState.bowler.wickets++;
    }
    matchState.bowler.balls++;
    updateBowlerOvers();

    // Reset partnership
    matchState.partRuns = 0;
    matchState.partBalls = 0;

    updateOvers();
    calculateCRR();
    updateDisplay();

    // 🆕 Send update with isOut flag for scorebar fade effect
    sendUpdate();

    // Send WICKET hype
    sendHype('WICKET');

    // Check if all out or no available batsmen
    const availableBatsmen = getAvailableBatsmen();

    // 🆕 Check if over will be complete after this wicket
    const legalBallsAfterWicket = countLegalBallsInOver();
    pendingBowlerPopup = legalBallsAfterWicket >= 6;

    if (matchState.wkts >= 10 || availableBatsmen.length === 0) {
        // All out - no new batter popup needed
        console.log('❌ All Out - No batsmen available');

        // Clear the out batter's slot
        matchState[strikerSlot] = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };

        // Switch striker to non-striker (who is not out)
        matchState.striker = matchState.striker === 1 ? 2 : 1;

        updateDisplay();
        sendUpdate();

        // Handle end conditions after wicket hype
        setTimeout(() => {
            handleMatchEndConditions(0);
        }, CONFIG.TIMING.HYPE_WICKET);

        showToast('All Out! Innings Over', 'error');
        return;
    }

    // Open new batter popup after wicket animation
    setTimeout(() => {
        openNewBatterPopup();
    }, CONFIG.TIMING.HYPE_WICKET);
}

// ==========================================
// PLAYER PICKERS
// ==========================================
function openPlayerPicker(slot) {
    if (lockStates.batsmen || lockStates.full) return showToast('Batsmen locked', 'error');
    currentPickerSlot = slot;
    document.getElementById('playerPickerTitle').innerText = `Select Batter ${slot}`;
    renderPlayerList();
    document.getElementById('playerPickerPopup').classList.add('show');
}

function closePlayerPicker() {
    document.getElementById('playerPickerPopup').classList.remove('show');
    currentPickerSlot = 0;
}

// 🆕 RENDER PLAYER LIST WITH OUT BADGE
function renderPlayerList() {
    const container = document.getElementById('playerPickerList');
    document.getElementById('playerSearchInput').value = '';
    container.innerHTML = '';

    if (battingPlayers.length === 0) {
        container.innerHTML = '<div class="empty-text">No players loaded. Sync from admin.</div>';
        return;
    }

    battingPlayers.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';

        const isOut = player.isOut || matchState.dismissedPlayers.includes(player.name);
        const isCurrentB1 = matchState.bat1.name === player.name;
        const isCurrentB2 = matchState.bat2.name === player.name;
        const isPlaying = (isCurrentB1 || isCurrentB2) && !isOut;

        // 🆕 Disable OUT players and currently playing
        if (isOut || isPlaying) {
            div.classList.add('disabled');
        }

        div.innerHTML = `
            <div class="picker-avatar">${player.name.charAt(0).toUpperCase()}</div>
            <div style="flex: 1; margin-left: 12px;">
                <div class="player-name-row">
                    <span class="player-name">${player.name}</span>
                    ${isOut ? '<span class="out-badge">OUT</span>' : ''}
                    ${isCurrentB1 && !isOut ? '<span class="out-badge playing">B1</span>' : ''}
                    ${isCurrentB2 && !isOut ? '<span class="out-badge playing">B2</span>' : ''}
                </div>
                <div class="player-role">${player.role}</div>
            </div>`;

        // Only add click handler if not out and not playing
        if (!isOut && !isPlaying) {
            div.onclick = () => selectBatter(player);
        }

        container.appendChild(div);
    });
}

function filterPlayerList() {
    const search = document.getElementById('playerSearchInput').value.toLowerCase();
    document.querySelectorAll('#playerPickerList .player-item').forEach(item => {
        item.style.display = item.querySelector('.player-name').innerText.toLowerCase().includes(search) ? 'flex' : 'none';
    });
}

function selectBatter(player) {
    if (currentPickerSlot === 1) {
        matchState.bat1 = { name: player.name, runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };
    } else {
        matchState.bat2 = { name: player.name, runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };
    }

    // Mark as playing
    const p = battingPlayers.find(bp => bp.name === player.name);
    if (p) p.isPlaying = true;

    closePlayerPicker();
    updateDisplay();
    sendUpdate();
    showToast(`${player.name} selected`, 'success');
}

// ==========================================
// NEW BATTER POPUP
// ==========================================
function openNewBatterPopup() {
    renderNewBatterList();
    document.getElementById('newBatterPopup').classList.add('show');
}

function closeNewBatterPopup() {
    document.getElementById('newBatterPopup').classList.remove('show');
}

// 🆕 RENDER NEW BATTER LIST WITH OUT BADGE
function renderNewBatterList() {
    const container = document.getElementById('newBatterList');
    document.getElementById('newBatterSearchInput').value = '';
    container.innerHTML = '';

    if (battingPlayers.length === 0) {
        container.innerHTML = '<div class="empty-text">No players loaded.</div>';
        return;
    }

    battingPlayers.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';

        const isOut = player.isOut || matchState.dismissedPlayers.includes(player.name);
        const isCurrentB1 = matchState.bat1.name === player.name && !matchState.bat1.isOut;
        const isCurrentB2 = matchState.bat2.name === player.name && !matchState.bat2.isOut;

        // 🆕 Disable OUT players and currently playing batsmen
        if (isOut || isCurrentB1 || isCurrentB2) {
            div.classList.add('disabled');
        }

        div.innerHTML = `
            <div class="picker-avatar">${player.name.charAt(0).toUpperCase()}</div>
            <div style="flex: 1; margin-left: 12px;">
                <div class="player-name-row">
                    <span class="player-name">${player.name}</span>
                    ${isOut ? '<span class="out-badge">OUT</span>' : ''}
                    ${isCurrentB1 ? '<span class="out-badge playing">B1</span>' : ''}
                    ${isCurrentB2 ? '<span class="out-badge playing">B2</span>' : ''}
                </div>
                <div class="player-role">${player.role}</div>
            </div>`;

        // Only add click handler if available
        if (!isOut && !isCurrentB1 && !isCurrentB2) {
            div.onclick = () => selectNewBatter(player);
        }

        container.appendChild(div);
    });
}

function filterNewBatterList() {
    const search = document.getElementById('newBatterSearchInput').value.toLowerCase();
    document.querySelectorAll('#newBatterList .player-item').forEach(item => {
        item.style.display = item.querySelector('.player-name').innerText.toLowerCase().includes(search) ? 'flex' : 'none';
    });
}

// ==========================================
// 🆕 SELECT NEW BATTER (With Full Profile Card)
// ==========================================
function selectNewBatter(player) {
    if (!player || !player.name) {
        showToast('Invalid player', 'error');
        return;
    }

    console.log('🏏 selectNewBatter called:', player.name);

    // Assign new batter to striker position
    const newBatterData = {
        name: player.name,
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        isOut: false
    };

    if (matchState.striker === 1) {
        matchState.bat1 = newBatterData;
    } else {
        matchState.bat2 = newBatterData;
    }

    // Mark new batter as playing
    const newPlayer = battingPlayers.find(p => p.name === player.name);
    if (newPlayer) {
        newPlayer.isPlaying = true;
    }

    closeNewBatterPopup();
    updateDisplay();
    sendUpdate();

    // 🆕 Send FULL profile card command
    sendNewBatterProfile(player.name);

    showToast(`${player.name} - Profile sent to scorebar`, 'success');

    // 🆕 If over was complete when wicket fell, show bowler popup after profile
    if (pendingBowlerPopup) {
        pendingBowlerPopup = false;
        setTimeout(() => {
            openNextBowlerPopup();
        }, CONFIG.TIMING.PROFILE_DURATION + 500);
    }
}

// ==========================================
// BOWLER PICKER
// ==========================================
function openBowlerPicker() {
    if (lockStates.bowler || lockStates.full) return showToast('Bowler locked', 'error');
    renderBowlerPickerList();
    document.getElementById('bowlerPickerPopup').classList.add('show');
}

function closeBowlerPicker() {
    document.getElementById('bowlerPickerPopup').classList.remove('show');
}

function renderBowlerPickerList() {
    const container = document.getElementById('bowlerPickerList');
    document.getElementById('bowlerPickerSearchInput').value = '';
    container.innerHTML = '';

    if (bowlingPlayers.length === 0) {
        container.innerHTML = '<div class="empty-text">No bowlers loaded.</div>';
        return;
    }

    bowlingPlayers.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        const isCurrent = matchState.bowler.name === player.name;

        div.innerHTML = `
            <div class="picker-avatar">${player.name.charAt(0).toUpperCase()}</div>
            <div style="flex: 1; margin-left: 12px;">
                <div class="player-name-row">
                    <span class="player-name">${player.name}</span>
                    ${isCurrent ? '<span class="out-badge playing">BOWLING</span>' : ''}
                </div>
                <div class="player-role">${player.role}</div>
            </div>`;
        div.onclick = () => selectBowler(player);
        container.appendChild(div);
    });
}

function filterBowlerPickerList() {
    const search = document.getElementById('bowlerPickerSearchInput').value.toLowerCase();
    document.querySelectorAll('#bowlerPickerList .player-item').forEach(item => {
        item.style.display = item.querySelector('.player-name').innerText.toLowerCase().includes(search) ? 'flex' : 'none';
    });
}

function selectBowler(player) {
    if (matchState.bowler.name) {
        bowlerHistory.push({ ...matchState.bowler });
        updateBowlerHistoryDisplay();
    }
    matchState.bowler = { name: player.name, overs: '0.0', runs: 0, wickets: 0, balls: 0 };
    closeBowlerPicker();
    updateDisplay();
    sendUpdate();
    showToast(`${player.name} is bowling`, 'success');
}

// ==========================================
// NEXT BOWLER (End Over)
// ==========================================
function openNextBowlerPopup() {
    selectedNextBowler = null;
    renderNextBowlerList();
    document.getElementById('nextBowlerPopup').classList.add('show');
}

function closeNextBowlerPopup() {
    document.getElementById('nextBowlerPopup').classList.remove('show');
    selectedNextBowler = null;
}

function renderNextBowlerList() {
    const container = document.getElementById('nextBowlerList');
    document.getElementById('bowlerSearchInput').value = '';
    container.innerHTML = '';

    if (bowlingPlayers.length === 0) {
        container.innerHTML = '<div class="empty-text">No bowlers loaded.</div>';
        return;
    }

    bowlingPlayers.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        const isCurrent = matchState.bowler.name === player.name;

        div.innerHTML = `
            <div class="picker-avatar">${player.name.charAt(0).toUpperCase()}</div>
            <div style="flex: 1; margin-left: 12px;">
                <div class="player-name-row">
                    <span class="player-name">${player.name}</span>
                    ${isCurrent ? '<span class="out-badge">JUST BOWLED</span>' : ''}
                </div>
                <div class="player-role">${player.role}</div>
            </div>`;

        div.onclick = () => {
            container.querySelectorAll('.player-item').forEach(i => i.classList.remove('selecting'));
            div.classList.add('selecting');
            selectedNextBowler = player;
        };
        container.appendChild(div);
    });
}

function filterNextBowlerList() {
    const search = document.getElementById('bowlerSearchInput').value.toLowerCase();
    document.querySelectorAll('#nextBowlerList .player-item').forEach(item => {
        item.style.display = item.querySelector('.player-name').innerText.toLowerCase().includes(search) ? 'flex' : 'none';
    });
}

function confirmNextBowler() {
    if (!selectedNextBowler) return showToast('Please select a bowler', 'error');

    if (matchState.bowler.name) {
        bowlerHistory.push({ ...matchState.bowler });
        updateBowlerHistoryDisplay();
    }

    // 🆕 Clear over and swap striker
    matchState.thisOver = [];
    matchState.striker = matchState.striker === 1 ? 2 : 1;
    matchState.bowler = { name: selectedNextBowler.name, overs: '0.0', runs: 0, wickets: 0, balls: 0 };

    closeNextBowlerPopup();
    updateDisplay();
    sendUpdate();
    showToast('New over started', 'success');
}

function updateBowlerHistoryDisplay() {
    const container = document.getElementById('bowlerHistoryList');
    if (!container) return;
    if (bowlerHistory.length === 0) {
        container.innerHTML = '<div class="empty-text">No previous bowlers</div>';
        return;
    }

    container.innerHTML = bowlerHistory.map(b => `
        <div class="player-item" style="cursor: default;">
            <div class="picker-avatar">${b.name.charAt(0).toUpperCase()}</div>
            <div style="flex: 1; margin-left: 12px;">
                <span class="player-name">${b.name}</span>
                <span class="player-role">${b.wickets}-${b.runs} (${b.overs})</span>
            </div>
        </div>
    `).join('');
}

// ==========================================
// STRIKER CONTROL & LOCK STATES
// ==========================================
function setStriker(num) {
    if (lockStates.batsmen || lockStates.full) return showToast('Batsmen locked', 'error');
    matchState.striker = num;
    updateDisplay();
    sendUpdate();
}

function toggleLockState(type) {
    lockStates[type] = !lockStates[type];
    const btn = document.getElementById(`lock${type.charAt(0).toUpperCase() + type.slice(1)}Btn`);

    if (lockStates[type]) {
        btn.classList.add('active');
        btn.innerHTML = btn.innerHTML.replace('🔓', '🔒');
        if (type === 'score' || type === 'full') {
            document.getElementById('scoreSectionLite').classList.add('section-locked');
            document.getElementById('actionsSectionLite').classList.add('section-locked');
        }
        if (type === 'batsmen' || type === 'full') document.getElementById('batsmenSectionLite').classList.add('section-locked');
        if (type === 'bowler' || type === 'full') document.getElementById('bowlerSectionLite').classList.add('section-locked');
    } else {
        btn.classList.remove('active');
        btn.innerHTML = btn.innerHTML.replace('🔒', '🔓');
        if (type === 'score') {
            document.getElementById('scoreSectionLite').classList.remove('section-locked');
            document.getElementById('actionsSectionLite').classList.remove('section-locked');
        }
        if (type === 'batsmen') document.getElementById('batsmenSectionLite').classList.remove('section-locked');
        if (type === 'bowler') document.getElementById('bowlerSectionLite').classList.remove('section-locked');
        if (type === 'full') {
            document.querySelectorAll('.section-locked').forEach(el => el.classList.remove('section-locked'));
        }
    }
    showToast(`${type} ${lockStates[type] ? 'locked' : 'unlocked'}`, 'success');
}

// ==========================================
// SEND COMMAND
// ==========================================
function sendCommand(event, payload = {}, force = false) {
    if (!database || !isConnected) {
        console.warn('Cannot send command - not connected');
        return;
    }

    if (!autoRealtimeEnabled && !force) {
        pendingCommandQueue.push({ event, payload });
        setPendingManualPush(true);
        console.log('📦 Queued command:', event);
        return;
    }

    const cmd = {
        event,
        payload,
        ts: firebase.database.ServerValue.TIMESTAMP
    };

    database.ref(`matches/${matchId}/command`).set(cmd);

    messagesSent++;
    updateTechPanel();
    console.log('📤 Command sent:', event);
}

// ==========================================
// SEND NEW BATTER PROFILE
// ==========================================
function sendNewBatterProfile(playerName) {
    if (!database || !isConnected) {
        console.warn('Cannot send profile - not connected');
        return;
    }

    if (!playerName) {
        console.warn('No player name provided');
        return;
    }

    const fullPlayerData = allPlayersData.find(p => p.name === playerName);
    const battingPlayer = battingPlayers.find(p => p.name === playerName);

    const playerPhoto = fullPlayerData?.photo_url || fullPlayerData?.photo_base64 || '';
    const playerRole = fullPlayerData?.role || battingPlayer?.role || 'NEW BATSMAN';
    const playerSchool = fullPlayerData?.school || '';
    const playerAge = fullPlayerData?.age || '';

    console.log('🏏 Sending new batter profile:', {
        name: playerName,
        photo: playerPhoto ? 'yes' : 'no',
        role: playerRole,
        school: playerSchool,
        age: playerAge
    });

    sendCommand('show_profile', {
        name: playerName,
        photo: playerPhoto,
        role: playerRole,
        school: playerSchool,
        age: playerAge
    });
}

function sendUpcomingBatter(name) {
    sendNewBatterProfile(name);
}

// ==========================================
// 🆕 BUILD UPDATE PAYLOAD (with isOut flags)
function buildUpdatePayload() {
    calculateCRR();

    return {
        timestamp: firebase.database.ServerValue.TIMESTAMP,

        runs: matchState.runs,
        wkts: matchState.wkts,
        overs: matchState.overs,
        crr: matchState.crr,

        target: matchState.target,
        totOvers: matchState.totOvers,

        striker: String(matchState.striker),
        isFreeHit: matchState.isFreeHit,

        thisOver: matchState.thisOver.join(' '),

        partRuns: matchState.partRuns,
        partBalls: matchState.partBalls,

        batFlag: matchState.battingTeam,
        bowlFlag: matchState.bowlingTeam,

        bat1: {
            name: matchState.bat1.name || '',
            runs: matchState.bat1.runs || 0,
            balls: matchState.bat1.balls || 0,
            fours: matchState.bat1.fours || 0,
            sixes: matchState.bat1.sixes || 0,
            isOut: matchState.bat1.isOut || false
        },

        bat2: {
            name: matchState.bat2.name || '',
            runs: matchState.bat2.runs || 0,
            balls: matchState.bat2.balls || 0,
            fours: matchState.bat2.fours || 0,
            sixes: matchState.bat2.sixes || 0,
            isOut: matchState.bat2.isOut || false
        },

        bowler: {
            name: matchState.bowler.name || '',
            figs: `${matchState.bowler.wickets}-${matchState.bowler.runs} ${matchState.bowler.overs}`,
            overs: matchState.bowler.overs || '0.0',
            runs: matchState.bowler.runs || 0,
            wickets: matchState.bowler.wickets || 0,
            balls: matchState.bowler.balls || 0
        },

        dismissedPlayers: [...matchState.dismissedPlayers]
    };
}
// ==========================================
// SEND UPDATES TO FIREBASE (Full sync)
// ==========================================
// ==========================================
// SEND UPDATES TO FIREBASE
// ==========================================
function sendUpdate(force = false) {
    if (!database || !isConnected) return;

    const payload = buildUpdatePayload();

    if (!autoRealtimeEnabled && !force) {
        setPendingManualPush(true);
        return;
    }

    Promise.all([
        database.ref(`matches/${matchId}/scorer_update`).set(payload),
        database.ref(`matches/${matchId}/live`).update(payload)
    ])
        .then(() => {
            setPendingManualPush(false);
            refreshUpdaterPresence();
            console.log('📤 Sent to Firebase:', {
                score: `${matchState.runs}/${matchState.wkts}`,
                overs: matchState.overs
            });
        })
        .catch((err) => {
            console.error('Send failed:', err);
            showToast('Push failed', 'error');
        });

    messagesSent++;
    updateTechPanel();
}

function sendHype(type) {
    sendCommand('trigger_hype', { type });
}

function syncFromAdmin() {
    if (!database || !isConnected) return showToast('Not connected', 'error');

    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) syncBtn.classList.add('syncing');

    Promise.all([
        database.ref(`matches/${matchId}/live`).once('value'),
        loadTeamsFromFirebase(true)
    ])
        .then(([liveSnap]) => {
            const data = liveSnap.val();
            if (data) {
                if (data.batFlag) updateTeamPlayers(data.batFlag, data.bowlFlag);
                loadMatchState(data);
                rerenderOpenPopupLists();
                showToast('Synced from admin/server', 'success');
            }
            if (syncBtn) syncBtn.classList.remove('syncing');
        })
        .catch(() => {
            if (syncBtn) syncBtn.classList.remove('syncing');
            showToast('Sync failed', 'error');
        });
}

function reconnectAll() {
    showToast('Reconnecting...', 'success');
    connectToMatch();
}

// ==========================================
// UI TOGGLES
// ==========================================
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tabName) btn.classList.add('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    const tab = document.getElementById('tab-' + tabName);
    if (tab) tab.classList.add('active');
}

function toggleConnPanel() {
    const details = document.getElementById('connDetails');
    if (!details) return;
    details.classList.toggle('show');
    const icon = document.getElementById('connExpandIcon');
    if (icon) icon.innerText = details.classList.contains('show') ? '▲' : '▼';
}

function toggleTechPanel() {
    const content = document.getElementById('techContent');
    if (!content) return;
    content.classList.toggle('show');
    const icon = document.getElementById('techExpandIcon');
    if (icon) icon.innerText = content.classList.contains('show') ? '▲' : '▼';
}

// ==========================================
// DISCONNECT & RESET
// ==========================================
function showDisconnectConfirm() {
    document.getElementById('disconnectPopup').classList.add('show');
}

function closeDisconnectPopup() {
    document.getElementById('disconnectPopup').classList.remove('show');
}

function disconnectMatch() {
    closeDisconnectPopup();

    stopPresenceRefresh();
    clearMatchListeners();

    if (database && matchId) {
        database.ref(`presence/${matchId}/updater`).set({
            online: false,
            lastSeen: firebase.database.ServerValue.TIMESTAMP,
            name: scorerName || '',
            version: '32.0',
            pingMs: 0
        });
    }

    selfPingMs = null;
    updatePingDisplay();

    lastScorebarPingMs = null;
    updateScorebarPingDisplay();

    isConnected = false;
    showLoginScreen();
    showToast('Disconnected', 'success');
}

// ==========================================
// NEW RESET POPUP LOGIC
// ==========================================
// ==========================================
// NEW RESET POPUP LOGIC (Fixed Reference)
// ==========================================
// මේකෙන් තමයි දැන් අලුත් Popup එක Open වෙන්නේ
function resetScorerMatch() {
    if (lockStates.full) return showToast('Safe mode is on', 'error');
    document.getElementById('resetConfirmPopup').classList.add('show');
}

function closeResetPopup() {
    document.getElementById('resetConfirmPopup').classList.remove('show');
}

// මේකෙන් තමයි ඇත්තටම Reset එක වෙන්නේ (Confirm කරාම)
function executeResetMatch() {
    closeResetPopup(); // Hide popup

    matchState = {
        runs: 0, wkts: 0, overs: '0.0', balls: 0, thisOver: [], target: 0,
        totOvers: matchState.totOvers || 20, crr: '0.00', striker: 1, isFreeHit: false,
        partRuns: 0, partBalls: 0,
        bat1: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
        bat2: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
        bowler: { name: '', overs: '0.0', runs: 0, wickets: 0, balls: 0 },
        battingTeam: matchState.battingTeam || '',
        bowlingTeam: matchState.bowlingTeam || '',
        prevInnings: null, isMatchEnded: false, dismissedPlayers: []
    };

    bowlerHistory = [];
    pendingBowlerPopup = false;
    previousTarget = 0;

    battingPlayers.forEach(p => { p.isOut = false; p.isPlaying = false; });

    updateDisplay();
    rerenderOpenPopupLists();

    if (database && isConnected) {
        database.ref(`matches/${matchId}/command`).set({
            event: 'hide_graphics', payload: {}, ts: firebase.database.ServerValue.TIMESTAMP
        });
    }

    sendUpdate(true);
    showToast('Match reset for all screens', 'success');
}

function closeResetPopup() {
    document.getElementById('resetConfirmPopup').classList.remove('show');
}

function executeResetMatch() {
    closeResetPopup(); // Hide popup

    matchState = {
        runs: 0, wkts: 0, overs: '0.0', balls: 0, thisOver: [], target: 0,
        totOvers: matchState.totOvers || 20, crr: '0.00', striker: 1, isFreeHit: false,
        partRuns: 0, partBalls: 0,
        bat1: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
        bat2: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
        bowler: { name: '', overs: '0.0', runs: 0, wickets: 0, balls: 0 },
        battingTeam: matchState.battingTeam || '',
        bowlingTeam: matchState.bowlingTeam || '',
        prevInnings: null, isMatchEnded: false, dismissedPlayers: []
    };

    bowlerHistory = [];
    pendingBowlerPopup = false;
    previousTarget = 0;

    battingPlayers.forEach(p => { p.isOut = false; p.isPlaying = false; });

    updateDisplay();
    rerenderOpenPopupLists();

    if (database && isConnected) {
        database.ref(`matches/${matchId}/command`).set({
            event: 'hide_graphics', payload: {}, ts: firebase.database.ServerValue.TIMESTAMP
        });
    }

    sendUpdate(true);
    showToast('Match reset for all screens', 'success');
}

function clearLocalOnly() {
    localStorage.removeItem('scorer_matchId');
    localStorage.removeItem('scorer_name');
    clearTeamsCache();
    showToast('Local storage cleared', 'success');
}

function forceSaveNow() {
    manualPushNow();
}

// ==========================================
// RECENT MATCHES
// ==========================================
function loadRecentMatches() {
    const recent = JSON.parse(localStorage.getItem('scorer_recent') || '[]');
    const container = document.getElementById('recentList');
    if (!container) return;

    if (recent.length === 0) {
        container.innerHTML = '<div class="empty-text">No recent matches</div>';
        return;
    }

    container.innerHTML = recent.slice(0, 5).map(item => `
        <div class="recent-item" onclick="selectRecentMatch('${item.id}')">
            <div class="recent-item-id">${item.id}</div>
            <div class="recent-item-date">${item.date}</div>
        </div>
    `).join('');
}

function addToRecentMatches(id) {
    let recent = JSON.parse(localStorage.getItem('scorer_recent') || '[]');
    recent = recent.filter(item => item.id !== id);
    recent.unshift({ id: id, date: new Date().toLocaleString() });
    localStorage.setItem('scorer_recent', JSON.stringify(recent.slice(0, 10)));
}

function selectRecentMatch(id) {
    document.getElementById('inputMatchId').value = id;
}

function closeChaseStartPopup() {
    document.getElementById('chaseStartPopup').classList.remove('show');
}

// ==========================================
// TOAST
// ==========================================
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    const icon = document.getElementById('toastIcon');
    const text = document.getElementById('toastText');

    if (icon) icon.innerText = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    if (text) text.innerText = message;

    toast.className = 'toast ' + type;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// ==========================================
// WINDOW EVENTS
// ==========================================
window.addEventListener('beforeunload', () => {
    stopPresenceRefresh();

    if (database && matchId && isConnected) {
        database.ref(`presence/${matchId}/updater`).set({
            online: false,
            lastSeen: Date.now(),
            name: scorerName || '',
            version: '32.0',
            pingMs: 0
        });
    }
});

window.addEventListener('offline', () => {
    isConnected = false;
    stopPresenceRefresh();
    selfPingMs = null;
    lastScorebarPingMs = null;
    updatePingDisplay();
    updateScorebarPingDisplay();
    updateConnectionStatus();
    showToast('Connection lost', 'error');
});

window.addEventListener('online', () => {
    showToast('Internet restored', 'success');
    if (matchId && scorerName) connectToMatch();
});

// ==========================================
// EXPOSE FUNCTIONS GLOBALLY
// ==========================================
window.showChaseStartPopup = showChaseStartPopup;
window.closeChaseStartPopup = closeChaseStartPopup;
window.joinMatch = joinMatch;
window.addBall = addBall;
window.addCustomBall = addCustomBall;
window.undoBall = undoBall;
window.clearOver = clearOver;
window.swapStriker = swapStriker;
window.endOver = endOver;
window.openExtrasPopup = openExtrasPopup;
window.closeExtrasPopup = closeExtrasPopup;
window.confirmExtras = confirmExtras;
window.openWicketPopup = openWicketPopup;
window.closeWicketPopup = closeWicketPopup;
window.confirmWicket = confirmWicket;
window.openPlayerPicker = openPlayerPicker;
window.closePlayerPicker = closePlayerPicker;
window.filterPlayerList = filterPlayerList;
window.openBowlerPicker = openBowlerPicker;
window.closeBowlerPicker = closeBowlerPicker;
window.filterBowlerPickerList = filterBowlerPickerList;
window.openNextBowlerPopup = openNextBowlerPopup;
window.closeNextBowlerPopup = closeNextBowlerPopup;
window.filterNextBowlerList = filterNextBowlerList;
window.confirmNextBowler = confirmNextBowler;
window.openNewBatterPopup = openNewBatterPopup;
window.closeNewBatterPopup = closeNewBatterPopup;
window.filterNewBatterList = filterNewBatterList;
window.setStriker = setStriker;
window.toggleLockState = toggleLockState;
window.syncFromAdmin = syncFromAdmin;
window.reconnectAll = reconnectAll;
window.switchTab = switchTab;
window.toggleConnPanel = toggleConnPanel;
window.toggleTechPanel = toggleTechPanel;
window.showDisconnectConfirm = showDisconnectConfirm;
window.closeDisconnectPopup = closeDisconnectPopup;
window.disconnectMatch = disconnectMatch;
window.resetScorerMatch = resetScorerMatch;
window.clearLocalOnly = clearLocalOnly;
window.forceSaveNow = forceSaveNow;
window.selectRecentMatch = selectRecentMatch;
window.closeChaseStartPopup = closeChaseStartPopup;

window.closeResetPopup = closeResetPopup;
window.executeResetMatch = executeResetMatch;

window.toggleRealtimeMode = toggleRealtimeMode;
window.manualPushNow = manualPushNow;
window.closeDeviceAlert = closeDeviceAlert;
window.openDeviceAlertPanel = openDeviceAlertPanel;
window.showChaseStartPopup = showChaseStartPopup;

window.sendCommand = sendCommand;
window.sendNewBatterProfile = sendNewBatterProfile;
window.sendUpcomingBatter = sendUpcomingBatter;
window.forceRefreshTeams = forceRefreshTeams;
window.clearTeamsCache = clearTeamsCache;
window.sendSpecialOverlay = sendSpecialOverlay;
window.hideSpecialOverlay = hideSpecialOverlay;

// ==========================================
// INITIALIZATION COMPLETE
// ==========================================
console.log('🏏 Scorer V32.0 Firebase Loaded');
console.log('✅ Features:');
console.log('   - Auto Next Bowler Popup (6 balls)');
console.log('   - WD/NB not counted as legal balls');
console.log('   - OUT batsmen read-only in list');
console.log('   - Batsmen isOut flag for scorebar fade');
console.log('   - Auto New Batter Profile');
console.log('   - Auto Result Cards');