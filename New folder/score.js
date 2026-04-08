// ==========================================
// SCOREBAR.JS - V29.0 FIREBASE OPTIMIZED
// OBS Scorebar Overlay - 100% Firebase
// Zero Bandwidth Presence System
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
    }
};

// ==========================================
// GLOBAL STATE
// ==========================================
let matchId = localStorage.getItem('matchId') || 'my_match_999';
let firebaseApp = null;
let database = null;
let lastDataReceived = 0;
let selfPingMs = null;
let presenceRefreshInterval = null;

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

// View state
let currentView = 'view-bowler';
let carouselTimer = null;
let carouselLoop = null;
let lastForceTrig = '';
let autoCarouselEnabled = true;
let rotateViews = [];
let viewIndex = 0;

// Player state tracking
let prevStrikerId = null;
let prevB1Name = null;
let prevB2Name = null;
let prevBowlerName = null;
let prevBat1Runs = -1;
let prevBat2Runs = -1;

// Milestone state
let autoMilestoneActive = false;
let autoMilestoneTimer = null;

// Hype state
let hypeTimeout = null;

// Profile state
let isPlayerProfileVisible = false;
let profileTimeout = null;
let newBatterTimeout = null;

// Upcoming batter queue
let pendingUpcomingBatter = null;
let pendingUpcomingTimer = null;

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🏏 Scorebar V29.0 Firebase Initializing...');

    const urlParams = new URLSearchParams(window.location.search);
    const urlMatchId = urlParams.get('match');
    if (urlMatchId) {
        matchId = urlMatchId;
        localStorage.setItem('matchId', matchId);
    }

    initFirebase();
    startAutoCarousel();
});

// ==========================================
// FIREBASE INIT
// ==========================================
function initFirebase() {
    try {
        if (!window.firebase) {
            throw new Error('Firebase library not loaded');
        }

        if (!firebase.apps.length) {
            firebaseApp = firebase.initializeApp(CONFIG.FIREBASE);
        } else {
            firebaseApp = firebase.apps[0];
        }

        database = firebase.database();
        setupFirebaseRealtime();
        console.log('✅ Scorebar Firebase Ready');
    } catch (e) {
        console.error('Firebase init failed:', e);
    }
}

// ==========================================
// LIGHTWEIGHT SELF PING
// ==========================================
async function measureOwnFirebasePing() {
    if (!database || !navigator.onLine) {
        selfPingMs = null;
        return null;
    }

    try {
        const start = performance.now();
        await database.ref(`ping/${matchId}/scorebar_probe`).set({
            t: firebase.database.ServerValue.TIMESTAMP
        });
        selfPingMs = Math.max(1, Math.round(performance.now() - start));
        return selfPingMs;
    } catch (e) {
        selfPingMs = null;
        return null;
    }
}

// ==========================================
// LOW-BANDWIDTH PRESENCE REFRESH
// ==========================================
async function refreshScorebarPresence() {
    if (!database || !navigator.onLine) return;

    const ping = await measureOwnFirebasePing();

    try {
        await database.ref(`presence/${matchId}/scorebar`).update({
            online: true,
            lastSeen: firebase.database.ServerValue.TIMESTAMP,
            version: '29.0',
            pingMs: ping ?? 0
        });
    } catch (e) { }
}

function startPresenceRefresh() {
    stopPresenceRefresh();
    refreshScorebarPresence();
    presenceRefreshInterval = setInterval(refreshScorebarPresence, 10000); // 10s
}

function stopPresenceRefresh() {
    if (presenceRefreshInterval) {
        clearInterval(presenceRefreshInterval);
        presenceRefreshInterval = null;
    }
}
// ==========================================
// FIREBASE REALTIME (Zero Bandwidth Presence)
// ==========================================
function setupFirebaseRealtime() {
    const amOnline = database.ref('.info/connected');
    const myPresenceRef = database.ref(`presence/${matchId}/scorebar`);

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

            startPresenceRefresh();
            showConnectionPopup();
        } else {
            stopPresenceRefresh();
        }
    });

    database.ref(`matches/${matchId}/live`).on('value', (snap) => {
        const data = snap.val();
        if (data) processLiveData(data);
    });

    database.ref(`matches/${matchId}/command`).on('value', (snap) => {
        const cmd = snap.val();
        if (!cmd || !cmd.ts) return;

        const cmdAge = Date.now() - cmd.ts;
        if (cmdAge > 5000) return;

        if (cmd.event === 'trigger_hype') {
            let duration = animSettings.fourDuration;
            if (cmd.payload.type === 'SIX') duration = animSettings.sixDuration;
            if (cmd.payload.type === 'WICKET') duration = animSettings.wicketDuration;
            triggerHype(cmd.payload.type, duration);
        }
        else if (cmd.event === 'show_profile') {
            showPlayerProfile(cmd.payload, animSettings.profileDuration);
        }
        else if (cmd.event === 'hide_graphics') {
            hidePlayerProfile();
            hideSummary();
            restoreFromSpecial();
        }
        else if (cmd.event === 'show_summary') {
            showSummary(cmd.payload);
        }
        else if (cmd.event === 'force_reload') {
            if (
                cmd.payload?.target === 'scorebar' ||
                cmd.payload?.target === 'all'
            ) {
                location.reload();
            }
        }
    });
}

function showConnectionPopup() {
    const popup = document.getElementById('connPopup');
    if (popup) {
        popup.classList.add('show');
        setTimeout(() => popup.classList.remove('show'), 3000);
    }
}

// ==========================================
// UPCOMING BATTER
// ==========================================
// ==========================================
// 🆕 UPCOMING BATTER (Profile Card System)
// ==========================================

/**
 * Get hold time for upcoming batter display
 */
function getUpcomingBatterHoldTime() {
    return Math.max(3500, (parseInt(animSettings.newBatterDelay, 10) || 1600) + 1500);
}

/**
 * Show upcoming batter as FULL PROFILE CARD
 * This uses the same profile system as manual profile - guaranteed to work!
 */
function showUpcomingBatterView(name, photoSrc = '', holdTime = null, playerData = null) {
    if (!name) return;

    // Build profile data
    const profileData = {
        name: name,
        photo: normalizeProfilePhotoSrc(photoSrc),
        role: playerData?.role || 'NEW BATSMAN',
        school: playerData?.school || '',
        age: playerData?.age || ''
    };

    const displayTime = holdTime || getUpcomingBatterHoldTime();

    // 🆕 Use the SAME profile system as manual profile card
    // This is what works when you click "Show Profile" manually
    showPlayerProfile(profileData, displayTime);

    console.log('🏏 Showing new batter profile:', name);
}

/**
 * Queue upcoming batter for display after current animation
 */
function queueUpcomingBatter(name, photoSrc = '', holdTime = null, playerData = null) {
    if (!name) return;

    pendingUpcomingBatter = {
        name: name,
        photoSrc: photoSrc,
        holdTime: holdTime || getUpcomingBatterHoldTime(),
        playerData: playerData || null
    };

    console.log('📋 Queued upcoming batter:', name);
}

/**
 * Flush queued upcoming batter after delay
 */
function flushQueuedUpcomingBatter(delay = 150) {
    if (!pendingUpcomingBatter) return;

    const queued = { ...pendingUpcomingBatter };
    pendingUpcomingBatter = null;

    if (pendingUpcomingTimer) {
        clearTimeout(pendingUpcomingTimer);
        pendingUpcomingTimer = null;
    }

    pendingUpcomingTimer = setTimeout(() => {
        showUpcomingBatterView(
            queued.name,
            queued.photoSrc,
            queued.holdTime,
            queued.playerData
        );
        pendingUpcomingTimer = null;
    }, delay);
}

/**
 * 🆕 Handle incoming new batter data from Admin
 * Called from processLiveData when showUpcomingBatter is true
 */
function handleIncomingNewBatter(data) {
    if (!data.upcomingBatterName) return;

    const name = data.upcomingBatterName;
    const photo = data.upcomingBatterPhoto || '';
    const holdTime = getUpcomingBatterHoldTime();

    // Build player data if available
    const playerData = {
        role: data.upcomingBatterRole || 'NEW BATSMAN',
        school: data.upcomingBatterSchool || '',
        age: data.upcomingBatterAge || ''
    };

    // Check if something is currently showing
    const hypeOverlay = document.getElementById('hypeOverlay');
    const isHypeShowing = hypeOverlay && hypeOverlay.classList.contains('show');

    if (isHypeShowing || isPlayerProfileVisible) {
        // Queue it for later
        queueUpcomingBatter(name, photo, holdTime, playerData);
    } else {
        // Show immediately
        showUpcomingBatterView(name, photo, holdTime, playerData);
    }
}

// ==========================================
// LIVE DATA HANDLING
// ==========================================
function processLiveData(data) {
    if (!data) return;

    lastDataReceived = Date.now();

    const prevCarouselInterval = animSettings.carouselInterval;

    if (data.animSettings) {
        animSettings = { ...animSettings, ...data.animSettings };
    }

    if (prevCarouselInterval !== animSettings.carouselInterval) {
        startAutoCarousel();
    }

    autoCarouselEnabled = data.autoCarousel !== false;

    const fhOverlay = document.getElementById('fhOverlay');
    if (fhOverlay) {
        fhOverlay.style.display = data.isFreeHit ? 'inline-block' : 'none';
    }

    // Inline hype trigger from live data
    if (data.triggerHype) {
        let duration = animSettings.fourDuration;
        if (data.triggerHype === 'SIX') duration = animSettings.sixDuration;
        if (data.triggerHype === 'WICKET') duration = animSettings.wicketDuration;
        triggerHype(data.triggerHype, duration);
    }

    if (data.showPlayerProfile && data.playerProfile) {
        showPlayerProfile(data.playerProfile, animSettings.profileDuration);
    } else if (data.hidePlayerProfile) {
        hidePlayerProfile();
    }

    if (data.showSummary && data.summary) {
        showSummary(data.summary);
    } else if (data.hideSummary) {
        hideSummary();
    }

    rotateViews = [];
    if (data.enTarget) rotateViews.push('view-target');
    if (data.enPart) rotateViews.push('view-partner');
    if (data.enPred) rotateViews.push('view-predictor');
    if (data.enChase && (parseInt(data.target) || 0) > 0) rotateViews.push('view-chase');

    if (data.matchType === 'test' && data.testMatch) {
        rotateViews.push('view-lead');
        updateLeadTrail(data.testMatch);
    }

    if (viewIndex >= rotateViews.length) {
        viewIndex = 0;
    }

    if (currentView !== 'view-bowler') {
        if (!autoCarouselEnabled || !rotateViews.includes(currentView)) {
            switchView('view-bowler');
        }
    }

    if (data.forceView && data.forceView !== lastForceTrig) {
        lastForceTrig = data.forceView;
        switchView(data.forceView.split('_')[0], animSettings.viewHoldDuration);
    }

    if (data.showAllOutCard && data.allOutData) {
        triggerAutoMilestone(
            generateAllOutCard(data.allOutData),
            Math.max(parseInt(animSettings.resultDelay, 10) || 3000, 3000)
        );
    }

    // Manual milestone support
    if (data.showMilestone && data.milestoneData) {
        triggerAutoMilestone(
            generateMilestoneCard(data.milestoneData),
            animSettings.milestoneDuration
        );
    }

    // 🆕 Handle new batter profile (uses same system as manual profile)
    if (data.showUpcomingBatter && data.upcomingBatterName) {
        handleIncomingNewBatter(data);
    }

    detectMilestones(data);
    handleSpecialMode(data);
    updateDisplay(data);
    updateChaseCarousel(data);
}

// ==========================================
// MILESTONE DETECTION
// ==========================================
function detectMilestones(data) {
    let b1R = parseInt(data.bat1?.runs) || 0;
    let b2R = parseInt(data.bat2?.runs) || 0;

    if (prevBat1Runs !== -1) {
        let jump = b1R - prevBat1Runs;
        if (jump > 0 && jump <= 10) {
            if (b1R >= 100 && prevBat1Runs < 100) {
                triggerAutoMilestone(generateMilestoneCard(data.bat1), animSettings.milestoneDuration);
            } else if (b1R >= 50 && prevBat1Runs < 50) {
                triggerAutoMilestone(generateMilestoneCard(data.bat1), animSettings.milestoneDuration);
            }
        }
    }

    if (prevBat2Runs !== -1) {
        let jump = b2R - prevBat2Runs;
        if (jump > 0 && jump <= 10) {
            if (b2R >= 100 && prevBat2Runs < 100) {
                triggerAutoMilestone(generateMilestoneCard(data.bat2), animSettings.milestoneDuration);
            } else if (b2R >= 50 && prevBat2Runs < 50) {
                triggerAutoMilestone(generateMilestoneCard(data.bat2), animSettings.milestoneDuration);
            }
        }
    }

    prevBat1Runs = b1R;
    prevBat2Runs = b2R;
}

function generateMilestoneCard(playerData) {
    const b = parseInt(playerData?.balls) || 0;
    const r = parseInt(playerData?.runs) || 0;
    const sr = b > 0 ? ((r / b) * 100).toFixed(2) : "0.00";
    const title = r >= 100 ? 'CENTURY' : 'HALF CENTURY';

    return `
        <div style="display:flex; align-items:center; justify-content:center; gap:22px; width:100%; padding:8px 16px;">
            ${generateMilestoneAvatar(playerData)}
            <div style="display:flex; flex-direction:column; gap:8px; align-items:flex-start; justify-content:center;">
                <div style="font-size:16px; font-weight:900; color:var(--gold); letter-spacing:2px; text-transform:uppercase;">
                    ${title}
                </div>
                <div style="display:flex; align-items:baseline; gap:14px; text-shadow:2px 2px 10px rgba(0,0,0,0.9); white-space:nowrap; flex-wrap:wrap;">
                    <span style="font-size:34px; font-weight:900; color:#fff; text-transform:uppercase;">${playerData?.name || 'PLAYER'}</span>
                    <span style="font-size:52px; font-weight:900; color:var(--gold); line-height:0.8;">
                        ${r}<span style="font-size:26px; color:#fff;">*</span>
                    </span>
                    <span style="font-size:22px; font-weight:800; color:#ddd;">(${b})</span>
                </div>
                <div style="display:flex; align-items:center; gap:18px; font-size:16px; font-weight:800; color:#fff; background:linear-gradient(90deg,transparent,rgba(0,0,0,0.78),transparent); padding:6px 28px; letter-spacing:1px; border-top:1px solid rgba(248,180,0,0.3); border-bottom:1px solid rgba(248,180,0,0.3);">
                    <div>SIXES: <span style="color:var(--gold); font-size:22px; margin-left:4px;">${playerData?.sixes || 0}</span></div>
                    <div style="color:rgba(255,255,255,0.3);">|</div>
                    <div>FOURS: <span style="color:var(--gold); font-size:22px; margin-left:4px;">${playerData?.fours || 0}</span></div>
                    <div style="color:rgba(255,255,255,0.3);">|</div>
                    <div>STRICK RATE: <span style="color:var(--gold); font-size:22px; margin-left:4px;">${sr}</span></div>
                </div>
            </div>
        </div>
    `;
}

function generateAllOutCard(data) {
    const teamName = data?.teamName || 'TEAM';
    const score = data?.score || '0/0';
    const overs = data?.overs || '0.0';

    return `
            <div class="result-card-wrap">
                <div class="result-card-kicker">INNINGS OVER</div>
                <div class="result-card-winner">
                    <span class="result-card-team">${teamName}</span>
                    <span class="result-card-team">${score}</span>
                </div>
                <div class="result-card-line">ALL OUT</div>
                <div class="result-card-sub">${overs} OVERS</div>
            </div>
        `;
}

function triggerAutoMilestone(htmlContent, duration) {
    autoMilestoneActive = true;

    const scoreboard = document.getElementById('scoreboard');
    const normalContent = document.getElementById('normalContent');
    const overlay = document.getElementById('specialOverlay');
    const overlayContent = document.getElementById('specialOverlayContent');

    if (!scoreboard || !normalContent || !overlay || !overlayContent) return;

    normalContent.classList.add('hide');

    setTimeout(() => {
        scoreboard.classList.add('is-special');

        overlay.classList.remove('plain-text');
        if (!htmlContent.includes('<div')) overlay.classList.add('plain-text');
        overlayContent.innerHTML = htmlContent;
        scheduleFitSpecialOverlay();
    }, 100);

    const displayTime = duration || animSettings.milestoneDuration;

    clearTimeout(autoMilestoneTimer);
    autoMilestoneTimer = setTimeout(() => {
        restoreFromSpecial();
    }, displayTime);
}

function restoreFromSpecial() {
    const scoreboard = document.getElementById('scoreboard');
    const normalContent = document.getElementById('normalContent');

    if (!scoreboard || !normalContent) return;

    scoreboard.classList.remove('is-special');

    setTimeout(() => {
        normalContent.classList.remove('hide');
        autoMilestoneActive = false;
    }, 400);
}

// ==========================================
// SPECIAL MODE
// ==========================================
function handleSpecialMode(data) {
    if (data.isSpecial && !autoMilestoneActive) {
        const normalContent = document.getElementById('normalContent');
        const scoreboard = document.getElementById('scoreboard');
        const overlay = document.getElementById('specialOverlay');
        const overlayContent = document.getElementById('specialOverlayContent');

        if (normalContent && scoreboard && overlay && overlayContent) {
            normalContent.classList.add('hide');
            scoreboard.classList.add('is-special');

            if ((data.specialText || '').includes('<div')) {
                overlay.classList.remove('plain-text');
            } else {
                overlay.classList.add('plain-text');
            }
            overlayContent.innerHTML = data.specialText || '';
            scheduleFitSpecialOverlay();
        }
    } else if (!data.isSpecial && !autoMilestoneActive) {
        const scoreboard = document.getElementById('scoreboard');
        if (scoreboard && scoreboard.classList.contains('is-special')) {
            restoreFromSpecial();
        }
    }
}

function fitSpecialOverlay() {
    const overlay = document.getElementById('specialOverlay');
    const content = document.getElementById('specialOverlayContent');
    if (!overlay || !content) return;

    content.style.transform = 'scale(1)';

    requestAnimationFrame(() => {
        const availW = overlay.clientWidth - 16;
        const availH = overlay.clientHeight - 16;

        const rect = content.getBoundingClientRect();
        let scale = Math.min(
            availW / Math.max(rect.width, 1),
            availH / Math.max(rect.height, 1),
            1
        );

        if (!isFinite(scale) || scale <= 0) scale = 1;
        content.style.transform = `scale(${scale})`;
    });
}

function scheduleFitSpecialOverlay() {
    fitSpecialOverlay();
    setTimeout(fitSpecialOverlay, 50);
    setTimeout(fitSpecialOverlay, 300);
    setTimeout(fitSpecialOverlay, 850);
}

// ==========================================
// DISPLAY UPDATES
// ==========================================
// ==========================================
// DISPLAY UPDATES
// ==========================================
function updateDisplay(data) {
    if (!data) return;

    const teamsHeader = document.getElementById('teamsHeader');
    const playSchool = document.getElementById('playSchool');
    const statusText = document.getElementById('statusText');

    if (teamsHeader) teamsHeader.innerText = `${data.batFlag} VS ${data.bowlFlag}`;
    if (playSchool) playSchool.innerText = data.batFlag;

    let statusStr = `CRR: ${data.crr}`;
    if (data.status) statusStr += ` • ${data.status}`;
    if (data.matchType === 'test' && data.testMatch) {
        statusStr = `DAY ${data.testMatch.day} • SESSION ${data.testMatch.session} • ${statusStr}`;
    }
    if (statusText) statusText.innerText = statusStr;

    let target = parseInt(data.target) || 0;
    if (target > 0) {
        let runsNeeded = target - (parseInt(data.runs) || 0);
        let bowled = getBallsFromOversValue(data.overs);
        let ballsRem = Math.max(0, (Math.floor(parseFloat(data.totOvers) * 6)) - bowled);
        let rrr = (runsNeeded > 0 && ballsRem > 0) ? (runsNeeded / (ballsRem / 6)).toFixed(2) : "0.00";

        const tarTextMain = document.getElementById('tarTextMain');
        const tarTextSub = document.getElementById('tarTextSub');

        if (tarTextMain && tarTextSub) {
            if (runsNeeded > 0) {
                tarTextMain.innerHTML = `${data.batFlag} NEEDS <span class="g-text">${runsNeeded}</span> RUNS IN <span class="g-text">${ballsRem}</span> BALLS`;
                tarTextSub.innerHTML = `RRR: <span class="g-text">${rrr}</span> • CRR: <span class="g-text">${parseFloat(data.crr || 0).toFixed(2)}</span>`;
            } else {
                tarTextMain.innerHTML = `${data.batFlag} WON THE MATCH`;
                tarTextSub.innerHTML = `TARGET WAS: <span class="g-text">${target}</span>`;
            }
        }
    }

    updateCounter('partRuns', data.partRuns || 0);
    updateCounter('partBalls', data.partBalls || 0);

    let t1p = parseInt(data.winProb) || 50;
    const predT1Name = document.getElementById('predT1Name');
    const predT2Name = document.getElementById('predT2Name');
    const predBarFill = document.getElementById('predBarFill');

    if (predT1Name) predT1Name.innerHTML = `${data.batFlag} <span class="g-text">${t1p}%</span>`;
    if (predT2Name) predT2Name.innerHTML = `<span style="color:#ccc;">${100 - t1p}%</span> ${data.bowlFlag}`;
    if (predBarFill) predBarFill.style.width = `${t1p}%`;

    // --- BUG FIX (හිස් Slots වල 0 0 සහ Arrow එක පෙන්නන එක නැවැත්වීම) ---
    const b1Valid = data.bat1 && data.bat1.name && data.bat1.name.trim() !== '';
    const b2Valid = data.bat2 && data.bat2.name && data.bat2.name.trim() !== '';

    prevB1Name = processBatterName('b1Name', 'rowB1', b1Valid ? data.bat1.name : '--', data.bat1?.isOut, prevB1Name);
    prevB2Name = processBatterName('b2Name', 'rowB2', b2Valid ? data.bat2.name : '--', data.bat2?.isOut, prevB2Name);

    const p1 = document.getElementById('p1');
    const p2 = document.getElementById('p2');

    if (p1 && p2) {
        p1.classList.remove('active');
        p2.classList.remove('active');

        if (data.striker === '1' && b1Valid) p1.classList.add('active');
        if (data.striker === '2' && b2Valid) p2.classList.add('active');
    }

    if (prevStrikerId !== null && data.striker !== prevStrikerId) {
        let row = document.getElementById(data.striker === "1" ? "rowB1" : "rowB2");
        if (row) {
            row.classList.remove('strike-changed');
            void row.offsetWidth;
            row.classList.add('strike-changed');
        }
    }
    prevStrikerId = data.striker;

    processBowlerName(data.bowler?.name || '--');

    renderLogo('logo1Box', 'batFlagLogo', data.batFlag, data.t1Logo);
    renderLogo('logo2Box', 'bowlFlagLogo', data.bowlFlag, data.t2Logo);

    updateText('oversText', data.overs);
    updateText('bowlFigs', data.bowler?.figs || '0-0 0.0');
    updateCounter('mainRuns', data.runs);
    updateCounter('mainWkts', data.wkts);

    // නමක් නැත්නම් ලකුණු Clear කරනවා
    if (b1Valid) {
        updateCounter('b1Runs', data.bat1?.runs || 0);
        updateCounter('b1Balls', data.bat1?.balls || 0);
    } else {
        const r1 = document.getElementById('b1Runs');
        const bl1 = document.getElementById('b1Balls');
        if (r1) r1.innerText = '';
        if (bl1) bl1.innerText = '';
    }

    if (b2Valid) {
        updateCounter('b2Runs', data.bat2?.runs || 0);
        updateCounter('b2Balls', data.bat2?.balls || 0);
    } else {
        const r2 = document.getElementById('b2Runs');
        const bl2 = document.getElementById('b2Balls');
        if (r2) r2.innerText = '';
        if (bl2) bl2.innerText = '';
    }

    renderOverBalls(data.thisOver || '');
}

function getTwoInitials(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean) return 'PL';

    const parts = clean.split(' ').filter(Boolean);

    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    const one = parts[0] || '';
    return one.slice(0, 2).toUpperCase() || 'PL';
}

function normalizeProfilePhotoSrc(photo) {
    const src = String(photo || '').trim();
    if (!src) return '';

    if (/^(data:image\/|https?:\/\/|blob:)/i.test(src)) {
        return src;
    }

    const cleaned = src.replace(/\s+/g, '');
    if (/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
        return `data:image/jpeg;base64,${cleaned}`;
    }

    return src;
}

function generateMilestoneAvatar(playerData) {
    const photoSrc = normalizeProfilePhotoSrc(
        playerData?.photo || playerData?.photo_url || playerData?.photo_base64 || ''
    );
    const initials = getTwoInitials(playerData?.name || 'PL');

    if (photoSrc) {
        return `
            <div style="position:relative; width:94px; height:94px; border-radius:50%; overflow:hidden; border:3px solid rgba(248,180,0,0.45); box-shadow:0 8px 20px rgba(0,0,0,0.35); flex-shrink:0; background:rgba(255,255,255,0.08);">
                <img src="${photoSrc}"
                     style="width:100%; height:100%; object-fit:cover; display:block;"
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div style="display:none; width:100%; height:100%; align-items:center; justify-content:center; font-size:28px; font-weight:900; color:#fff; background:linear-gradient(135deg,#1f2937,#111827);">
                    ${initials}
                </div>
            </div>
        `;
    }

    return `
        <div style="width:94px; height:94px; border-radius:50%; border:3px solid rgba(248,180,0,0.45); box-shadow:0 8px 20px rgba(0,0,0,0.35); flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:28px; font-weight:900; color:#fff; background:linear-gradient(135deg,#1f2937,#111827);">
            ${initials}
        </div>
    `;
}

function setProfilePhoto(photo, playerName) {
    const wrap = document.getElementById('ppPhotoWrap');
    const img = document.getElementById('ppPhoto');
    const fallback = document.getElementById('ppPhotoFallback');

    if (!wrap || !img || !fallback) return;

    const normalizedSrc = normalizeProfilePhotoSrc(photo);
    fallback.innerText = getTwoInitials(playerName);

    // පරණ Photo එක ඉක්මනින් අයින් කිරීම
    wrap.classList.remove('has-image');
    img.removeAttribute('src');

    if (!normalizedSrc) return;

    // අලුත් Photo එක Preload කරලා දානවා (Delay Error එක Fix වීම)
    const tempImg = new Image();
    tempImg.onload = () => {
        img.src = normalizedSrc;
        wrap.classList.add('has-image');
    };
    tempImg.onerror = () => {
        wrap.classList.remove('has-image');
        img.removeAttribute('src');
    };
    tempImg.src = normalizedSrc;
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
function updateCounter(elId, newV) {
    const el = document.getElementById(elId);
    if (!el) return;

    const curV = parseInt(el.innerText) || 0;
    const tarV = parseInt(newV) || 0;

    if (curV !== tarV) {
        el.classList.remove('pop-update');
        void el.offsetWidth;
        el.classList.add('pop-update');

        let start = null;
        const duration = 400;

        const step = (ts) => {
            if (!start) start = ts;
            const progress = Math.min((ts - start) / duration, 1);
            const easeOut = progress * (2 - progress);
            el.innerText = Math.floor(curV + (tarV - curV) * easeOut);
            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                el.innerText = tarV;
            }
        };

        window.requestAnimationFrame(step);
    }
}

function updateText(elId, newV) {
    const el = document.getElementById(elId);
    if (el && el.innerText !== String(newV)) {
        el.innerText = newV;
        el.classList.remove('pop-update');
        void el.offsetWidth;
        el.classList.add('pop-update');
    }
}

function getBallsFromOversValue(o) {
    o = parseFloat(o) || 0;
    return Math.floor(o) * 6 + Math.round((o % 1) * 10);
}

// ==========================================
// BATTER NAME ANIMATION
// ==========================================
function processBatterName(id, rowId, currentNameData, isOutData, prevNameVar) {
    const el = document.getElementById(id);
    const row = document.getElementById(rowId);
    if (!el) return prevNameVar;

    if (isOutData) {
        el.classList.add('out-text');
    } else {
        el.classList.remove('out-text');
    }

    if (prevNameVar !== currentNameData) {
        if (prevNameVar === null) {
            el.innerText = currentNameData;
            return currentNameData;
        }

        if (row) {
            row.classList.remove('swipe-in');
            row.classList.add('swipe-out');
        }

        setTimeout(() => {
            el.innerText = currentNameData;
            if (!isOutData) el.classList.remove('out-text');

            if (row) {
                row.classList.remove('swipe-out');
                row.classList.add('swipe-in');
            }
        }, 300);

        return currentNameData;
    }

    return prevNameVar;
}

// ==========================================
// BOWLER NAME ANIMATION
// ==========================================
function processBowlerName(currentName) {
    const el = document.getElementById('bowlName');
    if (!el) return;

    if (prevBowlerName !== currentName && prevBowlerName !== null) {
        el.classList.remove('swipe-in');
        el.classList.add('swipe-out');

        setTimeout(() => {
            el.innerText = currentName;
            el.classList.remove('swipe-out');
            el.classList.add('swipe-in');
        }, 300);
    } else {
        el.innerText = currentName;
    }

    prevBowlerName = currentName;
}

// ==========================================
// LOGO RENDERING
// ==========================================
function renderLogo(bId, fId, fTxt, src) {
    const box = document.getElementById(bId);
    if (!box) return;

    if (src && src.length > 5) {
        box.innerHTML = `<img src="${src}">`;
    } else {
        box.innerHTML = `<div class="crest-placeholder" id="${fId}">${fTxt}</div>`;
    }
}

// ==========================================
// OVER BALLS DISPLAY
// ==========================================
function renderOverBalls(thisOverStr) {
    const ballsArray = (thisOverStr || "").trim().split(" ").filter(Boolean);
    const container = document.getElementById('ballsRowContainer');
    if (!container) return;

    container.innerHTML = "";
    let legalCount = 0;
    const lastBallIndex = ballsArray.length - 1;

    ballsArray.forEach((val, idx) => {
        let div = document.createElement('div');
        div.className = 'ball pop-update';

        let vUp = val.toUpperCase();
        if (vUp === '0') vUp = '•';
        div.innerText = vUp;

        if (vUp.includes('W') && !vUp.includes('WD')) {
            div.classList.add('w');
        } else if (vUp.includes('NB')) {
            div.classList.add('nb');
        } else if (vUp.includes('WD')) {
            div.classList.add('wd');
        } else if (vUp.includes('4')) {
            div.classList.add('b4');
        } else if (vUp.includes('6')) {
            div.classList.add('b6');
        } else if (vUp === '•') {
            div.classList.add('dot');
        }

        if (idx === lastBallIndex) div.classList.add('last-ball');
        if (!vUp.includes('NB') && !vUp.includes('WD')) legalCount++;

        container.appendChild(div);
    });

    for (let i = 0; i < 6 - legalCount; i++) {
        let d = document.createElement('div');
        d.className = 'ball empty';
        container.appendChild(d);
    }
}

// ==========================================
// HYPE ANIMATIONS
// ==========================================
function triggerHype(type, duration) {
    if (hypeTimeout) clearTimeout(hypeTimeout);

    const overlay = document.getElementById('hypeOverlay');
    const text = document.getElementById('hypeText');
    const content = document.getElementById('normalContent');

    if (!overlay || !text || !content) return;

    text.innerText = type;
    text.className = 'hype-text';

    if (type === 'WICKET') text.classList.add('wicket');
    else if (type === 'SIX') text.classList.add('six');

    content.classList.add('hide-for-hype');
    overlay.classList.add('show');

    const displayTime = duration || animSettings.fourDuration;

    hypeTimeout = setTimeout(() => {
        overlay.classList.remove('show');

        setTimeout(() => {
            const newBatterOverlay = document.getElementById('newBatterOverlay');
            if (!newBatterOverlay || !newBatterOverlay.classList.contains('show')) {
                content.classList.remove('hide-for-hype');
            }
        }, 200);
    }, displayTime);
}

// ==========================================
// PLAYER PROFILE
// ==========================================
function showPlayerProfile(data, duration) {
    const hypeOverlay = document.getElementById('hypeOverlay');
    if (hypeOverlay && hypeOverlay.classList.contains('show')) {
        // Infinite loop වීම නවත්තන්න
        if (window.profileRetry) clearTimeout(window.profileRetry);
        window.profileRetry = setTimeout(() => showPlayerProfile(data, duration), 500);
        return;
    }
    // ... ඉතුරු ටික වෙනස් කරන්න එපා

    const scoreboard = document.getElementById('scoreboard');
    if (!scoreboard) return;

    const ppRole = document.getElementById('ppRole');
    const ppName = document.getElementById('ppName');
    const ppSchool = document.getElementById('ppSchool');
    const ppAge = document.getElementById('ppAge');

    const playerName = data?.name || 'PLAYER NAME';

    setProfilePhoto(data?.photo || '', playerName);

    if (ppRole) ppRole.innerText = data.role || 'PLAYER';
    if (ppName) ppName.innerText = playerName;
    if (ppSchool) ppSchool.innerText = data.school || 'School Name';
    if (ppAge) ppAge.innerText = data.age ? 'Age ' + data.age : '';

    scoreboard.classList.add('profile-mode');
    isPlayerProfileVisible = true;

    const normalContent = document.getElementById('normalContent');
    const newBatterOverlay = document.getElementById('newBatterOverlay');

    if (normalContent && newBatterOverlay) {
        normalContent.classList.add('hide-for-hype');
        newBatterOverlay.classList.add('show');

        if (newBatterTimeout) clearTimeout(newBatterTimeout);

        newBatterTimeout = setTimeout(() => {
            newBatterOverlay.classList.remove('show');

            setTimeout(() => {
                if ((!hypeOverlay || !hypeOverlay.classList.contains('show')) &&
                    !scoreboard.classList.contains('is-special')) {
                    normalContent.classList.remove('hide-for-hype');
                }
            }, 300);
        }, Math.max(2500, animSettings.newBatterDelay + 900));
    }

    if (profileTimeout) clearTimeout(profileTimeout);

    const displayTime = duration || animSettings.profileDuration;

    profileTimeout = setTimeout(() => {
        hidePlayerProfile();
    }, displayTime);
}

function hidePlayerProfile() {
    const scoreboard = document.getElementById('scoreboard');
    if (!scoreboard) return;

    scoreboard.classList.remove('profile-mode');
    isPlayerProfileVisible = false;

    const newBatterOverlay = document.getElementById('newBatterOverlay');
    const normalContent = document.getElementById('normalContent');

    if (newBatterOverlay && newBatterOverlay.classList.contains('show')) {
        newBatterOverlay.classList.remove('show');

        if (newBatterTimeout) {
            clearTimeout(newBatterTimeout);
            newBatterTimeout = null;
        }

        setTimeout(() => {
            const hypeOverlay = document.getElementById('hypeOverlay');
            if ((!hypeOverlay || !hypeOverlay.classList.contains('show')) &&
                !scoreboard.classList.contains('is-special')) {
                if (normalContent) normalContent.classList.remove('hide-for-hype');
            }

            flushQueuedUpcomingBatter(120);
        }, 300);
    } else {
        flushQueuedUpcomingBatter(120);
    }

    if (profileTimeout) {
        clearTimeout(profileTimeout);
        profileTimeout = null;
    }

    const wrap = document.getElementById('ppPhotoWrap');
    const img = document.getElementById('ppPhoto');
    const fallback = document.getElementById('ppPhotoFallback');

    if (wrap) wrap.classList.remove('has-image');
    if (img) img.removeAttribute('src');
    if (fallback) fallback.innerText = 'PL';
}

// ==========================================
// MATCH SUMMARY
// ==========================================
function showSummary(data) {
    const overlay = document.getElementById('summaryOverlay');
    const scoreboard = document.getElementById('scoreboard');
    const inningsView = document.getElementById('sumInningsView');
    const matchView = document.getElementById('sumMatchView');

    if (!overlay || !scoreboard) return;

    if (data.title) {
        document.getElementById('sumTitle').innerText = data.title;
    }

    if (data.type === 'match') {
        if (inningsView) inningsView.style.display = 'none';
        if (matchView) matchView.style.display = 'block';

        setText('sumTeam1Badge', data.team1Name || 'T1');
        setText('sumTeam1Name', data.team1FullName || data.team1Name || 'Team 1');
        setText('sumTeam1Score', data.team1Score || '0/0');
        setText('sumTeam1Overs', `(${data.team1Overs || '0.0'})`);

        setText('sumTeam2Badge', data.team2Name || 'T2');
        setText('sumTeam2Name', data.team2FullName || data.team2Name || 'Team 2');
        setText('sumTeam2Score', data.team2Score || '0/0');
        setText('sumTeam2Overs', `(${data.team2Overs || '0.0'})`);

        setText('sumResultText', data.result || 'MATCH RESULT');

        renderPerformers('sumMatchBatsmen', data.batsmen, 'bat');
        renderPerformers('sumMatchBowlers', data.bowlers, 'bowl');

    } else {
        if (inningsView) inningsView.style.display = 'block';
        if (matchView) matchView.style.display = 'none';

        setText('sumTeamName', data.teamName);
        setText('sumRuns', data.runs);
        setText('sumOvers', '(' + data.overs + ' Overs)');
        setText('sumTarget', data.target);

        const batsmenEl = document.getElementById('sumBatsmen');
        if (batsmenEl && data.batsmen?.length > 0) {
            batsmenEl.innerHTML = data.batsmen.map(b => `
                    <div class="sum-row">
                        <span class="sum-name">${b.name}</span>
                        <span class="sum-stat">${b.runs} (${b.balls})</span>
                    </div>
                `).join('');
        }

        const bowlersEl = document.getElementById('sumBowlers');
        if (bowlersEl && data.bowlers?.length > 0) {
            bowlersEl.innerHTML = data.bowlers.map(b => `
                    <div class="sum-row">
                        <span class="sum-name">${b.name}</span>
                        <span class="sum-stat">${b.figs}</span>
                    </div>
                `).join('');
        }
    }

    overlay.classList.add('show');
    scoreboard.style.opacity = '0';
    scoreboard.style.transform = 'translateY(30px)';
}

function hideSummary() {
    const overlay = document.getElementById('summaryOverlay');
    const scoreboard = document.getElementById('scoreboard');

    if (!overlay || !scoreboard) return;

    overlay.classList.remove('show');
    scoreboard.style.opacity = '1';
    scoreboard.style.transform = 'translateY(0)';
}

function renderPerformers(containerId, players, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!players || players.length === 0) {
        container.innerHTML = '<div class="sum-performer-item"><span class="sum-performer-name">--</span></div>';
        return;
    }

    container.innerHTML = players.map(p => `
            <div class="sum-performer-item">
                <span class="sum-performer-name">${p.name}</span>
                <span class="sum-performer-stat">${type === 'bat' ? `${p.runs} (${p.balls})` : p.figs}</span>
            </div>
        `).join('');
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text || '';
}

// ==========================================
// VIEW SWITCHING (Carousel)
// ==========================================
function switchView(targetViewId, holdTime) {
    if (currentView === targetViewId) return;

    const outEl = document.getElementById(currentView);
    const inEl = document.getElementById(targetViewId);

    if (outEl) {
        outEl.classList.remove('active');
        outEl.classList.add('exit-left');
    }

    if (inEl) {
        inEl.classList.remove('exit-left');
        inEl.classList.add('active');
    }

    setTimeout(() => {
        if (outEl) outEl.classList.remove('exit-left');
    }, 600);

    currentView = targetViewId;

    const hold = holdTime || animSettings.viewHoldDuration;

    if (targetViewId !== 'view-bowler') {
        clearTimeout(carouselTimer);
        carouselTimer = setTimeout(() => {
            switchView('view-bowler');
        }, hold);
    }
}

function startAutoCarousel() {
    if (carouselLoop) clearInterval(carouselLoop);

    carouselLoop = setInterval(() => {
        if (
            autoCarouselEnabled &&
            currentView === 'view-bowler' &&
            !autoMilestoneActive &&
            rotateViews.length > 0
        ) {
            switchView(rotateViews[viewIndex], animSettings.viewHoldDuration);
            viewIndex = (viewIndex + 1) % rotateViews.length;
        }
    }, animSettings.carouselInterval);
}

// ==========================================
// CHASE CAROUSEL
// ==========================================
function updateChaseCarousel(data) {
    const target = parseInt(data.target) || 0;
    const runs = parseInt(data.runs) || 0;
    const overs = parseFloat(data.overs) || 0;
    const totalOvers = parseInt(data.totOvers) || 20;
    const crr = parseFloat(data.crr) || 0;

    const fill = document.getElementById('chaseViewFill');
    const crrEl = document.getElementById('chaseCrr');
    const rrrEl = document.getElementById('chaseRrr');
    const title = document.getElementById('chaseViewTitle');
    const scoreLabel = document.getElementById('chaseScoreLabel');

    if (!fill || !crrEl || !rrrEl || !title || !scoreLabel) return;
    if (target <= 0) return;

    const need = Math.max(0, target - runs);
    const bowledBalls = getBallsFromOversValue(overs);
    const totalBalls = totalOvers * 6;
    const ballsRem = Math.max(0, totalBalls - bowledBalls);
    const rrr = (need > 0 && ballsRem > 0) ? (need / (ballsRem / 6)) : 0;

    const progressPct = Math.min((runs / Math.max(1, target - 1)) * 100, 100);
    fill.style.width = `${progressPct}%`;

    if (runs >= target) {
        fill.style.background = 'linear-gradient(90deg, #10b981, #34d399)';
        title.innerText = 'TARGET CHASED ✅';
    } else if (progressPct > 70) {
        fill.style.background = 'linear-gradient(90deg, #10b981, #6ee7b7)';
        title.innerText = 'TARGET PROGRESS';
    } else if (progressPct > 40) {
        fill.style.background = 'linear-gradient(90deg, var(--gold), #fde047)';
        title.innerText = 'TARGET PROGRESS';
    } else {
        fill.style.background = 'linear-gradient(90deg, #ef4444, #fca5a5)';
        title.innerText = 'TARGET PROGRESS';
    }

    scoreLabel.innerText = `${runs} / ${target - 1}`;
    crrEl.innerText = crr.toFixed(2);
    rrrEl.innerText = rrr.toFixed(2);

    crrEl.className = '';
    rrrEl.className = '';

    if (crr > rrr) {
        crrEl.classList.add('chase-rate-good');
        rrrEl.classList.add('chase-rate-bad');
    } else if (rrr > crr) {
        crrEl.classList.add('chase-rate-bad');
        rrrEl.classList.add('chase-rate-good');
    } else {
        crrEl.classList.add('chase-rate-even');
        rrrEl.classList.add('chase-rate-even');
    }
}

// ==========================================
// TEST MATCH LEAD/TRAIL
// ==========================================
function updateLeadTrail(testData) {
    if (!testData) return;

    const title = document.getElementById('leadViewTitle');
    const value = document.getElementById('leadViewValue');

    if (!title || !value) return;

    if (testData.isLead) {
        title.innerText = 'LEAD';
        title.style.color = '#86efac';
    } else {
        title.innerText = 'TRAIL';
        title.style.color = '#fca5a5';
    }

    value.innerText = testData.lead || 0;
}

// ==========================================
// KEYBOARD SHORTCUTS (Testing)
// ==========================================
document.addEventListener('keydown', (e) => {
    switch (e.key) {
        case '4':
            triggerHype('FOUR', animSettings.fourDuration);
            break;
        case '6':
            triggerHype('SIX', animSettings.sixDuration);
            break;
        case 'w':
        case 'W':
            triggerHype('WICKET', animSettings.wicketDuration);
            break;
        case 'p':
        case 'P':
            if (isPlayerProfileVisible) {
                hidePlayerProfile();
            } else {
                showPlayerProfile({
                    photo: '',
                    role: 'BATSMAN',
                    name: 'TEST PLAYER',
                    school: 'Test School',
                    age: '25'
                }, animSettings.profileDuration);
            }
            break;
        case 'm':
        case 'M':
            const summaryOverlay = document.getElementById('summaryOverlay');
            if (summaryOverlay && summaryOverlay.classList.contains('show')) {
                hideSummary();
            } else {
                showSummary({
                    title: 'INNINGS SUMMARY',
                    teamName: 'TEST TEAM',
                    runs: '150/5',
                    overs: '20.0',
                    target: '151',
                    batsmen: [
                        { name: 'Player 1', runs: 75, balls: 45 },
                        { name: 'Player 2', runs: 50, balls: 35 }
                    ],
                    bowlers: [
                        { name: 'Bowler 1', figs: '2-25 (4.0)' }
                    ]
                });
            }
            break;
        case 't':
        case 'T':
            triggerAutoMilestone(generateMilestoneCard({
                name: 'TEST PLAYER',
                runs: 50,
                balls: 30,
                fours: 5,
                sixes: 2
            }), animSettings.milestoneDuration);
            break;
    }
});

// ==========================================
// WINDOW EVENTS
// ==========================================
window.addEventListener('beforeunload', () => {
    stopPresenceRefresh();

    if (database && matchId) {
        database.ref(`presence/${matchId}/scorebar`).set({
            online: false,
            lastSeen: Date.now(),
            version: '29.0',
            pingMs: 0
        });
    }
});

window.addEventListener('offline', () => {
    console.log('⚠️ Internet connection lost');
});

window.addEventListener('online', () => {
    console.log('✅ Internet connection restored');
});

// ==========================================
// INITIALIZATION COMPLETE
// ==========================================
console.log('🏏 Scorebar V29.0 Firebase Optimized Loaded');
console.log('⌨️ Test Shortcuts: 4=FOUR, 6=SIX, W=WICKET, P=Profile, M=Summary, T=Milestone');