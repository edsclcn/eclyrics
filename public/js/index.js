const AREA_PER_ROW = 5;
const SESSION_ID = Math.random().toString().substring(2);
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
    return {
        type: 'eclyrics-prompter-sync',
        top: 0,
        vw: PROMPTER_POPUP_W,
        vh: PROMPTER_POPUP_H,
        fs: !Number.isNaN(fs) ? fs : 138,
        cw: !Number.isNaN(cw) ? cw : PROMPTER_POPUP_W * 0.7,
    };
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

const BLOCK_TITLE_MAX_LEN = 52;

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

    if (titleEl) titleEl.textContent = getBlockTitleDisplay(ta);

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

    const html = formatText(raw);
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

    const scrollBtn = document.getElementById('scroll-block-btn');
    if (scrollBtn) {
        scrollBtn.addEventListener('click', () => {
            const ta = getSelectedTextareaForActiveTab();
            if (ta) ta.scrollTop = 0;
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

    createTextareasRow(container, tabId);

    const addSetButton = document.createElement('button');
    addSetButton.classList.add('add-set-btn');
    addSetButton.id = `add-set-${tabId}`;
    addSetButton.title = 'Add new row of lyric blocks';
    addSetButton.type = 'button';
    addSetButton.innerHTML = '<i class="fa-solid fa-layer-group"></i> Add row of blocks';
    addSetButton.onclick = function () {
        createTextareasRow(container, tabId);
    };

    content.appendChild(container);
    content.appendChild(addSetButton);
    tabContent.appendChild(content);
}

function createTextareasRow(container, tabId) {
    const rowContainer = document.createElement('div');
    rowContainer.classList.add('textareas-row');

    for (let i = 1; i <= AREA_PER_ROW; i++) {
        const textId = ++textNum[tabId.toString()][0];

        const cell = document.createElement('div');
        cell.classList.add('textarea-cell');

        const head = document.createElement('div');
        head.classList.add('textarea-cell-head');
        const label = document.createElement('span');
        label.classList.add('textarea-cell-label');
        label.title = 'Double-click to rename';
        head.appendChild(label);

        const textarea = document.createElement('textarea');
        textarea.id = `textarea-${tabId}-${textId}`;
        textarea.placeholder = `Lyrics for block ${textId} `;
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
        updateBlockCellLabel(textarea);
        rowContainer.appendChild(cell);
    }

    const removeSetButton = document.createElement('button');
    removeSetButton.classList.add('remove-set-btn');
    removeSetButton.type = 'button';
    removeSetButton.innerHTML = '×';
    removeSetButton.title = 'Remove this row';
    removeSetButton.onclick = function () {
        rowContainer.remove();
        rearrangeTextAreas(tabId);
        const first = document.querySelector(`#tab-${tabId} textarea`);
        if (first) selectTextarea(first);
        else {
            updateActiveBlockToolbar();
            updatePreview();
        }
    };

    const buttonWrapper = document.createElement('div');
    buttonWrapper.classList.add('remove-set-btn-wrapper');
    buttonWrapper.appendChild(removeSetButton);
    rowContainer.appendChild(buttonWrapper);
    container.appendChild(rowContainer);
    refreshAllBlockLabelsInTab(tabId);
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
        textarea.placeholder = `Lyrics for block ${newTextId} (§ codes for color)`;
    }

    refreshAllBlockLabelsInTab(tabId);
    updateActiveBlockToolbar();
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
