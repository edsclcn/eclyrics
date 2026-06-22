/** Initial lyric blocks when a tab is created (add inserts one at a time). */
const INITIAL_BLOCK_COUNT = 3;
/** Hard wrap: row 1 holds blocks 1–3, row 2 holds 4–6, etc. */
const MAX_BLOCKS_PER_ROW = 3;
const SESSION_ID = Math.random().toString().substring(2);
const PREVIEW_PROMPTER_SPEED_KEY = 'eclyrics-preview-prompter-speed';
const PREVIEW_STAGE_THEME_KEY = 'eclyrics-preview-stage-theme';

/* ─────────────────────────────────────────────────────────
 * PREVIEW PROMPTER DOCK — controls the opened prompter window
 *   (play, speed, blocks; global keyboard shortcuts via prompter-shortcuts.js)
 * ───────────────────────────────────────────────────────── */
const PREVIEW_PROMPTER = {
    speedMin: 0.1,
    speedMax: 6.5,
    speedStep: 0.1,
    defaultSpeed: 0.5,
};
/** Fixed manual scroll step for ArrowUp/ArrowDown (not scaled by scroll speed). */
const PREVIEW_KEYBOARD_SCROLL_PX = 100;
/** Fixed manual scroll step per mouse wheel tick in the preview strip (not scaled by scroll speed). */
const PREVIEW_WHEEL_SCROLL_PX = 50;
const PROMPTER_POPUP_W = 1920;
const PROMPTER_POPUP_H = 1080;
const PROMPTER_BC_NAME = 'eclyrics-prompter';
/** Single reused popup name so Send never opens a second window while the first is open. */
const PROMPTER_WINDOW_NAME = 'eclyricsPrompter';

let tabCount = 0;
let prompterBroadcast = null;
let lastPrompterSync = null;
let lastPrompterSyncAt = 0;
/** Tab id last sent to the prompter — lineup pushes are gated to this tab only. */
let prompterBoundTabId = null;
/** Slow backup interval for parity watchdog (ms). Primary path should sync via broadcasts. */
const PROMPTER_PARITY_BACKUP_MS = 5000;
/** @type {((drifts: object[]) => void) | null} */
let reportParityDrift = null;
let prompterParityWatchdog = 0;
let prompterPopupWindow = null;
let activeTabs = [];
let textNum = {};
/** One full-lyrics editor at a time; opening another block switches content. */
/** @type {{ blockTabId: string, sourceId: string, pane: HTMLElement, editor: HTMLTextAreaElement } | null} */
let blockEditorSession = null;
let activeBlockTabId = null;
/** @type {Record<string, ReturnType<typeof setTimeout>>} */
const prompterLineupSyncTimers = {};

let blockSourceTargetTextarea = null;
const SONG_LIBRARY_RESULT_LIMIT = 80;

/* ─────────────────────────────────────────────────────────
 * SONG CATEGORY PILLS — colors, filters, restricted states
 *
 *   himnario    light blue
 *   adaptation  yellow
 *   original    dark blue
 *   asop/f      purple
 *   revision    orange  (non-selectable)
 *   archived    red     (non-selectable)
 *
 *   revision/archived → only those pills shown; deprioritized in search
 * ───────────────────────────────────────────────────────── */
const SONG_CATEGORY_FILTERS = [
    { slug: 'himnario', label: 'Himnario' },
    { slug: 'original', label: 'Original' },
    { slug: 'adaptation', label: 'Adaptation' },
    { slug: 'asop-f', label: 'ASOP/F', aliases: ['asop/f', 'asopf'] },
    { slug: 'revision', label: 'Revision' },
    { slug: 'archived', label: 'Archived' },
];

const RESTRICTED_CATEGORY_SLUGS = new Set(['revision', 'archived']);

/** @type {Set<string>} */
let blockSourceActiveCategoryFilters = new Set();

function defaultPrompterSync() {
    const fs = parseFloat(localStorage.getItem('eclyrics-prompter-fontSize'));
    const cw = parseFloat(localStorage.getItem('eclyrics-prompter-width'));
    const sp = parseFloat(localStorage.getItem(PREVIEW_PROMPTER_SPEED_KEY));
    const storedTheme = localStorage.getItem(PREVIEW_STAGE_THEME_KEY);
    const theme = storedTheme === 'bw' || storedTheme === 'lyrics' ? storedTheme : 'lyrics';
    return {
        type: 'eclyrics-prompter-sync',
        top: 0,
        vw: PROMPTER_POPUP_W,
        vh: PROMPTER_POPUP_H,
        fs: !Number.isNaN(fs) ? fs : 138,
        ls: theme === 'lyrics' ? '2.5px' : 'normal',
        lh: '1.2em',
        cw: !Number.isNaN(cw) ? cw : PROMPTER_POPUP_W * 0.7,
        speed: !Number.isNaN(sp) ? sp : PREVIEW_PROMPTER.defaultSpeed,
        playing: false,
        theme,
    };
}

/** Parse letter-spacing / similar values from prompter computed style. */
function parsePrompterCssPx(value, fallback = 0) {
    if (!value || value === 'normal') return fallback;
    const n = parseFloat(value);
    return Number.isNaN(n) ? fallback : n;
}

function getPreviewScaleFactor(wrap) {
    if (!wrap) return 1;
    /* Scale preview strip to fit; logical stage is always PROMPTER_POPUP_W (not window/zoom size). */
    return Math.max(0.04, wrap.clientWidth / PROMPTER_POPUP_W);
}

function applyPreviewStageTheme(theme) {
    const wp = document.querySelector('.workspace-preview');
    if (!wp || (theme !== 'lyrics' && theme !== 'bw')) return;
    wp.classList.remove('preview-stage--lyrics', 'preview-stage--bw');
    wp.classList.add(theme === 'lyrics' ? 'preview-stage--lyrics' : 'preview-stage--bw');
    wp.dataset.stageTheme = theme;
}

function getSyncGuardApi() {
    return typeof EclyricsPrompterSyncGuard !== 'undefined' ? EclyricsPrompterSyncGuard : null;
}

function readPreviewViewfinderMetrics() {
    const inner = document.getElementById('lyrics-preview-viewfinder');
    const guard = getSyncGuardApi();
    if (!inner || inner.classList.contains('preview-empty') || !guard) return null;
    return {
        top: guard.parsePx(inner.style.top, 0),
        fs: guard.parsePx(inner.style.fontSize, 0),
        cw: guard.parsePx(inner.style.width, 0),
    };
}

function getLiveBlockParityExpectation() {
    const guard = getSyncGuardApi();
    const liveTa = getLivePrompterTextarea();
    if (!guard || !liveTa) return null;

    const m = liveTa.id.match(/^textarea-(\d+)-(\d+)$/);
    if (!m) return null;

    const liveTabId = parseInt(m[1], 10);
    const raw = liveTa.value;
    const lineupBlock = raw.trim() ? `\n${formatText(raw)}` : '';
    return {
        lineupKey: getLineupKeyForTab(liveTabId),
        blockIndex: parseInt(m[2], 10) - 1,
        contentFingerprint: lineupBlock ? guard.hashString(lineupBlock) : null,
        tabId: liveTabId,
    };
}

function reconcilePrompterParity(drifts) {
    if (!drifts?.length) return;

    const needsVisual = drifts.some((d) => d.kind === 'visual');
    const needsContent = drifts.some((d) => d.kind === 'content' || d.kind === 'index');
    const needsStale = drifts.some((d) => d.kind === 'stale');

    if (needsVisual) applyViewfinderFromPrompterSync();

    if (needsContent) {
        const exp = getLiveBlockParityExpectation();
        const tabId = exp?.tabId ?? prompterBoundTabId;
        if (tabId != null) {
            pushLineupToOpenPrompter(tabId);
            const sync = lastPrompterSync;
            if (
                exp &&
                sync &&
                typeof sync.currentIndex === 'number' &&
                sync.currentIndex !== exp.blockIndex
            ) {
                sendPrompt(tabId, exp.blockIndex + 1, { openIfClosed: false, focusWindow: false });
            }
        }
    }

    if (needsStale && isPrompterWindowOpen()) {
        postPrompterControl({ action: 'requestSync' });
    }
}

function runPrompterParityCheck() {
    if (!isPrompterWindowOpen()) return;

    const guard = getSyncGuardApi();
    if (!guard || !lastPrompterSync) return;

    /** @type {import('./prompter-sync-guard').ParityDrift[]} */
    const drifts = [];

    const dom = readPreviewViewfinderMetrics();
    if (dom) drifts.push(...guard.diffVisualAgainstDom(lastPrompterSync, dom));

    const expected = getLiveBlockParityExpectation();
    if (expected?.contentFingerprint) {
        drifts.push(...guard.diffContentAgainstLive(lastPrompterSync, expected));
    }

    if (lastPrompterSyncAt > 0) {
        drifts.push(...guard.diffStaleSync(lastPrompterSyncAt));
    }

    if (!drifts.length) return;

    if (!reportParityDrift) reportParityDrift = guard.createThrottledReporter();
    reportParityDrift(drifts);
    reconcilePrompterParity(drifts);
}

function initPrompterParityGuard() {
    const guard = getSyncGuardApi();
    if (!guard) {
        console.error('[eclyrics] prompter-sync-guard.js must load before index.js');
        return;
    }

    if (prompterParityWatchdog) clearInterval(prompterParityWatchdog);
    prompterParityWatchdog = window.setInterval(() => {
        if (!isPrompterWindowOpen()) return;
        runPrompterParityCheck();
    }, PROMPTER_PARITY_BACKUP_MS);
}

function ingestPrompterSyncBroadcast(normalized) {
    if (!normalized || normalized.type !== 'eclyrics-prompter-sync') return;
    const prevFingerprint = lastPrompterSync?.contentFingerprint;
    const prevIndex = lastPrompterSync?.currentIndex;
    /* Stage dimensions are logical (1920×1080), never follow browser zoom or popup resize. */
    normalized.vw = PROMPTER_POPUP_W;
    normalized.vh = PROMPTER_POPUP_H;
    lastPrompterSync = { ...(lastPrompterSync || {}), ...normalized };
    lastPrompterSyncAt = Date.now();
    applyViewfinderFromPrompterSync();
    updatePreviewDockFromSync(normalized);
    const contentChanged =
        (typeof normalized.contentFingerprint === 'string' &&
            normalized.contentFingerprint !== prevFingerprint) ||
        (typeof normalized.currentIndex === 'number' && normalized.currentIndex !== prevIndex);
    if (contentChanged && getLivePrompterTextarea()) {
        updateLiveViewfinder();
    }
}

function applyViewfinderFromPrompterSync() {
    const wrap = document.querySelector('.preview-viewfinder-16x9');
    const pan = document.getElementById('preview-viewfinder-pan');
    const inner = document.getElementById('lyrics-preview-viewfinder');
    if (!wrap || !pan || !inner) return;

    if (inner.classList.contains('preview-empty')) {
        inner.style.width = '';
        inner.style.fontSize = '';
        inner.style.letterSpacing = '';
        inner.style.lineHeight = '';
        inner.style.top = '';
        inner.style.left = '';
        inner.style.right = '';
        inner.style.transform = '';
        inner.style.position = '';
        pan.style.transform = '';
        pan.style.transformOrigin = '';
        return;
    }

    const data = lastPrompterSync || defaultPrompterSync();
    const k = getPreviewScaleFactor(wrap);
    const top = typeof data.top === 'number' ? data.top : 0;
    const fs = data.fs || 138;
    const cw = data.cw || PROMPTER_POPUP_W * 0.7;
    const lsPx = parsePrompterCssPx(data.ls, data.theme === 'bw' ? 0 : 2.5);

    /* Match prompter pixel-for-pixel, then scale from viewport top-center. */
    inner.style.position = 'absolute';
    inner.style.left = '50%';
    inner.style.right = 'auto';
    inner.style.top = `${top}px`;
    inner.style.width = `${cw}px`;
    inner.style.fontSize = `${fs}px`;
    inner.style.lineHeight = data.lh || '1.2em';
    inner.style.letterSpacing = lsPx > 0 ? `${lsPx}px` : 'normal';
    inner.style.transform = 'translateX(-50%)';
    pan.style.transformOrigin = 'top center';
    pan.style.transform = `scale(${k})`;
}

function getPrompterTargetOrigin() {
    return window.location.origin && window.location.origin !== 'null' ? window.location.origin : '*';
}

function postPrompterControl(payload) {
    if (!prompterPopupWindow || prompterPopupWindow.closed) return false;
    try {
        prompterPopupWindow.postMessage({ type: 'eclyrics-prompter-control', ...payload }, getPrompterTargetOrigin());
        return true;
    } catch (e) {
        return false;
    }
}

function postPrompterKey(code, key) {
    if (!prompterPopupWindow || prompterPopupWindow.closed) return false;
    try {
        prompterPopupWindow.postMessage(
            { type: 'eclyrics-prompter-key', code, key: key || '' },
            getPrompterTargetOrigin(),
        );
        return true;
    } catch (e) {
        return false;
    }
}

function isPrompterWindowOpen() {
    if (prompterPopupWindow && prompterPopupWindow.closed) {
        prompterPopupWindow = null;
        prompterBoundTabId = null;
    }
    return !!(prompterPopupWindow && !prompterPopupWindow.closed);
}

function getActivePrompterSpeed() {
    const fromSync = lastPrompterSync?.speed;
    if (typeof fromSync === 'number' && !Number.isNaN(fromSync)) return fromSync;
    return readSavedPreviewSpeed();
}

/* ─────────────────────────────────────────────────────────
 * DOCK HOLD-SCROLL — press-and-hold the ▲/▼ buttons to scroll
 *   continuously at a rate proportional to scroll speed.
 *   ArrowUp/ArrowDown keys and mouse wheel use fixed px steps instead.
 * ───────────────────────────────────────────────────────── */
/** px/sec per unit of scroll speed. Matches auto-scroll (play), which advances
 *  `scrollSpeed` px per animation frame (~60fps), i.e. scrollSpeed × 60 px/sec. */
const PREVIEW_HOLD_SCROLL_PX_PER_SPEED = 60;
/** dir: +1 scrolls toward the start (up), -1 toward the end (down). */
let previewHoldScroll = { raf: 0, dir: 0, lastTs: 0 };

function stopPreviewHoldScroll() {
    if (previewHoldScroll.raf) cancelAnimationFrame(previewHoldScroll.raf);
    previewHoldScroll = { raf: 0, dir: 0, lastTs: 0 };
}

function previewHoldScrollTick(ts) {
    if (!previewHoldScroll.dir) return;
    if (!isPrompterWindowOpen()) {
        stopPreviewHoldScroll();
        return;
    }
    const last = previewHoldScroll.lastTs || ts;
    const dtMs = Math.min(64, Math.max(0, ts - last));
    previewHoldScroll.lastTs = ts;
    const speed = getActivePrompterSpeed();
    const px = previewHoldScroll.dir * speed * PREVIEW_HOLD_SCROLL_PX_PER_SPEED * (dtMs / 1000);
    if (px !== 0) postPrompterControl({ action: 'scrollBy', delta: px });
    previewHoldScroll.raf = requestAnimationFrame(previewHoldScrollTick);
}

function startPreviewHoldScroll(dir) {
    if (!isPrompterWindowOpen()) return;
    if (previewHoldScroll.dir === dir && previewHoldScroll.raf) return;
    stopPreviewHoldScroll();
    previewHoldScroll.dir = dir;
    previewHoldScroll.lastTs = 0;
    previewHoldScroll.raf = requestAnimationFrame(previewHoldScrollTick);
}

/** Wire a dock arrow button to hold-to-scroll instead of a single step jump. */
function bindPreviewHoldScrollButton(btn, dir) {
    if (!btn) return;
    btn.addEventListener('pointerdown', (e) => {
        if (btn.disabled) return;
        e.preventDefault();
        if (e.pointerId != null && btn.setPointerCapture) {
            try {
                btn.setPointerCapture(e.pointerId);
            } catch (_) {
                /* ignore */
            }
        }
        startPreviewHoldScroll(dir);
    });
    btn.addEventListener('pointerup', stopPreviewHoldScroll);
    btn.addEventListener('pointercancel', stopPreviewHoldScroll);
    btn.addEventListener('lostpointercapture', stopPreviewHoldScroll);
    // Suppress the synthetic click so the button never performs a step jump.
    btn.addEventListener('click', (e) => e.preventDefault());
}

function updatePreviewPrompterDock() {
    const open = isPrompterWindowOpen();
    const dock = document.getElementById('preview-prompter-dock');
    const panel = document.getElementById('workspace-preview-panel');
    if (panel) {
        panel.tabIndex = 0;
    }
    if (dock) {
        dock.classList.toggle('is-inactive', !open);
    }
    [
        'preview-btn-play',
        'preview-btn-scroll-up',
        'preview-btn-scroll-down',
        'preview-btn-font-smaller',
        'preview-btn-font-larger',
        'preview-btn-theme',
        'preview-prompter-speed',
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = !open;
    });
}

function updatePreviewDockFromSync(data) {
    if (!data || typeof data !== 'object') return;
    const speedEl = document.getElementById('preview-prompter-speed');
    const valEl = document.getElementById('preview-prompter-speed-val');
    const playBtn = document.getElementById('preview-btn-play');
    const themeBtn = document.getElementById('preview-btn-theme');
    if (typeof data.speed === 'number' && !Number.isNaN(data.speed) && speedEl) {
        speedEl.value = String(
            Math.min(PREVIEW_PROMPTER.speedMax, Math.max(PREVIEW_PROMPTER.speedMin, data.speed)),
        );
        if (valEl) valEl.textContent = data.speed.toFixed(1);
    }
    if (playBtn && typeof data.playing === 'boolean') {
        playBtn.setAttribute('aria-pressed', data.playing ? 'true' : 'false');
        const icon = playBtn.querySelector('i');
        if (icon) icon.className = data.playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    }
    if (data.theme === 'lyrics' || data.theme === 'bw') {
        try {
            localStorage.setItem(PREVIEW_STAGE_THEME_KEY, data.theme);
        } catch (e) {
            /* ignore */
        }
        applyPreviewStageTheme(data.theme);
    }
    if (themeBtn && (data.theme === 'lyrics' || data.theme === 'bw')) {
        themeBtn.setAttribute('aria-pressed', data.theme === 'lyrics' ? 'true' : 'false');
        const ti = themeBtn.querySelector('i');
        if (ti) {
            ti.className =
                data.theme === 'lyrics' ? 'fa-solid fa-droplet' : 'fa-solid fa-circle-half-stroke';
        }
        themeBtn.title =
            data.theme === 'lyrics' ? 'Stage: blue lyrics (P) — click for black & white' : 'Stage: black & white (P) — click for blue lyrics';
    }
}

function readSavedPreviewSpeed() {
    const raw = localStorage.getItem(PREVIEW_PROMPTER_SPEED_KEY);
    const n = parseFloat(raw);
    if (!Number.isNaN(n) && n >= PREVIEW_PROMPTER.speedMin && n <= PREVIEW_PROMPTER.speedMax) return n;
    return PREVIEW_PROMPTER.defaultSpeed;
}

function applySavedSpeedToSlider() {
    const v = readSavedPreviewSpeed();
    const speedEl = document.getElementById('preview-prompter-speed');
    const valEl = document.getElementById('preview-prompter-speed-val');
    if (speedEl) speedEl.value = String(v);
    if (valEl) valEl.textContent = v.toFixed(1);
}

function getPrompterShortcutsApi() {
    return typeof EclyricsPrompterShortcuts !== 'undefined' ? EclyricsPrompterShortcuts : null;
}

function isPreviewShortcutsDialogOpen() {
    const dlg = document.getElementById('preview-shortcuts-dialog');
    return dlg && !dlg.hidden;
}

/** Global prompter shortcuts (preview registry) — work everywhere except text fields and modals. */
function handleGlobalPrompterShortcut(event) {
    const sc = getPrompterShortcutsApi();
    if (!sc) return;

    const ctx = { prompterOpen: isPrompterWindowOpen() };
    if (sc.shouldIgnorePrompterShortcut(event, ctx)) return;

    const resolved = sc.resolvePrompterShortcut(event);
    if (!resolved) return;

    event.preventDefault();

    switch (resolved.id) {
        case 'send':
            sendActiveBlockToPrompter();
            break;
        case 'adjacentBlock':
            goToAdjacentBlockAndSend(resolved.code === 'ArrowLeft' ? -1 : 1);
            break;
        case 'manualScroll':
            postPrompterControl({
                action: 'scrollBy',
                delta: resolved.code === 'ArrowUp' ? PREVIEW_KEYBOARD_SCROLL_PX : -PREVIEW_KEYBOARD_SCROLL_PX,
            });
            break;
        case 'fontSize':
            postPrompterKey(resolved.code, resolved.key);
            break;
        default:
            postPrompterKey(resolved.code, resolved.key);
            break;
    }
}

function initGlobalPrompterShortcuts() {
    const sc = getPrompterShortcutsApi();
    if (!sc) {
        console.error('[eclyrics] prompter-shortcuts.js must load before index.js');
        return;
    }
    sc.assertPrompterShortcutParity();
    sc.renderPreviewShortcutsList(document.getElementById('preview-shortcuts-dialog-list'));
    document.addEventListener('keydown', handleGlobalPrompterShortcut, true);
}

function goToAdjacentBlockAndSend(delta) {
    const tabId = getActiveTabId();
    if (!tabId) return;
    const ta = getSelectedTextareaForActiveTab();
    if (!ta) return;
    const m = ta.id.match(/^textarea-\d+-(\d+)$/);
    if (!m) return;
    const textId = parseInt(m[1], 10) + delta;
    const nextTa = document.getElementById(`textarea-${tabId}-${textId}`);
    if (!nextTa) return;
    selectTextarea(nextTa);
    sendPrompt(tabId, textId, { openIfClosed: false, focusWindow: false });
}

function openPreviewShortcutsDialog() {
    const dlg = document.getElementById('preview-shortcuts-dialog');
    const btn = document.getElementById('preview-shortcuts-help-btn');
    if (!dlg) return;
    dlg.hidden = false;
    dlg.setAttribute('aria-hidden', 'false');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    document.getElementById('preview-shortcuts-dialog-close')?.focus();
}

function closePreviewShortcutsDialog() {
    const dlg = document.getElementById('preview-shortcuts-dialog');
    const btn = document.getElementById('preview-shortcuts-help-btn');
    if (!dlg) return;
    dlg.hidden = true;
    dlg.setAttribute('aria-hidden', 'true');
    if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.focus({ preventScroll: true });
    }
}

function initPreviewShortcutsDialog() {
    const helpBtn = document.getElementById('preview-shortcuts-help-btn');
    const backdrop = document.getElementById('preview-shortcuts-dialog-backdrop');
    const closeBtn = document.getElementById('preview-shortcuts-dialog-close');
    helpBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        openPreviewShortcutsDialog();
    });
    backdrop?.addEventListener('click', () => closePreviewShortcutsDialog());
    closeBtn?.addEventListener('click', () => closePreviewShortcutsDialog());
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !isPreviewShortcutsDialogOpen()) return;
        e.preventDefault();
        closePreviewShortcutsDialog();
    });
}

function clearAllLiveBlocks() {
    document.querySelectorAll('#tab-content .textarea-cell.is-live').forEach((c) => {
        c.classList.remove('is-live');
    });
}

function getLivePrompterTextarea() {
    return document.querySelector('#tab-content .textarea-cell.is-live textarea');
}

function buildLineupForTab(tabId) {
    const blocks = [];
    for (let i = 1; ; i++) {
        const textarea = document.getElementById(`textarea-${tabId}-${i}`);
        if (!textarea) break;
        blocks.push('\n' + formatText(textarea.value));
    }
    return blocks;
}

function getLineupKeyForTab(tabId) {
    return `${SESSION_ID}-${tabId}`;
}

function schedulePrompterLineupSync(tabId) {
    const key = String(tabId);
    if (prompterLineupSyncTimers[key]) clearTimeout(prompterLineupSyncTimers[key]);
    prompterLineupSyncTimers[key] = setTimeout(() => {
        delete prompterLineupSyncTimers[key];
        pushLineupToOpenPrompter(tabId);
    }, 60);
}

function pushLineupToOpenPrompter(tabId) {
    if (!isPrompterWindowOpen()) return;
    if (prompterBoundTabId != null && tabId !== prompterBoundTabId) return;
    const lineupKey = getLineupKeyForTab(tabId);
    const data = buildLineupForTab(tabId);
    localStorage.setItem(lineupKey, JSON.stringify(data));
    postPrompterControl({ action: 'updateLineup', lineupKey, data });
}

function setLivePreviewHtml(vf, raw) {
    vf.className = '';
    vf.innerHTML = '\n' + formatText(raw);
}

function initPreviewViewfinderWheel() {
    const wheelZone = document.getElementById('preview-viewfinder-stage');
    if (!wheelZone) return;
    wheelZone.addEventListener(
        'wheel',
        (e) => {
            if (!isPrompterWindowOpen()) return;
            /* Do not capture Ctrl/meta + wheel — that is browser zoom, not a prompter control. */
            if (e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            const delta = e.deltaY < 0 ? PREVIEW_WHEEL_SCROLL_PX : -PREVIEW_WHEEL_SCROLL_PX;
            postPrompterControl({ action: 'scrollBy', delta });
        },
        { passive: false },
    );
}

function initPreviewPrompterDock() {
    applySavedSpeedToSlider();
    updatePreviewPrompterDock();
    initPreviewShortcutsDialog();
    initPreviewViewfinderWheel();

    const playBtn = document.getElementById('preview-btn-play');
    const prevBtn = document.getElementById('preview-btn-prev');
    const nextBtn = document.getElementById('preview-btn-next');
    const scrollUpBtn = document.getElementById('preview-btn-scroll-up');
    const scrollDownBtn = document.getElementById('preview-btn-scroll-down');
    const fontSmBtn = document.getElementById('preview-btn-font-smaller');
    const fontLgBtn = document.getElementById('preview-btn-font-larger');
    const themeBtn = document.getElementById('preview-btn-theme');
    const speedEl = document.getElementById('preview-prompter-speed');
    const valEl = document.getElementById('preview-prompter-speed-val');

    if (playBtn) {
        playBtn.addEventListener('click', () => {
            if (playBtn.disabled) return;
            postPrompterControl({ action: 'playPause' });
        });
    }
    if (prevBtn) {
        prevBtn.addEventListener('click', () => goToAdjacentBlockAndSend(-1));
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => goToAdjacentBlockAndSend(1));
    }
    bindPreviewHoldScrollButton(scrollUpBtn, 1);
    bindPreviewHoldScrollButton(scrollDownBtn, -1);
    if (fontSmBtn) {
        fontSmBtn.addEventListener('click', () => {
            if (fontSmBtn.disabled) return;
            postPrompterKey('BracketLeft', '[');
        });
    }
    if (fontLgBtn) {
        fontLgBtn.addEventListener('click', () => {
            if (fontLgBtn.disabled) return;
            postPrompterKey('BracketRight', ']');
        });
    }
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            if (themeBtn.disabled) return;
            postPrompterControl({ action: 'toggleTheme' });
        });
    }
    if (speedEl) {
        speedEl.addEventListener('input', () => {
            const v = parseFloat(speedEl.value);
            if (Number.isNaN(v)) return;
            if (valEl) valEl.textContent = v.toFixed(1);
            localStorage.setItem(PREVIEW_PROMPTER_SPEED_KEY, String(v));
            postPrompterControl({ action: 'setSpeed', speed: v });
        });
    }

    window.addEventListener('focus', () => updatePreviewPrompterDock());
    window.addEventListener('blur', stopPreviewHoldScroll);
    updatePreviewDockFromSync(lastPrompterSync || defaultPrompterSync());
}

function initPrompterBroadcast() {
    try {
        prompterBroadcast = new BroadcastChannel(PROMPTER_BC_NAME);
    } catch (e) {
        prompterBroadcast = null;
    }
    if (!prompterBroadcast) return;

    prompterBroadcast.onmessage = (ev) => {
        const guard = getSyncGuardApi();
        const normalized = guard ? guard.normalizeSyncPayload(ev.data) : ev.data;
        ingestPrompterSyncBroadcast(normalized);
    };

    const wrap = document.querySelector('.preview-viewfinder-16x9');
    const slot = document.querySelector('.preview-viewfinder-slot');
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => applyViewfinderFromPrompterSync());
        if (wrap) ro.observe(wrap);
        if (slot) ro.observe(slot);
    }
}

function getActiveTabId() {
    const t = document.querySelector('#tabs-list .tab.active');
    return t ? parseInt(t.dataset.tabId, 10) : null;
}

const BLOCK_TITLE_MAX_LEN = 25;

function firstLineFromValue(text) {
    if (!text || !String(text).trim()) return '';
    const line = String(text).trim().split(/\r?\n/)[0].trim();
    return line.replace(/\s+/g, ' ');
}

function truncateTitle(s) {
    const t = String(s);
    if (t.length <= BLOCK_TITLE_MAX_LEN) return t;
    return `${t.slice(0, BLOCK_TITLE_MAX_LEN - 1)}…`;
}

function blockNumberFallbackLabel(textarea) {
    const m = textarea?.id.match(/^textarea-\d+-(\d+)$/);
    return m ? `BLOCK ${m[1]}` : 'BLOCK';
}

function getBlockTitleFull(textarea) {
    if (!textarea) return '—';
    if (!textarea.value.trim()) return blockNumberFallbackLabel(textarea);
    return firstLineFromValue(textarea.value) || blockNumberFallbackLabel(textarea);
}

function getBlockTitleDisplay(textarea) {
    return truncateTitle(getBlockTitleFull(textarea));
}

function updateBlockCellLabel(textarea) {
    const label = textarea.closest('.textarea-cell')?.querySelector('.textarea-cell-label');
    if (label) label.textContent = getBlockTitleDisplay(textarea);
}

function refreshAllBlockLabelsInTab(tabId) {
    document.querySelectorAll(`#tab-${tabId} textarea`).forEach((ta) => updateBlockCellLabel(ta));
}

function updateActiveBlockToolbar() {
    const titleEl = document.getElementById('selected-block-title');
    const titleBtn = document.getElementById('selected-block-title-btn');
    const sendBtn = document.getElementById('send-prompter-btn');
    const ta = getSelectedTextareaForActiveTab();

    if (!ta || !document.body.contains(ta)) {
        if (titleEl) titleEl.textContent = '—';
        if (titleBtn) titleBtn.disabled = true;
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.title = 'Send the active block to the prompter (`) — updates an open window';
        }
        return;
    }

    if (titleEl) {
        const full = getBlockTitleFull(ta);
        titleEl.textContent = full;
        titleEl.title = full;
    }
    if (titleBtn) titleBtn.disabled = false;

    if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.title =
            'Send the active block to the prompter (`) — replaces the lineup in an open prompter window';
    }
}

function closeBlockTabsForTextarea(textareaId) {
    if (blockEditorSession?.sourceId === textareaId) closeBlockEditor();
}

function closeBlockTabsForSongTab(tabId) {
    if (blockEditorSession?.sourceId?.startsWith(`textarea-${tabId}-`)) closeBlockEditor();
}

function selectTextarea(textarea) {
    const m = textarea.id.match(/^textarea-(\d+)-(\d+)$/);
    if (!m) return;
    const tabId = m[1];

    document.querySelectorAll(`#tab-${tabId} .textarea-cell.is-selected`).forEach((cell) => {
        cell.classList.remove('is-selected');
    });

    const cell = textarea.closest('.textarea-cell');
    if (cell) cell.classList.add('is-selected');

    textNum[tabId][2] = textarea;
    updateActiveBlockToolbar();
    updatePreview();
}

function getSelectedTextareaForActiveTab() {
    const tabId = getActiveTabId();
    if (!tabId || !textNum[tabId.toString()]) return null;

    let ta = textNum[tabId.toString()][2];
    if (ta && document.body.contains(ta)) return ta;

    const first = document.querySelector(`#tab-${tabId} textarea`);
    if (first) selectTextarea(first);
    return first;
}

function updateLiveViewfinder() {
    const vf = document.getElementById('lyrics-preview-viewfinder');
    if (!vf) return;

    const liveTa = getLivePrompterTextarea();
    if (!liveTa) {
        vf.className = 'preview-empty';
        vf.textContent = isPrompterWindowOpen()
            ? 'Nothing on stage yet — choose a block and tap Send to prompter, or use prev / next after a send.'
            : 'Open the prompter and send a block. This strip mirrors the projection.';
        applyViewfinderFromPrompterSync();
        return;
    }

    const raw = liveTa.value;
    if (!raw.trim()) {
        vf.className = 'preview-empty';
        vf.textContent = 'The live block is empty.';
    } else {
        setLivePreviewHtml(vf, raw);
    }
    applyViewfinderFromPrompterSync();
}

function updatePreview() {
    syncActiveBlockTabEditor();
    updateLiveViewfinder();
}

function blockTabIdForTextarea(textarea) {
    return textarea?.id ? `block-tab-${textarea.id}` : null;
}

function syncBlockEditorFromSource() {
    if (!blockEditorSession) return;
    const source = document.getElementById(blockEditorSession.sourceId);
    if (!source || !document.body.contains(source)) return;
    if (blockEditorSession.editor.value !== source.value) {
        blockEditorSession.editor.value = source.value;
    }
}

function syncBlockTabEditor(blockTabId) {
    if (!blockEditorSession || blockEditorSession.blockTabId !== blockTabId) return;
    syncBlockEditorFromSource();
}

function syncActiveBlockTabEditor() {
    if (activeBlockTabId && blockEditorSession) syncBlockEditorFromSource();
}

function syncSourceFromBlockEditor() {
    if (!blockEditorSession) return;
    const source = document.getElementById(blockEditorSession.sourceId);
    if (!source) return;
    if (source.value !== blockEditorSession.editor.value) {
        source.value = blockEditorSession.editor.value;
        source.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function syncSourceFromBlockTab(blockTabId) {
    if (!blockEditorSession || blockEditorSession.blockTabId !== blockTabId) return;
    syncSourceFromBlockEditor();
}

function refreshBlockEditorChrome() {
    if (!blockEditorSession) return;
    const source = document.getElementById(blockEditorSession.sourceId);
    if (!source) return;
    const paneTitle = blockEditorSession.pane.querySelector('.block-tab-pane-title');
    if (paneTitle) {
        const full = getBlockTitleFull(source);
        paneTitle.textContent = full;
        paneTitle.title = full;
    }
}

function refreshBlockTabChrome(blockTabId) {
    if (!blockEditorSession || blockEditorSession.blockTabId !== blockTabId) return;
    refreshBlockEditorChrome();
}

function syncBlockTabsChromeVisibility() {
    /* Block lyric tabs removed — one editor pane, no toolbar chips. */
}

function setEditorViewMode(mode) {
    const grid = document.getElementById('tab-content');
    const blockContent = document.getElementById('block-tab-content');
    if (!grid || !blockContent) return;
    const showBlock = mode === 'block';
    grid.hidden = showBlock;
    blockContent.hidden = !showBlock;
    syncBlockTabsChromeVisibility();
}

function showBlockEditor() {
    if (!blockEditorSession) return;
    activeBlockTabId = blockEditorSession.blockTabId;
    blockEditorSession.pane.style.display = 'flex';
    setEditorViewMode('block');
    syncBlockEditorFromSource();
    blockEditorSession.editor.focus();
}

function showGridEditor() {
    if (blockEditorSession) syncSourceFromBlockEditor();
    activeBlockTabId = null;
    setEditorViewMode('grid');
    const tabId = getActiveTabId();
    if (tabId) {
        const activeContent = document.getElementById(`tab-${tabId}`);
        if (activeContent) activeContent.style.display = 'block';
    }
}

function closeBlockEditor() {
    if (!blockEditorSession) return;
    syncSourceFromBlockEditor();
    blockEditorSession.pane.style.display = 'none';
    blockEditorSession = null;
    activeBlockTabId = null;
    showGridEditor();
}

function closeBlockTab(blockTabId) {
    if (!blockEditorSession || blockEditorSession.blockTabId !== blockTabId) return;
    closeBlockEditor();
}

function ensureBlockEditorPane() {
    if (blockEditorSession?.pane && document.body.contains(blockEditorSession.pane)) {
        return blockEditorSession;
    }

    const pane = document.createElement('div');
    pane.classList.add('block-tab-pane');
    pane.id = 'block-editor-pane';
    pane.style.display = 'none';

    const head = document.createElement('div');
    head.classList.add('block-tab-pane-head');
    const paneTitle = document.createElement('h3');
    paneTitle.classList.add('block-tab-pane-title');
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.classList.add('block-tab-back-btn');
    backBtn.innerHTML =
        '<i class="fa-solid fa-table-cells" aria-hidden="true"></i><span>Back to blocks</span>';
    backBtn.addEventListener('click', () => showGridEditor());
    head.appendChild(paneTitle);
    head.appendChild(backBtn);

    const editor = document.createElement('textarea');
    editor.classList.add('block-tab-editor');
    editor.spellcheck = false;
    editor.addEventListener('input', () => {
        syncSourceFromBlockEditor();
        refreshBlockEditorChrome();
    });
    editor.addEventListener('paste', () => {
        setTimeout(() => {
            syncSourceFromBlockEditor();
            refreshBlockEditorChrome();
        }, 0);
    });

    pane.appendChild(head);
    pane.appendChild(editor);
    document.getElementById('block-tab-content')?.appendChild(pane);

    blockEditorSession = {
        blockTabId: 'block-editor-pane',
        sourceId: '',
        pane,
        editor,
    };
    return blockEditorSession;
}

function openBlockTab(textarea) {
    if (!textarea?.id) return;
    const blockTabId = blockTabIdForTextarea(textarea);
    if (!blockTabId) return;

    selectTextarea(textarea);

    const session = ensureBlockEditorPane();
    if (session.sourceId && session.sourceId !== textarea.id) {
        syncSourceFromBlockEditor();
    }

    session.blockTabId = blockTabId;
    session.sourceId = textarea.id;
    session.editor.value = textarea.value;
    session.editor.placeholder = textarea.placeholder;
    refreshBlockEditorChrome();
    showBlockEditor();
}

function syncThemeToggle(dark) {
    const btn = document.getElementById('theme-toggle');
    const label = document.getElementById('theme-toggle-label');
    if (!btn || !label) return;
    const icon = btn.querySelector('i');
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    if (dark) {
        label.textContent = 'Light mode';
        if (icon) icon.className = 'fa-solid fa-sun';
    } else {
        label.textContent = 'Dark mode';
        if (icon) icon.className = 'fa-solid fa-moon';
    }
}

function syncSidebarToggle(collapsed) {
    const shell = document.getElementById('app-shell');
    const btn = document.getElementById('sidebar-toggle');
    if (!shell || !btn) return;
    const icon = btn.querySelector('i');
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    if (icon) {
        icon.className = collapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left';
    }
}

function initSidebarCollapse() {
    const shell = document.getElementById('app-shell');
    const btn = document.getElementById('sidebar-toggle');
    if (!shell || !btn) return;

    if (localStorage.getItem('eclyrics-sidebar-collapsed') === '1') {
        shell.classList.add('sidebar-collapsed');
        syncSidebarToggle(true);
    }

    btn.addEventListener('click', () => {
        const collapsed = shell.classList.toggle('sidebar-collapsed');
        localStorage.setItem('eclyrics-sidebar-collapsed', collapsed ? '1' : '0');
        syncSidebarToggle(collapsed);
    });
}

function sendActiveBlockToPrompter() {
    const sendBtn = document.getElementById('send-prompter-btn');
    if (sendBtn?.disabled) return;
    const ta = getSelectedTextareaForActiveTab();
    if (!ta) return;
    const parts = ta.id.split('-');
    sendPrompt(parseInt(parts[1], 10), parseInt(parts[2], 10));
}

function initShell() {
    initSidebarCollapse();
    initPrompterBroadcast();
    initPrompterParityGuard();
    initBlockSourceDialog();
    initPreviewPrompterDock();
    initGlobalPrompterShortcuts();
    applyViewfinderFromPrompterSync();

    window.addEventListener('storage', (e) => {
        if (e.key !== 'eclyrics-prompter-fontSize' && e.key !== 'eclyrics-prompter-width') return;
        if (!isPrompterWindowOpen()) return;
        postPrompterControl({ action: 'requestSync' });
    });

    let saved = localStorage.getItem('eclyrics-theme');
    if (saved !== 'light' && saved !== 'dark') {
        saved = 'dark';
        localStorage.setItem('eclyrics-theme', saved);
    }
    const dark = saved === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    syncThemeToggle(dark);

    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const dark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('eclyrics-theme', dark ? 'dark' : 'light');
            syncThemeToggle(dark);
        });
    }

    document.querySelectorAll('.sidebar-nav button').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.panel;
            if (id === 'admin') {
                const a = window.__eclyricsAuth;
                if (!a?.isAdmin) return;
            }
            document.querySelectorAll('.sidebar-nav button').forEach((b) => {
                b.classList.toggle('is-active', b === btn);
            });
            document.querySelectorAll('.app-main .panel').forEach((p) => p.classList.remove('is-active'));
            const panel = document.getElementById(`panel-${id}`);
            if (panel) panel.classList.add('is-active');
            document.querySelectorAll('.sidebar-nav button').forEach((b) => {
                if (b === btn) b.setAttribute('aria-current', 'page');
                else b.removeAttribute('aria-current');
            });
            if (id === 'admin' && typeof window.eclyricsLoadAdminPanel === 'function') {
                window.eclyricsLoadAdminPanel();
            }
        });
    });

    const sendBtn = document.getElementById('send-prompter-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', () => sendActiveBlockToPrompter());
    }

    document.getElementById('selected-block-title-btn')?.addEventListener('click', () => {
        const ta = getSelectedTextareaForActiveTab();
        if (ta) openBlockTab(ta);
    });

    const tc = document.getElementById('tab-content');
    if (tc) {
        tc.addEventListener('focusin', (e) => {
            if (e.target.matches && e.target.matches('textarea')) selectTextarea(e.target);
        });
        tc.addEventListener('input', (e) => {
            if (!e.target.matches || !e.target.matches('textarea')) return;
            const m = e.target.id.match(/^textarea-(\d+)-(\d+)$/);
            const tid = m ? parseInt(m[1], 10) : null;
            if (tid != null) {
                refreshAllBlockLabelsInTab(tid);
                if (e.target.closest('.textarea-cell.is-live')) {
                    updateLiveViewfinder();
                    pushLineupToOpenPrompter(tid);
                } else {
                    schedulePrompterLineupSync(tid);
                }
            }
            const blockTabId = blockTabIdForTextarea(e.target);
            if (blockTabId && blockEditorSession?.blockTabId === blockTabId) {
                syncBlockTabEditor(blockTabId);
            }
            const sel = tid != null && textNum[tid.toString()] ? textNum[tid.toString()][2] : null;
            if (tid !== getActiveTabId()) return;
            if (sel === e.target) {
                updatePreview();
                updateActiveBlockToolbar();
            }
        });
    }
}

function getTabLabel(tab) {
    return tab?.querySelector('.tab-label')?.textContent?.trim() || '';
}

function setTabLabel(tab, name) {
    const label = tab?.querySelector('.tab-label');
    if (label && name) label.textContent = name.trim();
}

function buildTabElement(tabId, labelText) {
    const tab = document.createElement('li');
    tab.classList.add('tab');
    tab.dataset.tabId = String(tabId);

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = labelText;

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'tab-edit-btn';
    editBtn.title = 'Rename tab';
    editBtn.setAttribute('aria-label', 'Rename tab');
    editBtn.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i>';
    editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startTabInlineRename(tab);
    });

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'tab-close-btn close-btn';
    closeButton.setAttribute('aria-label', 'Close tab');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', (e) => {
        e.stopPropagation();
        handleTabClose(tab);
    });

    tab.append(label, editBtn, closeButton);
    tab.addEventListener('dblclick', (e) => {
        if (e.target.closest('.tab-close-btn, .tab-edit-btn')) return;
        startTabInlineRename(tab);
    });

    return tab;
}

function addTab() {
    if (activeTabs.length >= 10) {
        alert('Maximum 10 tabs allowed.');
        return 0;
    }

    tabCount++;
    activeTabs.push(tabCount);
    textNum[tabCount.toString()] = [0, null, null];

    const tab = buildTabElement(tabCount, `Tab ${tabCount}`);

    document.getElementById('tabs-list').appendChild(tab);
    addTabContent(tabCount);
    showTabContent(tabCount);
    return tabCount;
}


function isBlockEmpty(textarea) {
    return !textarea?.value.trim();
}

function getTabIdFromTextarea(textarea) {
    const m = textarea?.id.match(/^textarea-(\d+)-/);
    return m ? parseInt(m[1], 10) : null;
}

function updateBlockCellState(textarea) {
    const cell = textarea?.closest('.textarea-cell');
    if (!cell) return;
    const empty = isBlockEmpty(textarea);
    cell.classList.toggle('is-empty', empty);
    if (!empty) cell.classList.remove('is-paste-focus');
}

function countEmptyBlocksInTab(tabId) {
    return [...document.querySelectorAll(`#tab-${tabId} textarea`)].filter(isBlockEmpty).length;
}

/** Always keep at least one empty block with + available for new lyrics. */
function maintainEmptySlotForTab(tabId) {
    const tab = document.getElementById(`tab-${tabId}`);
    if (!tab) return;
    const container = tab.querySelector('.textareas-container');
    if (!container) return;
    let guard = 0;
    while (countEmptyBlocksInTab(tabId) === 0 && guard < 3) {
        addSingleBlock(container, tabId);
        guard++;
    }
}

function formatBlockLyricsContent(title, lyricsBody) {
    const heading = (title || '').trim();
    const body = (lyricsBody || '').trim();
    if (!heading) return body;
    if (!body) return heading;
    return `${heading}\n\n${body}`;
}

/** Parse clipboard text: title + blank line + lyrics, or lyrics only. */
function parseClipboardLyrics(raw) {
    const text = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const trimmed = text.trim();
    if (!trimmed) return { title: null, lyrics: '' };

    const lines = text.split('\n');
    const firstBlank = lines.findIndex((line, i) => i > 0 && line.trim() === '');
    if (firstBlank > 0) {
        const title = lines.slice(0, firstBlank).join('\n').trim();
        const lyrics = lines.slice(firstBlank + 1).join('\n').trim();
        if (title && lyrics) return { title, lyrics };
    }

    return { title: null, lyrics: trimmed };
}

async function pasteLyricsFromClipboard(textarea) {
    if (!textarea) return;
    const fallbackTitle = blockNumberFallbackLabel(textarea);

    try {
        const raw = await navigator.clipboard.readText();
        if (!raw || !raw.trim()) {
            activateBlockPasteMode(textarea);
            return;
        }
        const { title, lyrics } = parseClipboardLyrics(raw);
        applyLyricsToBlock(textarea, lyrics, title || fallbackTitle, '', { uppercaseTitle: false });
        const cell = textarea.closest('.textarea-cell');
        if (cell) cell.classList.remove('is-paste-focus');
    } catch (e) {
        activateBlockPasteMode(textarea);
    }
}

function onBlockContentChanged(textarea) {
    const tabId = getTabIdFromTextarea(textarea);
    if (tabId == null) return;
    delete textarea.dataset.blockTitle;
    updateBlockCellState(textarea);
    updateBlockCellLabel(textarea);
    const blockTabId = blockTabIdForTextarea(textarea);
    if (blockTabId && blockEditorSession?.sourceId === textarea.id) refreshBlockTabChrome(blockTabId);
    const cur = textNum[tabId.toString()]?.[2];
    if (cur === textarea) updateActiveBlockToolbar();
    maintainEmptySlotForTab(tabId);
}

function applyLyricsToBlock(textarea, lyrics, title, hymnNum = '', { uppercaseTitle = true } = {}) {
    if (!textarea) return;
    delete textarea.dataset.blockTitle;
    let resolvedTitle = (title || blockNumberFallbackLabel(textarea)).trim();
    if (uppercaseTitle) resolvedTitle = resolvedTitle.toUpperCase();
    const hymnNumText = String(hymnNum || '').trim();
    const hymnHeading = hymnNumText.replace(/^#\s*/, '');
    const fullTitle = hymnHeading ? `#${hymnHeading}\n${resolvedTitle}` : resolvedTitle;
    textarea.value = formatBlockLyricsContent(fullTitle, lyrics);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    onBlockContentChanged(textarea);
    selectTextarea(textarea);
}

function activateBlockEditMode(textarea, { paste = false } = {}) {
    const cell = textarea?.closest('.textarea-cell');
    if (!cell) return;
    const label = firstLineFromValue(textarea.value) || blockNumberFallbackLabel(textarea);
    cell.classList.remove('is-empty');
    cell.classList.add('is-paste-focus');
    textarea.value = `${label}\n\n`;
    textarea.placeholder = paste
        ? 'Paste lyrics below the title (Ctrl+V)'
        : 'Type title, then lyrics below the blank line';
    selectTextarea(textarea);
    textarea.focus();
    if (paste) {
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
    } else {
        textarea.setSelectionRange(0, label.length);
    }
    onBlockContentChanged(textarea);
}

function activateBlockPasteMode(textarea) {
    activateBlockEditMode(textarea, { paste: true });
}

function activateBlockTypeMode(textarea) {
    activateBlockEditMode(textarea, { paste: false });
}

function getBlockSourceDialogTitle(textarea) {
    const label = getBlockTitleDisplay(textarea);
    return label && label !== '—' ? `Add lyrics · ${label}` : 'Add lyrics to block';
}

function renderSongLibraryNote(message, show = true) {
    const note = document.getElementById('block-source-library-note');
    if (!note) return;
    note.textContent = message;
    note.hidden = !show;
}

function getSongLibraryApi() {
    return window.eclyricsSongLibrary || null;
}

function getSongLibraryState() {
    const api = getSongLibraryApi();
    if (!api || typeof api.getState !== 'function') {
        return { loaded: true, error: 'Song library module is not loaded.', count: 0 };
    }
    return api.getState();
}

function categoryToSlug(category) {
    const normalized = String(category || '').trim().toLowerCase();
    if (normalized === 'asop/f' || normalized === 'asopf' || normalized === 'asop-f') return 'asop-f';
    return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function songHasCategorySlug(song, slug) {
    if (!Array.isArray(song?.category)) return false;
    const filterDef = SONG_CATEGORY_FILTERS.find((entry) => entry.slug === slug);
    const aliases = filterDef?.aliases || [];
    return song.category.some((entry) => {
        const entrySlug = categoryToSlug(entry);
        return entrySlug === slug || aliases.includes(String(entry || '').trim().toLowerCase());
    });
}

function isAdaptationCategory(song) {
    return songHasCategorySlug(song, 'adaptation');
}

function shouldOmitHymnNumForSong(song) {
    return songHasCategorySlug(song, 'adaptation') && songHasCategorySlug(song, 'himnario');
}

function isRestrictedSong(song) {
    return [...RESTRICTED_CATEGORY_SLUGS].some((slug) => songHasCategorySlug(song, slug));
}

function buildSongCategoryPills(song) {
    const categories = Array.isArray(song?.category) ? song.category.filter(Boolean) : [];
    if (categories.length === 0) return [];

    const slugs = categories.map((entry) => categoryToSlug(entry));
    const hasRevision = slugs.includes('revision');
    const hasArchived = slugs.includes('archived');

    if (hasRevision || hasArchived) {
        const pills = [];
        if (hasRevision) pills.push({ text: 'REVISION', slug: 'revision' });
        if (hasArchived) pills.push({ text: 'ARCHIVED', slug: 'archived' });
        return pills;
    }

    return categories.map((category) => ({
        text: String(category).trim().toUpperCase(),
        slug: categoryToSlug(category),
    }));
}

function queryTargetsRestrictedCategory(query) {
    const q = String(query || '').trim().toLowerCase();
    return q.includes('revision') || q.includes('archived') || q.includes('archive');
}

function isFilteringRestrictedCategories() {
    return blockSourceActiveCategoryFilters.has('revision') || blockSourceActiveCategoryFilters.has('archived');
}

function deprioritizeRestrictedResults(songs, query) {
    if (isFilteringRestrictedCategories() || queryTargetsRestrictedCategory(query)) {
        return songs;
    }
    const normal = [];
    const restricted = [];
    songs.forEach((song) => {
        if (isRestrictedSong(song)) restricted.push(song);
        else normal.push(song);
    });
    return [...normal, ...restricted];
}

function applyRestrictedSearchRules(songs, query) {
    const q = String(query || '').trim();
    if (!q && !isFilteringRestrictedCategories()) {
        return songs.filter((song) => !isRestrictedSong(song));
    }
    return deprioritizeRestrictedResults(songs, q);
}

function filterSongsByCategory(songs) {
    if (blockSourceActiveCategoryFilters.size === 0) return songs;
    return songs.filter((song) =>
        [...blockSourceActiveCategoryFilters].every((slug) => songHasCategorySlug(song, slug)),
    );
}

function renderBlockSourceCategoryFilters() {
    const wrap = document.getElementById('block-source-filters');
    if (!wrap) return;
    wrap.replaceChildren();
    SONG_CATEGORY_FILTERS.forEach(({ slug, label }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'block-source-filter-pill';
        btn.dataset.category = slug;
        btn.textContent = label;
        const isActive = blockSourceActiveCategoryFilters.has(slug);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        if (isActive) {
            btn.classList.add('block-source-filter-pill--active', `block-source-filter-pill--${slug}`);
        }
        btn.addEventListener('click', () => {
            if (blockSourceActiveCategoryFilters.has(slug)) {
                blockSourceActiveCategoryFilters.delete(slug);
            } else {
                blockSourceActiveCategoryFilters.add(slug);
            }
            renderBlockSourceCategoryFilters();
            const search = document.getElementById('block-source-search');
            renderBlockSourceSearchResults(search?.value || '');
        });
        wrap.appendChild(btn);
    });
}

function getSongVersionDisplay(version) {
    const v = String(version || '').trim();
    if (!v) return '';
    if (v.toLowerCase() === 'original') return '';
    if (v.toLowerCase() === 'k&t') return 'K&T';
    return v;
}

function getSongAdaptationLabel(song) {
    if (!isAdaptationCategory(song) || !song?.adaptOf) return '';
    return `${song.adaptOf} Adapt.`;
}

function truncateLyricsPreview(lyrics, maxChars = 150) {
    const normalized = String(lyrics || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return 'No lyrics text yet.';
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function getPopupSongTitle(song) {
    const hymnNum = String(song?.hymnNum || '').trim();
    const title = String(song?.title || '').trim() || '(Untitled)';
    return hymnNum ? `${hymnNum} - ${title}` : title;
}

function updateBlockSourceDialogHeader(textarea) {
    const titleEl = document.getElementById('block-source-dialog-title');
    if (titleEl && textarea) titleEl.textContent = getBlockSourceDialogTitle(textarea);
}

function resetBlockSourceDialog() {
    const search = document.getElementById('block-source-search');
    blockSourceActiveCategoryFilters.clear();
    renderBlockSourceCategoryFilters();
    if (search) {
        search.value = '';
        renderBlockSourceSearchResults('');
    }
    if (blockSourceTargetTextarea) updateBlockSourceDialogHeader(blockSourceTargetTextarea);
}

function focusBlockSourceSearch() {
    const search = document.getElementById('block-source-search');
    if (!search) return;
    renderBlockSourceSearchResults(search.value);
    requestAnimationFrame(() => search.focus());
}

function renderBlockSourceSearchResults(query) {
    const list = document.getElementById('block-source-results');
    if (!list) return;
    const api = getSongLibraryApi();
    const q = query.trim();
    const state = getSongLibraryState();
    let matches =
        api && typeof api.search === 'function' ? api.search(q, SONG_LIBRARY_RESULT_LIMIT) : [];
    matches = filterSongsByCategory(matches);
    matches = applyRestrictedSearchRules(matches, q);
    list.replaceChildren();
    if (matches.length === 0) {
        const li = document.createElement('li');
        li.className = 'block-source-results-empty';
        if (state.error) li.textContent = state.error;
        else if (!state.loaded) li.textContent = 'Loading song library…';
        else if (blockSourceActiveCategoryFilters.size > 0) {
            li.textContent = 'No songs match your search and filters.';
        } else li.textContent = q ? 'No songs match your search.' : 'No songs in library yet.';
        list.appendChild(li);
        if (state.error) renderSongLibraryNote(state.error, true);
        else if (!state.loaded) renderSongLibraryNote('Loading song library…', true);
        return;
    }
    if (q && matches.length === SONG_LIBRARY_RESULT_LIMIT) {
        renderSongLibraryNote(`Showing top ${SONG_LIBRARY_RESULT_LIMIT} matches. Refine search for more.`, true);
    } else {
        renderSongLibraryNote('', false);
    }
    matches.forEach((song) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        const restricted = isRestrictedSong(song);
        btn.className = restricted
            ? 'block-source-result block-source-result--restricted'
            : 'block-source-result';
        btn.setAttribute('role', 'option');
        if (restricted) {
            btn.setAttribute('aria-disabled', 'true');
            btn.title = 'Revision and archived lyrics cannot be added to blocks';
        }
        const topRow = document.createElement('span');
        topRow.className = 'block-source-result__top';
        const titleWrap = document.createElement('span');
        titleWrap.className = 'block-source-result__title-wrap';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'block-source-result__title';
        titleSpan.textContent = getPopupSongTitle(song);
        titleWrap.appendChild(titleSpan);
        const versionDisplay = getSongVersionDisplay(song.version);
        if (versionDisplay) {
            const versionSpan = document.createElement('span');
            versionSpan.className = 'block-source-result__version';
            versionSpan.textContent = versionDisplay;
            titleWrap.appendChild(versionSpan);
        }
        const adaptLabel = getSongAdaptationLabel(song);
        if (adaptLabel) {
            const adaptSpan = document.createElement('span');
            adaptSpan.className = 'block-source-result__adapt';
            adaptSpan.textContent = adaptLabel;
            titleWrap.appendChild(adaptSpan);
        }
        const pillWrap = document.createElement('span');
        pillWrap.className = 'block-source-result__pills';
        buildSongCategoryPills(song).forEach((pillData) => {
            const pill = document.createElement('span');
            pill.className = `block-source-pill block-source-pill--${pillData.slug}`;
            pill.textContent = pillData.text;
            pillWrap.appendChild(pill);
        });
        topRow.append(titleWrap, pillWrap);
        const metaSpan = document.createElement('span');
        metaSpan.className = 'block-source-result__meta';
        metaSpan.textContent = truncateLyricsPreview(song.lyrics);
        btn.append(topRow, metaSpan);
        if (!restricted) {
            btn.addEventListener('click', () => {
                if (blockSourceTargetTextarea) {
                    const hymnNum = shouldOmitHymnNumForSong(song) ? '' : song.hymnNum;
                    applyLyricsToBlock(blockSourceTargetTextarea, song.lyrics, song.title, hymnNum);
                }
                closeBlockSourceDialog();
            });
        }
        li.appendChild(btn);
        list.appendChild(li);
    });
}

function openBlockSourceDialog(textarea) {
    const dlg = document.getElementById('block-source-dialog');
    if (!dlg || !textarea) return;
    blockSourceTargetTextarea = textarea;
    resetBlockSourceDialog();
    dlg.hidden = false;
    dlg.setAttribute('aria-hidden', 'false');
    focusBlockSourceSearch();
}

function closeBlockSourceDialog() {
    const dlg = document.getElementById('block-source-dialog');
    if (!dlg) return;
    dlg.hidden = true;
    dlg.setAttribute('aria-hidden', 'true');
    blockSourceTargetTextarea = null;
    resetBlockSourceDialog();
}

function initBlockSourceDialog() {
    const dlg = document.getElementById('block-source-dialog');
    if (!dlg) return;

    document.getElementById('block-source-dialog-close')?.addEventListener('click', closeBlockSourceDialog);
    document.getElementById('block-source-dialog-backdrop')?.addEventListener('click', closeBlockSourceDialog);

    document.getElementById('block-source-type')?.addEventListener('click', () => {
        if (!blockSourceTargetTextarea) return;
        const ta = blockSourceTargetTextarea;
        closeBlockSourceDialog();
        activateBlockTypeMode(ta);
    });

    document.getElementById('block-source-paste')?.addEventListener('click', () => {
        if (!blockSourceTargetTextarea) return;
        const ta = blockSourceTargetTextarea;
        closeBlockSourceDialog();
        void pasteLyricsFromClipboard(ta);
    });

    const search = document.getElementById('block-source-search');
    search?.addEventListener('input', () => renderBlockSourceSearchResults(search.value));

    renderBlockSourceCategoryFilters();

    const libraryApi = getSongLibraryApi();
    if (libraryApi) {
        libraryApi.onChange(() => {
            const next = document.getElementById('block-source-search')?.value || '';
            renderBlockSourceSearchResults(next);
            const state = getSongLibraryState();
            if (state.error) renderSongLibraryNote(state.error, true);
            else if (!state.loaded) renderSongLibraryNote('Loading song library…', true);
            else if (state.count === 0) renderSongLibraryNote('No songs found in Firestore library.', true);
        });
        void libraryApi.start();
    } else {
        renderSongLibraryNote('Song library module is not loaded.', true);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || dlg.hidden) return;
        e.preventDefault();
        closeBlockSourceDialog();
    });
}

function addTabContent(tabId) {
    const tabContent = document.getElementById('tab-content');
    const content = document.createElement('div');
    content.classList.add('tab-pane');
    content.id = `tab-${tabId}`;

    const container = document.createElement('div');
    container.classList.add('textareas-container');

    for (let b = 0; b < INITIAL_BLOCK_COUNT; b++) {
        addSingleBlock(container, tabId);
    }
    maintainEmptySlotForTab(tabId);

    content.appendChild(container);
    tabContent.appendChild(content);
}

function syncBlockRemoveButtons(tabId) {
    const tab = document.getElementById(`tab-${tabId}`);
    if (!tab) return;
    const cells = tab.querySelectorAll('.textarea-cell');
    const multi = cells.length > 1;
    cells.forEach((cell) => {
        const btn = cell.querySelector('.textarea-cell-remove');
        if (!btn) return;
        btn.hidden = !multi;
    });
}

function removeBlockCell(cell, tabId) {
    const tab = document.getElementById(`tab-${tabId}`);
    if (!tab || tab.querySelectorAll('.textarea-cell').length <= 1) return;
    const textarea = cell.querySelector('textarea');
    if (textarea?.id) closeBlockTabsForTextarea(textarea.id);
    const row = cell.closest('.textareas-row');
    cell.remove();
    if (row && row.querySelectorAll('.textarea-cell').length === 0) {
        row.remove();
    }
    rearrangeTextAreas(tabId);
    maintainEmptySlotForTab(tabId);
    const first = tab.querySelector('textarea');
    if (first) selectTextarea(first);
    else {
        updateActiveBlockToolbar();
        updatePreview();
    }
}

function getOrCreateRowForNewBlock(container) {
    const rows = container.querySelectorAll(':scope > .textareas-row');
    const last = rows[rows.length - 1];
    if (!last) {
        const row = document.createElement('div');
        row.classList.add('textareas-row');
        container.appendChild(row);
        return row;
    }
    const count = last.querySelectorAll('.textarea-cell').length;
    if (count >= MAX_BLOCKS_PER_ROW) {
        const row = document.createElement('div');
        row.classList.add('textareas-row');
        container.appendChild(row);
        return row;
    }
    return last;
}

function addSingleBlock(container, tabId) {
    const textId = ++textNum[tabId.toString()][0];
    const row = getOrCreateRowForNewBlock(container);

    const cell = document.createElement('div');
    cell.classList.add('textarea-cell', 'is-empty');

    const head = document.createElement('div');
    head.classList.add('textarea-cell-head');
    const label = document.createElement('span');
    label.classList.add('textarea-cell-label');
    label.title = 'Click to open full lyrics (title is the first line)';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.classList.add('textarea-cell-remove');
    removeBtn.title = 'Remove this block';
    removeBtn.setAttribute('aria-label', 'Remove this block');
    removeBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    removeBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        removeBlockCell(cell, tabId);
    });

    head.appendChild(label);
    head.appendChild(removeBtn);

    const textarea = document.createElement('textarea');
    textarea.id = `textarea-${tabId}-${textId}`;
    textarea.placeholder = `Lyrics for block ${textId}`;
    let labelClickTimer = null;
    label.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (labelClickTimer) clearTimeout(labelClickTimer);
        labelClickTimer = setTimeout(() => {
            if (isBlockEmpty(textarea)) openBlockSourceDialog(textarea);
            else openBlockTab(textarea);
            labelClickTimer = null;
        }, 220);
    });
    textarea.addEventListener('input', () => {
        onBlockContentChanged(textarea);
    });
    textarea.addEventListener('paste', () => {
        setTimeout(() => {
            textarea.scrollTop = 0;
            onBlockContentChanged(textarea);
            const mid = textarea.id.match(/^textarea-(\d+)-/);
            const tid = mid ? parseInt(mid[1], 10) : null;
            if (tid != null) refreshAllBlockLabelsInTab(tid);
            const sel = tid != null && textNum[tid.toString()] ? textNum[tid.toString()][2] : null;
            if (tid !== getActiveTabId()) return;
            if (sel === textarea) {
                updateActiveBlockToolbar();
                updatePreview();
            } else if (textarea.closest('.textarea-cell.is-live')) {
                updateLiveViewfinder();
            }
        }, 0);
    });

    const body = document.createElement('div');
    body.classList.add('textarea-cell-body');

    const fillTrigger = document.createElement('button');
    fillTrigger.type = 'button';
    fillTrigger.classList.add('block-fill-trigger');
    fillTrigger.setAttribute('aria-label', 'Add lyrics to this block');
    fillTrigger.title = 'Add lyrics';
    fillTrigger.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i>';
    fillTrigger.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openBlockSourceDialog(textarea);
    });

    body.appendChild(fillTrigger);
    body.appendChild(textarea);

    cell.appendChild(head);
    cell.appendChild(body);
    row.appendChild(cell);
    updateBlockCellState(textarea);
    updateBlockCellLabel(textarea);
    refreshAllBlockLabelsInTab(tabId);
    syncBlockRemoveButtons(tabId);
    maintainEmptySlotForTab(tabId);
}

function showTabContent(tabId) {
    document.querySelectorAll('#tabs-list .tab').forEach((tab) => tab.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((pane) => (pane.style.display = 'none'));
    const activeTab = document.querySelector(`#tabs-list .tab[data-tab-id="${tabId}"]`);
    const activeContent = document.getElementById(`tab-${tabId}`);
    if (activeTab && activeContent) {
        activeTab.classList.add('active');
        activeContent.style.display = 'block';
        showGridEditor();
        refreshAllBlockLabelsInTab(tabId);
        syncBlockRemoveButtons(tabId);
        maintainEmptySlotForTab(tabId);
        const first = activeContent.querySelector('textarea');
        if (first) selectTextarea(first);
        else {
            updateActiveBlockToolbar();
            updatePreview();
        }
    }
}

function rearrangeTextAreas(tabId) {
    const tab = document.getElementById(`tab-${tabId}`);
    const textareas = tab.querySelectorAll('textarea');
    const newTextAreaCount = textareas.length;
    textNum[tabId.toString()][0] = newTextAreaCount;

    let newTextId = 0;
    for (const textarea of textareas) {
        newTextId++;
        textarea.id = `textarea-${tabId}-${newTextId}`;
        textarea.placeholder = `Lyrics for block ${newTextId}`;
    }

    refreshAllBlockLabelsInTab(tabId);
    textareas.forEach((ta) => updateBlockCellState(ta));
    updateActiveBlockToolbar();
    syncBlockRemoveButtons(tabId);
    closeBlockTabsForSongTab(tabId);
}

function handleTabClose(tab) {
    const tabId = parseInt(tab.dataset.tabId);
    closeBlockTabsForSongTab(tabId);
    tab.remove();
    document.getElementById(`tab-${tabId}`).remove();

    activeTabs = activeTabs.filter((id) => id !== tabId);
    delete textNum[tabId.toString()];

    if (tab.classList.contains('active')) {
        if (activeTabs.length > 0) showTabContent(activeTabs[activeTabs.length - 1]);
        else {
            updateActiveBlockToolbar();
            updatePreview();
        }
    }
}

let tabInlineRename = null;

function syncTabRenameInputWidth(input) {
    const chars = Math.max(3, Math.min(48, (input.value || '').length));
    input.style.width = `${chars + 0.5}ch`;
}

function startTabInlineRename(tab) {
    if (!tab || tab.classList.contains('is-renaming')) return;
    if (tabInlineRename?.tab) finishTabInlineRename(true);

    const label = tab.querySelector('.tab-label');
    if (!label) return;

    const prevName = getTabLabel(tab);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename-input';
    input.value = prevName;
    input.maxLength = 48;
    input.setAttribute('aria-label', 'Tab name');
    input.autocomplete = 'off';
    input.spellcheck = false;

    label.textContent = '';
    label.appendChild(input);
    syncTabRenameInputWidth(input);
    tab.classList.add('is-renaming');

    tabInlineRename = { tab, prevName, input, label };

    input.addEventListener('input', () => syncTabRenameInputWidth(input));
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            finishTabInlineRename(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finishTabInlineRename(false);
        }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (tabInlineRename?.input === input) finishTabInlineRename(true);
        }, 0);
    });

    requestAnimationFrame(() => {
        input.focus();
        input.select();
    });
}

function finishTabInlineRename(save) {
    if (!tabInlineRename) return;

    const { tab, prevName, input, label } = tabInlineRename;
    const next = input.value.trim();
    const name = save && next ? next : prevName;

    input.remove();
    label.textContent = name;
    tab.classList.remove('is-renaming');
    tabInlineRename = null;
}

window.getActiveTabLabel = function getActiveTabLabel() {
    return getTabLabel(document.querySelector('#tabs-list .tab.active'));
};

function sendPrompt(tabId, textId, options = {}) {
    const openIfClosed = options.openIfClosed !== false;
    const focusWindow = options.focusWindow !== false;

    const data = [];
    for (let i = 1; true; i++) {
        const textarea = document.getElementById(`textarea-${tabId}-${i}`);
        if (!textarea) break;
        data.push('\n' + formatText(textarea.value));
    }

    const lineupKey = `${SESSION_ID}-${tabId}`;
    localStorage.setItem(lineupKey, JSON.stringify(data));

    clearAllLiveBlocks();

    const activeTa = document.getElementById(`textarea-${tabId}-${textId}`);
    if (activeTa) {
        const cell = activeTa.closest('.textarea-cell');
        if (cell) cell.classList.add('is-live');
        textNum[tabId.toString()][2] = activeTa;
        document.querySelectorAll(`#tab-${tabId} .textarea-cell.is-selected`).forEach((c) => c.classList.remove('is-selected'));
        if (cell) cell.classList.add('is-selected');
        updateActiveBlockToolbar();
    }

    updatePreview();

    prompterBoundTabId = tabId;

    const payload = {
        type: 'eclyrics-prompter-load',
        lineupKey,
        currentIndex: textId - 1,
    };

    const targetOrigin =
        window.location.origin && window.location.origin !== 'null' ? window.location.origin : '*';

    if (isPrompterWindowOpen()) {
        try {
            prompterPopupWindow.postMessage(payload, targetOrigin);
            if (focusWindow) prompterPopupWindow.focus();
            textNum[tabId.toString()][1] = prompterPopupWindow;
            updatePreviewPrompterDock();
            postPrompterControl({ action: 'setSpeed', speed: readSavedPreviewSpeed() });
            postPrompterControl({ action: 'requestSync' });
            return;
        } catch (e) {
            prompterPopupWindow = null;
        }
    }

    if (!openIfClosed) {
        updatePreviewPrompterDock();
        return;
    }

    const left = Math.max(0, Math.round((window.screen.availWidth - PROMPTER_POPUP_W) / 2));
    const top = Math.max(0, Math.round((window.screen.availHeight - PROMPTER_POPUP_H) / 2));
    const popupFeatures = [
        'popup=yes',
        `width=${PROMPTER_POPUP_W}`,
        `height=${PROMPTER_POPUP_H}`,
        `left=${left}`,
        `top=${top}`,
    ].join(',');

    const url = `prompter.html?title=${encodeURIComponent(lineupKey)}&current=${textId - 1}`;
    prompterPopupWindow = window.open(url, PROMPTER_WINDOW_NAME, popupFeatures);
    textNum[tabId.toString()][1] = prompterPopupWindow;
    if (prompterPopupWindow) prompterPopupWindow.focus();
    updatePreview();
    updatePreviewPrompterDock();
    setTimeout(() => {
        postPrompterControl({ action: 'setSpeed', speed: readSavedPreviewSpeed() });
        postPrompterControl({ action: 'requestSync' });
    }, 120);
}

document.getElementById('add-tab-btn').addEventListener('click', addTab);
document.getElementById('tabs-list').addEventListener('click', (e) => {
    const tabEl = e.target.closest('.tab');
    if (tabEl && !e.target.classList.contains('close-btn')) {
        showTabContent(parseInt(tabEl.dataset.tabId, 10));
    }
});

document.addEventListener('DOMContentLoaded', initShell);
window.onload = () => {
    addTab();
    applyViewfinderFromPrompterSync();
};

window.addEventListener('beforeunload', function () {
    for (let i = 1; i <= tabCount; i++) {
        this.localStorage.removeItem(`${SESSION_ID}-${i}`);
    }
});
