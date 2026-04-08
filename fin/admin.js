// ==========================================
// ADMIN.JS - V29.0 FIREBASE OPTIMIZED
// 100% Firebase Realtime Database
// Zero Bandwidth Presence System
// ==========================================

// ==========================================
// CONFIG
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
    STORAGE_KEY: 'adminMatchStateV29',

    // 🆕 Cache settings (Team.js එකේ වගේම)
    CACHE: {
        TEAMS_KEY: 'stc_teams_cache_v2',
        VERSION_KEY: 'stc_data_version_v2',
        MAX_AGE_MS: 24 * 60 * 60 * 1000  // 24 hours
    }


};

// ==========================================
// GLOBAL STATE
// ==========================================
let matchId = localStorage.getItem('matchId') || 'my_match_999';
let firebaseApp = null;
let database = null;
let isClearing = false;

let autoUpdateEnabled = true;
let autoAllOutEnabled = true;
let msgCount = 0;
let lastForceTrig = '';

let teams = [];
let allPlayers = [];
let selectedProfilePlayer = null;
let playerPickerTarget = '';
let teamSelectorTarget = 0;
let selectedNextBowler = null;
let selectedNextBatsman = null;
let pendingWicketSlot = null;
let pendingBowlerAfterWicket = false;

// Connection state
const connectedApps = {
    updater: {
        online: false,
        lastSeen: 0,
        version: '',
        pingMs: null,
        name: '',
        device: {
            battery: {
                supported: false,
                level: null,
                charging: null,
                low: false,
                critical: false
            },
            network: {
                online: false,
                rawType: 'unknown',
                effectiveType: 'unknown',
                label: 'Unknown',
                signalBars: 0,
                signalPct: 0,
                downlink: 0,
                rtt: 0,
                unstable: false
            },
            autoRealtimeEnabled: true,
            pendingManualPush: false
        }
    },
    scorebar: { online: false, lastSeen: 0, version: '', pingMs: null },
    monitor: { online: false, lastSeen: 0, version: '', pingMs: null }
};

// Animation settings
let animSettings = {
    fourDuration: 2500,
    sixDuration: 2500,
    wicketDuration: 3000,
    profileDuration: 5000,
    milestoneDuration: 8000,
    carouselInterval: 20000,
    viewHoldDuration: 7000,
    newBatterDelay: 1600,
    resultDelay: 3000,
    queueGap: 500
};

// Match state
let matchState = {
    runs: 0,
    wkts: 0,
    overs: '0.0',
    target: 0,
    totOvers: 20,
    oversPreset: 't20',
    crr: '0.00',
    batFlag: 'BAT',
    bowlFlag: 'BOWL',
    matchType: 'limited',
    status: 'LIVE MATCH',
    striker: '1',
    isFreeHit: false,
    thisOver: '',
    partRuns: 0,
    partBalls: 0,
    winProb: 50,
    bat1: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
    bat2: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
    bowler: { name: '', figs: '0-0 0.0', wickets: 0, runs: 0, balls: 0 },
    t1Logo: '',
    t2Logo: '',
    team1: null,
    team2: null,
    team1Id: null,
    team2Id: null,
    battingSide: 1,
    testDay: 1,
    testSession: 1,
    testInnings: 1,
    isSpecial: false,
    specialText: '',
    dismissedPlayers: [],
    lastWicketType: '',
    showUpcomingBatter: false,
    upcomingBatterName: ''

};

let currentOver = [];
let historyStack = [];
let realtimePingMs = null;
let pingInterval = null;
let presenceRefreshInterval = null;

const locks = {
    setup: false,
    teams: false,
    score: false,
    batsmen: false,
    bowler: false
};

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    loadFromLocalStorage();
    initUI();
    bindAllInputListeners();
    await initFirebase();
    updateStorageInfo();

    setInterval(updateConnectionStatusUI, 3000);
    setInterval(updateStorageInfo, 60000);
    setInterval(saveToLocalStorage, 30000);

    document.querySelectorAll('.modal-overlay, .popup-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('show');
        });
    });

    window.addEventListener('online', () => showToast('Internet restored'));
    window.addEventListener('offline', () => showToast('Internet disconnected', 'error'));

    console.log('🏏 Admin Panel V29.0 Firebase Ready');
});

// ==========================================
// FIREBASE INIT
// ==========================================
async function initFirebase() {
    try {
        updateSupabaseStatus('connecting');

        if (!window.firebase) {
            throw new Error('Firebase library not loaded');
        }

        if (!firebase.apps.length) {
            firebaseApp = firebase.initializeApp(CONFIG.FIREBASE);
        } else {
            firebaseApp = firebase.apps[0];
        }

        database = firebase.database();
        updateSupabaseStatus('connected');

        await loadTeams();
        setupFirebaseRealtime();
    } catch (e) {
        console.error('Firebase init failed:', e);
        updateSupabaseStatus('error');
        showToast('Firebase init failed', 'error');
    }
}

// ==========================================
// FIREBASE REALTIME (Zero Bandwidth Presence)
// ==========================================
function setupFirebaseRealtime() {
    updateRealtimeStatus('connecting');

    const amOnline = database.ref('.info/connected');
    const myPresenceRef = database.ref(`presence/${matchId}/admin`);

    amOnline.on('value', (snapshot) => {
        if (snapshot.val()) {
            myPresenceRef.onDisconnect().set({
                online: false,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });

            myPresenceRef.set({
                online: true,
                lastSeen: firebase.database.ServerValue.TIMESTAMP,
                version: '29.0',
                pingMs: 0
            });

            updateRealtimeStatus('connected');
            updateBroadcastLabel('Live');
            showToast('Connected to Match Server');

            startPingMonitor();
            startPresenceRefresh();
        } else {
            updateRealtimeStatus('error');
            updateBroadcastLabel('Offline');
            stopPingMonitor();
            stopPresenceRefresh();
            realtimePingMs = null;
            updatePingBars();
        }
        listenForTeamUpdates();
    });

    // Listen to Scorer Updates (Presence)
    database.ref(`presence/${matchId}`).on('value', (snap) => {
        const data = snap.val() || {};

        if (data.updater) {
            const incomingDevice = data.updater.device || {};
            connectedApps.updater = {
                ...connectedApps.updater,
                ...data.updater,
                device: {
                    ...(connectedApps.updater.device || {}),
                    ...incomingDevice,
                    battery: {
                        ...((connectedApps.updater.device || {}).battery || {}),
                        ...(incomingDevice.battery || {})
                    },
                    network: {
                        ...((connectedApps.updater.device || {}).network || {}),
                        ...(incomingDevice.network || {})
                    }
                }
            };
        }

        if (data.scorebar) {
            connectedApps.scorebar = { ...connectedApps.scorebar, ...data.scorebar };
        }

        if (data.monitor) {
            connectedApps.monitor = { ...connectedApps.monitor, ...data.monitor };
        }

        updateConnectionStatusUI();
        updatePingBars();
    });

    // Listen to Others Presence
    database.ref(`presence/${matchId}`).on('value', (snap) => {
        const data = snap.val() || {};

        if (data.updater) connectedApps.updater = { ...connectedApps.updater, ...data.updater };
        if (data.scorebar) connectedApps.scorebar = { ...connectedApps.scorebar, ...data.scorebar };
        if (data.monitor) connectedApps.monitor = { ...connectedApps.monitor, ...data.monitor };

        updateConnectionStatusUI();
        updatePingBars();
    });

    // 🆕 NEW: Listen to Actual Match Score Updates from Mobile Updater!
    // මෙතනින් තමයි Mobile Updater එකෙන් එන Score එක අල්ලගෙන Admin Panel එක Update කරන්නේ.
    database.ref(`matches/${matchId}/scorer_update`).on('value', (snap) => {
        const payload = snap.val();
        if (payload && payload.timestamp) {
            console.log('🔄 Match state updated from Mobile Updater');
            handleScorerSync(payload); // Admin UI එක update කරන function එක කෝල් කිරීම
        }
    });
}

// ==========================================
// LIGHTWEIGHT PING SYSTEM
// ==========================================
async function measureRealtimePing() {
    if (!database || !navigator.onLine) {
        realtimePingMs = null;
        updatePingBars();
        return;
    }

    try {
        const start = performance.now();
        await database.ref(`ping/${matchId}/admin_probe`).set({
            t: firebase.database.ServerValue.TIMESTAMP
        });
        realtimePingMs = Math.max(1, Math.round(performance.now() - start));
    } catch (e) {
        realtimePingMs = null;
    }

    updatePingBars();
}

function startPingMonitor() {
    stopPingMonitor();
    measureRealtimePing();
    pingInterval = setInterval(measureRealtimePing, 10000); // 10s
}

function stopPingMonitor() {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
}

// ==========================================
// PRESENCE REFRESH (LOW BANDWIDTH)
// ==========================================
async function refreshAdminPresence() {
    if (!database || !navigator.onLine) return;

    try {
        await database.ref(`presence/${matchId}/admin`).update({
            online: true,
            lastSeen: firebase.database.ServerValue.TIMESTAMP,
            version: '29.0',
            pingMs: realtimePingMs ?? 0
        });
    } catch (e) { }
}

function startPresenceRefresh() {
    stopPresenceRefresh();
    refreshAdminPresence();
    presenceRefreshInterval = setInterval(refreshAdminPresence, 10000); // 10s
}

function stopPresenceRefresh() {
    if (presenceRefreshInterval) {
        clearInterval(presenceRefreshInterval);
        presenceRefreshInterval = null;
    }
}

// ==========================================
// PING BAR UI
// ==========================================
function updatePingBars() {
    setPingBar(
        'realtimePingValue',
        'realtimePingFill',
        realtimePingMs
    );

    setPingBar(
        'scorebarPingValue',
        'scorebarPingFill',
        isAppCurrentlyOnline('scorebar') ? connectedApps.scorebar.pingMs : null
    );
}

function setPingBar(valueId, fillId, ms) {
    const valueEl = document.getElementById(valueId);
    const fillEl = document.getElementById(fillId);
    if (!valueEl || !fillEl) return;

    if (ms === null || ms === undefined || Number.isNaN(ms) || ms <= 0) {
        valueEl.textContent = '-- ms';
        fillEl.style.width = '0%';
        fillEl.style.background = 'var(--danger)';
        return;
    }

    const safeMs = Math.min(Math.max(Math.round(ms), 0), 999);
    valueEl.textContent = `${safeMs} ms`;

    let width = 100;
    let color = 'var(--success)';

    if (safeMs <= 60) {
        width = 100;
        color = 'var(--success)';
    } else if (safeMs <= 120) {
        width = 80;
        color = 'var(--success)';
    } else if (safeMs <= 220) {
        width = 60;
        color = 'var(--warning)';
    } else if (safeMs <= 350) {
        width = 40;
        color = 'var(--warning)';
    } else {
        width = 18;
        color = 'var(--danger)';
    }

    fillEl.style.width = `${width}%`;
    fillEl.style.background = color;
}

function isAppCurrentlyOnline(appName) {
    const appState = connectedApps[appName];
    if (!appState) return false;
    return appState.online === true;
}

// ==========================================
// CACHED TEAMS LOADER
// ==========================================
// ==========================================
// 🆕 CACHE HELPER FUNCTIONS
// ==========================================

/**
 * Load teams data from localStorage cache
 */
function loadTeamsFromCache() {
    try {
        const cached = localStorage.getItem(CONFIG.CACHE.TEAMS_KEY);
        if (!cached || cached === "undefined") return null;

        const data = JSON.parse(cached);

        const age = Date.now() - (data.timestamp || 0);
        if (age > CONFIG.CACHE.MAX_AGE_MS) {
            console.log('⏰ Teams cache expired');
            return null;
        }
        return data;
    } catch (e) {
        console.warn('Cache load failed. Clearing cache:', e);
        localStorage.removeItem(CONFIG.CACHE.TEAMS_KEY);
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
        console.warn('Cache save failed (Storage Full?):', e);
        // Quota full නම් පරණ cache ටික අයින් කරනවා
        localStorage.removeItem(CONFIG.CACHE.TEAMS_KEY);
    }
}

/**
 * Get server version from RTDB
 */
async function getTeamsServerVersion() {
    try {
        const snap = await database.ref('data_version/teams').once('value');
        return snap.val() || 0;
    } catch (e) {
        return 0;
    }
}

/**
 * Check if cache is valid by comparing versions
 */
async function isTeamsCacheValid(cachedData) {
    if (!cachedData || !cachedData.version) return false;

    const serverVersion = await getTeamsServerVersion();

    if (serverVersion > cachedData.version) {
        console.log('🔄 Server has newer team data');
        return false;
    }

    return true;
}

/**
 * Clear teams cache
 */
function clearTeamsCache() {
    localStorage.removeItem(CONFIG.CACHE.TEAMS_KEY);
    console.log('🗑️ Teams cache cleared');
}

// ==========================================
// 🆕 LOAD TEAMS (with Cache System - Zero Bandwidth!)
// ==========================================
async function loadTeams(forceRefresh = false) {
    if (!database) {
        console.warn('Database not initialized');
        return;
    }

    try {
        let teamsData = {};
        let playersData = {};
        let usedCache = false;
        let currentVersion = Date.now();

        // Step 1: Try to use cache (if not forcing refresh)
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

        // Step 2: If no valid cache, fetch from Firebase RTDB
        if (!usedCache) {
            console.log('☁️ Fetching teams from Firebase...');

            const [teamsSnap, playersSnap, versionSnap] = await Promise.all([
                database.ref('teams').orderByChild('name').once('value'),
                database.ref('players').orderByChild('name').once('value'),
                database.ref('data_version/teams').once('value')
            ]);

            const teamsRaw = teamsSnap.val() || {};
            const playersRaw = playersSnap.val() || {};
            currentVersion = versionSnap.val() || Date.now();

            // Convert to objects for cache
            teamsData = teamsRaw;
            playersData = playersRaw;

            // Save to cache for next time
            saveTeamsToCache(teamsData, playersData, currentVersion);

            console.log('📥 Teams fetched from Firebase and cached');
        }

        // Step 3: Process data into usable format
        allPlayers = Object.entries(playersData).map(([id, player]) => ({
            id,
            ...player
        }));

        teams = Object.entries(teamsData).map(([id, team]) => ({
            id,
            ...team,
            players: allPlayers.filter(p => p.team_id === id)
        }));

        // Sort teams by name
        teams.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

        // Step 4: Update UI
        reconcileSelectedTeamsFromIds();
        renderTeamSelectors();
        renderSquadPreview();
        updateActivePlayerCards();

        if (usedCache) {
            console.log(`✅ Teams loaded from cache: ${teams.length} teams, ${allPlayers.length} players`);
            console.log('💰 Bandwidth saved!');
        } else {
            console.log(`✅ Teams loaded from Firebase: ${teams.length} teams, ${allPlayers.length} players`);
        }

    } catch (e) {
        console.error('Failed to load teams:', e);

        // Fallback: Try to use cache even if expired
        const cached = loadTeamsFromCache();
        if (cached && cached.teams) {
            console.log('📴 Using expired cache as fallback');

            const teamsData = cached.teams || {};
            const playersData = cached.players || {};

            allPlayers = Object.entries(playersData).map(([id, player]) => ({
                id,
                ...player
            }));

            teams = Object.entries(teamsData).map(([id, team]) => ({
                id,
                ...team,
                players: allPlayers.filter(p => p.team_id === id)
            }));

            reconcileSelectedTeamsFromIds();
            renderTeamSelectors();
            renderSquadPreview();
            updateActivePlayerCards();

            showToast('Using offline team data', 'error');
        } else {
            showToast('Failed to load teams', 'error');
        }
    }
}

// ==========================================
// 🆕 FORCE REFRESH TEAMS (Clear cache and reload)
// ==========================================
async function forceRefreshTeams() {
    clearTeamsCache();
    await loadTeams(true);
    showToast('Teams refreshed from server');
}

// ==========================================
// 🆕 LISTEN FOR TEAM DATA UPDATES
// Add this to setupFirebaseRealtime() function
// ==========================================
function listenForTeamUpdates() {
    if (!database) return;

    database.ref('data_version/teams').on('value', (snap) => {
        const serverVersion = snap.val();
        const cached = loadTeamsFromCache();

        if (cached && serverVersion && serverVersion > cached.version) {
            console.log('🔔 Team data updated, refreshing...');
            loadTeams(true);
        }
    });
}

// ==========================================
// BROADCAST / SEND DATA
// ==========================================
function sendCommand(event, payload = {}) {
    if (!database) return;
    const cmd = {
        event,
        payload,
        ts: firebase.database.ServerValue.TIMESTAMP
    };
    database.ref(`matches/${matchId}/command`).set(cmd);
    msgCount++;
    updateMsgCount();
    updateLastSync();
}

function buildPayload(extra = {}) {
    calculateWinProbability();

    const battingTeam = getBattingTeam();
    const bat1Player = findPlayerByName(matchState.bat1.name, battingTeam);
    const bat2Player = findPlayerByName(matchState.bat2.name, battingTeam);

    return {
        timestamp: firebase.database.ServerValue.TIMESTAMP,
        matchId,

        runs: matchState.runs,
        wkts: matchState.wkts,
        overs: matchState.overs,
        target: matchState.target,
        totOvers: matchState.totOvers,
        oversPreset: matchState.oversPreset || 't20',
        crr: matchState.crr,

        batFlag: matchState.batFlag,
        bowlFlag: matchState.bowlFlag,
        t1Logo: matchState.t1Logo,
        t2Logo: matchState.t2Logo,

        matchType: matchState.matchType,
        status: matchState.status,

        testMatch: matchState.matchType === 'test' ? {
            day: matchState.testDay,
            session: matchState.testSession,
            innings: matchState.testInnings
        } : null,

        bat1: {
            name: matchState.bat1.name || '',
            runs: matchState.bat1.runs || 0,
            balls: matchState.bat1.balls || 0,
            fours: matchState.bat1.fours || 0,
            sixes: matchState.bat1.sixes || 0,
            isOut: matchState.bat1.isOut || false,
            photo: bat1Player ? (bat1Player.photo_url || bat1Player.photo_base64 || '') : ''
        },

        bat2: {
            name: matchState.bat2.name || '',
            runs: matchState.bat2.runs || 0,
            balls: matchState.bat2.balls || 0,
            fours: matchState.bat2.fours || 0,
            sixes: matchState.bat2.sixes || 0,
            isOut: matchState.bat2.isOut || false,
            photo: bat2Player ? (bat2Player.photo_url || bat2Player.photo_base64 || '') : ''
        },

        striker: matchState.striker,

        bowler: {
            name: matchState.bowler.name || '',
            figs: matchState.bowler.figs || '0-0 0.0',
            wickets: matchState.bowler.wickets || 0,
            runs: matchState.bowler.runs || 0,
            balls: matchState.bowler.balls || 0
        },

        thisOver: currentOver.join(' '),
        isFreeHit: matchState.isFreeHit,
        partRuns: matchState.partRuns,
        partBalls: matchState.partBalls,
        winProb: matchState.winProb,

        autoCarousel: document.getElementById('autoCarousel')?.checked ?? true,
        enTarget: document.getElementById('enTarget')?.checked ?? true,
        enPart: document.getElementById('enPart')?.checked ?? true,
        enPred: document.getElementById('enPred')?.checked ?? true,
        enChase: document.getElementById('enChase')?.checked ?? true,

        autoAllOutEnabled: isAutoAllOutEnabled(),
        isSpecial: matchState.isSpecial,
        specialText: matchState.specialText,
        animSettings,
        forceView: lastForceTrig,

        dismissedPlayers: [...(matchState.dismissedPlayers || [])],

        showUpcomingBatter: false,
        upcomingBatterName: '',

        showAllOutCard: false,
        allOutData: null,
        showMilestone: false,
        milestoneData: null,

        ...extra
    };
}

function sendLiveData(extra = {}) {
    if (!database) {
        showToast('Database not connected', 'error');
        return Promise.resolve();
    }

    const payload = buildPayload(extra);
    const cleanPayload = JSON.parse(JSON.stringify(payload));

    return database.ref(`matches/${matchId}/live`).update(cleanPayload)
        .then(() => {
            msgCount++;
            updateMsgCount();
            updateLastSync();
        })
        .catch(err => {
            console.error("Firebase Update Error:", err);
        });
}

function forceSend() {
    updateMatchState();
    sendLiveData();
    showToast('Data pushed to scoreboard');
}

// ==========================================
// SCORER SYNC HANDLER
// ==========================================
// ==========================================
// SCORER SYNC HANDLER (Real-time from Score Updater)
// ==========================================
function handleScorerSync(payload) {
    if (!payload) return;

    console.log('📥 Scorer sync received:', payload);

    matchState.runs = parseInt(payload.runs, 10) || 0;
    matchState.wkts = parseInt(payload.wkts, 10) || 0;
    matchState.overs = payload.overs || '0.0';

    if (payload.target !== undefined) {
        matchState.target = parseInt(payload.target, 10) || 0;
    }

    if (payload.totOvers !== undefined) {
        matchState.totOvers = parseInt(payload.totOvers, 10) || matchState.totOvers || 20;
    }

    if (payload.batFlag) matchState.batFlag = payload.batFlag;
    if (payload.bowlFlag) matchState.bowlFlag = payload.bowlFlag;

    matchState.striker = String(payload.striker || matchState.striker || '1');
    matchState.isFreeHit = !!payload.isFreeHit;

    matchState.thisOver = payload.thisOver || '';
    currentOver = matchState.thisOver ? matchState.thisOver.split(' ').filter(Boolean) : [];

    if (payload.partRuns !== undefined) {
        matchState.partRuns = parseInt(payload.partRuns, 10) || 0;
    }

    if (payload.partBalls !== undefined) {
        matchState.partBalls = parseInt(payload.partBalls, 10) || 0;
    }

    if (payload.bat1) {
        matchState.bat1 = {
            name: payload.bat1.name || '',
            runs: parseInt(payload.bat1.runs, 10) || 0,
            balls: parseInt(payload.bat1.balls, 10) || 0,
            fours: parseInt(payload.bat1.fours, 10) || 0,
            sixes: parseInt(payload.bat1.sixes, 10) || 0,
            isOut: !!payload.bat1.isOut
        };
    }

    if (payload.bat2) {
        matchState.bat2 = {
            name: payload.bat2.name || '',
            runs: parseInt(payload.bat2.runs, 10) || 0,
            balls: parseInt(payload.bat2.balls, 10) || 0,
            fours: parseInt(payload.bat2.fours, 10) || 0,
            sixes: parseInt(payload.bat2.sixes, 10) || 0,
            isOut: !!payload.bat2.isOut
        };
    }

    if (payload.bowler) {
        let bowlerWickets = 0;
        let bowlerRuns = 0;
        let bowlerBalls = 0;

        if (payload.bowler.figs) {
            const parsedFigs = parseBowlerFigures(payload.bowler.figs);
            bowlerWickets = parsedFigs.wickets;
            bowlerRuns = parsedFigs.runs;
            bowlerBalls = parsedFigs.balls;
        } else {
            bowlerWickets = parseInt(payload.bowler.wickets, 10) || 0;
            bowlerRuns = parseInt(payload.bowler.runs, 10) || 0;
            bowlerBalls = parseInt(payload.bowler.balls, 10) || 0;
        }

        matchState.bowler = {
            name: payload.bowler.name || '',
            figs: formatBowlerFigures({
                wickets: bowlerWickets,
                runs: bowlerRuns,
                balls: bowlerBalls
            }),
            wickets: bowlerWickets,
            runs: bowlerRuns,
            balls: bowlerBalls
        };
    }

    if (payload.dismissedPlayers && Array.isArray(payload.dismissedPlayers)) {
        matchState.dismissedPlayers = [...payload.dismissedPlayers];
    } else {
        matchState.dismissedPlayers = [];
    }

    calculateWinProbability();

    restoreUIFromState();
    renderOverDisplay();
    updateFreeHitBadge();
    updateStrikerUI();
    updateCrrDisplay();
    updateActivePlayerCards();
    renderSquadPreview();

    saveToLocalStorage();
    updateStorageInfo();
    updateLastSync();

    console.log('✅ Admin UI updated from Scorer');
}

//monitor helper block add //

function getUpdaterMonitorSnapshot() {
    const d = connectedApps.updater?.device || {};
    return {
        online: connectedApps.updater?.online || false,
        name: connectedApps.updater?.name || '',
        pingMs: connectedApps.updater?.pingMs ?? null,
        batteryLevel: d.battery?.level ?? null,
        charging: d.battery?.charging ?? null,
        lowBattery: d.battery?.low ?? false,
        criticalBattery: d.battery?.critical ?? false,
        networkType: d.network?.label || 'Unknown',
        signalBars: d.network?.signalBars ?? 0,
        signalPct: d.network?.signalPct ?? 0,
        unstable: d.network?.unstable ?? false,
        autoRealtimeEnabled: d.autoRealtimeEnabled ?? true,
        pendingManualPush: d.pendingManualPush ?? false
    };
}

window.getUpdaterMonitorSnapshot = getUpdaterMonitorSnapshot;

// ==========================================
// CONNECTION UI
// ==========================================
function updateSupabaseStatus(status) {
    const dot = document.querySelector('#supabaseBadge .conn-dot');
    const text = document.getElementById('supabaseStatus');
    if (!dot || !text) return;

    dot.className = 'conn-dot';
    if (status === 'connected') {
        dot.classList.add('good');
        text.textContent = 'Firebase: Connected';
    } else if (status === 'connecting') {
        dot.classList.add('connecting');
        text.textContent = 'Firebase: Connecting...';
    } else {
        dot.classList.add('bad');
        text.textContent = 'Firebase: Error';
    }
}

function updateRealtimeStatus(status) {
    const dot = document.querySelector('#realtimeBadge .conn-dot');
    const text = document.getElementById('realtimeStatus');
    if (!dot || !text) return;

    dot.className = 'conn-dot';
    if (status === 'connected') {
        dot.classList.add('good');
        text.textContent = 'Realtime: Connected';
    } else if (status === 'connecting') {
        dot.classList.add('connecting');
        text.textContent = 'Realtime: Connecting...';
    } else {
        dot.classList.add('bad');
        text.textContent = 'Realtime: Error';
    }
}

function updateBroadcastLabel(text) {
    const el = document.getElementById('broadcastValue');
    if (el) el.textContent = text;
}

function updateConnectionStatusUI() {
    const updaterOnline = isAppCurrentlyOnline('updater');
    const scorebarOnline = isAppCurrentlyOnline('scorebar');

    const updaterPingEl = document.getElementById('updaterLastPing');
    if (updaterPingEl) {
        if (connectedApps.updater.lastSeen > 0) {
            const ago = Math.floor((Date.now() - connectedApps.updater.lastSeen) / 1000);
            updaterPingEl.textContent = updaterOnline ? (ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`) : 'Offline';
        } else {
            updaterPingEl.textContent = '--';
        }
    }

    const scorebarPingEl = document.getElementById('scorebarLastPing');
    if (scorebarPingEl) {
        if (connectedApps.scorebar.lastSeen > 0) {
            const ago = Math.floor((Date.now() - connectedApps.scorebar.lastSeen) / 1000);
            scorebarPingEl.textContent = scorebarOnline ? (ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`) : 'Offline';
        } else {
            scorebarPingEl.textContent = '--';
        }
    }

    updateAppStatusBadge('updaterBadge', 'updaterStatus', 'Updater', updaterOnline);
    updateAppStatusBadge('scorebarBadge', 'scorebarStatus', 'Scorebar', scorebarOnline);

    const networkEl = document.getElementById('networkStatus');
    if (networkEl) {
        const online = navigator.onLine;
        networkEl.innerHTML = online
            ? '<span class="network-indicator good"></span>Online'
            : '<span class="network-indicator bad"></span>Offline';
    }

    updatePingBars();
}

function updateAppStatusBadge(badgeId, textId, label, isOnline) {
    const badge = document.getElementById(badgeId);
    const text = document.getElementById(textId);
    const dot = badge?.querySelector('.conn-dot');

    if (!badge || !text || !dot) return;

    dot.className = 'conn-dot';
    if (isOnline) {
        dot.classList.add('good');
        text.textContent = `${label}: Online`;
    } else {
        dot.classList.add('offline');
        text.textContent = `${label}: Offline`;
    }
}

function updateMsgCount() {
    const el = document.getElementById('msgSent');
    if (el) el.textContent = msgCount;
}

function updateLastSync() {
    const el = document.getElementById('lastSync');
    if (el) el.textContent = new Date().toLocaleTimeString();
}

async function testConnection() {
    try {
        await loadTeams(true);
        showToast('Connection test passed');
    } catch (e) {
        showToast('Connection test failed', 'error');
    }
}

async function reconnect() {
    await loadTeams(true);
    showToast('Reconnected');
}

function copyMatchId() {
    navigator.clipboard.writeText(matchId)
        .then(() => showToast('Match ID copied'))
        .catch(() => showToast('Copy failed', 'error'));
}

// ==========================================
// UI INIT / GENERAL
// ==========================================
function initUI() {
    const matchIdDisplay = document.getElementById('matchIdDisplay');
    if (matchIdDisplay) matchIdDisplay.textContent = matchId;

    const autoAllOutToggle = document.getElementById('autoAllOutToggle');
    if (autoAllOutToggle) {
        autoAllOutToggle.checked = autoAllOutEnabled;
    }

    restoreUIFromState();
    renderOverDisplay();
    updateFreeHitBadge();
    updateStrikerUI();
    updateCrrDisplay();
    updateConnectionStatusUI();
    updateActivePlayerCards();
    updateOversPresetUI();
}

function bindAllInputListeners() {
    const inputs = document.querySelectorAll('input:not([type="file"]), select, textarea');
    inputs.forEach(input => {
        input.addEventListener('change', checkAutoSend);
        input.addEventListener('input', debounce(checkAutoSend, 250));
    });

    document.querySelectorAll('[id^="set"]').forEach(input => {
        if (input.type === 'range') {
            input.addEventListener('input', updateAnimationValueDisplays);
        }
    });
}

function toggleAutoUpdate() {
    autoUpdateEnabled = document.getElementById('autoUpdateToggle')?.checked ?? true;
    document.getElementById('manualUpdateBtn')?.classList.toggle('show', !autoUpdateEnabled);
}

function postStateChange(send = true) {
    restoreUIFromState();
    saveToLocalStorage();
    updateStorageInfo();

    if (send) {
        if (autoUpdateEnabled) {
            sendLiveData();
        } else {
            document.getElementById('manualUpdateBtn')?.classList.add('show');
        }
    }
}

function checkAutoSend() {
    updateMatchState();
    postStateChange(true);
}

// ==========================================
// TEAMS
// ==========================================
function reconcileSelectedTeamsFromIds() {
    if (matchState.team1Id) {
        matchState.team1 = teams.find(t => t.id === matchState.team1Id) || matchState.team1;
    }
    if (matchState.team2Id) {
        matchState.team2 = teams.find(t => t.id === matchState.team2Id) || matchState.team2;
    }

    applySelectedTeamToUI(1);
    applySelectedTeamToUI(2);
    updateTeamsHeader();
    renderSquadPreview();
}

function openTeamSelector(target) {
    teamSelectorTarget = target;
    document.getElementById('teamModalTitle').textContent = `Select Team ${target}`;
    document.getElementById('teamSearch').value = '';
    renderTeamSelectors();
    document.getElementById('teamSelectorModal')?.classList.add('show');
}

function closeTeamSelector() {
    document.getElementById('teamSelectorModal')?.classList.remove('show');
}

function renderTeamSelectors() {
    const teamList = document.getElementById('teamList');
    if (!teamList) return;

    if (!teams.length) {
        teamList.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">No teams found.</p>';
        return;
    }

    teamList.innerHTML = teams.map(team => {
        const logoSrc = team.logo_url || team.logo_base64 || '';

        return `
            <div class="team-option" onclick="selectTeam('${team.id}')">
                <div class="team-option-logo">
                    ${logoSrc ? `<img src="${logoSrc}" alt="">` : escapeHtml(team.short_name)}
                </div>
                <div class="team-option-info">
                    <span class="team-option-name">${escapeHtml(team.name)}</span>
                    <span class="team-option-meta">${team.players?.length || 0} players • ${escapeHtml(team.short_name)}</span>
                </div>
            </div>
        `;
    }).join('');
}

function filterTeams() {
    const search = document.getElementById('teamSearch')?.value?.toLowerCase() || '';
    const options = document.querySelectorAll('#teamList .team-option');
    options.forEach(opt => {
        const txt = opt.textContent.toLowerCase();
        opt.style.display = txt.includes(search) ? 'flex' : 'none';
    });
}

function selectTeam(teamId) {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;

    const logoSrc = team.logo_url || team.logo_base64 || '';

    if (teamSelectorTarget === 1) {
        matchState.team1 = team;
        matchState.team1Id = team.id;
        matchState.t1Logo = logoSrc;
    } else {
        matchState.team2 = team;
        matchState.team2Id = team.id;
        matchState.t2Logo = logoSrc;
    }

    applySelectedTeamToUI(teamSelectorTarget);
    closeTeamSelector();
    updateTeamsHeader();
    renderSquadPreview();
    updateActivePlayerCards();
    postStateChange(true);
}

function applySelectedTeamToUI(slot) {
    const team = slot === 1 ? matchState.team1 : matchState.team2;
    if (!team) return;

    const logoEl = document.getElementById(`team${slot}Logo`);
    const nameEl = document.getElementById(`team${slot}Name`);
    const playersEl = document.getElementById(`team${slot}Players`);
    const batLabelEl = document.getElementById(`batLabel${slot}`);

    const logoSrc = team.logo_url || team.logo_base64 || '';

    if (logoEl) {
        logoEl.innerHTML = logoSrc ? `<img src="${logoSrc}" alt="">` : escapeHtml(team.short_name);
    }
    if (nameEl) nameEl.textContent = team.name;
    if (playersEl) playersEl.textContent = `${team.players?.length || 0} players`;
    if (batLabelEl) batLabelEl.textContent = team.short_name;
}

function setBattingSide(side, shouldSend = true) {
    matchState.battingSide = side;

    document.getElementById('batBtn1')?.classList.toggle('active', side === 1);
    document.getElementById('batBtn2')?.classList.toggle('active', side === 2);

    const batStatus1 = document.querySelector('#batBtn1 .bat-status');
    const batStatus2 = document.querySelector('#batBtn2 .bat-status');
    if (batStatus1) batStatus1.textContent = side === 1 ? '🏏 Batting' : '⚾ Bowling';
    if (batStatus2) batStatus2.textContent = side === 2 ? '🏏 Batting' : '⚾ Bowling';

    updateTeamsHeader();
    renderSquadPreview();
    updateActivePlayerCards();

    if (shouldSend) postStateChange(true);
}

function updateTeamsHeader() {
    if (matchState.battingSide === 1) {
        matchState.batFlag = matchState.team1?.short_name || 'T1';
        matchState.bowlFlag = matchState.team2?.short_name || 'T2';
    } else {
        matchState.batFlag = matchState.team2?.short_name || 'T2';
        matchState.bowlFlag = matchState.team1?.short_name || 'T1';
    }
}

function renderSquadPreview() {
    const container = document.getElementById('squadTags');
    const countEl = document.getElementById('squadCount');
    const battingTeam = getBattingTeam();
    if (!container || !countEl) return;

    if (!battingTeam?.players?.length) {
        container.innerHTML = '<span style="color:var(--text-secondary)">No squad loaded</span>';
        countEl.textContent = '0 players';
        return;
    }

    container.innerHTML = battingTeam.players.map(p => {
        const badges = getPlayerStatusBadgeHTML(p.name, 'squad');
        return `<span class="squad-tag" onclick="quickSelectBatter('${escapeAttr(p.name)}')">${escapeHtml(p.name)}${badges}</span>`;
    }).join('');

    countEl.textContent = `${battingTeam.players.length} players`;
}

function quickSelectBatter(name) {
    if (isPlayerDismissed(name)) {
        showToast('This player is already out', 'error');
        return;
    }

    if (!matchState.bat1.name) {
        assignBatter('bat1', name);
    } else if (!matchState.bat2.name) {
        assignBatter('bat2', name);
    } else {
        showToast('Both batter slots are already selected', 'error');
        return;
    }
    postStateChange(true);
}

// ==========================================
// PLAYER HELPERS
// ==========================================
function getBattingTeam() {
    return matchState.battingSide === 1 ? matchState.team1 : matchState.team2;
}

function getBowlingTeam() {
    return matchState.battingSide === 1 ? matchState.team2 : matchState.team1;
}

function findPlayerByName(name, preferredTeam = null) {
    if (!name) return null;

    if (preferredTeam?.players?.length) {
        const found = preferredTeam.players.find(p => p.name === name);
        if (found) return found;
    }

    for (const team of teams) {
        const found = (team.players || []).find(p => p.name === name);
        if (found) return found;
    }

    return allPlayers.find(p => p.name === name) || null;
}

function getPlayerStatus(name, currentTarget = '') {
    if (!name) return 'none';

    const currentSlotName =
        currentTarget === 'bat1' ? matchState.bat1.name :
            currentTarget === 'bat2' ? matchState.bat2.name : '';

    if (isPlayerDismissed(name)) return 'out';
    if (name === matchState.bat1.name || name === matchState.bat2.name) {
        if (name === currentSlotName) return 'selected';
        return 'playing';
    }
    return 'normal';
}

function getPlayerStatusBadgeHTML(name, currentTarget = '') {
    const status = getPlayerStatus(name, currentTarget);
    if (status === 'out') return `<span class="player-status-badge out">OUT</span>`;
    if (status === 'playing') return `<span class="player-status-badge playing">PLAYING</span>`;
    if (status === 'selected') return `<span class="player-status-badge selected">SELECTED</span>`;
    return '';
}

function isPlayerDismissed(name) {
    return matchState.dismissedPlayers.includes(name);
}

function markPlayerOut(name) {
    if (!name) return;
    if (!matchState.dismissedPlayers.includes(name)) {
        matchState.dismissedPlayers.push(name);
    }
}

function assignBatter(slotKey, name) {
    if (!name) return;
    const current = matchState[slotKey];
    const samePlayer = current.name === name;

    matchState[slotKey] = {
        name,
        runs: samePlayer ? current.runs : 0,
        balls: samePlayer ? current.balls : 0,
        fours: samePlayer ? current.fours : 0,
        sixes: samePlayer ? current.sixes : 0,
        isOut: false
    };

    if (slotKey === 'bat1') {
        document.getElementById('b1Name').value = name;
    } else {
        document.getElementById('b2Name').value = name;
    }
}

function assignBowler(name) {
    if (!name) return;
    matchState.bowler.name = name;
    matchState.bowler.runs = 0;
    matchState.bowler.wickets = 0;
    matchState.bowler.balls = 0;
    matchState.bowler.figs = '0-0 0.0';
    document.getElementById('bowlName').value = name;
    document.getElementById('bowlFigs').value = matchState.bowler.figs;
}

// ==========================================
// PLAYER PICKER
// ==========================================
function openPlayerPicker(target) {
    playerPickerTarget = target;
    document.getElementById('playerPickerTitle').textContent = getPickerTitle(target);
    document.getElementById('playerPickerSearch').value = '';
    renderPlayerPickerList();
    document.getElementById('playerPickerModal')?.classList.add('show');
}

function closePlayerPicker() {
    document.getElementById('playerPickerModal')?.classList.remove('show');
}

function getPickerTitle(target) {
    if (target === 'bat1') return 'Select Batter 1';
    if (target === 'bat2') return 'Select Batter 2';
    if (target === 'bowler') return 'Select Bowler';
    return 'Select Player';
}

function getSourcePlayersForPicker() {
    if (playerPickerTarget === 'bowler') return getBowlingTeam()?.players || [];
    return getBattingTeam()?.players || [];
}

function renderPlayerPickerList() {
    const list = document.getElementById('playerPickerList');
    if (!list) return;

    const players = getSourcePlayersForPicker();
    const search = (document.getElementById('playerPickerSearch')?.value || '').toLowerCase();

    const filtered = players.filter(p =>
        (p.name || '').toLowerCase().includes(search) ||
        (p.role || '').toLowerCase().includes(search)
    );

    if (!filtered.length) {
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">No players loaded.</p>';
        return;
    }

    list.innerHTML = filtered.map(p => {
        const status = playerPickerTarget === 'bowler' ? 'normal' : getPlayerStatus(p.name, playerPickerTarget);
        const disabled = status === 'playing' || status === 'out';
        const extraClass = status === 'playing' ? 'is-playing' : status === 'out' ? 'is-out' : '';
        const badge = playerPickerTarget === 'bowler'
            ? (matchState.bowler.name === p.name ? `<span class="player-status-badge selected">CURRENT</span>` : '')
            : getPlayerStatusBadgeHTML(p.name, playerPickerTarget);

        const photoSrc = p.photo_url || p.photo_base64 || '';

        return `
            <div class="player-option ${disabled ? 'disabled' : ''} ${extraClass}" onclick="${disabled ? '' : `selectPickerPlayer('${escapeAttr(p.name)}')`}">
                <div class="player-option-photo">
                    ${photoSrc ? `<img src="${photoSrc}" alt="">` : getInitial(p.name)}
                </div>
                <div class="player-option-info">
                    <span class="player-option-name">${escapeHtml(p.name)} ${badge}</span>
                    <span class="player-option-meta">${escapeHtml(p.role || 'Player')}${p.jersey_number ? ' • #' + p.jersey_number : ''}</span>
                </div>
            </div>
        `;
    }).join('');
}

function filterPlayerPicker() {
    renderPlayerPickerList();
}

function selectPickerPlayer(name) {
    if (playerPickerTarget === 'bat1') {
        if (name === matchState.bat2.name) return showToast('Already playing as Batter 2', 'error');
        if (isPlayerDismissed(name) && name !== matchState.bat1.name) return showToast('This player is already out', 'error');
        assignBatter('bat1', name);
    } else if (playerPickerTarget === 'bat2') {
        if (name === matchState.bat1.name) return showToast('Already playing as Batter 1', 'error');
        if (isPlayerDismissed(name) && name !== matchState.bat2.name) return showToast('This player is already out', 'error');
        assignBatter('bat2', name);
    } else if (playerPickerTarget === 'bowler') {
        assignBowler(name);
    }

    closePlayerPicker();
    postStateChange(true);
}

// ==========================================
// WICKET -> NEXT BATSMAN
// ==========================================
function openWicketPopup() {
    document.getElementById('wicketPopup')?.classList.add('show');
}

function closeWicketPopup() {
    document.getElementById('wicketPopup')?.classList.remove('show');
}
function selectWicketType(type) {
    closeWicketPopup();

    const outSlot = matchState.striker === '1' ? 'bat1' : 'bat2';
    pendingWicketSlot = outSlot;
    matchState.lastWicketType = type;

    const outName = matchState[outSlot].name;
    matchState[outSlot].isOut = true;
    markPlayerOut(outName);

    addBall('W', { deferOverPopup: true });
    resetPartnership(false);
    triggerHype('WICKET');

    const legalBalls = currentOver.filter(b => !/wd|nb/i.test(String(b))).length;
    pendingBowlerAfterWicket = legalBalls >= 6;

    restoreUIFromState();
    updateActivePlayerCards();
    saveToLocalStorage();

    // Wickets 10ක් ගියාම / batsman ඉතුරු නැත්නම්
    if (matchState.wkts >= 10 || getSelectableNextBatsmen().length === 0) {
        pendingWicketSlot = null;
        selectedNextBatsman = null;
        pendingBowlerAfterWicket = false;

        setTimeout(() => {
            matchState[outSlot] = {
                name: '',
                runs: 0,
                balls: 0,
                fours: 0,
                sixes: 0,
                isOut: false
            };

            const inputEl = document.getElementById(outSlot === 'bat1' ? 'b1Name' : 'b2Name');
            if (inputEl) inputEl.value = '';

            matchState.striker = outSlot === 'bat1' ? '2' : '1';
            postStateChange(true);
        }, 2500);

        broadcastAllOutCardAfterWicket();
        showToast('All Out! Innings Over', 'error');

        if (matchState.target > 0 && matchState.runs < matchState.target) {
            // 2nd innings all out -> bowling side wins
            setTimeout(() => {
                presetResultCard();
            }, 4000);
        } else if (matchState.target <= 0) {
            // 1st innings all out -> innings over card
            setTimeout(() => {
                presetInningsOverCard();
            }, 4000);
        }

        return;
    }

    setTimeout(() => {
        openNextBatsmanPopup();
    }, parseInt(animSettings.wicketDuration, 10) || 3000);
}



function openNextBatsmanPopup() {
    selectedNextBatsman = null;
    document.getElementById('nextBatsmanSearch').value = '';
    renderNextBatsmanList();
    document.getElementById('nextBatsmanPopup')?.classList.add('show');
}

function closeNextBatsmanPopup() {
    document.getElementById('nextBatsmanPopup')?.classList.remove('show');
}

function filterNextBatsmanList() {
    renderNextBatsmanList();
}

function renderNextBatsmanList() {
    const list = document.getElementById('nextBatsmanList');
    if (!list) return;

    const battingPlayers = getBattingTeam()?.players || [];
    const search = (document.getElementById('nextBatsmanSearch')?.value || '').toLowerCase();
    const otherPlayingName = pendingWicketSlot === 'bat1' ? matchState.bat2.name : matchState.bat1.name;

    const filtered = battingPlayers.filter(p =>
        (p.name || '').toLowerCase().includes(search)
    );

    if (!filtered.length) {
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">No available players.</p>';
        return;
    }

    list.innerHTML = filtered.map(p => {
        const isOut = isPlayerDismissed(p.name);
        const isPlaying = p.name === otherPlayingName;
        const disabled = isOut || isPlaying;

        let badge = '';
        if (isOut) badge = `<span class="player-status-badge out">OUT</span>`;
        else if (isPlaying) badge = `<span class="player-status-badge playing">PLAYING</span>`;
        else if (selectedNextBatsman === p.name) badge = `<span class="player-status-badge selected">SELECTED</span>`;

        const photoSrc = p.photo_url || p.photo_base64 || '';

        return `
            <div class="player-option ${disabled ? 'disabled is-out' : ''} ${selectedNextBatsman === p.name ? 'selected' : ''}" onclick="${disabled ? '' : `selectNextBatsman('${escapeAttr(p.name)}')`}">
                <div class="player-option-photo">
                    ${photoSrc ? `<img src="${photoSrc}" alt="">` : getInitial(p.name)}
                </div>
                <div class="player-option-info">
                    <span class="player-option-name">${escapeHtml(p.name)} ${badge}</span>
                    <span class="player-option-meta">${escapeHtml(p.role || 'Player')}</span>
                </div>
            </div>
        `;
    }).join('');
}

function selectNextBatsman(name) {
    selectedNextBatsman = name;
    renderNextBatsmanList();
}

// ==========================================
// 🆕 CONFIRM NEXT BATSMAN (Auto Profile Fix)
// ==========================================
function confirmNextBatsman() {
    if (!selectedNextBatsman || !pendingWicketSlot) {
        showToast('Please select next batsman', 'error');
        return;
    }

    const newBatterName = selectedNextBatsman;

    // Assign the new batter to the slot
    assignBatter(pendingWicketSlot, newBatterName);

    closeNextBatsmanPopup();
    pendingWicketSlot = null;
    selectedNextBatsman = null;

    restoreUIFromState();
    updateActivePlayerCards();
    saveToLocalStorage();

    // 🆕 Get FULL player details for profile card
    const tempPlayer = findPlayerByName(newBatterName, getBattingTeam());
    const playerPhoto = tempPlayer ? (tempPlayer.photo_url || tempPlayer.photo_base64 || '') : '';
    const playerRole = tempPlayer ? (tempPlayer.role || 'BATSMAN') : 'BATSMAN';
    const playerSchool = tempPlayer ? (tempPlayer.school || '') : '';
    const playerAge = tempPlayer ? (tempPlayer.age || '') : '';

    // 🆕 Send FULL profile command (same as manual - this works!)
    sendCommand('show_profile', {
        name: newBatterName,
        photo: playerPhoto,
        role: playerRole,
        school: playerSchool,
        age: playerAge
    });

    // Update live data
    sendLiveData();

    // If over is complete, show bowler popup after profile
    if (pendingBowlerAfterWicket) {
        pendingBowlerAfterWicket = false;
        // Wait for profile to finish, then show bowler popup
        const profileDelay = (parseInt(animSettings.profileDuration, 10) || 5000) + 500;
        setTimeout(() => openBowlerPopup(), profileDelay);
    }

    showToast(`${newBatterName} - Profile shown on scorebar`);
}

// ==========================================
// BOWLER POPUP
// ==========================================
function openBowlerPopup() {
    selectedNextBowler = null;
    renderBowlerList();
    document.getElementById('bowlerPopup')?.classList.add('show');
}

function closeBowlerPopup() {
    document.getElementById('bowlerPopup')?.classList.remove('show');
}

function renderBowlerList() {
    const list = document.getElementById('bowlerSelectList');
    if (!list) return;

    const bowlingPlayers = getBowlingTeam()?.players || [];
    if (!bowlingPlayers.length) {
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">No bowling team players loaded</p>';
        return;
    }

    list.innerHTML = bowlingPlayers.map(p => `
        <div class="bowler-option ${selectedNextBowler === p.name ? 'selected' : ''}" onclick="selectNextBowler(this, '${escapeAttr(p.name)}')">
            <div class="bowler-option-icon">🎯</div>
            <div class="bowler-option-info">
                <span class="bowler-option-name">${escapeHtml(p.name)} ${matchState.bowler.name === p.name ? '<span class="player-status-badge selected">CURRENT</span>' : ''}</span>
                <span class="bowler-option-meta">${escapeHtml(p.role || 'Player')}</span>
            </div>
        </div>
    `).join('');
}

function selectNextBowler(el, name) {
    document.querySelectorAll('.bowler-option').forEach(opt => opt.classList.remove('selected'));
    el.classList.add('selected');
    selectedNextBowler = name;
}

function confirmNextBowler() {
    if (!selectedNextBowler) {
        showToast('Please select a bowler', 'error');
        return;
    }

    assignBowler(selectedNextBowler);
    closeBowlerPopup();
    endOver();
    showToast(`Next bowler: ${selectedNextBowler}`);
}

function endOver() {
    swapStriker(false);
    clearOver(false);
    postStateChange(true);
}

// ==========================================
// BALL BY BALL + HISTORY
// ==========================================
function saveHistory() {
    historyStack.push(JSON.parse(JSON.stringify({
        matchState,
        currentOver
    })));

    if (historyStack.length > 40) {
        historyStack.shift();
    }
}

function applySnapshot(snapshot) {
    if (!snapshot) return;
    matchState = JSON.parse(JSON.stringify(snapshot.matchState));
    currentOver = JSON.parse(JSON.stringify(snapshot.currentOver || []));
}

function addCustomBall() {
    const input = document.getElementById('customBall');
    if (!input || !input.value.trim()) return;

    addBall(input.value.trim());
    input.value = '';
}

function addBall(value, options = {}) {
    const v = String(value).toUpperCase();

    // Target එක ගහලා ඉවර නම් තවත් ලකුණු දාන එක නවත්තනවා
    if (matchState.target > 0 && matchState.runs >= matchState.target && v !== 'UNDO') {
        showToast('Match is already won!', 'error');
        return;
    }

    const ballsBowled = oversToBalls(matchState.overs);
    const maxBalls = matchState.totOvers * 6;

    // Overs ඉවර උනාට පස්සේ ලකුණු දාන එක Block කරනවා
    if (ballsBowled >= maxBalls && v !== 'UNDO' && v !== 'W') {
        showToast('Overs completed! Innings is over.', 'error');
        return;
    }

    if (matchState.wkts >= 10 && v !== 'UNDO') {
        showToast('Innings is over! All Out.', 'error');
        return;
    }

    updateMatchState();
    saveHistory();

    currentOver.push(value);
    matchState.thisOver = currentOver.join(' ');

    processBallScore(value);
    restoreUIFromState();

    if (v === '4') triggerHype('FOUR');
    if (v === '6') triggerHype('SIX');

    const legalBalls = currentOver.filter(b => !/wd|nb/i.test(String(b))).length;
    const newBallsBowled = oversToBalls(matchState.overs);

    // --- 2nd INNINGS: Target එක ගැහුවොත් (Batting Team Won) ---
    if (matchState.target > 0 && matchState.runs >= matchState.target) {
        setTimeout(() => { presetResultCard(); }, parseInt(animSettings.fourDuration, 10) || 2500);
        postStateChange(true);
        return;
    }

    // --- OVERS ඉවර උනොත් වෙන දේ ---
    if (newBallsBowled >= maxBalls) {
        if (matchState.target > 0 && matchState.runs < matchState.target) {
            // 2nd Innings එකේ Overs ඉවරයි, ඒත් Target ගහලා නෑ (Bowling Team Won)
            setTimeout(() => { presetResultCard(); }, 2500);
        } else if (matchState.target <= 0) {
            // 1st Innings එකේ Overs ඉවරයි (Target Card එක පෙන්නනවා)
            setTimeout(() => { presetInningsOverCard(); }, 2500);
        }
    }

    if (legalBalls >= 6 && !options.deferOverPopup && v !== 'W') {
        setTimeout(() => openBowlerPopup(), 500);
    }

    postStateChange(true);
}

function processBallScore(value) {
    const v = String(value).toUpperCase();
    let totalRuns = 0;
    let batterRuns = 0;
    let strikeSwapRuns = 0;
    let isLegal = true;
    let isWicket = false;

    let figures = parseBowlerFigures(
        document.getElementById('bowlFigs')?.value || matchState.bowler.figs
    );

    if (v === '0' || v === '.' || v === '•') {
        totalRuns = 0;
        batterRuns = 0;
        strikeSwapRuns = 0;
    } else if (/^[1-9]$/.test(v)) {
        totalRuns = parseInt(v, 10);
        batterRuns = totalRuns;
        strikeSwapRuns = batterRuns;
    } else if (v === 'W') {
        isWicket = true;
        matchState.wkts++;
        figures.wickets++;
    } else if (v.includes('WD')) {
        const extra = parseInt(v.replace(/WD/ig, ''), 10) || 0;
        totalRuns = 1 + extra;
        batterRuns = 0;
        strikeSwapRuns = 0;
        isLegal = false;
    } else if (v.includes('NB')) {
        const extraBatRuns = parseInt(v.replace(/NB/ig, ''), 10) || 0;
        totalRuns = 1 + extraBatRuns;
        batterRuns = extraBatRuns;
        strikeSwapRuns = extraBatRuns;
        isLegal = false;
        matchState.isFreeHit = true;
    } else if (v.includes('LB')) {
        const lbRuns = parseInt(v.replace(/LB/ig, ''), 10) || 0;
        totalRuns = lbRuns;
        batterRuns = 0;
        strikeSwapRuns = lbRuns;
    } else if (/^B\d+$/i.test(v)) {
        const byeRuns = parseInt(v.replace(/B/ig, ''), 10) || 0;
        totalRuns = byeRuns;
        batterRuns = 0;
        strikeSwapRuns = byeRuns;
    }

    matchState.runs += totalRuns;

    const strikerKey = matchState.striker === '1' ? 'bat1' : 'bat2';
    const striker = matchState[strikerKey];

    if (isLegal || v.includes('NB')) {
        striker.balls += 1;
    }

    if (!isWicket) {
        striker.runs += batterRuns;

        if (batterRuns === 4) striker.fours += 1;
        if (batterRuns === 6) striker.sixes += 1;
    }

    matchState.partRuns += totalRuns;
    if (isLegal) matchState.partBalls += 1;

    figures.runs += totalRuns;
    if (isLegal) figures.balls += 1;

    matchState.bowler.wickets = figures.wickets;
    matchState.bowler.runs = figures.runs;
    matchState.bowler.balls = figures.balls;
    matchState.bowler.figs = formatBowlerFigures(figures);

    if (isLegal) {
        incrementOvers();

        if (matchState.isFreeHit && !v.includes('NB')) {
            matchState.isFreeHit = false;
        }
    }

    if (!isWicket && strikeSwapRuns % 2 === 1) {
        matchState.striker = matchState.striker === '1' ? '2' : '1';
    }
}

function incrementOvers() {
    const balls = oversToBalls(matchState.overs) + 1;
    matchState.overs = ballsToOversString(balls);
}

function undoBall() {
    if (!historyStack.length) {
        showToast('Nothing to undo', 'error');
        return;
    }

    const snapshot = historyStack.pop();
    applySnapshot(snapshot);

    // වැරදිලා Win/All Out උනානම්, Undo කරපු ගමන් Graphics ටිකත් Auto අයින් කරනවා
    matchState.isSpecial = false;
    matchState.specialText = '';
    const specialToggle = document.getElementById('specialToggle');
    if (specialToggle) specialToggle.checked = false;
    sendCommand('hide_graphics');

    postStateChange(true);
    showToast('Last ball undone');
}

function clearOver(send = true) {
    currentOver = [];
    matchState.thisOver = '';
    restoreUIFromState();

    if (send) {
        postStateChange(true);
    }
}

function renderOverDisplay() {
    const container = document.getElementById('overDisplay');
    if (!container) return;

    container.innerHTML = '';

    const balls = currentOver.slice();
    const legalCount = balls.filter(b => !/wd|nb/i.test(String(b))).length;

    balls.forEach((ball, idx) => {
        const div = document.createElement('div');
        div.className = 'ball-slot';

        const v = String(ball).toUpperCase();
        div.textContent = (v === '0' || v === '.') ? '•' : v;

        if (v === '0' || v === '.') div.classList.add('dot');
        else if (v === '4' || v === '6') div.classList.add('boundary');
        else if (v === 'W') div.classList.add('wicket');
        else if (/WD|NB/i.test(v)) div.classList.add('extra');

        if (idx === balls.length - 1) div.classList.add('last');
        container.appendChild(div);
    });

    for (let i = legalCount; i < 6; i++) {
        const empty = document.createElement('div');
        empty.className = 'ball-slot empty';
        container.appendChild(empty);
    }
}

function updateFreeHitBadge() {
    document.getElementById('freeHitBadge')?.classList.toggle('show', matchState.isFreeHit);
}

function isAutoAllOutEnabled() {
    const toggle = document.getElementById('autoAllOutToggle');
    if (toggle) {
        autoAllOutEnabled = toggle.checked;
    }
    return autoAllOutEnabled;
}

function getSelectableNextBatsmen() {
    const battingPlayers = getBattingTeam()?.players || [];
    const outSlot = pendingWicketSlot || (matchState.striker === '1' ? 'bat1' : 'bat2');
    const otherPlayingName = outSlot === 'bat1' ? matchState.bat2.name : matchState.bat1.name;

    return battingPlayers.filter(p => {
        const name = p.name || '';
        if (!name) return false;
        if (isPlayerDismissed(name)) return false;
        if (name === otherPlayingName) return false;
        return true;
    });
}

function shouldCloseInningsAfterWicket() {
    return matchState.wkts >= 10 || getSelectableNextBatsmen().length === 0;
}

function buildAllOutCardPayload() {
    return {
        showAllOutCard: true,
        autoAllOutEnabled: isAutoAllOutEnabled(),
        allOutData: {
            teamName: matchState.batFlag || 'TEAM',
            score: `${matchState.runs}/${matchState.wkts}`,
            overs: matchState.overs || '0.0'
        }
    };
}

function broadcastAllOutCardAfterWicket() {
    if (!isAutoAllOutEnabled()) return;

    const delay =
        (parseInt(animSettings.wicketDuration, 10) || 3000) +
        (parseInt(animSettings.queueGap, 10) || 500);

    setTimeout(() => {
        sendLiveData(buildAllOutCardPayload());
    }, delay);
}

// ==========================================
// STRIKER
// ==========================================
function setStriker(num, shouldSend = true) {
    matchState.striker = String(num);
    updateStrikerUI();
    updateActivePlayerCards();
    if (shouldSend) postStateChange(true);
}

function updateStrikerUI() {
    document.getElementById('strikerBtn1')?.classList.toggle('active', matchState.striker === '1');
    document.getElementById('strikerBtn2')?.classList.toggle('active', matchState.striker === '2');
    document.getElementById('striker1Badge')?.classList.toggle('hidden', matchState.striker !== '1');
    document.getElementById('striker2Badge')?.classList.toggle('hidden', matchState.striker !== '2');
}

function swapStriker(shouldSend = true) {
    matchState.striker = matchState.striker === '1' ? '2' : '1';
    updateStrikerUI();
    updateActivePlayerCards();
    if (shouldSend) postStateChange(true);
}

// ==========================================
// MATCH STATE UI SYNC
// ==========================================
function updateMatchState() {
    // BUG FIX 6: Manual Score Sync - පරණ ලකුණු මතක තියාගන්නවා
    let oldB1Runs = matchState.bat1?.runs || 0;
    let oldB2Runs = matchState.bat2?.runs || 0;

    let newB1Runs = parseInt(document.getElementById('b1Runs')?.value, 10) || 0;
    let newB2Runs = parseInt(document.getElementById('b2Runs')?.value, 10) || 0;

    let b1Diff = newB1Runs - oldB1Runs;
    let b2Diff = newB2Runs - oldB2Runs;

    let currentTotalRuns = parseInt(document.getElementById('runs')?.value, 10) || matchState.runs;

    // Batsman ලකුණු manual වෙනස් කළොත්, ඒක Total Score එකටත් එකතු කරනවා
    if (b1Diff !== 0 || b2Diff !== 0) {
        currentTotalRuns += (b1Diff + b2Diff);
        const runsInput = document.getElementById('runs');
        if (runsInput) runsInput.value = currentTotalRuns; // Input එකත් Update කරනවා
    }

    matchState.runs = currentTotalRuns;

    // BUG FIX 2: Wickets 10ට වඩා වැඩි වෙන එක නවත්තනවා
    let currentWkts = parseInt(document.getElementById('wkts')?.value, 10) || matchState.wkts;
    matchState.wkts = currentWkts > 10 ? 10 : currentWkts;

    matchState.overs = document.getElementById('overs')?.value || matchState.overs;
    matchState.target = parseInt(document.getElementById('target')?.value || matchState.target, 10) || 0;
    const typedTotalOvers = parseInt(document.getElementById('totOvers')?.value || matchState.totOvers, 10) || 20;
    const presetMap = { t10: 10, t20: 20, odi: 50 };

    if (matchState.matchType === 'limited') {
        if (matchState.oversPreset === 'custom') {
            matchState.totOvers = parseInt(document.getElementById('customTotalOvers')?.value || typedTotalOvers, 10) || 20;
        } else {
            matchState.totOvers = presetMap[matchState.oversPreset] || typedTotalOvers || 20;
        }
    } else {
        matchState.totOvers = typedTotalOvers;
    }
    matchState.status = document.getElementById('statusText')?.value || matchState.status;

    matchState.bat1 = {
        ...matchState.bat1,
        name: document.getElementById('b1Name')?.value || '',
        runs: newB1Runs,
        balls: parseInt(document.getElementById('b1Balls')?.value || matchState.bat1.balls, 10) || 0,
        fours: parseInt(document.getElementById('b1Fours')?.value || matchState.bat1.fours, 10) || 0,
        sixes: parseInt(document.getElementById('b1Sixes')?.value || matchState.bat1.sixes, 10) || 0
    };

    matchState.bat2 = {
        ...matchState.bat2,
        name: document.getElementById('b2Name')?.value || '',
        runs: newB2Runs,
        balls: parseInt(document.getElementById('b2Balls')?.value || matchState.bat2.balls, 10) || 0,
        fours: parseInt(document.getElementById('b2Fours')?.value || matchState.bat2.fours, 10) || 0,
        sixes: parseInt(document.getElementById('b2Sixes')?.value || matchState.bat2.sixes, 10) || 0
    };

    const parsedFigs = parseBowlerFigures(document.getElementById('bowlFigs')?.value || matchState.bowler.figs);
    matchState.bowler = {
        ...matchState.bowler,
        name: document.getElementById('bowlName')?.value || '',
        figs: formatBowlerFigures(parsedFigs),
        wickets: parsedFigs.wickets,
        runs: parsedFigs.runs,
        balls: parsedFigs.balls
    };

    matchState.partRuns = parseInt(document.getElementById('partRuns')?.value || matchState.partRuns, 10) || 0;
    matchState.partBalls = parseInt(document.getElementById('partBalls')?.value || matchState.partBalls, 10) || 0;

    matchState.isFreeHit = document.getElementById('freeHitToggle')?.checked ?? matchState.isFreeHit;
    matchState.isSpecial = document.getElementById('specialToggle')?.checked ?? matchState.isSpecial;
    matchState.specialText = document.getElementById('specialText')?.value || matchState.specialText;

    const balls = oversToBalls(matchState.overs);
    matchState.crr = balls > 0 ? (matchState.runs / (balls / 6)).toFixed(2) : '0.00';

    updateTeamsHeader();
    calculateWinProbability();
    updateActivePlayerCards();
}

function restoreUIFromState() {
    document.getElementById('runs').value = matchState.runs;
    document.getElementById('wkts').value = matchState.wkts;
    document.getElementById('overs').value = matchState.overs;
    document.getElementById('target').value = matchState.target;
    document.getElementById('totOvers').value = matchState.totOvers;
    document.getElementById('statusText').value = matchState.status;

    document.getElementById('b1Name').value = matchState.bat1.name;
    document.getElementById('b1Runs').value = matchState.bat1.runs;
    document.getElementById('b1Balls').value = matchState.bat1.balls;
    document.getElementById('b1Fours').value = matchState.bat1.fours;
    document.getElementById('b1Sixes').value = matchState.bat1.sixes;

    document.getElementById('b2Name').value = matchState.bat2.name;
    document.getElementById('b2Runs').value = matchState.bat2.runs;
    document.getElementById('b2Balls').value = matchState.bat2.balls;
    document.getElementById('b2Fours').value = matchState.bat2.fours;
    document.getElementById('b2Sixes').value = matchState.bat2.sixes;

    document.getElementById('bowlName').value = matchState.bowler.name;
    document.getElementById('bowlFigs').value = matchState.bowler.figs;

    document.getElementById('partRuns').value = matchState.partRuns;
    document.getElementById('partBalls').value = matchState.partBalls;
    document.getElementById('freeHitToggle').checked = matchState.isFreeHit;
    document.getElementById('specialToggle').checked = matchState.isSpecial;
    document.getElementById('specialText').value = matchState.specialText;

    document.getElementById('testDay').value = matchState.testDay;
    document.getElementById('testSession').value = matchState.testSession;
    document.getElementById('testInnings').value = matchState.testInnings;

    setMatchType(matchState.matchType, false);
    updateStrikerUI();
    renderOverDisplay();
    updateFreeHitBadge();
    updateCrrDisplay();
    updateActivePlayerCards();
    updateOversPresetUI();

    if (matchState.team1) applySelectedTeamToUI(1);
    if (matchState.team2) applySelectedTeamToUI(2);
    setBattingSide(matchState.battingSide, false);
}

function updateCrrDisplay() {
    calculateWinProbability();

    const crrEl = document.getElementById('crrValue');
    const winProbEl = document.getElementById('winProbValue');

    if (crrEl) crrEl.textContent = matchState.crr;
    if (winProbEl) winProbEl.textContent = `${matchState.winProb}%`;
}

function calculateWinProbability() {
    if (matchState.target <= 0) {
        matchState.winProb = 50;
        return;
    }

    const runsNeeded = matchState.target - matchState.runs;
    const ballsRemaining = (matchState.totOvers * 6) - oversToBalls(matchState.overs);
    const wicketsRemaining = 10 - matchState.wkts;

    if (runsNeeded <= 0) {
        matchState.winProb = 100;
    } else if (wicketsRemaining <= 0 || ballsRemaining <= 0) {
        matchState.winProb = 0;
    } else {
        const rrr = (runsNeeded / ballsRemaining) * 6;
        const crr = parseFloat(matchState.crr) || 0;

        let prob = 50;
        if (crr > rrr) prob += Math.min(40, (crr - rrr) * 10);
        else prob -= Math.min(40, (rrr - crr) * 8);

        prob += (wicketsRemaining - 5) * 3;
        matchState.winProb = Math.max(5, Math.min(95, Math.round(prob)));
    }
}

// ==========================================
// ACTIVE PLAYER CARDS
// ==========================================
function updateActivePlayerCards() {
    const strikerPlayer = matchState.striker === '1' ? matchState.bat1 : matchState.bat2;
    const nonStrikerPlayer = matchState.striker === '1' ? matchState.bat2 : matchState.bat1;

    renderActiveBatterCard('activeStriker', strikerPlayer, getBattingTeam(), true);
    renderActiveBatterCard('activeNonStriker', nonStrikerPlayer, getBattingTeam(), false);
    renderActiveBowlerCard();
}

function renderActiveBatterCard(prefix, batter, team, isStriker) {
    const nameEl = document.getElementById(`${prefix}Name`);
    const photoEl = document.getElementById(`${prefix}Photo`);
    const runsEl = document.getElementById(`${prefix}Runs`);
    const ballsEl = document.getElementById(`${prefix}Balls`);
    const foursEl = document.getElementById(`${prefix}Fours`);
    const sixesEl = document.getElementById(`${prefix}Sixes`);
    const srEl = document.getElementById(`${prefix}SR`);

    if (!nameEl) return;

    nameEl.textContent = batter.name || 'Select Batsman';
    runsEl.textContent = batter.runs || 0;
    ballsEl.textContent = batter.balls || 0;
    foursEl.textContent = batter.fours || 0;
    sixesEl.textContent = batter.sixes || 0;

    const sr = (batter.balls > 0) ? ((batter.runs / batter.balls) * 100).toFixed(2) : '0.00';
    srEl.textContent = sr;

    const player = findPlayerByName(batter.name, team);
    const photoSrc = player?.photo_url || player?.photo_base64 || '';

    if (photoEl) {
        photoEl.innerHTML = photoSrc
            ? `<img src="${photoSrc}" alt="">`
            : `<span>${getInitial(batter.name)}</span>`;
    }
}

function renderActiveBowlerCard() {
    const prefix = 'activeBowler';
    const nameEl = document.getElementById(`${prefix}Name`);
    const photoEl = document.getElementById(`${prefix}Photo`);
    const wicketsEl = document.getElementById(`${prefix}Wickets`);
    const runsEl = document.getElementById(`${prefix}Runs`);
    const oversEl = document.getElementById(`${prefix}Overs`);
    const econEl = document.getElementById(`${prefix}Econ`);
    const figsEl = document.getElementById(`${prefix}Figs`);

    if (!nameEl) return;

    const figs = parseBowlerFigures(matchState.bowler.figs);
    nameEl.textContent = matchState.bowler.name || 'Select Bowler';
    wicketsEl.textContent = figs.wickets;
    runsEl.textContent = figs.runs;
    oversEl.textContent = ballsToOversString(figs.balls);
    econEl.textContent = figs.balls > 0 ? (figs.runs / (figs.balls / 6)).toFixed(2) : '0.00';
    figsEl.textContent = `${figs.wickets}-${figs.runs}`;

    const player = findPlayerByName(matchState.bowler.name, getBowlingTeam());
    const photoSrc = player?.photo_url || player?.photo_base64 || '';

    if (photoEl) {
        photoEl.innerHTML = photoSrc
            ? `<img src="${photoSrc}" alt="">`
            : `<span>${getInitial(matchState.bowler.name)}</span>`;
    }
}

// ==========================================
// HYPE / GRAPHICS
// ==========================================
function triggerHype(type) {
    sendCommand('trigger_hype', { type });
}

function triggerHypeManual(type) {
    triggerHype(type);
    showToast(`${type} animation triggered`);
}

function openProfileControl() {
    document.getElementById('playerProfileModal')?.classList.add('show');
    renderPlayerSelectList();
}

function closePlayerProfileModal() {
    document.getElementById('playerProfileModal')?.classList.remove('show');
}

function renderPlayerSelectList() {
    const list = document.getElementById('playerSelectList');
    if (!list) return;

    const players = allPlayers.map((p, idx) => ({ ...p, __idx: idx }));
    selectedProfilePlayer = null;

    if (!players.length) {
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">No players loaded</p>';
        return;
    }

    list.innerHTML = players.map((p, idx) => {
        const photoSrc = p.photo_url || p.photo_base64 || '';

        return `
            <div class="player-option" onclick="selectPlayerForProfile(${idx})">
                <div class="player-option-photo">
                    ${photoSrc ? `<img src="${photoSrc}" alt="">` : getInitial(p.name)}
                </div>
                <div class="player-option-info">
                    <span class="player-option-name">${escapeHtml(p.name)}</span>
                    <span class="player-option-meta">${escapeHtml(p.role || 'Player')} ${p.school ? '• ' + escapeHtml(p.school) : ''}</span>
                </div>
            </div>
        `;
    }).join('');

    window.__profilePlayers = players;
}

function selectPlayerForProfile(index) {
    const player = window.__profilePlayers?.[index];
    if (!player) return;

    selectedProfilePlayer = player;
    document.getElementById('profileRole').value = player.role || 'PLAYER';
    document.getElementById('profileName').value = player.name || '';
    document.getElementById('profileSchool').value = player.school || '';
    document.getElementById('profileAge').value = player.age || '';

    const photo = document.getElementById('profilePreviewPhoto');
    photo.src = player.photo_url || player.photo_base64 || '';
}

function confirmShowProfile() {
    const profile = {
        role: document.getElementById('profileRole')?.value || 'PLAYER',
        name: document.getElementById('profileName')?.value || '',
        school: document.getElementById('profileSchool')?.value || '',
        age: document.getElementById('profileAge')?.value || '',
        photo: document.getElementById('profilePreviewPhoto')?.src || ''
    };

    if (!profile.name) {
        showToast('Please select a player', 'error');
        return;
    }

    sendCommand('show_profile', profile);
    closePlayerProfileModal();
    showToast('Profile shown on scoreboard');
}

function showMilestone(batterNum) {
    updateMatchState();

    const bat = batterNum === 1 ? matchState.bat1 : matchState.bat2;
    if (!bat.name) {
        showToast('No batter selected', 'error');
        return;
    }

    const player = findPlayerByName(bat.name, getBattingTeam());
    const photo = player ? (player.photo_url || player.photo_base64 || '') : '';

    sendLiveData({
        showMilestone: true,
        milestoneData: {
            name: bat.name,
            runs: bat.runs,
            balls: bat.balls,
            fours: bat.fours,
            sixes: bat.sixes,
            photo
        }
    });

    showToast(`${bat.name} milestone shown`);
}

function showInningsSummary() {
    updateMatchState();
    sendCommand('show_summary', {
        type: 'innings',
        title: 'INNINGS SUMMARY',
        teamName: matchState.batFlag,
        runs: `${matchState.runs}/${matchState.wkts}`,
        overs: matchState.overs,
        target: matchState.target > 0 ? String(matchState.target) : '---',
        batsmen: [
            { name: matchState.bat1.name || '--', runs: matchState.bat1.runs, balls: matchState.bat1.balls },
            { name: matchState.bat2.name || '--', runs: matchState.bat2.runs, balls: matchState.bat2.balls }
        ],
        bowlers: [
            { name: matchState.bowler.name || '--', figs: matchState.bowler.figs }
        ]
    });

    showToast('Innings summary shown');
}

function showMatchSummary() {
    updateMatchState();
    sendCommand('show_summary', {
        type: 'match',
        title: 'MATCH SUMMARY',
        team1Name: matchState.team1?.short_name || 'T1',
        team1FullName: matchState.team1?.name || 'Team 1',
        team1Score: `${matchState.runs}/${matchState.wkts}`,
        team1Overs: matchState.overs,
        team2Name: matchState.team2?.short_name || 'T2',
        team2FullName: matchState.team2?.name || 'Team 2',
        team2Score: matchState.target > 0 ? `${Math.max(matchState.target - 1, 0)}/10` : '0/0',
        team2Overs: `${matchState.totOvers}.0`,
        result: getMatchResult(),
        batsmen: [
            { name: matchState.bat1.name || '--', runs: matchState.bat1.runs, balls: matchState.bat1.balls },
            { name: matchState.bat2.name || '--', runs: matchState.bat2.runs, balls: matchState.bat2.balls }
        ],
        bowlers: [
            { name: matchState.bowler.name || '--', figs: matchState.bowler.figs }
        ]
    });

    showToast('Match summary shown');
}

function getMatchResult() {
    if (matchState.target <= 0) return 'MATCH IN PROGRESS';
    if (matchState.runs >= matchState.target) {
        return `${matchState.batFlag} WON BY ${10 - matchState.wkts} WICKETS`;
    }
    return 'MATCH IN PROGRESS';
}

function hideAllGraphics() {
    document.getElementById('specialToggle').checked = false;
    matchState.isSpecial = false;
    matchState.specialText = '';

    sendCommand('hide_graphics');
    sendLiveData({
        isSpecial: false,
        specialText: ''
    });

    showToast('All graphics hidden');
}

function presetInningsBreak() {
    document.getElementById('specialText').value = 'INNINGS BREAK';
    document.getElementById('specialToggle').checked = true;
    matchState.isSpecial = true;
    matchState.specialText = 'INNINGS BREAK';
    postStateChange(true);
}

function presetDrinkBreak() {
    document.getElementById('specialText').value = '🥤 DRINKS BREAK';
    document.getElementById('specialToggle').checked = true;
    matchState.isSpecial = true;
    matchState.specialText = '🥤 DRINKS BREAK';
    postStateChange(true);
}

// 1st Innings එක ඉවර උනාම පෙන්නන Card එක
function presetInningsOverCard() {
    const teamName = matchState.batFlag || 'TEAM';
    const score = `${matchState.runs}/${matchState.wkts}`;
    const target = (parseInt(matchState.runs, 10) || 0) + 1;

    const resultHtml = `
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

    document.getElementById('specialText').value = resultHtml;
    document.getElementById('specialToggle').checked = true;
    matchState.isSpecial = true;
    matchState.specialText = resultHtml;
    postStateChange(true);
    showToast('Innings Over Card Shown');
}

// Match එක ඉවර උනාම පෙන්නන Result Card එක
function presetResultCard() {
    let winnerName = '';
    let marginText = '';
    let detailsText = '';

    const defendedScore = Math.max((parseInt(matchState.target, 10) || 1) - 1, 0);

    if (matchState.target > 0) {
        if (matchState.runs >= matchState.target) {
            // Batting side won chasing
            winnerName = matchState.batFlag;
            const wktsLeft = Math.max(0, 10 - matchState.wkts);
            marginText = `WON BY ${wktsLeft} WICKET${wktsLeft === 1 ? '' : 'S'}`;
            detailsText = `${matchState.runs}/${matchState.wkts} • ${matchState.overs} OVERS`;
        } else {
            // Bowling side defended
            winnerName = matchState.bowlFlag;
            const runsShort = Math.max(1, defendedScore - matchState.runs);
            marginText = `WON BY ${runsShort} RUN${runsShort === 1 ? '' : 'S'}`;
            detailsText = `DEFENDED ${defendedScore} • ${matchState.batFlag} ${matchState.runs}/${matchState.wkts}`;
        }
    } else {
        winnerName = matchState.batFlag;
        marginText = 'MATCH FINISHED';
        detailsText = `${matchState.runs}/${matchState.wkts} • ${matchState.overs} OVERS`;
    }

    const resultHtml = `
        <div class="result-card-wrap">
            <div class="result-card-kicker">MATCH RESULT</div>
            <div class="result-card-winner">
                <span class="result-card-team">${winnerName}</span>
            </div>
            <div class="result-card-line">${marginText}</div>
            <div class="result-card-sub">${detailsText}</div>
        </div>
    `;

    document.getElementById('specialText').value = resultHtml;
    document.getElementById('specialToggle').checked = true;
    matchState.isSpecial = true;
    matchState.specialText = resultHtml;
    postStateChange(true);
}

function forceView(viewId) {
    lastForceTrig = `${viewId}_${Date.now()}`;
    sendLiveData();
    showToast(`Showing ${viewId.replace('view-', '')}`);
}

// ==========================================
// ANIMATION SETTINGS
// ==========================================
function openAnimationSettings() {
    document.getElementById('animationSettingsModal')?.classList.add('show');
    loadAnimationSettingsUI();
}

function closeAnimationSettings() {
    document.getElementById('animationSettingsModal')?.classList.remove('show');
}

function loadAnimationSettingsUI() {
    const settings = [
        ['fourDuration', 'setFourDuration'],
        ['sixDuration', 'setSixDuration'],
        ['wicketDuration', 'setWicketDuration'],
        ['profileDuration', 'setProfileDuration'],
        ['milestoneDuration', 'setMilestoneDuration'],
        ['carouselInterval', 'setCarouselInterval'],
        ['viewHoldDuration', 'setViewHoldDuration'],
        ['newBatterDelay', 'setNewBatterDelay'],
        ['resultDelay', 'setResultDelay'],
        ['queueGap', 'setQueueGap']
    ];

    settings.forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el) el.value = animSettings[key];
    });

    updateAnimationValueDisplays();
}

function updateAnimationValueDisplays() {
    const map = [
        ['setFourDuration', 'valFourDuration'],
        ['setSixDuration', 'valSixDuration'],
        ['setWicketDuration', 'valWicketDuration'],
        ['setProfileDuration', 'valProfileDuration'],
        ['setMilestoneDuration', 'valMilestoneDuration'],
        ['setCarouselInterval', 'valCarouselInterval'],
        ['setViewHoldDuration', 'valViewHoldDuration'],
        ['setNewBatterDelay', 'valNewBatterDelay'],
        ['setResultDelay', 'valResultDelay'],
        ['setQueueGap', 'valQueueGap']
    ];

    map.forEach(([inputId, valueId]) => {
        const input = document.getElementById(inputId);
        const value = document.getElementById(valueId);
        if (input && value) value.textContent = `${(parseInt(input.value, 10) / 1000).toFixed(1)}s`;
    });
}

function saveAnimationSettings() {
    animSettings = {
        fourDuration: parseInt(document.getElementById('setFourDuration')?.value, 10) || 2500,
        sixDuration: parseInt(document.getElementById('setSixDuration')?.value, 10) || 2500,
        wicketDuration: parseInt(document.getElementById('setWicketDuration')?.value, 10) || 3000,
        profileDuration: parseInt(document.getElementById('setProfileDuration')?.value, 10) || 5000,
        milestoneDuration: parseInt(document.getElementById('setMilestoneDuration')?.value, 10) || 8000,
        carouselInterval: parseInt(document.getElementById('setCarouselInterval')?.value, 10) || 20000,
        viewHoldDuration: parseInt(document.getElementById('setViewHoldDuration')?.value, 10) || 7000,
        newBatterDelay: parseInt(document.getElementById('setNewBatterDelay')?.value, 10) || 1600,
        resultDelay: parseInt(document.getElementById('setResultDelay')?.value, 10) || 3000,
        queueGap: parseInt(document.getElementById('setQueueGap')?.value, 10) || 500
    };

    saveToLocalStorage();
    closeAnimationSettings();
    postStateChange(true);
    showToast('Animation settings saved');
}

function resetAnimationSettings() {
    animSettings = {
        fourDuration: 2500,
        sixDuration: 2500,
        wicketDuration: 3000,
        profileDuration: 5000,
        milestoneDuration: 8000,
        carouselInterval: 20000,
        viewHoldDuration: 7000,
        newBatterDelay: 1600,
        resultDelay: 3000,
        queueGap: 500
    };
    loadAnimationSettingsUI();
    showToast('Settings reset');
}

// ==========================================
// MATCH TYPE
// ==========================================
function setMatchType(type, shouldSend = true) {
    matchState.matchType = type;

    document.getElementById('typeLimit')?.classList.toggle('active', type === 'limited');
    document.getElementById('typeTest')?.classList.toggle('active', type === 'test');
    document.getElementById('testOptions')?.classList.toggle('show', type === 'test');
    document.getElementById('leadDisplay')?.classList.toggle('show', type === 'test');

    if (type === 'limited' && !matchState.oversPreset) {
        matchState.oversPreset = 't20';
    }

    updateOversPresetUI();

    if (shouldSend) postStateChange(true);
}

// ==========================================
// LOCKS
// ==========================================
function toggleLock(section) {
    locks[section] = document.getElementById(`lock${capitalizeFirst(section)}`)?.checked ?? false;

    const sectionEl = document.getElementById(`${section}Section`);
    const icon = document.querySelector(`#lock${capitalizeFirst(section)} + .lock-icon`) ||
        document.getElementById(`lock${capitalizeFirst(section)}`)?.closest('.lock-toggle')?.querySelector('.lock-icon');

    if (sectionEl) sectionEl.classList.toggle('is-locked', locks[section]);
    if (icon) icon.textContent = locks[section] ? '🔒' : '🔓';
}

// ==========================================
// QUICK ACTIONS
// ==========================================
function presetStartMatch() {
    if (!confirm('Start new match? This will reset score data.')) return;

    resetScore(false);
    resetBatsmen(false);
    resetBowler(false);
    resetPartnership(false);

    currentOver = [];
    matchState.dismissedPlayers = [];
    matchState.showUpcomingBatter = false;
    matchState.upcomingBatterName = '';
    matchState.status = 'LIVE MATCH';

    restoreUIFromState();
    renderSquadPreview();
    postStateChange(true);
    showToast('Match started!');
}

function presetChaseStart() {
    updateMatchState();

    const firstInningsScore = matchState.runs;
    if (firstInningsScore <= 0) {
        showToast('No first innings score found', 'error');
        return;
    }

    const oldBattingSide = matchState.battingSide;
    const newBattingSide = oldBattingSide === 1 ? 2 : 1;

    setBattingSide(newBattingSide, false);

    resetScore(false);
    resetBatsmen(false);
    resetBowler(false);
    resetPartnership(false);

    currentOver = [];
    matchState.dismissedPlayers = [];
    matchState.target = firstInningsScore + 1;
    matchState.status = `TARGET: ${matchState.target}`;
    matchState.showUpcomingBatter = false;
    matchState.upcomingBatterName = '';

    // BUG FIX 4: Chase View එක Auto Enable කිරීම සහ Force View යැවීම
    const enChaseToggle = document.getElementById('enChase');
    if (enChaseToggle) enChaseToggle.checked = true;

    calculateWinProbability(); // RRR එක ගණනය කිරීම
    restoreUIFromState();
    renderSquadPreview();

    // Scorebar එකට Chase Graphic එක එක පාරම පෙන්නන්න order දෙනවා
    lastForceTrig = `view-chase_${Date.now()}`;

    sendLiveData();
    saveToLocalStorage();
    showToast(`Chase started! Target ${matchState.target}`);
}

function resetScore(send = true) {
    matchState.runs = 0;
    matchState.wkts = 0;
    matchState.overs = '0.0';
    currentOver = [];
    if (send) postStateChange(true);
}

function resetBatsmen(send = true) {
    matchState.bat1 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };
    matchState.bat2 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };
    matchState.striker = '1';
    matchState.dismissedPlayers = [];

    const b1 = document.getElementById('b1Name');
    const b2 = document.getElementById('b2Name');
    if (b1) b1.value = '';
    if (b2) b2.value = '';

    if (send) postStateChange(true);
    renderSquadPreview();
}

function resetBowler(send = true) {
    matchState.bowler = { name: '', figs: '0-0 0.0', wickets: 0, runs: 0, balls: 0 };
    if (send) postStateChange(true);
}

function resetPartnership(send = true) {
    matchState.partRuns = 0;
    matchState.partBalls = 0;
    if (send) postStateChange(true);
}

function clearAllData() {
    if (!confirm('⚠️ WARNING: This will clear ALL match data. Are you sure?')) return;
    if (!confirm('🔴 FINAL WARNING: This action CANNOT be undone. Continue?')) return;

    isClearing = true;

    // ... existing matchState reset code ...

    // Clear Firebase match data
    if (database) {
        database.ref(`matches/${matchId}`).set(null);
    }

    localStorage.removeItem(CONFIG.STORAGE_KEY);
    localStorage.removeItem('matchId');

    // 🆕 Use new cache key
    localStorage.removeItem(CONFIG.CACHE.TEAMS_KEY);
    localStorage.removeItem(CONFIG.CACHE.VERSION_KEY);

    showToast('All data cleared! Reloading...');

    setTimeout(() => {
        location.reload(true);
    }, 600);
}

// ==========================================
// STORAGE
// ==========================================
function saveToLocalStorage() {
    if (isClearing) return;

    const data = {
        matchId,
        matchState,
        animSettings,
        currentOver,
        msgCount,
        autoAllOutEnabled,
        timestamp: Date.now()
    };
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem('matchId', matchId);
}

function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (!raw) return;

        const data = JSON.parse(raw);
        if (data.timestamp && (Date.now() - data.timestamp) < 86400000 * 7) {
            if (data.matchId) matchId = data.matchId;
            if (data.matchState) matchState = { ...matchState, ...data.matchState };
            if (data.animSettings) animSettings = { ...animSettings, ...data.animSettings };
            if (Array.isArray(data.currentOver)) currentOver = data.currentOver;
            if (data.msgCount) msgCount = data.msgCount;
            if (typeof data.autoAllOutEnabled === 'boolean') autoAllOutEnabled = data.autoAllOutEnabled;

            matchState.dismissedPlayers = matchState.dismissedPlayers || [];
            matchState.bat1 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, ...matchState.bat1 };
            matchState.bat2 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, ...matchState.bat2 };
            matchState.bowler = { name: '', figs: '0-0 0.0', wickets: 0, runs: 0, balls: 0, ...matchState.bowler };
            if (!matchState.oversPreset) {
                if (matchState.totOvers === 10) matchState.oversPreset = 't10';
                else if (matchState.totOvers === 20) matchState.oversPreset = 't20';
                else if (matchState.totOvers === 50) matchState.oversPreset = 'odi';
                else matchState.oversPreset = 'custom';
            }
        }
    } catch (e) {
        console.error('Load local state failed', e);
    }
}

function updateStorageInfo() {
    const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
    const size = saved ? (saved.length / 1024).toFixed(1) : '0';
    const sizeEl = document.getElementById('storageSize');
    const timeEl = document.getElementById('lastSaveTime');

    if (sizeEl) sizeEl.textContent = `${size} KB`;

    if (timeEl && saved) {
        try {
            const data = JSON.parse(saved);
            timeEl.textContent = data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '--';
        } catch {
            timeEl.textContent = '--';
        }
    }
}

function exportData() {
    const data = {
        exported: new Date().toISOString(),
        version: '29.0',
        matchId,
        matchState,
        animSettings,
        currentOver
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `admin-match-${matchId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('Data exported');
}

function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (!data.matchState) {
                showToast('Invalid file', 'error');
                return;
            }

            if (data.matchId) matchId = data.matchId;
            matchState = { ...matchState, ...data.matchState };
            currentOver = data.currentOver || [];
            animSettings = { ...animSettings, ...(data.animSettings || {}) };

            restoreUIFromState();
            saveToLocalStorage();
            updateActivePlayerCards();
            postStateChange(true);

            document.getElementById('matchIdDisplay').textContent = matchId;
            showToast('Data imported');
        } catch (e) {
            console.error(e);
            showToast('Import failed', 'error');
        }
    };

    input.click();
}

function clearSavedData() {
    if (!confirm('Clear ALL browser saved admin state?')) return;

    localStorage.removeItem(CONFIG.STORAGE_KEY);
    localStorage.removeItem('matchId');
    localStorage.removeItem('cricket_teams_cache');
    localStorage.removeItem('cricket_teams_time');

    // 🆕 Clear teams cache too
    clearTeamsCache();

    showToast('All saved data cleared. Refresh to start fresh.');
}

// ==========================================
// BOWLER FIGURES HELPERS
// ==========================================
function parseBowlerFigures(text) {
    const str = String(text || '0-0 0.0').trim();
    const parts = str.split(' ');
    const wr = (parts[0] || '0-0').split('-');
    const ob = (parts[1] || '0.0').split('.');

    return {
        wickets: parseInt(wr[0], 10) || 0,
        runs: parseInt(wr[1], 10) || 0,
        balls: ((parseInt(ob[0], 10) || 0) * 6) + (parseInt(ob[1], 10) || 0)
    };
}

function formatBowlerFigures(figs) {
    return `${figs.wickets}-${figs.runs} ${ballsToOversString(figs.balls)}`;
}

function updateOversPresetUI() {
    const limitedSection = document.getElementById('limitedOversSection');
    const customRow = document.getElementById('customOversRow');
    const summary = document.getElementById('oversPresetSummary');
    const customInput = document.getElementById('customTotalOvers');
    const totalOversInput = document.getElementById('totOvers');

    if (limitedSection) {
        limitedSection.style.display = matchState.matchType === 'limited' ? 'block' : 'none';
    }

    ['t10', 't20', 'odi', 'custom'].forEach(key => {
        const btn = document.getElementById(`oversPreset_${key}`);
        if (btn) btn.classList.toggle('active', matchState.oversPreset === key);
    });

    if (customRow) {
        customRow.classList.toggle('show', matchState.oversPreset === 'custom');
    }

    if (customInput && document.activeElement !== customInput) {
        customInput.value = matchState.totOvers;
    }

    if (totalOversInput) {
        totalOversInput.value = matchState.totOvers;
    }

    if (summary) {
        if (matchState.matchType === 'test') {
            summary.textContent = 'Multi-day match format';
        } else {
            summary.textContent = `${matchState.totOvers} overs per innings`;
        }
    }
}

function setOversPreset(preset, shouldSend = true) {
    if (matchState.matchType === 'test') return;

    matchState.oversPreset = preset;

    const presetMap = {
        t10: 10,
        t20: 20,
        odi: 50
    };

    if (preset !== 'custom') {
        matchState.totOvers = presetMap[preset] || 20;
    } else {
        const customVal = parseInt(document.getElementById('customTotalOvers')?.value, 10) || matchState.totOvers || 20;
        matchState.totOvers = customVal;
    }

    updateOversPresetUI();

    if (shouldSend) {
        postStateChange(true);
    }
}

function syncCustomOvers() {
    matchState.oversPreset = 'custom';

    const customVal = parseInt(document.getElementById('customTotalOvers')?.value, 10) || 20;
    matchState.totOvers = customVal;

    updateOversPresetUI();
    postStateChange(true);
}

// ==========================================
// UTILS
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

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function getInitial(name) {
    return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

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

function debounce(fn, delay) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ==========================================
// TOAST
// ==========================================
function showToast(message, type = 'success') {
    const toastId = type === 'error' ? 'toastError' : 'toastSuccess';
    const textId = type === 'error' ? 'toastErrorText' : 'toastSuccessText';

    const toast = document.getElementById(toastId);
    const text = document.getElementById(textId);

    if (!toast || !text) return;

    text.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ==========================================
// WINDOW EVENTS
// ==========================================
window.addEventListener('beforeunload', () => {
    if (isClearing) return;

    stopPingMonitor();
    stopPresenceRefresh();

    if (database) {
        database.ref(`presence/${matchId}/admin`).set({
            online: false,
            lastSeen: Date.now(),
            version: '29.0',
            pingMs: 0
        });
    }

    saveToLocalStorage();
});

document.addEventListener('visibilitychange', () => {
    // No heartbeat needed - Firebase Presence handles it
});

// ==========================================
// KEYBOARD SHORTCUTS
// ==========================================
document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    switch (e.key) {
        case '0':
        case '.':
            addBall('0');
            break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
            addBall(e.key);
            break;
        case 'w':
        case 'W':
            openWicketPopup();
            break;
        case 's':
        case 'S':
            swapStriker();
            break;
        case 'u':
        case 'U':
            undoBall();
            break;
        case 'Escape':
            closeTeamSelector();
            closePlayerPicker();
            closeBowlerPopup();
            closeWicketPopup();
            closeNextBatsmanPopup();
            closePlayerProfileModal();
            closeAnimationSettings();
            break;
    }
});

// ==========================================
// END OF ADMIN.JS V29.0 FIREBASE OPTIMIZED
// ==========================================
console.log('🏏 Admin.js V29.0 Firebase Optimized Loaded');