// ==========================================
// MONITOR.JS - V31.0 FIREBASE OPTIMIZED
// System Monitor Dashboard - 100% Firebase
// Zero Bandwidth Presence + Metrics Panel
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
        MAX_AGE_MS: 24 * 60 * 60 * 1000
    },
    SITE_URLS: {
        scorebar: 'https://stccricketscoreboard.vercel.app/favicon.ico',
        admin: 'https://stccricketscoreboardadmin.vercel.app/favicon.ico',
        updater: 'https://scoreupdater.vercel.app/favicon.ico',
        team: 'https://teamediteor.vercel.app/favicon.ico'
    },
    INTERVALS: {
        SITE_PING: 15000,
        DB_HEALTH: 25000,
        WATCHDOG: 3000,
        TRAFFIC_UPDATE: 1000,
        CLOCK: 1000,
        ERROR_CLEAN_INTERVAL: 60000,
        ERROR_RESOLVED_KEEP_MS: 5 * 60 * 1000
    },
    CRITICAL_SERVICES: ['admin', 'scorebar', 'updater', 'realtime']
};

// ==========================================
// GLOBAL STATE
// ==========================================
let matchId = localStorage.getItem('matchId') || 'my_match_999';
let firebaseApp = null;
let database = null;
let isConnected = false;
let logPaused = false;
let currentTeamsVersion = 0;
let teamVersionListenerAttached = false;

// Alert Settings
let alertSettings = {
    admin: true,
    updater: true,
    scorebar: true,
    sound: true
};

let lastCriticalSignature = '';
let lastCriticalUnackSignature = '';
let acknowledgedIssues = new Set();
let criticalWasVisible = false;

let audioUnlocked = false;
let sharedAudioContext = null;

// Error Store
const errorStore = {
    seq: 0,
    map: new Map(),
    activeByFingerprint: new Map(),
    resolvedCount: 0
};

// Services State
const services = {
    admin: createServiceState('admin'),
    scorebar: createServiceState('scorebar'),
    updater: createServiceState('updater'),
    team: createServiceState('team'),
    db: createDbState(),
    realtime: createRealtimeState()
};

// Traffic Metrics
const traffic = {
    rt: { current: 0, history: new Array(20).fill(0) },
    http: { current: 0, history: new Array(20).fill(0) }
};

const totals = {
    messages: 0,
    alerts: 0
};

// ==========================================
// FIREBASE METRICS (Estimated)
// NOTE: Browser-side estimate only.
// Not exact Firebase Console billing values.
// ==========================================
const firebaseMetrics = {
    reads: 0,
    writes: 0,
    listenerEvents: 0,
    downloadBytes: 0,
    uploadBytes: 0,

    current: {
        reads: 0,
        writes: 0,
        listener: 0,
        bandwidthKB: 0
    },

    history: {
        reads: new Array(20).fill(0),
        writes: new Array(20).fill(0),
        listener: new Array(20).fill(0),
        bandwidth: new Array(20).fill(0)
    }
};

// Live Match Data
const liveMatch = {
    runs: 0,
    wkts: 0,
    overs: '0.0',
    balls: 0,
    crr: '0.00',
    target: 0,
    winProb: 50,
    partRuns: 0,
    partBalls: 0,
    batTeam: 'BAT',
    bowlTeam: 'BOWL',
    matchType: 'limited',
    overBalls: [],
    freeHit: false,
    striker: { name: '--', runs: 0, balls: 0, fours: 0, sixes: 0, photo: '' },
    nonStriker: { name: '--', runs: 0, balls: 0, fours: 0, sixes: 0, photo: '' },
    bowler: { name: '--', figs: '0-0 0.0', photo: '' },
    upcoming: { show: false, name: '', photo: '' },
    profile: null
};

// ==========================================
// UPDATER DEVICE STATE
// ==========================================
let updaterDeviceState = {
    online: false,
    name: '',
    pingMs: null,
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
    pendingManualPush: false,
    lastSeen: 0
};

// Player Cache
const playerCache = new Map();

// Over History
let overHistory = [];
let lastRecordedOver = -1;
let lastRecordedScore = 0;

// ==========================================
// STATE FACTORIES
// ==========================================
function createServiceState(name) {
    return {
        name,
        online: false,
        lastHeartbeat: 0,
        heartbeatCount: 0,
        ping: 0,
        visible: false,
        version: '',
        errors: 0,
        requests: 0,
        siteReachable: false,
        siteLatency: 0,
        reason: 'Waiting for presence...'
    };
}

function createDbState() {
    return {
        online: false,
        lastCheck: 0,
        ping: 0,
        teams: 0,
        players: 0,
        errors: 0,
        requests: 0,
        reason: 'Not checked yet'
    };
}

function createRealtimeState() {
    return {
        online: false,
        lastConnect: 0,
        ping: 0,
        messagesReceived: 0,
        errors: 0,
        reason: 'Connecting...'
    };
}

// ==========================================
// CACHE HELPERS
// ==========================================
function loadTeamsFromCache() {
    try {
        const cached = localStorage.getItem(CONFIG.CACHE.TEAMS_KEY);
        if (!cached) return null;

        const data = JSON.parse(cached);
        if ((Date.now() - (data.timestamp || 0)) > CONFIG.CACHE.MAX_AGE_MS) {
            return null;
        }

        return data;
    } catch (e) {
        return null;
    }
}

function saveTeamsToCache(teamsData, playersData, version) {
    try {
        const existing = loadTeamsFromCache() || {};
        const payload = {
            teams: teamsData ?? existing.teams ?? {},
            players: playersData ?? existing.players ?? {},
            version: version ?? existing.version ?? Date.now(),
            timestamp: Date.now()
        };
        localStorage.setItem(CONFIG.CACHE.TEAMS_KEY, JSON.stringify(payload));
    } catch (e) { }
}

// ==========================================
// HELPERS
// ==========================================
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text || '';
}

function getInitial(name) {
    return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function oversToBalls(oversStr) {
    const parts = String(oversStr || '0.0').split('.');
    return (parseInt(parts[0] || '0', 10) * 6) + parseInt(parts[1] || '0', 10);
}

function calculateRRR() {
    const target = Number(liveMatch.target || 0);
    const runs = Number(liveMatch.runs || 0);
    const balls = Number(liveMatch.balls || 0);

    if (target <= 0) return '0.00';

    const need = Math.max(0, target - runs);
    const remainingBalls = Math.max(1, 120 - balls);

    return (need / (remainingBalls / 6)).toFixed(2);
}

function getDisplayPing(serviceKey) {
    const s = services[serviceKey];
    if (!s) return 0;

    if (serviceKey === 'realtime') {
        return Math.max(0, Math.round(s.ping || 0));
    }

    if (s.siteLatency && s.siteLatency > 0) return Math.round(s.siteLatency);
    if (s.ping && s.ping > 0) return Math.round(s.ping);

    return 0;
}

function setAvatar(id, name, photo) {
    const el = document.getElementById(id);
    if (!el) return;

    if (photo) {
        el.innerHTML = `<img src="${photo}" alt="${escapeHtml(name || 'Player')}">`;
    } else {
        el.textContent = getInitial(name);
    }
}

// ==========================================
// FIREBASE METRICS HELPERS
// ==========================================
function getPayloadSizeBytes(data) {
    try {
        return new Blob([JSON.stringify(data || {})]).size || 0;
    } catch (e) {
        return 0;
    }
}

function trackFirebaseRead(payload = null, count = 1) {
    firebaseMetrics.reads += count;
    firebaseMetrics.current.reads += count;

    const bytes = payload ? getPayloadSizeBytes(payload) : 0;
    firebaseMetrics.downloadBytes += bytes;
    firebaseMetrics.current.bandwidthKB += bytes / 1024;
}

function trackFirebaseWrite(payload = null, count = 1) {
    firebaseMetrics.writes += count;
    firebaseMetrics.current.writes += count;

    const bytes = payload ? getPayloadSizeBytes(payload) : 0;
    firebaseMetrics.uploadBytes += bytes;
    firebaseMetrics.current.bandwidthKB += bytes / 1024;
}

function trackFirebaseListenerEvent(payload = null) {
    firebaseMetrics.listenerEvents += 1;
    firebaseMetrics.current.listener += 1;

    const bytes = payload ? getPayloadSizeBytes(payload) : 0;
    firebaseMetrics.downloadBytes += bytes;
    firebaseMetrics.current.bandwidthKB += bytes / 1024;
}

function resetFirebaseMetrics() {
    firebaseMetrics.reads = 0;
    firebaseMetrics.writes = 0;
    firebaseMetrics.listenerEvents = 0;
    firebaseMetrics.downloadBytes = 0;
    firebaseMetrics.uploadBytes = 0;

    firebaseMetrics.current = {
        reads: 0,
        writes: 0,
        listener: 0,
        bandwidthKB: 0
    };

    firebaseMetrics.history.reads = new Array(20).fill(0);
    firebaseMetrics.history.writes = new Array(20).fill(0);
    firebaseMetrics.history.listener = new Array(20).fill(0);
    firebaseMetrics.history.bandwidth = new Array(20).fill(0);

    renderBars('fmReadsBars', firebaseMetrics.history.reads, 'rt');
    renderBars('fmWritesBars', firebaseMetrics.history.writes, 'http');
    renderBars('fmListenerBars', firebaseMetrics.history.listener, 'rt');
    renderBars('fmBandwidthBars', firebaseMetrics.history.bandwidth, 'http');
    updateFirebaseMetricsUI();

    addLog('Firebase metrics reset', 'ok');
}

function pushFirebaseMetricsHistory() {
    firebaseMetrics.history.reads.shift();
    firebaseMetrics.history.reads.push(firebaseMetrics.current.reads);

    firebaseMetrics.history.writes.shift();
    firebaseMetrics.history.writes.push(firebaseMetrics.current.writes);

    firebaseMetrics.history.listener.shift();
    firebaseMetrics.history.listener.push(firebaseMetrics.current.listener);

    firebaseMetrics.history.bandwidth.shift();
    firebaseMetrics.history.bandwidth.push(Number(firebaseMetrics.current.bandwidthKB.toFixed(2)));

    firebaseMetrics.current.reads = 0;
    firebaseMetrics.current.writes = 0;
    firebaseMetrics.current.listener = 0;
    firebaseMetrics.current.bandwidthKB = 0;

    renderBars('fmReadsBars', firebaseMetrics.history.reads, 'rt');
    renderBars('fmWritesBars', firebaseMetrics.history.writes, 'http');
    renderBars('fmListenerBars', firebaseMetrics.history.listener, 'rt');
    renderBars('fmBandwidthBars', firebaseMetrics.history.bandwidth, 'http');

    updateFirebaseMetricsUI();
}

function updateFirebaseMetricsUI() {
    const totalBandwidthKB = ((firebaseMetrics.downloadBytes + firebaseMetrics.uploadBytes) / 1024);

    setText('fmReadsValue', String(firebaseMetrics.reads));
    setText('fmWritesValue', String(firebaseMetrics.writes));
    setText('fmListenerValue', String(firebaseMetrics.listenerEvents));
    setText('fmBandwidthValue', `${totalBandwidthKB.toFixed(1)} KB`);

    const readsPerMin = firebaseMetrics.history.reads.slice(-10).reduce((a, b) => a + b, 0) * 6;
    const writesPerMin = firebaseMetrics.history.writes.slice(-10).reduce((a, b) => a + b, 0) * 6;
    const listenerPerMin = firebaseMetrics.history.listener.slice(-10).reduce((a, b) => a + b, 0) * 6;

    setText('fmReadsSub', `${readsPerMin} / min`);
    setText('fmWritesSub', `${writesPerMin} / min`);
    setText('fmListenerSub', `${listenerPerMin} / min`);
    setText(
        'fmBandwidthSub',
        `${(firebaseMetrics.downloadBytes / 1024).toFixed(1)} KB down • ${(firebaseMetrics.uploadBytes / 1024).toFixed(1)} KB up`
    );

    const latestRead = firebaseMetrics.history.reads[firebaseMetrics.history.reads.length - 1] || 0;
    const latestWrite = firebaseMetrics.history.writes[firebaseMetrics.history.writes.length - 1] || 0;
    const latestListener = firebaseMetrics.history.listener[firebaseMetrics.history.listener.length - 1] || 0;
    const latestBandwidth = firebaseMetrics.history.bandwidth[firebaseMetrics.history.bandwidth.length - 1] || 0;

    updateInfraBar('fmReadLoadBar', 'fmReadLoadText', Math.min(100, latestRead * 10), `${Math.min(100, latestRead * 10)}%`);
    updateInfraBar('fmWriteLoadBar', 'fmWriteLoadText', Math.min(100, latestWrite * 12), `${Math.min(100, latestWrite * 12)}%`);
    updateInfraBar('fmListenerLoadBar', 'fmListenerLoadText', Math.min(100, latestListener * 10), `${Math.min(100, latestListener * 10)}%`);
    updateInfraBar('fmBandwidthLoadBar', 'fmBandwidthLoadText', Math.min(100, latestBandwidth * 8), `${Math.min(100, latestBandwidth * 8)}%`);
}

// ==========================================
// UPDATER DEVICE HELPERS
// ==========================================
function monitorSignalBarsText(bars = 0) {
    const map = ['○○○○', '●○○○', '●●○○', '●●●○', '●●●●'];
    return map[bars] || '○○○○';
}

function ingestUpdaterDevicePresence(updaterPresence = {}) {
    const d = updaterPresence.device || {};

    updaterDeviceState = {
        online: updaterPresence.online === true,
        name: updaterPresence.name || '',
        pingMs: updaterPresence.pingMs ?? null,
        lastSeen: updaterPresence.lastSeen || 0,
        battery: {
            supported: d.battery?.supported ?? false,
            level: d.battery?.level ?? null,
            charging: d.battery?.charging ?? null,
            low: d.battery?.low ?? false,
            critical: d.battery?.critical ?? false
        },
        network: {
            online: d.network?.online ?? false,
            rawType: d.network?.rawType || 'unknown',
            effectiveType: d.network?.effectiveType || 'unknown',
            label: d.network?.label || 'Unknown',
            signalBars: d.network?.signalBars ?? 0,
            signalPct: d.network?.signalPct ?? 0,
            downlink: d.network?.downlink ?? 0,
            rtt: d.network?.rtt ?? 0,
            unstable: d.network?.unstable ?? false
        },
        autoRealtimeEnabled: d.autoRealtimeEnabled ?? true,
        pendingManualPush: d.pendingManualPush ?? false
    };

    renderUpdaterDevicePanel();
}

function setMetricTone(el, tone) {
    if (!el) return;
    el.classList.remove('good', 'warn', 'bad');
    if (tone) el.classList.add(tone);
}

function renderUpdaterDevicePanel() {
    const onlinePill = document.getElementById('updDeviceOnlinePill');
    const sub = document.getElementById('updDeviceSub');

    const batteryCard = document.getElementById('updBatteryCard');
    const batteryValue = document.getElementById('updBatteryValue');
    const batteryMeta = document.getElementById('updBatteryMeta');

    const networkCard = document.getElementById('updNetworkCard');
    const networkValue = document.getElementById('updNetworkValue');
    const networkMeta = document.getElementById('updNetworkMeta');

    const signalCard = document.getElementById('updSignalCard');
    const signalBars = document.getElementById('updSignalBars');
    const signalMeta = document.getElementById('updSignalMeta');

    const pushCard = document.getElementById('updPushCard');
    const pushModeValue = document.getElementById('updPushModeValue');
    const pushModeMeta = document.getElementById('updPushModeMeta');

    const pingValue = document.getElementById('updPingValue');
    const pingMeta = document.getElementById('updPingMeta');

    const stabilityCard = document.getElementById('updStabilityCard');
    const stabilityValue = document.getElementById('updStabilityValue');
    const stabilityMeta = document.getElementById('updStabilityMeta');

    if (onlinePill) {
        onlinePill.className = 'status-pill ' + (updaterDeviceState.online ? 'online' : 'offline');
        onlinePill.textContent = updaterDeviceState.online ? 'Online' : 'Offline';
    }

    if (sub) {
        const who = updaterDeviceState.name || 'Updater';
        sub.textContent = updaterDeviceState.online
            ? `${who} device telemetry is live`
            : `${who} device telemetry unavailable`;
    }

    // Battery
    if (batteryValue) {
        batteryValue.textContent = updaterDeviceState.battery.supported
            ? `${updaterDeviceState.battery.level ?? '--'}%`
            : 'Unsupported';
    }

    if (batteryMeta) {
        if (!updaterDeviceState.battery.supported) {
            batteryMeta.textContent = 'Battery API unsupported';
        } else {
            const parts = [];
            parts.push(updaterDeviceState.battery.charging ? 'Charging ⚡' : 'Discharging');
            if (updaterDeviceState.battery.critical) parts.push('Critical');
            else if (updaterDeviceState.battery.low) parts.push('Low');
            else parts.push('Normal');
            batteryMeta.textContent = parts.join(' • ');
        }
    }

    if (batteryCard) {
        let tone = 'good';
        if (updaterDeviceState.battery.critical) tone = 'bad';
        else if (updaterDeviceState.battery.low) tone = 'warn';
        setMetricTone(batteryCard, tone);
    }

    // Network
    if (networkValue) {
        networkValue.textContent = updaterDeviceState.network.online
            ? (updaterDeviceState.network.label || 'Unknown')
            : 'OFFLINE';
    }

    if (networkMeta) {
        networkMeta.textContent = updaterDeviceState.network.online
            ? `${updaterDeviceState.network.effectiveType || 'n/a'} • RTT ${updaterDeviceState.network.rtt || 0} ms`
            : 'No internet';
    }

    if (networkCard) {
        let tone = 'good';
        if (!updaterDeviceState.network.online) tone = 'bad';
        else if (updaterDeviceState.network.unstable) tone = 'warn';
        setMetricTone(networkCard, tone);
    }

    // Signal
    if (signalBars) {
        signalBars.textContent = monitorSignalBarsText(updaterDeviceState.network.signalBars || 0);
        signalBars.classList.remove('signal-bars-good', 'signal-bars-warn', 'signal-bars-bad');

        if ((updaterDeviceState.network.signalBars || 0) >= 3) {
            signalBars.classList.add('signal-bars-good');
        } else if ((updaterDeviceState.network.signalBars || 0) >= 2) {
            signalBars.classList.add('signal-bars-warn');
        } else {
            signalBars.classList.add('signal-bars-bad');
        }
    }

    if (signalMeta) {
        signalMeta.textContent = `${updaterDeviceState.network.signalPct || 0}% signal`;
    }

    if (signalCard) {
        let tone = 'good';
        if ((updaterDeviceState.network.signalBars || 0) <= 1) tone = 'bad';
        else if ((updaterDeviceState.network.signalBars || 0) === 2) tone = 'warn';
        setMetricTone(signalCard, tone);
    }

    // Push Mode
    if (pushModeValue) {
        pushModeValue.textContent = updaterDeviceState.autoRealtimeEnabled ? 'AUTO' : 'MANUAL';
    }

    if (pushModeMeta) {
        pushModeMeta.textContent = updaterDeviceState.pendingManualPush
            ? 'Pending manual push'
            : (updaterDeviceState.autoRealtimeEnabled ? 'Realtime enabled' : 'Manual mode idle');
    }

    if (pushCard) {
        let tone = updaterDeviceState.autoRealtimeEnabled ? 'good' : 'warn';
        if (updaterDeviceState.pendingManualPush) tone = 'bad';
        setMetricTone(pushCard, tone);
    }

    // Ping
    if (pingValue) {
        pingValue.textContent = updaterDeviceState.pingMs ? `${updaterDeviceState.pingMs} ms` : '-- ms';
    }

    if (pingMeta) {
        const lastSeenText = updaterDeviceState.lastSeen
            ? new Date(updaterDeviceState.lastSeen).toLocaleTimeString()
            : '--';
        pingMeta.textContent = `Last seen ${lastSeenText}`;
    }

    // Stability
    if (stabilityValue) {
        if (!updaterDeviceState.network.online) stabilityValue.textContent = 'OFFLINE';
        else if (updaterDeviceState.network.unstable) stabilityValue.textContent = 'UNSTABLE';
        else stabilityValue.textContent = 'STABLE';
    }

    if (stabilityMeta) {
        stabilityMeta.textContent = updaterDeviceState.network.online
            ? `${updaterDeviceState.network.downlink || 0} Mbps • ${updaterDeviceState.network.rtt || 0} ms RTT`
            : 'No connection';
    }

    if (stabilityCard) {
        let tone = 'good';
        if (!updaterDeviceState.network.online) tone = 'bad';
        else if (updaterDeviceState.network.unstable) tone = 'warn';
        setMetricTone(stabilityCard, tone);
    }
}

// ==========================================
// AUDIO
// ==========================================
function unlockAudio() {
    if (audioUnlocked) return;

    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;

        if (!sharedAudioContext) {
            sharedAudioContext = new AudioCtx();
        }

        if (sharedAudioContext.state === 'suspended') {
            sharedAudioContext.resume().then(() => {
                audioUnlocked = true;
                addLog('Audio alerts unlocked', 'ok');
            }).catch(() => { });
        } else {
            audioUnlocked = true;
            addLog('Audio alerts unlocked', 'ok');
        }
    } catch (e) { }
}

function playAlertSound() {
    if (!alertSettings.sound) return;

    try {
        if (!audioUnlocked) return;

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;

        if (!sharedAudioContext) {
            sharedAudioContext = new AudioCtx();
        }

        if (sharedAudioContext.state === 'suspended') {
            sharedAudioContext.resume().catch(() => { });
        }

        const ctx = sharedAudioContext;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);

        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
        osc.type = 'sine';

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.26);
    } catch (e) { }
}

// ==========================================
// ERROR TRACKING
// ==========================================
function calculateErrorWeight(category, message = '') {
    if (category === 'realtime_connection' || category === 'db_fatal') return 5;
    if (category === 'timeout' || category === 'service_offline') return 3;
    if (category === 'http_5xx') return 4;
    if (category === 'fetch' || category === 'site_unreachable') return 2;
    if (message.includes('500') || message.includes('502') || message.includes('503')) return 4;
    return 1;
}

function addTrackedError(message, category = 'general', serviceKey = null, fingerprint = null) {
    const fp = fingerprint || `${serviceKey || 'global'}::${category}::${message}`;

    if (errorStore.activeByFingerprint.has(fp)) {
        const existingId = errorStore.activeByFingerprint.get(fp);
        const existing = errorStore.map.get(existingId);
        if (existing) {
            existing.lastSeenAt = Date.now();
            return existing.id;
        }
    }

    const id = ++errorStore.seq;
    const errorObj = {
        id,
        message,
        category,
        serviceKey,
        fingerprint: fp,
        weight: calculateErrorWeight(category, message),
        active: true,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        resolvedAt: 0
    };

    errorStore.map.set(id, errorObj);
    errorStore.activeByFingerprint.set(fp, id);

    addAlert(message, 'err');
    addLog(`[ERROR] ${message}`, 'err');
    updateErrorMetrics();

    return id;
}

function resolveErrorsByFilter(filterFn, options = {}) {
    let count = 0;
    const now = Date.now();

    errorStore.map.forEach((err) => {
        if (err.active && filterFn(err)) {
            err.active = false;
            err.resolvedAt = now;
            errorStore.activeByFingerprint.delete(err.fingerprint);
            errorStore.resolvedCount++;
            count++;
        }
    });

    if (count > 0 && !options.silent) {
        if (options.message) addAlert(options.message, 'ok');
        if (options.log) addLog(options.log, 'ok');
    }

    updateErrorMetrics();
    return count;
}

function resolveErrorsByService(serviceKey, categories = null, silent = false) {
    return resolveErrorsByFilter(
        err => err.serviceKey === serviceKey && (!categories || categories.includes(err.category)),
        {
            silent,
            message: `${serviceKey.toUpperCase()} issue(s) resolved`,
            log: `[RESOLVED] ${serviceKey.toUpperCase()} issues cleared`
        }
    );
}

function getActiveErrors() {
    return Array.from(errorStore.map.values()).filter(err => err.active);
}

function getActiveErrorCount() {
    return getActiveErrors().length;
}

function getActiveErrorWeight() {
    return getActiveErrors().reduce((sum, err) => sum + err.weight, 0);
}

function getServiceActiveErrorCount(serviceKey) {
    return getActiveErrors().filter(err => err.serviceKey === serviceKey).length;
}

function resetAllErrors() {
    errorStore.map.clear();
    errorStore.activeByFingerprint.clear();
    errorStore.seq = 0;
    errorStore.resolvedCount = 0;
    addLog('All errors manually reset', 'ok');
    addAlert('Error registry reset by user', 'info');
    updateErrorMetrics();
    updateCriticalAlert();
    renderServices();
}

function cleanupResolvedErrors() {
    const now = Date.now();
    errorStore.map.forEach((err, id) => {
        if (!err.active && err.resolvedAt && (now - err.resolvedAt) > CONFIG.INTERVALS.ERROR_RESOLVED_KEEP_MS) {
            errorStore.map.delete(id);
        }
    });
    updateErrorMetrics();
}

function updateErrorMetrics() {
    const activeCount = getActiveErrorCount();
    const activeWeight = getActiveErrorWeight();
    const pressure = Math.min(100, Math.round((activeWeight / 24) * 100));

    setText('totalErrorsBig', String(activeCount));
    setText('activeErrorCount', `${activeCount} active`);
    setText('resolvedErrorCount', `${errorStore.resolvedCount} resolved`);

    const errorBig = document.getElementById('totalErrorsBig');
    if (errorBig) {
        errorBig.style.color = activeCount > 0 ? 'var(--red)' : 'var(--green)';
    }

    const errorBar = document.getElementById('errorLoadBar');
    const errorText = document.getElementById('errorLoadText');
    if (errorBar) errorBar.style.width = `${pressure}%`;
    if (errorText) errorText.textContent = `${pressure}%`;

    const errorSummaryCard = document.getElementById('errorSummaryCard');
    if (errorSummaryCard) {
        errorSummaryCard.classList.toggle('error-border-animate', activeCount > 0);
    }

    const logoStatusDot = document.getElementById('logoStatusDot');
    if (logoStatusDot) {
        logoStatusDot.classList.toggle('error', activeCount > 0);
    }

    updateErrorDecorations();
}

function updateErrorDecorations() {
    const pingMap = {
        admin: 'pingCardAdmin',
        scorebar: 'pingCardScorebar',
        updater: 'pingCardUpdater',
        realtime: 'pingCardSupabase'
    };

    Object.entries(pingMap).forEach(([serviceKey, elementId]) => {
        const el = document.getElementById(elementId);
        if (!el) return;
        const hasError = getServiceActiveErrorCount(serviceKey) > 0;
        el.classList.toggle('error-border-animate', hasError);
    });
}

// ==========================================
// ALERTS / LOGS
// ==========================================
function addLog(message, type = 'info') {
    if (logPaused) return;
    const container = document.getElementById('logList');
    if (!container) return;

    const item = document.createElement('div');
    item.className = `log-item ${type}`;
    item.innerHTML = `
        <div class="item-top">
            <div class="item-label">${type.toUpperCase()}</div>
            <div class="item-time">${new Date().toLocaleTimeString('en-GB')}</div>
        </div>
        <div class="item-msg">${escapeHtml(message)}</div>
    `;

    container.prepend(item);
    while (container.children.length > 50) {
        container.removeChild(container.lastChild);
    }
}

function clearLogs() {
    const container = document.getElementById('logList');
    if (container) container.innerHTML = '';
}

function togglePauseLogs() {
    logPaused = !logPaused;
    const btn = document.getElementById('pauseLogBtn');
    if (btn) btn.textContent = logPaused ? 'Resume' : 'Pause';
}

function addAlert(message, type = 'info') {
    totals.alerts++;
    const container = document.getElementById('alertList');
    if (!container) return;

    const item = document.createElement('div');
    item.className = `alert-item ${type}`;
    item.innerHTML = `
        <div class="item-top">
            <div class="item-label">${type.toUpperCase()}</div>
            <div class="item-time">${new Date().toLocaleTimeString('en-GB')}</div>
        </div>
        <div class="item-msg">${escapeHtml(message)}</div>
    `;

    container.prepend(item);
    while (container.children.length > 30) {
        container.removeChild(container.lastChild);
    }
}

function clearAlerts() {
    const container = document.getElementById('alertList');
    if (container) container.innerHTML = '';
}

function showToast(msg, type = 'info') {
    addAlert(msg, type === 'error' ? 'err' : type);
}

function getUpdaterDeviceAlertReasons() {
    const reasons = [];

    if (updaterDeviceState.battery.critical) {
        reasons.push({
            key: 'updater_battery_critical',
            label: 'Updater Battery',
            short: 'BATTERY',
            reason: `Battery critically low at ${updaterDeviceState.battery.level}%`
        });
    } else if (updaterDeviceState.battery.low) {
        reasons.push({
            key: 'updater_battery_low',
            label: 'Updater Battery',
            short: 'BATTERY',
            reason: `Battery low at ${updaterDeviceState.battery.level}%`
        });
    }

    if (updaterDeviceState.network.online && updaterDeviceState.network.unstable) {
        reasons.push({
            key: 'updater_network_unstable',
            label: 'Updater Network',
            short: 'NETWORK',
            reason: `${updaterDeviceState.network.label} unstable • ${updaterDeviceState.network.signalPct}% signal`
        });
    }

    if (!updaterDeviceState.network.online && updaterDeviceState.online) {
        reasons.push({
            key: 'updater_network_offline',
            label: 'Updater Network',
            short: 'NETWORK',
            reason: `Updater device internet is offline`
        });
    }

    if (updaterDeviceState.pendingManualPush) {
        reasons.push({
            key: 'updater_manual_pending',
            label: 'Updater Push',
            short: 'PUSH',
            reason: `Manual push is pending`
        });
    }

    return reasons;
}

// ==========================================
// CRITICAL ALERT UI
// ==========================================
function getCriticalIssues() {
    const issues = [];

    CONFIG.CRITICAL_SERVICES.forEach(key => {
        const service = services[key];

        if (!isAppAlertEnabled(key)) return;

        if (key === 'realtime') {
            if (getServiceStatus('realtime') !== 'online') {
                issues.push({
                    key,
                    label: getServiceLabel(key),
                    short: key.toUpperCase(),
                    reason: service.reason || 'Realtime unavailable'
                });
            }
            return;
        }

        if (service.online === false) {
            issues.push({
                key,
                label: getServiceLabel(key),
                short: key.toUpperCase(),
                reason: service.reason || 'Connection Lost'
            });
        }
    });

    return issues;
}

function dismissCriticalIssue(serviceKey) {
    acknowledgedIssues.add(serviceKey);
    updateCriticalAlert();
}

function dismissAllCriticalIssues() {
    const issues = getCriticalIssues();
    issues.forEach(issue => acknowledgedIssues.add(issue.key));
    updateCriticalAlert();
}

function clearAcknowledgedIssue(serviceKey) {
    acknowledgedIssues.delete(serviceKey);
}

function pruneAcknowledgedIssues(activeIssues) {
    const activeKeys = new Set(activeIssues.map(issue => issue.key));
    acknowledgedIssues.forEach(key => {
        if (!activeKeys.has(key)) acknowledgedIssues.delete(key);
    });
}

function setServiceCardErrorAnimation(serviceKey, active) {
    const pingMap = {
        admin: 'pingCardAdmin',
        scorebar: 'pingCardScorebar',
        updater: 'pingCardUpdater',
        realtime: 'pingCardSupabase'
    };

    const elementId = pingMap[serviceKey];
    if (elementId) {
        const el = document.getElementById(elementId);
        if (el) el.classList.toggle('error-border-animate', active);
    }
}

function updateCriticalAlert() {
    const allIssues = getCriticalIssues();

    pruneAcknowledgedIssues(allIssues);

    const currentSignature = allIssues
        .map(issue => `${issue.key}:${issue.reason}`)
        .sort()
        .join('|');

    const unacknowledgedIssues = allIssues.filter(issue => !acknowledgedIssues.has(issue.key));
    const isCritical = unacknowledgedIssues.length > 0;

    const unackSignature = unacknowledgedIssues.map(i => i.key).sort().join('|');
    const signatureChanged = currentSignature !== lastCriticalSignature || unackSignature !== lastCriticalUnackSignature;

    const banner = document.getElementById('criticalBanner');
    const titleEl = document.getElementById('criticalTitle');
    const subEl = document.getElementById('criticalSub');
    const listEl = document.getElementById('criticalReasonList');

    CONFIG.CRITICAL_SERVICES.forEach(key => {
        const hasIssue = allIssues.some(i => i.key === key);
        setServiceCardErrorAnimation(key, hasIssue);
    });

    if (isCritical) {
        document.body.classList.add('critical-alert');
        if (banner) banner.classList.add('show');

        if (signatureChanged) {
            if (titleEl) {
                titleEl.textContent = unacknowledgedIssues.length === 1
                    ? `${unacknowledgedIssues[0].label} Connection Lost`
                    : `${unacknowledgedIssues.length} Critical Connections Lost`;
            }

            if (subEl) {
                subEl.textContent = 'Please check the connection immediately. Press OK to dismiss temporarily.';
            }

            if (listEl) {
                listEl.innerHTML = unacknowledgedIssues.map(issue => `
                    <div class="critical-reason-row" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <span class="critical-service-pill">${escapeHtml(issue.label)}</span>
                            <span class="critical-reason-text">${escapeHtml(issue.reason)}</span>
                        </div>
                        <button onclick="dismissCriticalIssue('${issue.key}')" class="critical-ok-btn">OK</button>
                    </div>
                `).join('');

                if (unacknowledgedIssues.length >= 1) {
                    listEl.innerHTML += `
                        <div style="text-align:center; margin-top:14px;">
                            <button onclick="dismissAllCriticalIssues()" class="critical-dismiss-all-btn">Dismiss All</button>
                        </div>
                    `;
                }
            }

            lastCriticalSignature = currentSignature;
            lastCriticalUnackSignature = unackSignature;
        }

        if (!criticalWasVisible || signatureChanged) {
            playAlertSound();
        }

        criticalWasVisible = true;
    } else {
        document.body.classList.remove('critical-alert');
        if (banner) banner.classList.remove('show');
        if (listEl) listEl.innerHTML = '';

        if (criticalWasVisible) {
            addAlert('All critical services restored', 'ok');
        }

        criticalWasVisible = false;
        lastCriticalSignature = '';
        lastCriticalUnackSignature = '';
    }
}

// ==========================================
// CLOCK / SUMMARY / TRAFFIC
// ==========================================
function updateClock() {
    const now = new Date();
    setText('clock', now.toLocaleTimeString('en-GB'));
    setText(
        'dateEl',
        now.toLocaleDateString('en-GB', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        }).toUpperCase()
    );
}

function initCharts() {
    renderBars('rtBars', traffic.rt.history, 'rt');
    renderBars('httpBars', traffic.http.history, 'http');

    renderBars('fmReadsBars', firebaseMetrics.history.reads, 'rt');
    renderBars('fmWritesBars', firebaseMetrics.history.writes, 'http');
    renderBars('fmListenerBars', firebaseMetrics.history.listener, 'rt');
    renderBars('fmBandwidthBars', firebaseMetrics.history.bandwidth, 'http');

    updateFirebaseMetricsUI();
}

function renderBars(containerId, data, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (container.children.length === 0) {
        for (let i = 0; i < 20; i++) {
            const bar = document.createElement('div');
            bar.className = 'chart-bar';
            container.appendChild(bar);
        }
    }

    const max = Math.max(...data, 1);
    const bars = container.children;

    for (let i = 0; i < bars.length; i++) {
        const v = data[i] || 0;
        const h = Math.max(4, Math.round((v / max) * 80));
        bars[i].style.height = `${h}px`;
        bars[i].className = 'chart-bar';
        if (v > 0) bars[i].classList.add(type === 'rt' ? 'rt-active' : 'http-active');
        if (v > 10) bars[i].classList.add('warn');
    }
}

function pushTrafficHistory() {
    traffic.rt.history.shift();
    traffic.rt.history.push(traffic.rt.current);
    traffic.rt.current = 0;

    traffic.http.history.shift();
    traffic.http.history.push(traffic.http.current);
    traffic.http.current = 0;

    renderBars('rtBars', traffic.rt.history, 'rt');
    renderBars('httpBars', traffic.http.history, 'http');

    pushFirebaseMetricsHistory();
    updateSummary();
}

function updateInfraBar(barId, textId, percent, textValue) {
    const bar = document.getElementById(barId);
    const text = document.getElementById(textId);
    if (bar) bar.style.width = `${percent}%`;
    if (text) text.textContent = textValue !== undefined ? String(textValue) : `${Math.round(percent)}%`;
}

function calculateHealthPercent() {
    let total = 0;
    const keys = ['admin', 'scorebar', 'updater', 'team', 'db', 'realtime'];

    keys.forEach(key => {
        const status = getServiceStatus(key);
        if (status === 'online') total += 100;
        else if (status === 'warning') total += 50;
    });

    return Math.round(total / keys.length);
}

function updateSummary() {
    const healthPct = calculateHealthPercent();
    const healthColor = healthPct > 70 ? 'var(--green)' : healthPct > 40 ? 'var(--orange)' : 'var(--red)';
    const healthRing = document.getElementById('healthRing');

    if (healthRing) {
        healthRing.style.background = `conic-gradient(${healthColor} ${healthPct}%, #1b1b1b 0%)`;
    }

    setText('healthRingVal', `${healthPct}%`);
    setText(
        'healthSummary',
        healthPct > 70 ? 'Most services healthy' :
            healthPct > 40 ? 'Some services degraded' :
                'Critical issues'
    );

    const rtRate = traffic.rt.history[traffic.rt.history.length - 1] || 0;
    const rtPct = Math.min(100, rtRate * 10);
    const rtRing = document.getElementById('rtRing');
    if (rtRing) rtRing.style.background = `conic-gradient(var(--blue) ${rtPct}%, #1b1b1b 0%)`;
    setText('rtRingVal', `${rtRate}/s`);

    const dbPing = services.db.ping || 0;
    const dbPct = services.db.online ? Math.max(0, Math.min(100, 100 - Math.round(dbPing / 5))) : 0;
    const dbRing = document.getElementById('dbRing');
    if (dbRing) dbRing.style.background = `conic-gradient(var(--yellow) ${dbPct}%, #1b1b1b 0%)`;

    setText('dbRingVal', `${dbPct}%`);
    setText('dbRingSummary', services.db.online ? `Latency ${dbPing}ms` : 'DB offline');

    const chip = document.getElementById('globalChip');
    if (chip) {
        const span = chip.querySelector('span');
        if (healthPct > 70) {
            chip.style.background = 'var(--green-bg)';
            chip.style.borderColor = 'var(--green-br)';
            chip.style.color = 'var(--green)';
            if (span) span.textContent = 'Healthy';
        } else if (healthPct > 40) {
            chip.style.background = 'var(--orange-bg)';
            chip.style.borderColor = 'var(--orange-br)';
            chip.style.color = 'var(--orange)';
            if (span) span.textContent = 'Degraded';
        } else {
            chip.style.background = 'var(--red-bg)';
            chip.style.borderColor = 'var(--red-br)';
            chip.style.color = 'var(--red)';
            if (span) span.textContent = 'Critical';
        }
    }

    updateInfraBar(
        'rtQualityBar',
        'rtQualityText',
        services.realtime.online ? 100 - Math.min(100, (services.realtime.ping || 0) / 5) : 0
    );

    updateInfraBar('dbQualityBar', 'dbQualityText', dbPct);
    updateInfraBar(
        'httpLoadBar',
        'httpLoadText',
        Math.min(100, (traffic.http.history[19] || 0) * 10),
        traffic.http.history[19] || 0
    );

    updateErrorMetrics();
    updatePingBarsUI();
    updateCriticalAlert();
}

function applyPingToUI(valId, fillId, ping) {
    const valEl = document.getElementById(valId);
    const fillEl = document.getElementById(fillId);

    if (!valEl || !fillEl) return;

    if (ping === null || ping === undefined) {
        valEl.textContent = '-- ms';
        fillEl.style.width = '0%';
        fillEl.style.background = 'var(--red)';
        return;
    }

    valEl.textContent = `${ping} ms`;

    let width = 100;
    let color = 'var(--green)';

    if (ping <= 60) {
        width = 100;
        color = 'var(--green)';
    } else if (ping <= 120) {
        width = 80;
        color = 'var(--green)';
    } else if (ping <= 220) {
        width = 60;
        color = 'var(--orange)';
    } else if (ping <= 350) {
        width = 40;
        color = 'var(--orange)';
    } else {
        width = 18;
        color = 'var(--red)';
    }

    fillEl.style.width = `${width}%`;
    fillEl.style.background = color;
}

function updatePingBarsUI() {
    const apps = [
        { key: 'admin', valId: 'pmValAdmin', fillId: 'pmFillAdmin' },
        { key: 'scorebar', valId: 'pmValScorebar', fillId: 'pmFillScorebar' },
        { key: 'updater', valId: 'pmValUpdater', fillId: 'pmFillUpdater' },
        { key: 'realtime', valId: 'pmValSupabase', fillId: 'pmFillSupabase' }
    ];

    apps.forEach(app => {
        const isOnline = getServiceStatus(app.key) === 'online';
        const ping = isOnline ? getDisplayPing(app.key) : null;
        applyPingToUI(app.valId, app.fillId, ping);
    });
}

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================
function initFirebase() {
    try {
        if (!window.firebase) {
            addTrackedError('Firebase library failed to load', 'init', 'db', 'db::firebase_lib');
            return;
        }

        if (!firebase.apps.length) {
            firebaseApp = firebase.initializeApp(CONFIG.FIREBASE);
        } else {
            firebaseApp = firebase.apps[0];
        }

        database = firebase.database();
        addLog('Firebase initialized', 'ok');

        connectRealtime();
        preloadPlayers();

    } catch (e) {
        addTrackedError(`Init error: ${e.message}`, 'db_fatal', 'db', 'db::init');
    }
}

// ==========================================
// FIREBASE REALTIME CONNECTION
// ==========================================
function connectRealtime() {
    services.realtime.reason = 'Connecting to Firebase...';
    renderServices();

    const amOnline = database.ref('.info/connected');
    const myPresenceRef = database.ref(`presence/${matchId}/monitor`);

    amOnline.on('value', (snap) => {
        trackFirebaseListenerEvent({ connected: snap.val() });

        if (snap.val()) {
            isConnected = true;
            services.realtime.online = true;
            services.realtime.lastConnect = Date.now();
            services.realtime.ping = Math.floor(Math.random() * 20) + 10;
            services.realtime.reason = 'Connected to Firebase';

            myPresenceRef.onDisconnect().set({
                online: false,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });

            const monitorPresencePayload = {
                online: true,
                lastSeen: firebase.database.ServerValue.TIMESTAMP,
                version: '31.0'
            };
            myPresenceRef.set(monitorPresencePayload);
            trackFirebaseWrite(monitorPresencePayload);

            resolveErrorsByService('realtime', ['realtime_connection'], true);
            addLog('Firebase Realtime connected', 'ok');
        } else {
            isConnected = false;
            services.realtime.online = false;
            services.realtime.reason = 'Firebase Offline';
            addTrackedError('Firebase connection lost', 'realtime_connection', 'realtime', 'realtime::connection');
        }

        renderServices();
        updateSummary();
        updateCriticalAlert();
    });

    database.ref(`presence/${matchId}`).on('value', (snap) => {
        const data = snap.val() || {};
        trackFirebaseListenerEvent(data);

        ['admin', 'scorebar', 'updater', 'team'].forEach(app => {
            const appKey = app === 'scorer' ? 'updater' : app;
            const appData = data[app] || data[appKey];

            if (appData && appData.online) {
                markServiceOnline(appKey, {
                    version: appData.version || 'Active',
                    lastSeen: appData.lastSeen,
                    pingMs: appData.pingMs || 0
                });
            } else {
                markServiceOffline(appKey);
            }
        });

        // ✅ NEW: ingest updater device telemetry
        if (data.updater) {
            ingestUpdaterDevicePresence(data.updater);
        } else {
            ingestUpdaterDevicePresence({});
        }

        renderServices();
        updateSummary();
        updateCriticalAlert();
    });

    database.ref(`matches/${matchId}/live`).on('value', (snap) => {
        const data = snap.val();
        trackFirebaseListenerEvent(data);

        if (data) {
            traffic.rt.current++;
            totals.messages++;
            services.realtime.messagesReceived++;
            handleLiveData(data);
        }
    });

    database.ref(`matches/${matchId}/command`).on('value', (snap) => {
        const cmd = snap.val();
        trackFirebaseListenerEvent(cmd);

        if (!cmd || !cmd.ts) return;

        const cmdAge = Date.now() - cmd.ts;
        if (cmdAge > 5000) return;

        if (cmd.event === 'show_profile' && cmd.payload) {
            liveMatch.profile = cmd.payload;
            renderProfile(liveMatch.profile);
            addLog(`Profile broadcast: ${cmd.payload.name || 'Unknown'}`, 'info');
        } else if (cmd.event === 'hide_graphics') {
            liveMatch.profile = null;
            liveMatch.upcoming = { show: false, name: '', photo: '' };
            renderProfile(null);
            renderLiveMatch();
            addLog('Hide graphics command received', 'warn');
        } else if (cmd.event === 'trigger_hype') {
            addLog(`Hype triggered: ${cmd.payload?.type || 'UNKNOWN'}`, 'info');
        } else if (cmd.event === 'show_summary') {
            addLog(`Summary command received: ${cmd.payload?.type || 'summary'}`, 'info');
        } else if (cmd.event === 'force_reload') {
            if (cmd.payload?.target === 'monitor' || cmd.payload?.target === 'all') {
                addLog('Force reload command received', 'warn');
                setTimeout(() => location.reload(), 500);
            }
        }
    });
}

function markServiceOnline(appKey, meta = {}) {
    const service = services[appKey];
    if (!service) return;

    const wasOffline = !service.online;

    clearAcknowledgedIssue(appKey);
    service.online = true;
    service.lastHeartbeat = meta.lastSeen || Date.now();
    service.heartbeatCount++;
    service.version = meta.version || '';
    service.ping = meta.pingMs || service.ping || 0;
    service.reason = `Connected${service.version ? ` • v${service.version}` : ''}`;

    resolveErrorsByService(appKey, ['service_offline', 'timeout'], true);

    if (wasOffline) {
        addLog(`${appKey.toUpperCase()} connected`, 'ok');
        addAlert(`${appKey.toUpperCase()} is now online`, 'ok');
    }

    if (appKey === 'admin' || appKey === 'updater') {
        triggerDataRoute(appKey);
    } else if (appKey === 'scorebar') {
        triggerDataFlow('scorebar_to_db');
    }
}

function markServiceOffline(appKey) {
    const service = services[appKey];
    if (!service) return;

    if (service.online === false) return;

    service.online = false;
    service.reason = 'Connection lost (Presence)';

    addTrackedError(`${appKey.toUpperCase()} connection lost`, 'service_offline', appKey, `${appKey}::offline`);
    addLog(`${appKey.toUpperCase()} connection lost`, 'err');
}

// ==========================================
// PLAYER CACHE / TEAM CACHE
// ==========================================
async function preloadPlayers(forceRefresh = false) {
    if (!database) return;

    try {
        let teamsData = {};
        let playersData = {};
        let usedCache = false;
        let version = Date.now();

        if (!forceRefresh) {
            const cached = loadTeamsFromCache();
            if (cached && cached.players) {
                teamsData = cached.teams || {};
                playersData = cached.players || {};
                version = cached.version || Date.now();
                usedCache = true;
                addLog(`Loaded ${Object.keys(playersData).length} players from cache`, 'ok');
            }
        }

        if (!usedCache) {
            const [teamsSnap, playersSnap, versionSnap] = await Promise.all([
                database.ref('teams').once('value'),
                database.ref('players').once('value'),
                database.ref('data_version/teams').once('value')
            ]);

            teamsData = teamsSnap.val() || {};
            playersData = playersSnap.val() || {};
            version = versionSnap.val() || Date.now();

            trackFirebaseRead(teamsData);
            trackFirebaseRead(playersData);
            trackFirebaseRead(version);

            saveTeamsToCache(teamsData, playersData, version);
            addLog(`Loaded ${Object.keys(playersData).length} players from Firebase`, 'ok');
        }

        playerCache.clear();

        Object.values(playersData || {}).forEach(p => {
            if (p.name) {
                playerCache.set(p.name.trim().toLowerCase(), {
                    name: p.name,
                    role: p.role || '',
                    school: p.school || '',
                    age: p.age || '',
                    photo: p.photo_url || p.photo_base64 || ''
                });
            }
        });

        services.db.teams = Object.keys(teamsData || {}).length;
        services.db.players = Object.keys(playersData || {}).length;

        setupTeamsVersionListener();
    } catch (e) {
        addLog(`Player preload failed: ${e.message}`, 'warn');
    }
}

function setupTeamsVersionListener() {
    if (!database || teamVersionListenerAttached) return;
    teamVersionListenerAttached = true;

    database.ref('data_version/teams').on('value', async (snap) => {
        const serverVersion = snap.val() || 0;
        trackFirebaseListenerEvent(serverVersion);

        if (!serverVersion) return;

        if (currentTeamsVersion === 0) {
            currentTeamsVersion = serverVersion;
            return;
        }

        if (serverVersion !== currentTeamsVersion) {
            currentTeamsVersion = serverVersion;
            addLog('Team updates detected, refreshing cache...', 'info');
            await preloadPlayers(true);
            await checkDatabaseHealth();
        }
    });
}

async function getPlayerMeta(name) {
    if (!name) return null;
    return playerCache.get(name.trim().toLowerCase()) || null;
}

// ==========================================
// LIVE MATCH DATA
// ==========================================
async function handleLiveData(payload) {
    if (!payload) return;

    if (payload.overs !== undefined) {
        const currentBalls = oversToBalls(payload.overs);
        const currentOverInt = Math.floor(currentBalls / 6);
        const currentRuns = payload.runs || 0;

        if (lastRecordedOver === -1 && currentBalls > 0) {
            lastRecordedOver = currentOverInt;
            lastRecordedScore = currentRuns;
        } else if (currentOverInt > lastRecordedOver) {
            const runsInOver = currentRuns - lastRecordedScore;
            overHistory.push({
                runs: runsInOver,
                isWicket: (payload.wkts || 0) > liveMatch.wkts
            });

            if (overHistory.length > 8) overHistory.shift();

            lastRecordedOver = currentOverInt;
            lastRecordedScore = currentRuns;
            renderSparkline();
        }
    }

    liveMatch.runs = payload.runs || 0;
    liveMatch.wkts = payload.wkts || 0;
    liveMatch.overs = payload.overs || '0.0';
    liveMatch.balls = oversToBalls(payload.overs);
    liveMatch.crr = payload.crr || '0.00';
    liveMatch.target = payload.target || 0;
    liveMatch.winProb = payload.winProb || 50;
    liveMatch.partRuns = payload.partRuns || 0;
    liveMatch.partBalls = payload.partBalls || 0;
    liveMatch.batTeam = payload.batFlag || 'BAT';
    liveMatch.bowlTeam = payload.bowlFlag || 'BOWL';
    liveMatch.matchType = payload.matchType || 'limited';
    liveMatch.freeHit = payload.isFreeHit || false;
    liveMatch.overBalls = String(payload.thisOver || '').trim().split(/\s+/).filter(Boolean);

    const b1 = payload.bat1 || {};
    const b2 = payload.bat2 || {};
    const strikerNo = String(payload.striker || '1');
    const strikerData = strikerNo === '1' ? b1 : b2;
    const nonStrikerData = strikerNo === '1' ? b2 : b1;

    const strikerMeta = await getPlayerMeta(strikerData.name);
    const nonStrikerMeta = await getPlayerMeta(nonStrikerData.name);
    const bowlerMeta = await getPlayerMeta(payload.bowler?.name);

    liveMatch.striker = {
        name: strikerData.name || '--',
        runs: strikerData.runs || 0,
        balls: strikerData.balls || 0,
        fours: strikerData.fours || 0,
        sixes: strikerData.sixes || 0,
        photo: strikerMeta?.photo || ''
    };

    liveMatch.nonStriker = {
        name: nonStrikerData.name || '--',
        runs: nonStrikerData.runs || 0,
        balls: nonStrikerData.balls || 0,
        fours: nonStrikerData.fours || 0,
        sixes: nonStrikerData.sixes || 0,
        photo: nonStrikerMeta?.photo || ''
    };

    liveMatch.bowler = {
        name: payload.bowler?.name || '--',
        figs: payload.bowler?.figs || '0-0 0.0',
        photo: bowlerMeta?.photo || ''
    };

    if (payload.showUpcomingBatter && payload.upcomingBatterName) {
        const upMeta = await getPlayerMeta(payload.upcomingBatterName);
        liveMatch.upcoming = {
            show: true,
            name: payload.upcomingBatterName,
            photo: payload.upcomingBatterPhoto || upMeta?.photo || ''
        };
    } else {
        liveMatch.upcoming = { show: false, name: '', photo: '' };
    }

    if (payload.showPlayerProfile && payload.playerProfile) {
        liveMatch.profile = payload.playerProfile;
    }

    if (payload.hidePlayerProfile) {
        liveMatch.profile = null;
    }

    renderLiveMatch();
}

function renderLiveMatch() {
    const m = liveMatch;

    const scoreEl = document.getElementById('scoreValue');
    if (scoreEl) {
        const newScore = `${m.runs}/${m.wkts}`;
        if (scoreEl.textContent !== newScore) {
            scoreEl.textContent = newScore;
            scoreEl.classList.add('flash');
            setTimeout(() => scoreEl.classList.remove('flash'), 450);
        }
    }

    setText('oversValue', `${m.overs} overs`);
    setText('targetValue', `Target ${m.target}`);
    setText('batTeam', m.batTeam);
    setText('bowlTeam', m.bowlTeam);
    setText('matchBadge', matchId);
    setText('rrrValue', `RRR ${calculateRRR()}`);

    setText('miniRuns', String(m.runs));
    setText('miniWkts', String(m.wkts));
    setText('miniBalls', String(m.balls));
    setText('miniCrr', m.crr);
    setText('miniPart', `${m.partRuns} (${m.partBalls})`);
    setText('miniWinProb', `${m.winProb}%`);

    const typePill = document.getElementById('matchTypePill');
    if (typePill) {
        typePill.textContent = m.matchType;
        typePill.className = `status-pill ${services.admin.online ? 'online' : 'offline'}`;
    }

    const fhPill = document.getElementById('freeHitPill');
    if (fhPill) {
        fhPill.className = m.freeHit ? 'status-pill warning' : 'status-pill offline';
        fhPill.textContent = m.freeHit ? 'Free Hit' : 'No Free Hit';
    }

    renderOverBalls();
    renderPlayer('striker', m.striker);
    renderPlayer('nonStriker', m.nonStriker);
    renderBowler(m.bowler);

    const upCard = document.getElementById('upcomingCard');
    if (upCard) {
        if (m.upcoming.show) {
            upCard.classList.add('show');
            setText('upcomingName', m.upcoming.name);
            setAvatar('upcomingAvatar', m.upcoming.name, m.upcoming.photo);
        } else {
            upCard.classList.remove('show');
        }
    }

    renderProfile(m.profile);
    renderSparkline();
}

function renderOverBalls() {
    const container = document.getElementById('overBalls');
    if (!container) return;

    container.innerHTML = '';
    const balls = liveMatch.overBalls;
    const legalCount = balls.filter(b => !/wd|nb/i.test(b)).length;

    balls.forEach((ball, idx) => {
        const div = document.createElement('div');
        div.className = 'ball';

        const v = String(ball).toUpperCase();
        div.textContent = v === '0' ? '•' : v;

        if (v === '0') div.classList.add('dot');
        else if (v === '4') div.classList.add('four');
        else if (v === '6') div.classList.add('six');
        else if (v === 'W') div.classList.add('wicket');
        else if (/WD|NB/i.test(v)) div.classList.add('extra');

        if (idx === balls.length - 1) div.classList.add('last');
        container.appendChild(div);
    });

    for (let i = legalCount; i < 6; i++) {
        const empty = document.createElement('div');
        empty.className = 'ball empty';
        container.appendChild(empty);
    }
}

function renderPlayer(type, player) {
    setText(type + 'Name', player.name || '--');
    setText(type + 'Stats', `${player.runs} (${player.balls}) • 4s:${player.fours} • 6s:${player.sixes}`);
    setAvatar(type + 'Avatar', player.name, player.photo);
}

function renderBowler(player) {
    setText('bowlerName', player.name || '--');
    setText('bowlerStats', player.figs || '0-0 0.0');
    setAvatar('bowlerAvatar', player.name, player.photo);
}

function renderProfile(profile) {
    const emptyEl = document.getElementById('profileEmpty');
    const wrapEl = document.getElementById('profileWrap');
    if (!emptyEl || !wrapEl) return;

    if (!profile) {
        emptyEl.style.display = 'block';
        wrapEl.style.display = 'none';
        return;
    }

    emptyEl.style.display = 'none';
    wrapEl.style.display = 'flex';
    setAvatar('profileAvatar', profile.name, profile.photo);
    setText('profileRole', (profile.role || 'PLAYER').toUpperCase());
    setText('profileName', profile.name || 'Unknown');
    setText('profileMeta', `${profile.school || ''}${profile.age ? ' • Age ' + profile.age : ''}`);
}

function renderSparkline() {
    const container = document.getElementById('sparklineContainer');
    if (!container) return;

    container.innerHTML = '';

    if (overHistory.length === 0) {
        container.innerHTML = `<span style="color:var(--muted); font-size:.7rem; width:100%; text-align:center;">Waiting for over completion...</span>`;
        return;
    }

    const maxRuns = Math.max(...overHistory.map(o => o.runs), 10);

    overHistory.forEach((over, idx) => {
        const bar = document.createElement('div');
        const h = Math.max(5, (over.runs / maxRuns) * 100);
        bar.className = 'spark-bar';
        bar.style.height = `${h}%`;
        bar.setAttribute('data-val', over.runs);
        bar.setAttribute('data-ov', `Ov ${lastRecordedOver - (overHistory.length - 1 - idx)}`);

        if (over.runs >= 10) bar.classList.add('high');
        if (over.isWicket) bar.classList.add('wicket');

        container.appendChild(bar);
    });
}

// ==========================================
// HEALTH CHECKS
// ==========================================
async function pingSites() {
    const siteKeys = ['scorebar', 'admin', 'updater', 'team'];
    await Promise.all(siteKeys.map(key => pingSite(key)));
    renderServices();
    updateSummary();
}

async function pingSite(key) {
    const url = CONFIG.SITE_URLS[key];
    if (!url) return;

    const start = Date.now();
    traffic.http.current++;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);

        await fetch(url, {
            method: 'GET',
            mode: 'no-cors',
            cache: 'no-store',
            signal: controller.signal
        });

        clearTimeout(timeout);

        services[key].siteReachable = true;
        services[key].siteLatency = Date.now() - start;

        resolveErrorsByService(key, ['site_unreachable'], true);

        if (!services[key].online && services[key].siteReachable) {
            services[key].reason = 'Site reachable, waiting for presence...';
        }
    } catch (e) {
        services[key].siteReachable = false;
        services[key].siteLatency = 0;
        services[key].errors++;
        services[key].reason = e.name === 'AbortError' ? 'Site timeout' : 'Site unreachable';

        addTrackedError(
            `Ping ${key} failed: ${e.name === 'AbortError' ? 'timeout' : e.message}`,
            'site_unreachable',
            key,
            `${key}::site_unreachable`
        );
    }
}

async function checkDatabaseHealth() {
    if (!database) {
        services.db.online = false;
        services.db.reason = 'Firebase not initialized';
        renderServices();
        updateSummary();
        return;
    }

    const start = Date.now();
    traffic.http.current++;
    services.db.requests++;

    try {
        const healthSnap = await database.ref('app_meta/team_manager_ready').once('value');
        trackFirebaseRead(healthSnap.val());

        const cached = loadTeamsFromCache();
        const teamsCount = cached && cached.teams ? Object.keys(cached.teams).length : services.db.teams || 0;
        const playersCount = cached && cached.players ? Object.keys(cached.players).length : services.db.players || 0;

        services.db.online = true;
        services.db.lastCheck = Date.now();
        services.db.ping = Date.now() - start;
        services.db.teams = teamsCount;
        services.db.players = playersCount;
        services.db.reason = `Healthy • ${teamsCount} teams, ${playersCount} players`;

        resolveErrorsByService('db', ['db_fatal'], true);
    } catch (e) {
        services.db.online = false;
        services.db.errors++;
        services.db.reason = `Error: ${e.message}`;
        addTrackedError(`DB health error: ${e.message}`, 'db_fatal', 'db', 'db::health');
    }

    renderServices();
    updateSummary();
}

function checkWatchdogs() {
    const now = Date.now();
    const PRESENCE_TIMEOUT = 30000;

    ['admin', 'scorebar', 'updater'].forEach(key => {
        const service = services[key];

        if (service.online === false) return;

        const hasPresence = service.lastHeartbeat > 0;
        const stale = hasPresence && (now - service.lastHeartbeat) > PRESENCE_TIMEOUT;

        if (stale) {
            service.online = false;
            service.reason = 'Presence timeout';
            addLog(`${key.toUpperCase()} presence timeout`, 'warn');
            addTrackedError(`${key.toUpperCase()} presence timeout`, 'timeout', key, `${key}::timeout`);
        }
    });

    renderServices();
    updateSummary();
    updateCriticalAlert();
}

// ==========================================
// SERVICE STATUS RENDER
// ==========================================
function getServiceStatus(key) {
    const s = services[key];

    if (key === 'realtime') {
        return isConnected && s.online ? 'online' : 'offline';
    }

    if (key === 'db') {
        return s.online ? 'online' : 'offline';
    }

    if (s.online) return 'online';
    if (s.siteReachable) return 'warning';
    return 'offline';
}

function getLastSeen(key) {
    const s = services[key];
    let ts = 0;

    if (key === 'db') ts = s.lastCheck;
    else if (key === 'realtime') ts = s.lastConnect;
    else ts = s.lastHeartbeat;

    if (!ts) return 'never';

    const ago = Math.floor((Date.now() - ts) / 1000);
    if (ago < 60) return `${ago}s ago`;
    if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
    return `${Math.floor(ago / 3600)}h ago`;
}

function getServiceIcon(key) {
    return {
        admin: '🎮',
        scorebar: '📺',
        updater: '⚡',
        team: '👥',
        db: '🗄️',
        realtime: '📡'
    }[key] || '📌';
}

function getServiceLabel(key) {
    return {
        admin: 'Main Admin',
        scorebar: 'OBS Scorebar',
        updater: 'Score Updater',
        team: 'Team Editor',
        db: 'Firebase DB',
        realtime: 'Firebase Realtime'
    }[key] || key;
}

function getServiceUrl(key) {
    if (key === 'db') return CONFIG.FIREBASE.databaseURL;
    if (key === 'realtime') return CONFIG.FIREBASE.databaseURL;
    return CONFIG.SITE_URLS[key] || '';
}

function renderServiceMeta(key, s) {
    if (key === 'db') {
        return `
            <span class="meta-pill ok">Teams: ${s.teams}</span>
            <span class="meta-pill ok">Players: ${s.players}</span>
        `;
    }

    if (key === 'realtime') {
        return `<span class="meta-pill ok">Messages: ${s.messagesReceived}</span>`;
    }

    return `
        <span class="meta-pill ${s.siteReachable ? 'ok' : 'bad'}">Site: ${s.siteReachable ? 'OK' : 'DOWN'}</span>
        ${s.version ? `<span class="meta-pill">v${escapeHtml(s.version)}</span>` : ''}
    `;
}

function renderServices() {
    const container = document.getElementById('serviceList');
    if (!container) return;

    const serviceKeys = ['admin', 'scorebar', 'updater', 'team', 'db', 'realtime'];

    if (container.children.length !== serviceKeys.length) {
        container.innerHTML = serviceKeys.map(key => {
            const s = services[key];
            const status = getServiceStatus(key);
            const ping = getDisplayPing(key);
            const lastSeen = getLastSeen(key);
            const hasErrors = getServiceActiveErrorCount(key) > 0;
            const showRestart = key === 'admin' || key === 'scorebar' || key === 'updater';

            return `
                <div class="service-card ${status} ${hasErrors ? 'error-border-animate' : ''}">
                    <div class="service-top">
                        <div class="service-name">
                            <span class="dot ${status}"></span>
                            ${getServiceIcon(key)} ${getServiceLabel(key)}
                        </div>
                        <div style="display:flex; gap:6px; align-items:center;">
                            <div class="status-pill ${status}">${status}</div>
                            ${showRestart ? `<button class="small-btn btn-danger-lite" onclick="forceReloadApp('${key}')">Restart</button>` : ''}
                        </div>
                    </div>

                    <div class="service-url">${getServiceUrl(key)}</div>

                    <div class="service-grid">
                        <div class="metric-box">
                            <div class="metric-label">Ping</div>
                            <div class="metric-value">${ping} ms</div>
                        </div>
                        <div class="metric-box">
                            <div class="metric-label">Last Seen</div>
                            <div class="metric-value">${lastSeen}</div>
                        </div>
                        <div class="metric-box">
                            <div class="metric-label">${key === 'realtime' ? 'Messages' : 'Requests'}</div>
                            <div class="metric-value">${s.messagesReceived || s.requests || s.heartbeatCount || 0}</div>
                        </div>
                        <div class="metric-box">
                            <div class="metric-label">Errors</div>
                            <div class="metric-value" style="color:var(--red)">${getServiceActiveErrorCount(key)}</div>
                        </div>
                    </div>

                    <div class="meta-row">${renderServiceMeta(key, s)}</div>
                    <div class="service-reason">${escapeHtml(s.reason || 'No details')}</div>
                    ${renderServiceAlertToggle(key)}
                </div>
            `;
        }).join('');
        return;
    }

    serviceKeys.forEach((key, idx) => {
        const s = services[key];
        const card = container.children[idx];
        const status = getServiceStatus(key);
        const ping = getDisplayPing(key);
        const lastSeen = getLastSeen(key);
        const hasErrors = getServiceActiveErrorCount(key) > 0;

        const newClassName = `service-card ${status} ${hasErrors ? 'error-border-animate' : ''}`;
        if (card.className !== newClassName) {
            card.className = newClassName;
        }

        const dot = card.querySelector('.dot');
        if (dot && dot.className !== `dot ${status}`) dot.className = `dot ${status}`;

        const pill = card.querySelector('.status-pill');
        if (pill && pill.textContent !== status) {
            pill.className = `status-pill ${status}`;
            pill.textContent = status;
        }

        const metrics = card.querySelectorAll('.metric-value');
        if (metrics.length >= 4) {
            metrics[0].textContent = `${ping} ms`;
            metrics[1].textContent = lastSeen;
            metrics[2].textContent = s.messagesReceived || s.requests || s.heartbeatCount || 0;
            metrics[3].textContent = getServiceActiveErrorCount(key);
        }

        const metaRow = card.querySelector('.meta-row');
        if (metaRow) {
            const newMetaHtml = renderServiceMeta(key, s);
            if (metaRow.innerHTML !== newMetaHtml) metaRow.innerHTML = newMetaHtml;
        }

        const reasonEl = card.querySelector('.service-reason');
        const newReason = s.reason || 'No details';
        if (reasonEl && reasonEl.textContent !== newReason) reasonEl.textContent = newReason;
    });
}

// ==========================================
// CONTROLS
// ==========================================
function forceReloadApp(appName) {
    if (!confirm(`Are you sure you want to force restart ${appName.toUpperCase()}?`)) return;
    if (!database) {
        addLog('Database not connected, cannot send restart command', 'err');
        return;
    }

    const payload = {
        event: 'force_reload',
        payload: { target: appName },
        ts: firebase.database.ServerValue.TIMESTAMP
    };

    database.ref(`matches/${matchId}/command`).set(payload);
    trackFirebaseWrite(payload);

    addLog(`Restart command sent to ${appName.toUpperCase()}`, 'warn');
    addAlert(`${appName.toUpperCase()} remote restart requested`, 'warn');
}

function applyMatchId() {
    const newId = document.getElementById('matchIdInput')?.value?.trim();
    if (!newId) {
        addAlert('Please enter a Match ID', 'warn');
        return;
    }

    matchId = newId;
    localStorage.setItem('matchId', matchId);
    addLog(`Match ID changed to ${matchId}`, 'info');

    location.reload();
}

function manualRefresh() {
    addLog('Manual refresh triggered', 'info');
    pingSites();
    checkDatabaseHealth();
    preloadPlayers(true);
}

function godModeKillGraphics() {
    if (!confirm('⚠️ Are you sure you want to clear ALL graphics on the Broadcast?')) return;
    if (!database) return;

    const payload = {
        event: 'hide_graphics',
        ts: firebase.database.ServerValue.TIMESTAMP
    };

    database.ref(`matches/${matchId}/command`).set(payload);
    trackFirebaseWrite(payload);

    addAlert('Emergency graphics kill signal sent', 'err');
}

function godModeAlertScorer() {
    const msg = prompt('Enter warning message to send to the Scorer:');
    if (!msg) return;

    addAlert(`Alert message: "${msg}" (Note: Direct scorer alerts not implemented)`, 'info');
}

// ==========================================
// DATA FLOW TOPOLOGY
// ==========================================
function triggerDataRoute(source) {
    if (source === 'admin') {
        triggerDataFlow('admin_to_db');
        setTimeout(() => triggerDataFlow('db_to_scorebar'), 430);
    } else if (source === 'updater' || source === 'scorer') {
        triggerDataFlow('updater_to_db');
        setTimeout(() => triggerDataFlow('db_to_scorebar'), 430);
    } else if (source === 'scorebar') {
        triggerDataFlow('scorebar_to_db');
    }
}

function triggerDataFlow(source) {
    if (source === 'admin' || source === 'admin_to_db') {
        animateFlowOnPath('path-admin', '#38bdf8', 'forward');
    } else if (source === 'updater' || source === 'scorer' || source === 'updater_to_db') {
        animateFlowOnPath('path-updater', '#a855f7', 'forward');
    } else if (source === 'db_to_scorebar' || source === 'supabase_out') {
        animateFlowOnPath('path-scorebar', '#3b82f6', 'forward');
    } else if (source === 'scorebar' || source === 'scorebar_to_db') {
        animateFlowOnPath('path-scorebar', '#22c55e', 'reverse');
    }
}

function animateFlowOnPath(pathId, color, direction = 'forward') {
    const svg = document.getElementById('flowSvg');
    const basePath = document.getElementById(pathId);
    if (!svg || !basePath) return;

    const ns = 'http://www.w3.org/2000/svg';
    const length = basePath.getTotalLength();
    const dashLen = Math.max(24, length * 0.16);
    const duration = 950;

    const glow = document.createElementNS(ns, 'path');
    glow.setAttribute('d', basePath.getAttribute('d'));
    glow.setAttribute('fill', 'none');
    glow.setAttribute('stroke', color);
    glow.setAttribute('stroke-width', '4.2');
    glow.setAttribute('stroke-linecap', 'round');
    glow.setAttribute('stroke-linejoin', 'round');
    glow.setAttribute('stroke-opacity', '0.20');
    glow.setAttribute('vector-effect', 'non-scaling-stroke');
    glow.setAttribute('filter', 'url(#flowGlow)');
    glow.setAttribute('stroke-dasharray', `${dashLen} ${length + dashLen}`);

    const core = document.createElementNS(ns, 'path');
    core.setAttribute('d', basePath.getAttribute('d'));
    core.setAttribute('fill', 'none');
    core.setAttribute('stroke', color);
    core.setAttribute('stroke-width', '1.9');
    core.setAttribute('stroke-linecap', 'round');
    core.setAttribute('stroke-linejoin', 'round');
    core.setAttribute('stroke-opacity', '0.95');
    core.setAttribute('vector-effect', 'non-scaling-stroke');
    core.setAttribute('stroke-dasharray', `${dashLen} ${length + dashLen}`);

    svg.appendChild(glow);
    svg.appendChild(core);

    const frames = buildPremiumDashFrames(length, dashLen, direction);

    glow.animate(frames.glow, { duration, easing: 'linear', fill: 'forwards' });
    core.animate(frames.core, { duration, easing: 'linear', fill: 'forwards' });

    setTimeout(() => {
        glow.remove();
        core.remove();
    }, duration + 80);
}

function buildPremiumDashFrames(length, dashLen, direction) {
    if (direction === 'reverse') {
        return {
            glow: [
                { strokeDashoffset: -length, opacity: 0, offset: 0 },
                { strokeDashoffset: -(length * 0.78), opacity: 0.30, offset: 0.18 },
                { strokeDashoffset: -(length * 0.60), opacity: 0.38, offset: 0.36 },
                { strokeDashoffset: -(length * 0.44), opacity: 0.42, offset: 0.56 },
                { strokeDashoffset: -(length * 0.24), opacity: 0.38, offset: 0.76 },
                { strokeDashoffset: dashLen * 0.10, opacity: 0.18, offset: 0.92 },
                { strokeDashoffset: dashLen, opacity: 0, offset: 1 }
            ],
            core: [
                { strokeDashoffset: -length, opacity: 0, offset: 0 },
                { strokeDashoffset: -(length * 0.78), opacity: 0.90, offset: 0.18 },
                { strokeDashoffset: -(length * 0.60), opacity: 1, offset: 0.36 },
                { strokeDashoffset: -(length * 0.44), opacity: 1, offset: 0.56 },
                { strokeDashoffset: -(length * 0.24), opacity: 0.98, offset: 0.76 },
                { strokeDashoffset: dashLen * 0.10, opacity: 0.75, offset: 0.92 },
                { strokeDashoffset: dashLen, opacity: 0, offset: 1 }
            ]
        };
    }

    return {
        glow: [
            { strokeDashoffset: length, opacity: 0, offset: 0 },
            { strokeDashoffset: length * 0.78, opacity: 0.30, offset: 0.18 },
            { strokeDashoffset: length * 0.60, opacity: 0.38, offset: 0.36 },
            { strokeDashoffset: length * 0.44, opacity: 0.42, offset: 0.56 },
            { strokeDashoffset: length * 0.24, opacity: 0.38, offset: 0.76 },
            { strokeDashoffset: -(dashLen * 0.10), opacity: 0.18, offset: 0.92 },
            { strokeDashoffset: -dashLen, opacity: 0, offset: 1 }
        ],
        core: [
            { strokeDashoffset: length, opacity: 0, offset: 0 },
            { strokeDashoffset: length * 0.78, opacity: 0.90, offset: 0.18 },
            { strokeDashoffset: length * 0.60, opacity: 1, offset: 0.36 },
            { strokeDashoffset: length * 0.44, opacity: 1, offset: 0.56 },
            { strokeDashoffset: length * 0.24, opacity: 0.98, offset: 0.76 },
            { strokeDashoffset: -(dashLen * 0.10), opacity: 0.75, offset: 0.92 },
            { strokeDashoffset: -dashLen, opacity: 0, offset: 1 }
        ]
    };
}

// ==========================================
// CRITICAL ALERT TOGGLE FUNCTIONS
// ==========================================
function toggleServiceAlert(serviceKey, enabled) {
    alertSettings[serviceKey] = enabled;
    saveAlertSettings();

    const statusEl = document.getElementById(`alertStatus_${serviceKey}`);
    if (statusEl) {
        statusEl.textContent = enabled ? 'ON' : 'OFF';
        statusEl.className = `service-alert-status ${enabled ? 'on' : 'off'}`;
    }

    addLog(`${serviceKey.toUpperCase()} critical alerts ${enabled ? 'ENABLED' : 'DISABLED'}`, enabled ? 'ok' : 'warn');
    updateCriticalAlert();
}

function toggleAlertSound(enabled) {
    alertSettings.sound = enabled;
    saveAlertSettings();

    const statusEl = document.getElementById('soundStatus');
    if (statusEl) {
        statusEl.textContent = enabled ? 'ON' : 'OFF';
    }

    addLog(`Alert sound ${enabled ? 'ENABLED' : 'DISABLED'}`, enabled ? 'ok' : 'warn');
}

function saveAlertSettings() {
    localStorage.setItem('monitorAlertSettings', JSON.stringify(alertSettings));
}

function loadAlertSettings() {
    try {
        const saved = localStorage.getItem('monitorAlertSettings');
        if (saved) {
            const parsed = JSON.parse(saved);
            alertSettings = { ...alertSettings, ...parsed };
        }
    } catch (e) {
        console.warn('Could not load alert settings:', e);
    }

    const soundToggle = document.getElementById('alertSoundToggle');
    const soundStatus = document.getElementById('soundStatus');

    if (soundToggle) soundToggle.checked = alertSettings.sound;
    if (soundStatus) soundStatus.textContent = alertSettings.sound ? 'ON' : 'OFF';
}

function isAppAlertEnabled(appKey) {
    return alertSettings[appKey] !== false;
}

function renderServiceAlertToggle(serviceKey) {
    if (!['admin', 'updater', 'scorebar'].includes(serviceKey)) {
        return '';
    }

    const isEnabled = alertSettings[serviceKey] !== false;

    return `
        <div class="service-alert-toggle">
            <div class="service-alert-toggle-left">
                <span class="service-alert-toggle-icon">🚨</span>
                <span class="service-alert-toggle-text">Critical Alert</span>
            </div>
            <span class="service-alert-status ${isEnabled ? 'on' : 'off'}" id="alertStatus_${serviceKey}">
                ${isEnabled ? 'ON' : 'OFF'}
            </span>
            <label class="service-alert-switch">
                <input type="checkbox"
                       id="alertToggle_${serviceKey}"
                       ${isEnabled ? 'checked' : ''}
                       onchange="toggleServiceAlert('${serviceKey}', this.checked)">
                <span class="service-alert-slider"></span>
            </label>
        </div>
    `;
}

// ==========================================
// GLOBAL ERROR LISTENERS
// ==========================================
window.onerror = function (message, sourceFile, lineNo) {
    let errText = String(message || 'Unknown error');
    if (sourceFile) errText += ` (${sourceFile.split('/').pop()}:${lineNo})`;
    addTrackedError(errText, 'console', null, `console::${errText}`);
    return false;
};

window.addEventListener('unhandledrejection', function (event) {
    const reasonMsg = event.reason?.message || String(event.reason || 'Unknown promise rejection');
    addTrackedError(`Unhandled Rejection: ${reasonMsg}`, 'promise', null, `promise::${reasonMsg}`);
});

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlMatchId = urlParams.get('match');
    if (urlMatchId) {
        matchId = urlMatchId;
        localStorage.setItem('matchId', matchId);
    }

    const matchInput = document.getElementById('matchIdInput');
    if (matchInput) matchInput.value = matchId;

    loadAlertSettings();

    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });

    initFirebase();
    initCharts();

    setInterval(updateClock, CONFIG.INTERVALS.CLOCK);
    setInterval(pushTrafficHistory, CONFIG.INTERVALS.TRAFFIC_UPDATE);
    setInterval(checkWatchdogs, CONFIG.INTERVALS.WATCHDOG);
    setInterval(pingSites, CONFIG.INTERVALS.SITE_PING);
    setInterval(checkDatabaseHealth, CONFIG.INTERVALS.DB_HEALTH);
    setInterval(cleanupResolvedErrors, CONFIG.INTERVALS.ERROR_CLEAN_INTERVAL);

    setInterval(() => {
        const serviceCardContainer = document.getElementById('serviceList');
        if (!serviceCardContainer) return;

        const serviceKeys = ['admin', 'scorebar', 'updater', 'team', 'db', 'realtime'];
        serviceKeys.forEach((key, idx) => {
            const card = serviceCardContainer.children[idx];
            if (!card) return;
            const lastSeenEl = card.querySelectorAll('.metric-value')[1];
            if (lastSeenEl) lastSeenEl.textContent = getLastSeen(key);
        });

        updateCriticalAlert();
    }, 1000);

    updateClock();
    renderServices();
    renderLiveMatch();
    renderUpdaterDevicePanel();
    updateSummary();
    updateFirebaseMetricsUI();

    setTimeout(pingSites, 800);
    setTimeout(checkDatabaseHealth, 1600);

    addLog('Monitor dashboard initialized (Firebase Optimized)', 'ok');
});

// ==========================================
// WINDOW EVENTS
// ==========================================
window.addEventListener('beforeunload', () => {
    if (database && matchId) {
        const payload = {
            online: false,
            lastSeen: Date.now()
        };
        database.ref(`presence/${matchId}/monitor`).set(payload);
    }
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        checkWatchdogs();
        updateCriticalAlert();
    }
});

window.addEventListener('offline', () => {
    isConnected = false;
    services.realtime.online = false;
    services.realtime.reason = 'Internet Connection Lost';
    renderServices();
    updateCriticalAlert();
});

window.addEventListener('online', () => {
    addLog('Internet connection restored', 'ok');
    location.reload();
});

// ==========================================
// INITIALIZATION COMPLETE
// ==========================================
console.log('🖥️ Monitor V31.0 Firebase Metrics Loaded');