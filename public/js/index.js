/** Initial lyric blocks when a tab is created (add inserts one at a time). */
const INITIAL_BLOCK_COUNT = 3;
/** Hard wrap: row 1 holds blocks 1–3, row 2 holds 4–6, etc. */
const MAX_BLOCKS_PER_ROW = 3;
const SESSION_ID = Math.random().toString().substring(2);
const PREVIEW_PROMPTER_SPEED_KEY = 'eclyrics-preview-prompter-speed';
const PREVIEW_STAGE_THEME_KEY = 'eclyrics-preview-stage-theme';

/* ─────────────────────────────────────────────────────────
 * PREVIEW PROMPTER DOCK — controls the opened prompter window
 *   (play, speed, blocks; focus strip forwards keyboard shortcuts)
 * ───────────────────────────────────────────────────────── */
const PREVIEW_PROMPTER = {
    speedMin: 0.1,
    speedMax: 6.5,
    speedStep: 0.1,
    defaultSpeed: 0.5,
};
const PREVIEW_UNLOCK_KEY = 'eclyrics-preview-unlocked';
const PROMPTER_POPUP_W = 1920;
const PROMPTER_POPUP_H = 1080;
const PROMPTER_BC_NAME = 'eclyrics-prompter';
/** Single reused popup name so Send never opens a second window while the first is open. */
const PROMPTER_WINDOW_NAME = 'eclyricsPrompter';

let tabCount = 0;
let prompterBroadcast = null;
let lastPrompterSync = null;
let prompterPopupWindow = null;
let activeTabs = [];
let textNum = {};
/** @type {Map<string, { sourceId: string, pane: HTMLElement, editor: HTMLTextAreaElement }>} */
const openBlockTabs = new Map();
let activeBlockTabId = null;
/** @type {Record<string, ReturnType<typeof setTimeout>>} */
const prompterLineupSyncTimers = {};

/** UI preview catalog — replace with Firebase queries later. */
const SONG_LIBRARY_STUB = [
    { id: 'sample-1', title: 'Song 1', lyrics: 'The quick brown fox jumps over the lazy dog' },
    { id: 'sample-2', title: 'Song 2', lyrics: 'The quick brown fox jumps over the lazy dog' },
    { id: 'sample-3', title: 'Song 3', lyrics: 'The quick brown fox jumps over the lazy dog' },
    { id: 'sample-4', title: 'Song 4', lyrics: 'The quick brown fox jumps over the lazy dog' },
    { id: 'sample-5', title: 'Song 5', lyrics: 'The quick brown fox jumps over the lazy dog' },
];

let blockSourceTargetTextarea = null;

function isPreviewUnlocked() {
    return localStorage.getItem(PREVIEW_UNLOCK_KEY) === '1';
}

function unlockPreviewPanel() {
    localStorage.setItem(PREVIEW_UNLOCK_KEY, '1');
}

function anyBlockHasText() {
    return [...document.querySelectorAll('#tab-content textarea')].some((t) => t.value.trim().length > 0);
}

function refreshPreviewVisibility() {
    const w = document.getElementById('workspace');
    if (!w) return;
    const shouldShow = isPreviewUnlocked() || anyBlockHasText();
    if (shouldShow) {
        if (!isPreviewUnlocked() && anyBlockHasText()) unlockPreviewPanel();
        w.classList.add('preview-ready');
    } else {
        w.classList.remove('preview-ready');
    }
}

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
        cw: !Number.isNaN(cw) ? cw : PROMPTER_POPUP_W * 0.7,
        speed: !Number.isNaN(sp) ? sp : PREVIEW_PROMPTER.defaultSpeed,
        playing: false,
        theme,
    };
}

function applyPreviewStageTheme(theme) {
    const wp = document.querySelector('.workspace-preview');
    if (!wp || (theme !== 'lyrics' && theme !== 'bw')) return;
    wp.classList.remove('preview-stage--lyrics', 'preview-stage--bw');
    wp.classList.add(theme === 'lyrics' ? 'preview-stage--lyrics' : 'preview-stage--bw');
    wp.dataset.stageTheme = theme;
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
        pan.style.transform = 'translate(-50%, 0)';
        return;
    }

    const data = lastPrompterSync || defaultPrompterSync();
    const vw = data.vw || PROMPTER_POPUP_W;
    const k = Math.max(0.04, wrap.clientWidth / vw);
    const top = typeof data.top === 'number' ? data.top : 0;
    const fs = data.fs || 138;
    const cw = data.cw || vw * 0.7;

    inner.style.width = `${cw * k}px`;
    inner.style.fontSize = `${fs * k}px`;
    inner.style.letterSpacing = `${2.5 * k}px`;
    pan.style.transform = `translate(-50%, ${top * k}px)`;
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

function postPrompterKeyUp(key) {
    if (!prompterPopupWindow || prompterPopupWindow.closed) return false;
    try {
        prompterPopupWindow.postMessage({ type: 'eclyrics-prompter-keyup', key }, getPrompterTargetOrigin());
        return true;
    } catch (e) {
        return false;
    }
}

function isPrompterWindowOpen() {
    if (prompterPopupWindow && prompterPopupWindow.closed) prompterPopupWindow = null;
    return !!(prompterPopupWindow && !prompterPopupWindow.closed);
}

function getActivePrompterSpeed() {
    const fromSync = lastPrompterSync?.speed;
    if (typeof fromSync === 'number' && !Number.isNaN(fromSync)) return fromSync;
    return readSavedPreviewSpeed();
}

/** Scroll nudge in the prompter (px), scaled to match current scroll speed. */
function getPreviewScrollStep() {
    return 50 * (getActivePrompterSpeed() / PREVIEW_PROMPTER.defaultSpeed);
}

/** Dock scroll buttons use a slightly larger base step, same speed scaling. */
function getPreviewScrollStepLarge() {
    return 100 * (getActivePrompterSpeed() / PREVIEW_PROMPTER.defaultSpeed);
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

function isPreviewShortcutsDialogOpen() {
    const dlg = document.getElementById('preview-shortcuts-dialog');
    return dlg && !dlg.hidden;
}

function handlePreviewDockKeydown(event) {
    if (isPreviewShortcutsDialogOpen()) return;
    if (event.ctrlKey || event.metaKey) return;

    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToAdjacentBlockAndSend(-1);
        return;
    }
    if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToAdjacentBlockAndSend(1);
        return;
    }

    if (!isPrompterWindowOpen()) return;

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        postPrompterControl({ action: 'scrollBy', delta: getPreviewScrollStep() });
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        postPrompterControl({ action: 'scrollBy', delta: -getPreviewScrollStep() });
        return;
    }

    event.preventDefault();
    postPrompterKey(event.code, event.key);
}

function handlePreviewDockKeyup(event) {
    if (!isPrompterWindowOpen()) return;
    if (isPreviewShortcutsDialogOpen()) return;
    if (event.key === 'Tab') {
        event.preventDefault();
        postPrompterKeyUp('Tab');
    }
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
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                if (e.deltaY > 0) {
                    postPrompterKey('BracketRight', ']');
                } else {
                    postPrompterKey('BracketLeft', '[');
                }
                return;
            }
            e.preventDefault();
            const wrap = document.querySelector('.preview-viewfinder-16x9');
            const data = lastPrompterSync || defaultPrompterSync();
            const vw = data.vw || PROMPTER_POPUP_W;
            const k = wrap ? Math.max(0.04, wrap.clientWidth / vw) : 0.2;
            const speedScale = getActivePrompterSpeed() / PREVIEW_PROMPTER.defaultSpeed;
            const delta = (-e.deltaY / k) * speedScale;
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

    const panel = document.getElementById('workspace-preview-panel');
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

    if (panel) {
        panel.addEventListener('mousedown', (e) => {
            if (!isPrompterWindowOpen()) return;
            const dlg = document.getElementById('preview-shortcuts-dialog');
            if (dlg && !dlg.hidden && e.target.closest('#preview-shortcuts-dialog')) return;
            if (e.target.closest('button, input, textarea, select, a')) return;
            panel.focus({ preventScroll: true });
        });
        panel.addEventListener('keydown', handlePreviewDockKeydown, true);
        panel.addEventListener('keyup', handlePreviewDockKeyup, true);
    }

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
    if (scrollUpBtn) {
        scrollUpBtn.addEventListener('click', () => {
            if (scrollUpBtn.disabled) return;
            postPrompterControl({ action: 'scrollBy', delta: getPreviewScrollStepLarge() });
        });
    }
    if (scrollDownBtn) {
        scrollDownBtn.addEventListener('click', () => {
            if (scrollDownBtn.disabled) return;
            postPrompterControl({ action: 'scrollBy', delta: -getPreviewScrollStepLarge() });
        });
    }
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
        if (!ev.data || ev.data.type !== 'eclyrics-prompter-sync') return;
        lastPrompterSync = ev.data;
        applyViewfinderFromPrompterSync();
        updatePreviewDockFromSync(ev.data);
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

function getCustomBlockTitle(textarea) {
    return (textarea.dataset.blockTitle || '').trim();
}

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

function getBlockTitleDisplay(textarea) {
    if (!textarea) return '—';
    if (!textarea.value.trim()) {
        return blockNumberFallbackLabel(textarea);
    }
    const custom = getCustomBlockTitle(textarea);
    if (custom) return truncateTitle(custom);
    const fl = firstLineFromValue(textarea.value);
    if (fl) return truncateTitle(fl);
    return blockNumberFallbackLabel(textarea);
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

    if (titleEl) titleEl.textContent = getBlockTitleDisplay(ta).toUpperCase();
    if (titleBtn) titleBtn.disabled = false;

    if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.title =
            'Send the active block to the prompter (`) — replaces the lineup in an open prompter window';
    }
}

function closeBlockTabsForTextarea(textareaId) {
    const blockTabId = `block-tab-${textareaId}`;
    if (openBlockTabs.has(blockTabId)) closeBlockTab(blockTabId);
}

function closeBlockTabsForSongTab(tabId) {
    [...openBlockTabs.keys()].forEach((blockTabId) => {
        if (blockTabId.startsWith(`block-tab-${tabId}-`)) closeBlockTab(blockTabId);
    });
}

function renameBlockLabel(textarea) {
    const current = getCustomBlockTitle(textarea) || firstLineFromValue(textarea.value) || getBlockTitleDisplay(textarea);
    const name = prompt('Block display name (leave empty to use first line of lyrics):', current);
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed === '') delete textarea.dataset.blockTitle;
    else textarea.dataset.blockTitle = trimmed;
    updateBlockCellLabel(textarea);
    const blockTabId = blockTabIdForTextarea(textarea);
    if (blockTabId) refreshBlockTabChrome(blockTabId);
    const cur = textNum[getActiveTabId()?.toString()]?.[2];
    if (cur === textarea) updateActiveBlockToolbar();
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

function syncBlockTabEditor(blockTabId) {
    const entry = openBlockTabs.get(blockTabId);
    if (!entry) return;
    const source = document.getElementById(entry.sourceId);
    if (!source || !document.body.contains(source)) return;
    if (entry.editor.value !== source.value) entry.editor.value = source.value;
}

function syncActiveBlockTabEditor() {
    if (activeBlockTabId) syncBlockTabEditor(activeBlockTabId);
}

function syncSourceFromBlockTab(blockTabId) {
    const entry = openBlockTabs.get(blockTabId);
    if (!entry) return;
    const source = document.getElementById(entry.sourceId);
    if (!source) return;
    if (source.value !== entry.editor.value) {
        source.value = entry.editor.value;
        source.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function refreshBlockTabChrome(blockTabId) {
    const entry = openBlockTabs.get(blockTabId);
    if (!entry) return;
    const source = document.getElementById(entry.sourceId);
    if (!source) return;
    const tabEl = document.querySelector(`#block-tabs-list .block-tab[data-block-tab-id="${blockTabId}"]`);
    if (tabEl) {
        const label = getBlockTitleDisplay(source);
        const labelEl = tabEl.querySelector('.block-tab-label');
        if (labelEl) labelEl.textContent = label;
        tabEl.title = `Full lyrics: ${label}`;
    }
    const paneTitle = entry.pane.querySelector('.block-tab-pane-title');
    if (paneTitle) paneTitle.textContent = getBlockTitleDisplay(source);
}

function syncBlockTabsChromeVisibility() {
    const hasBlockTabs = openBlockTabs.size > 0;
    const list = document.getElementById('block-tabs-list');
    const divider = document.getElementById('block-tabs-divider');
    if (list) list.hidden = !hasBlockTabs;
    if (divider) divider.hidden = !hasBlockTabs;
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

function showBlockTab(blockTabId) {
    if (!openBlockTabs.has(blockTabId)) return;
    activeBlockTabId = blockTabId;
    document.querySelectorAll('#block-tabs-list .block-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.blockTabId === blockTabId);
    });
    document.querySelectorAll('#block-tab-content .block-tab-pane').forEach((p) => {
        p.style.display = p.id === blockTabId ? 'flex' : 'none';
    });
    setEditorViewMode('block');
    syncBlockTabEditor(blockTabId);
    const entry = openBlockTabs.get(blockTabId);
    entry?.editor.focus();
}

function showGridEditor() {
    activeBlockTabId = null;
    document.querySelectorAll('#block-tabs-list .block-tab').forEach((t) => t.classList.remove('active'));
    setEditorViewMode('grid');
    const tabId = getActiveTabId();
    if (tabId) {
        const activeContent = document.getElementById(`tab-${tabId}`);
        if (activeContent) activeContent.style.display = 'block';
    }
}

function closeBlockTab(blockTabId) {
    const entry = openBlockTabs.get(blockTabId);
    if (!entry) return;
    syncSourceFromBlockTab(blockTabId);
    entry.pane.remove();
    openBlockTabs.delete(blockTabId);
    document.querySelector(`#block-tabs-list .block-tab[data-block-tab-id="${blockTabId}"]`)?.remove();
    if (activeBlockTabId === blockTabId) {
        const remaining = [...openBlockTabs.keys()];
        if (remaining.length) showBlockTab(remaining[remaining.length - 1]);
        else showGridEditor();
    }
    syncBlockTabsChromeVisibility();
    setEditorViewMode(openBlockTabs.size ? 'block' : 'grid');
}

function openBlockTab(textarea) {
    if (!textarea?.id) return;
    const blockTabId = blockTabIdForTextarea(textarea);
    if (!blockTabId) return;

    selectTextarea(textarea);

    if (openBlockTabs.has(blockTabId)) {
        showBlockTab(blockTabId);
        return;
    }

    const tab = document.createElement('li');
    tab.classList.add('block-tab');
    tab.dataset.blockTabId = blockTabId;
    tab.title = `Full lyrics: ${getBlockTitleDisplay(textarea)}`;
    const labelSpan = document.createElement('span');
    labelSpan.classList.add('block-tab-label');
    labelSpan.textContent = getBlockTitleDisplay(textarea);
    tab.appendChild(labelSpan);

    const closeButton = document.createElement('span');
    closeButton.classList.add('close-btn');
    closeButton.setAttribute('role', 'button');
    closeButton.setAttribute('aria-label', 'Close block tab');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', (event) => {
        event.stopPropagation();
        closeBlockTab(blockTabId);
    });
    tab.appendChild(closeButton);
    tab.addEventListener('click', (e) => {
        if (e.target.classList.contains('close-btn')) return;
        showBlockTab(blockTabId);
    });

    const pane = document.createElement('div');
    pane.classList.add('block-tab-pane');
    pane.id = blockTabId;
    pane.dataset.sourceTextareaId = textarea.id;

    const head = document.createElement('div');
    head.classList.add('block-tab-pane-head');
    const paneTitle = document.createElement('h3');
    paneTitle.classList.add('block-tab-pane-title');
    paneTitle.textContent = getBlockTitleDisplay(textarea);
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.classList.add('block-tab-back-btn');
    backBtn.textContent = 'Back to blocks';
    backBtn.addEventListener('click', () => showGridEditor());
    head.appendChild(paneTitle);
    head.appendChild(backBtn);

    const editor = document.createElement('textarea');
    editor.classList.add('block-tab-editor');
    editor.value = textarea.value;
    editor.placeholder = textarea.placeholder;
    editor.spellcheck = false;
    editor.addEventListener('input', () => {
        syncSourceFromBlockTab(blockTabId);
        refreshBlockTabChrome(blockTabId);
    });
    editor.addEventListener('paste', () => {
        setTimeout(() => {
            syncSourceFromBlockTab(blockTabId);
            refreshBlockTabChrome(blockTabId);
        }, 0);
    });

    pane.appendChild(head);
    pane.appendChild(editor);
    document.getElementById('block-tab-content')?.appendChild(pane);
    document.getElementById('block-tabs-list')?.appendChild(tab);

    openBlockTabs.set(blockTabId, { sourceId: textarea.id, pane, editor });
    syncBlockTabsChromeVisibility();
    showBlockTab(blockTabId);
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

function isTypingInTextField(target) {
    if (!target || typeof target.closest !== 'function') return false;
    const el = target.nodeType === Node.ELEMENT_NODE ? target : null;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'SELECT') return true;
    if (tag === 'INPUT') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        const nonText = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'file', 'hidden', 'image']);
        return !nonText.has(type);
    }
    return false;
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
    refreshPreviewVisibility();
    initPrompterBroadcast();
    initBlockSourceDialog();
    initPreviewPrompterDock();
    applyViewfinderFromPrompterSync();

    window.addEventListener('storage', (e) => {
        if (e.key === 'eclyrics-prompter-fontSize' || e.key === 'eclyrics-prompter-width') {
            const base = { ...(lastPrompterSync || defaultPrompterSync()) };
            if (e.key === 'eclyrics-prompter-fontSize' && e.newValue) {
                const n = parseFloat(e.newValue);
                if (!Number.isNaN(n)) base.fs = n;
            }
            if (e.key === 'eclyrics-prompter-width' && e.newValue) {
                const n = parseFloat(e.newValue);
                if (!Number.isNaN(n)) base.cw = n;
            }
            lastPrompterSync = base;
            applyViewfinderFromPrompterSync();
            updatePreview();
        }
    });

    const saved = localStorage.getItem('eclyrics-theme');
    if (saved === 'dark') {
        document.documentElement.classList.add('dark');
        syncThemeToggle(true);
    }

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

    document.addEventListener(
        'keydown',
        (e) => {
            if (e.code !== 'Backquote') return;
            if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
            const textPanel = document.getElementById('panel-text');
            if (!textPanel?.classList.contains('is-active')) return;
            if (isPreviewShortcutsDialogOpen()) return;
            if (isTypingInTextField(e.target)) return;
            e.preventDefault();
            sendActiveBlockToPrompter();
        },
        true,
    );

    const tc = document.getElementById('tab-content');
    if (tc) {
        tc.addEventListener('focusin', (e) => {
            if (e.target.matches && e.target.matches('textarea')) selectTextarea(e.target);
        });
        tc.addEventListener('input', (e) => {
            if (!e.target.matches || !e.target.matches('textarea')) return;
            refreshPreviewVisibility();
            const m = e.target.id.match(/^textarea-(\d+)-(\d+)$/);
            const tid = m ? parseInt(m[1], 10) : null;
            if (tid != null) {
                refreshAllBlockLabelsInTab(tid);
                schedulePrompterLineupSync(tid);
            }
            const blockTabId = blockTabIdForTextarea(e.target);
            if (blockTabId && openBlockTabs.has(blockTabId)) syncBlockTabEditor(blockTabId);
            if (e.target.closest('.textarea-cell.is-live')) {
                updateLiveViewfinder();
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

function addTab() {
    if (activeTabs.length >= 10) {
        alert('Maximum 10 tabs allowed.');
        return 0;
    }

    tabCount++;
    activeTabs.push(tabCount);
    textNum[tabCount.toString()] = [0, null, null];

    const tab = document.createElement('li');
    tab.classList.add('tab');
    tab.textContent = `Tab ${tabCount}`;
    tab.dataset.tabId = tabCount;

    const closeButton = document.createElement('span');
    closeButton.classList.add('close-btn');
    closeButton.textContent = '×';
    closeButton.onclick = function (event) {
        event.stopPropagation();
        handleTabClose(tab);
    };

    tab.appendChild(closeButton);
    tab.ondblclick = () => renameTab(tab);

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
    if (empty) cell.classList.remove('is-paste-focus');
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

function onBlockContentChanged(textarea) {
    const tabId = getTabIdFromTextarea(textarea);
    if (tabId == null) return;
    updateBlockCellState(textarea);
    updateBlockCellLabel(textarea);
    maintainEmptySlotForTab(tabId);
}

function applyLyricsToBlock(textarea, lyrics, title) {
    if (!textarea) return;
    const resolvedTitle = (title || getCustomBlockTitle(textarea) || blockNumberFallbackLabel(textarea)).trim();
    if (resolvedTitle) textarea.dataset.blockTitle = resolvedTitle;
    textarea.value = formatBlockLyricsContent(resolvedTitle, lyrics);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    onBlockContentChanged(textarea);
    selectTextarea(textarea);
}

function activateBlockEditMode(textarea, { paste = false } = {}) {
    const cell = textarea?.closest('.textarea-cell');
    if (!cell) return;
    const label = getCustomBlockTitle(textarea) || blockNumberFallbackLabel(textarea);
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

function updateBlockSourceDialogHeader(textarea) {
    const titleEl = document.getElementById('block-source-dialog-title');
    if (titleEl && textarea) titleEl.textContent = getBlockSourceDialogTitle(textarea);
}

function resetBlockSourceDialog() {
    const search = document.getElementById('block-source-search');
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
    const note = document.getElementById('block-source-library-note');
    if (!list) return;
    const q = query.trim().toLowerCase();
    const matches = q
        ? SONG_LIBRARY_STUB.filter((s) => s.title.toLowerCase().includes(q))
        : SONG_LIBRARY_STUB;
    list.replaceChildren();
    if (matches.length === 0) {
        const li = document.createElement('li');
        li.className = 'block-source-results-empty';
        li.textContent = q ? 'No songs match your search.' : 'No songs in library yet.';
        list.appendChild(li);
        if (note) note.hidden = false;
        return;
    }
    if (note) note.hidden = true;
    matches.forEach((song) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'block-source-result';
        btn.setAttribute('role', 'option');
        const titleSpan = document.createElement('span');
        titleSpan.className = 'block-source-result__title';
        titleSpan.textContent = song.title;
        const metaSpan = document.createElement('span');
        metaSpan.className = 'block-source-result__meta';
        metaSpan.textContent = 'Inserts title, blank line, then lyrics';
        btn.append(titleSpan, metaSpan);
        btn.addEventListener('click', () => {
            if (blockSourceTargetTextarea) {
                applyLyricsToBlock(blockSourceTargetTextarea, song.lyrics, song.title);
            }
            closeBlockSourceDialog();
        });
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
        activateBlockPasteMode(ta);
    });

    const search = document.getElementById('block-source-search');
    search?.addEventListener('input', () => renderBlockSourceSearchResults(search.value));

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
    label.title = 'Click to open full lyrics · double-click to rename';

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
    label.addEventListener('dblclick', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (labelClickTimer) {
            clearTimeout(labelClickTimer);
            labelClickTimer = null;
        }
        renameBlockLabel(textarea);
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
        refreshPreviewVisibility();
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
            refreshPreviewVisibility();
        }
    }
}

function renameTab(tab) {
    const name = prompt('Enter new tab name:', tab.firstChild.textContent.replace('×', '').trim());
    if (name) tab.firstChild.textContent = name;
}

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

    document.querySelectorAll(`#tab-${tabId} .textarea-cell`).forEach((c) => c.classList.remove('is-live'));

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
    refreshPreviewVisibility();
    applyViewfinderFromPrompterSync();
};

window.addEventListener('beforeunload', function () {
    for (let i = 1; i <= tabCount; i++) {
        this.localStorage.removeItem(`${SESSION_ID}-${i}`);
    }
});
