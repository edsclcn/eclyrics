/** Initial lyric blocks when a tab is created (add inserts one at a time). */
const INITIAL_BLOCK_COUNT = 5;
/** Hard wrap: row 1 holds blocks 1–5, row 2 holds 6–10, etc. */
const MAX_BLOCKS_PER_ROW = 5;
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
    return !!(prompterPopupWindow && !prompterPopupWindow.closed);
}

function updatePreviewPrompterDock() {
    const open = isPrompterWindowOpen();
    const dock = document.getElementById('preview-prompter-dock');
    if (dock) {
        dock.classList.toggle('is-inactive', !open);
        dock.tabIndex = open ? 0 : -1;
    }
    ['preview-btn-play', 'preview-btn-prev', 'preview-btn-next', 'preview-btn-theme', 'preview-prompter-speed'].forEach((id) => {
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

function handlePreviewDockKeydown(event) {
    if (!isPrompterWindowOpen()) return;
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    postPrompterKey(event.code, event.key);
}

function handlePreviewDockKeyup(event) {
    if (!isPrompterWindowOpen()) return;
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
    sendPrompt(tabId, textId);
}

function initPreviewPrompterDock() {
    applySavedSpeedToSlider();
    updatePreviewPrompterDock();

    const dock = document.getElementById('preview-prompter-dock');
    const playBtn = document.getElementById('preview-btn-play');
    const prevBtn = document.getElementById('preview-btn-prev');
    const nextBtn = document.getElementById('preview-btn-next');
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
        prevBtn.addEventListener('click', () => {
            if (prevBtn.disabled) return;
            goToAdjacentBlockAndSend(-1);
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (nextBtn.disabled) return;
            goToAdjacentBlockAndSend(1);
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
    if (dock) {
        dock.addEventListener('mousedown', (e) => {
            if (dock.classList.contains('is-inactive')) return;
            if (e.target.closest('input[type="range"], button')) return;
            dock.focus({ preventScroll: true });
        });
        dock.addEventListener('keydown', handlePreviewDockKeydown, true);
        dock.addEventListener('keyup', handlePreviewDockKeyup, true);
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
    if (wrap && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => applyViewfinderFromPrompterSync()).observe(wrap);
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
    const sendBtn = document.getElementById('send-prompter-btn');
    const ta = getSelectedTextareaForActiveTab();

    if (!ta || !document.body.contains(ta)) {
        if (titleEl) titleEl.textContent = '—';
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.classList.remove('is-live-prompting');
            sendBtn.title = 'Send this tab to the lyric prompter window';
        }
        return;
    }

    if (titleEl) titleEl.textContent = getBlockTitleDisplay(ta).toUpperCase();

    const cell = ta.closest('.textarea-cell');
    const isLive = cell?.classList.contains('is-live');
    if (sendBtn) {
        sendBtn.disabled = !!isLive;
        sendBtn.classList.toggle('is-live-prompting', !!isLive);
        sendBtn.title = isLive
            ? 'This block is already on the prompter — select another block to switch'
            : 'Send this tab to the lyric prompter window';
    }
}

function renameBlockLabel(textarea) {
    const current = getCustomBlockTitle(textarea) || firstLineFromValue(textarea.value) || getBlockTitleDisplay(textarea);
    const name = prompt('Block display name (leave empty to use first line of lyrics):', current);
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed === '') delete textarea.dataset.blockTitle;
    else textarea.dataset.blockTitle = trimmed;
    updateBlockCellLabel(textarea);
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

function updatePreview() {
    const el = document.getElementById('lyrics-preview-content');
    const vf = document.getElementById('lyrics-preview-viewfinder');
    if (!el) return;

    const tabId = getActiveTabId();
    const ta = tabId && textNum[tabId.toString()] ? textNum[tabId.toString()][2] : null;

    if (!ta || !document.body.contains(ta)) {
        el.className = 'preview-empty';
        el.textContent = 'Select a block to preview formatted lyrics.';
        if (vf) {
            vf.className = 'preview-empty';
            vf.textContent = el.textContent;
        }
        applyViewfinderFromPrompterSync();
        return;
    }

    const raw = ta.value;
    if (!raw.trim()) {
        el.className = 'preview-empty';
        el.textContent = 'Empty block — lyrics will appear here.';
        if (vf) {
            vf.className = 'preview-empty';
            vf.textContent = el.textContent;
        }
        applyViewfinderFromPrompterSync();
        return;
    }

    const html = '\n' + formatText(raw);
    el.className = '';
    el.innerHTML = html;
    if (vf) {
        vf.className = '';
        vf.innerHTML = html;
    }
    applyViewfinderFromPrompterSync();
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

function initShell() {
    initSidebarCollapse();
    refreshPreviewVisibility();
    initPrompterBroadcast();
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
        sendBtn.addEventListener('click', () => {
            if (sendBtn.disabled) return;
            const ta = getSelectedTextareaForActiveTab();
            if (!ta) return;
            const parts = ta.id.split('-');
            sendPrompt(parseInt(parts[1], 10), parseInt(parts[2], 10));
        });
    }

    const tc = document.getElementById('tab-content');
    if (tc) {
        tc.addEventListener('focusin', (e) => {
            if (e.target.matches && e.target.matches('textarea')) selectTextarea(e.target);
        });
        tc.addEventListener('input', (e) => {
            if (!e.target.matches || !e.target.matches('textarea')) return;
            refreshPreviewVisibility();
            const m = e.target.id.match(/^textarea-(\d+)-/);
            const tid = m ? parseInt(m[1], 10) : null;
            if (tid != null) refreshAllBlockLabelsInTab(tid);
            const sel = tid != null && textNum[tid.toString()] ? textNum[tid.toString()][2] : null;
            if (tid === getActiveTabId() && sel === e.target) {
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

    const addBlockButton = document.createElement('button');
    addBlockButton.classList.add('add-block-btn');
    addBlockButton.id = `add-block-${tabId}`;
    addBlockButton.title = 'Add one lyric block';
    addBlockButton.type = 'button';
    addBlockButton.innerHTML = '<i class="fa-solid fa-plus"></i> Add block';
    addBlockButton.addEventListener('click', () => {
        addSingleBlock(container, tabId);
    });

    content.appendChild(container);
    content.appendChild(addBlockButton);
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
    const row = cell.closest('.textareas-row');
    cell.remove();
    if (row && row.querySelectorAll('.textarea-cell').length === 0) {
        row.remove();
    }
    rearrangeTextAreas(tabId);
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
    cell.classList.add('textarea-cell');

    const head = document.createElement('div');
    head.classList.add('textarea-cell-head');
    const label = document.createElement('span');
    label.classList.add('textarea-cell-label');
    label.title = 'Double-click to rename';

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
    label.addEventListener('dblclick', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        renameBlockLabel(textarea);
    });
    textarea.addEventListener('paste', () => {
        setTimeout(() => {
            textarea.scrollTop = 0;
            const mid = textarea.id.match(/^textarea-(\d+)-/);
            const tid = mid ? parseInt(mid[1], 10) : null;
            if (tid != null) refreshAllBlockLabelsInTab(tid);
            const sel = tid != null && textNum[tid.toString()] ? textNum[tid.toString()][2] : null;
            if (tid === getActiveTabId() && sel === textarea) {
                updateActiveBlockToolbar();
                updatePreview();
            }
        }, 0);
    });

    cell.appendChild(head);
    cell.appendChild(textarea);
    row.appendChild(cell);
    updateBlockCellLabel(textarea);
    refreshAllBlockLabelsInTab(tabId);
    syncBlockRemoveButtons(tabId);
}

function showTabContent(tabId) {
    document.querySelectorAll('#tabs-list .tab').forEach((tab) => tab.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((pane) => (pane.style.display = 'none'));
    const activeTab = document.querySelector(`#tabs-list .tab[data-tab-id="${tabId}"]`);
    const activeContent = document.getElementById(`tab-${tabId}`);
    if (activeTab && activeContent) {
        activeTab.classList.add('active');
        activeContent.style.display = 'block';
        refreshAllBlockLabelsInTab(tabId);
        syncBlockRemoveButtons(tabId);
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
    updateActiveBlockToolbar();
    syncBlockRemoveButtons(tabId);
}

function handleTabClose(tab) {
    const tabId = parseInt(tab.dataset.tabId);
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

function sendPrompt(tabId, textId) {
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

    const payload = {
        type: 'eclyrics-prompter-load',
        lineupKey,
        currentIndex: textId - 1,
    };

    const targetOrigin =
        window.location.origin && window.location.origin !== 'null' ? window.location.origin : '*';

    if (prompterPopupWindow && !prompterPopupWindow.closed) {
        try {
            prompterPopupWindow.postMessage(payload, targetOrigin);
            prompterPopupWindow.focus();
            textNum[tabId.toString()][1] = prompterPopupWindow;
            updatePreview();
            updatePreviewPrompterDock();
            postPrompterControl({ action: 'setSpeed', speed: readSavedPreviewSpeed() });
            return;
        } catch (e) {
            prompterPopupWindow = null;
        }
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
