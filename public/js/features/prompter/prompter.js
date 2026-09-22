const TOP_SPEED = 6.5;
const SPEED_CONTROL = 0.1;
const DEFAULT_SCROLL_SPEED = 0.5;
/** Logical stage size — fixed regardless of browser zoom or popup window resize. */
const STAGE_VW = 1920;
const STAGE_VH = 1080;
/** Manual scroll: fixed 100px per keypress (including hold key-repeat); not scaled by scroll speed. */
const KEYBOARD_ARROW_SCROLL_PX = 100;
const WHEEL_SCROLL_PX = 50;

function wheelScrollStepPx() {
    return WHEEL_SCROLL_PX;
}

function handleManualScrollShortcut(code) {
    const dir = code === 'ArrowUp' ? 1 : -1;
    applyPrompterScrollBy(dir * KEYBOARD_ARROW_SCROLL_PX);
}

function readPrompterFontSizePx() {
    const inline = parseFloat(prompterContent?.style?.fontSize);
    if (!Number.isNaN(inline) && inline > 0) return inline;
    const stored = parseFloat(sessionStorage.getItem('fontSize'));
    if (!Number.isNaN(stored) && stored > 0) return stored;
    return 138;
}

function readPrompterWidthPx() {
    const inline = parseFloat(prompterContent?.style?.width);
    if (!Number.isNaN(inline) && inline > 0) return inline;
    const stored = parseFloat(sessionStorage.getItem('prompterWidth'));
    if (!Number.isNaN(stored) && stored > 0) return stored;
    return STAGE_VW * 0.7;
}

function setPrompterFontSizePx(px) {
    const next = Math.max(8, Math.round(px));
    prompterContent.style.fontSize = `${next}px`;
    sessionStorage.setItem('fontSize', String(next));
    localStorage.setItem('eclyrics-prompter-fontSize', String(next));
    return next;
}

function setPrompterWidthPx(px) {
    const next = Math.round(px);
    prompterContent.style.width = `${next}px`;
    sessionStorage.setItem('prompterWidth', String(next));
    localStorage.setItem('eclyrics-prompter-width', String(next));
    return next;
}

/** Counter browser page zoom so stage metrics stay at logical 1920×1080 px. */
function applyBrowserZoomCompensation() {
    const scale = window.visualViewport?.scale;
    if (!scale || Math.abs(scale - 1) < 0.001) {
        document.documentElement.style.zoom = '';
        return;
    }
    document.documentElement.style.zoom = String(1 / scale);
}

function initPrompterViewportLock() {
    applyBrowserZoomCompensation();
    window.visualViewport?.addEventListener('resize', applyBrowserZoomCompensation);
    window.visualViewport?.addEventListener('scroll', applyBrowserZoomCompensation);
}

/** Sync font/width to localStorage so the main app preview can match the prompter window. */
function syncPreviewMetricsFromSession() {
    const fs = sessionStorage.getItem('fontSize');
    const w = sessionStorage.getItem('prompterWidth');
    if (fs) localStorage.setItem('eclyrics-prompter-fontSize', fs);
    if (w) localStorage.setItem('eclyrics-prompter-width', w);
}

let prompterBroadcastChannel = null;
try {
    prompterBroadcastChannel = new BroadcastChannel('eclyrics-prompter');
} catch (e) {
    prompterBroadcastChannel = null;
}

/** Cached visual metrics — refreshed on layout/block/theme changes, not every scroll frame. */
let cachedPrompterBroadcast = null;

function refreshCachedPrompterBroadcast() {
    if (!prompterContent) return null;
    const fs = readPrompterFontSizePx();
    const cw = readPrompterWidthPx();
    const guard = typeof EclyricsPrompterSyncGuard !== 'undefined' ? EclyricsPrompterSyncGuard : null;
    const blockHtml = data && data[currentIndex] != null ? String(data[currentIndex]) : '';
    const cs = window.getComputedStyle(prompterContent);
    cachedPrompterBroadcast = {
        fs,
        cw,
        ls: cs.letterSpacing,
        lh: cs.lineHeight,
        theme: getPrompterThemeId(),
        lineupKey: lineupKey || null,
        currentIndex,
        contentFingerprint: guard ? guard.hashString(blockHtml) : null,
    };
    return cachedPrompterBroadcast;
}

function getPrompterThemeId() {
    return sessionStorage.getItem('prompterType') === 'LYRICS_PROMPTER' ? 'lyrics' : 'bw';
}

function broadcastPrompterState(options = {}) {
    if (!prompterBroadcastChannel || !prompterContent) return;
    const scrollOnly = options.scrollOnly === true;
    if (!scrollOnly || !cachedPrompterBroadcast) {
        refreshCachedPrompterBroadcast();
    }
    const contentH = prompterContent.offsetHeight;
    prompterBroadcastChannel.postMessage({
        type: 'eclyrics-prompter-sync',
        top: scrollPosition,
        vw: STAGE_VW,
        vh: STAGE_VH,
        contentH,
        speed: scrollSpeed,
        playing: scrollingNow,
        ...(cachedPrompterBroadcast || {}),
    });
}

const prompterContainer = document.getElementById("bgPrompter");
const prompterContent = document.getElementById("prompter-content");
let lineupKey = getUrlParameter('title');
let data = null;
if (lineupKey) {
    const stored = localStorage.getItem(lineupKey);
    if (stored) {
        try {
            data = JSON.parse(stored);
        } catch (e) {
            data = null;
        }
    }
}
let currentIndex = parseInt(getUrlParameter('current'), 10);
if (Number.isNaN(currentIndex)) currentIndex = 0;

function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === "null" ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

window.onload = function () {
    var t = getUrlParameter('title');
    if (t) document.title = t;
    initPrompterViewportLock();
    broadcastPrompterState();
    setTimeout(tryInitialPrompterFullscreen, 150);
};

//Font size (default 138px matches 1920-wide stage; synced for main-app preview)
let fontSize = sessionStorage.getItem('fontSize');
if (fontSize) prompterContent.style.fontSize = fontSize + 'px';
else {
    setPrompterFontSizePx(138);
}
syncPreviewMetricsFromSession();

//Prompter width — fixed px, never viewport-relative
let prompterWidth = sessionStorage.getItem('prompterWidth');
if (prompterWidth) prompterContent.style.width = prompterWidth + 'px';
else {
    setPrompterWidthPx(STAGE_VW * 0.7);
}
syncPreviewMetricsFromSession();

//Scrolling
prompterContent.style.top = "0px";
let scrollingNow = false;
let animationLoop;
let scrollPosition = 0;
let scrollSpeed = 0.5;
try {
    const savedSp = sessionStorage.getItem('eclyrics-prompter-scroll-speed');
    if (savedSp) {
        const n = parseFloat(savedSp);
        if (!Number.isNaN(n) && n > 0 && n <= TOP_SPEED) scrollSpeed = n;
    }
} catch (e) {
    /* ignore */
}

function persistScrollSpeed() {
    try {
        sessionStorage.setItem('eclyrics-prompter-scroll-speed', String(scrollSpeed));
    } catch (e) {
        /* ignore */
    }
}

/** scrollPosition 0 = top; negative = scrolled down.
 * Allow one full viewport of blank tail after the last line. */
function getScrollBounds() {
    const viewH = STAGE_VH;
    const contentH = prompterContent ? prompterContent.offsetHeight : 0;
    const minTop = -(Math.max(contentH, viewH));
    return { min: minTop, max: 0 };
}

function clampScrollPosition() {
    const { min, max } = getScrollBounds();
    if (scrollPosition > max) scrollPosition = max;
    if (scrollPosition < min) scrollPosition = min;
}

function applyScrollPosition() {
    clampScrollPosition();
    prompterContent.style.top = scrollPosition + 'px';
}

function scrollScript() {
    scrollPosition -= scrollSpeed;
    applyScrollPosition();
    broadcastPrompterState({ scrollOnly: true });
    animationLoop = requestAnimationFrame(scrollScript);
}

function playPauseScroll() {
    if (scrollingNow) pauseScroll();
    else playScroll();
}

function playScroll() {
    scrollingNow = true;
    scrollScript();
}

function pauseScroll() {
    cancelAnimationFrame(animationLoop);
    scrollingNow = false;
}

setText(currentIndex);

function setText(index) {
    const i = parseInt(index, 10);
    if (Number.isNaN(i)) return;
    currentIndex = i;
    if (scrollingNow) pauseScroll();
    scrollPosition = 0;
    prompterContent.style.top = "0px";
    prompterContent.innerHTML = data && data[currentIndex] != null ? data[currentIndex] : '\nNo content. Close the window.';
    broadcastPrompterState();
}

function applyRemoteScrollSpeed(next) {
    const n = typeof next === 'number' ? next : parseFloat(next);
    if (Number.isNaN(n)) return;
    const clamped = Math.min(TOP_SPEED, Math.max(0.1, n));
    scrollSpeed = clamped;
    persistScrollSpeed();
    broadcastPrompterState();
}

function getPrompterTargetOrigin() {
    return window.location.origin && window.location.origin !== 'null' ? window.location.origin : '*';
}

function notifyOpenerWorkspaceShortcut(id, extra = {}) {
    if (!window.opener) return;
    try {
        window.opener.postMessage({ type: 'eclyrics-workspace-shortcut', id, ...extra }, getPrompterTargetOrigin());
    } catch (e) {
        /* ignore */
    }
}

/** Same dispatch table as handleGlobalPrompterShortcut in index.js — keeps state/broadcast aligned. */
function dispatchResolvedPrompterShortcut(resolved) {
    switch (resolved.id) {
        case 'send':
            notifyOpenerWorkspaceShortcut('send');
            break;
        case 'adjacentBlock':
            notifyOpenerWorkspaceShortcut('adjacentBlock', {
                delta: resolved.code === 'ArrowLeft' ? -1 : 1,
            });
            break;
        case 'manualScroll':
            handleManualScrollShortcut(resolved.code);
            break;
        case 'fontSize':
            handleMainKeys({ code: resolved.code, key: resolved.key, preventDefault() {} });
            break;
        default:
            handleMainKeys({ code: resolved.code, key: resolved.key, preventDefault() {} });
            break;
    }
}

function applyPrompterScrollBy(delta) {
    if (typeof delta !== 'number' || Number.isNaN(delta)) return;
    pauseScroll();
    scrollPosition += delta;
    applyScrollPosition();
    broadcastPrompterState();
}

function applyPrompterScrollTop() {
    if (scrollingNow) return;
    scrollPosition = 0;
    applyScrollPosition();
    broadcastPrompterState();
}

function getPrompterShortcutsApi() {
    return typeof EclyricsPrompterShortcuts !== 'undefined' ? EclyricsPrompterShortcuts : null;
}

function handleLocalPrompterShortcut(event) {
    const sc = getPrompterShortcutsApi();
    if (!sc) return;
    const ctx = { prompterOpen: true };
    if (sc.shouldIgnorePrompterShortcut(event, ctx)) return;
    const resolved = sc.resolvePrompterShortcut(event);
    if (!resolved) return;
    event.preventDefault();
    dispatchResolvedPrompterShortcut(resolved);
}

function initPrompterKeyboardShortcuts() {
    const sc = getPrompterShortcutsApi();
    if (!sc) {
        console.error('[eclyrics] prompter-shortcuts.js must load before prompter.js');
        return;
    }
    sc.assertPrompterShortcutParity();
    document.addEventListener('keydown', handleLocalPrompterShortcut, true);
}

window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'eclyrics-prompter-key') {
        if (!window.opener || event.source !== window.opener) return;
        const code = msg.code || '';
        const key = msg.key || '';
        const sc = getPrompterShortcutsApi();
        if (sc && !sc.assertRemotePrompterKeySupported(code)) return;
        const resolved = sc ? sc.resolvePrompterShortcut({ code, key }) : null;
        if (resolved) dispatchResolvedPrompterShortcut(resolved);
        return;
    }

    if (msg.type === 'eclyrics-prompter-control') {
        if (!window.opener || event.source !== window.opener) return;
        switch (msg.action) {
            case 'playPause':
                playPauseScroll();
                broadcastPrompterState();
                break;
            case 'pauseOnly':
                pauseScroll();
                broadcastPrompterState();
                break;
            case 'prevBlock':
                if (data && currentIndex > 0) {
                    setText(currentIndex - 1);
                }
                break;
            case 'nextBlock':
                if (data && currentIndex < data.length - 1) {
                    setText(currentIndex + 1);
                }
                break;
            case 'setSpeed':
                applyRemoteScrollSpeed(msg.speed);
                break;
            case 'scrollTop':
                applyPrompterScrollTop();
                break;
            case 'scrollBy':
                applyPrompterScrollBy(msg.delta);
                break;
            case 'updateLineup':
                if (!msg.lineupKey || msg.lineupKey !== lineupKey || !Array.isArray(msg.data)) break;
                data = msg.data;
                try {
                    localStorage.setItem(lineupKey, JSON.stringify(data));
                } catch (e) {
                    /* ignore */
                }
                if (data[currentIndex] != null) {
                    if (scrollingNow) pauseScroll();
                    prompterContent.innerHTML = data[currentIndex];
                    applyScrollPosition();
                    broadcastPrompterState();
                }
                break;
            case 'toggleTheme':
                togglePrompterTheme();
                break;
            case 'requestSync':
                broadcastPrompterState();
                break;
            default:
                break;
        }
        return;
    }

    if (msg.type !== 'eclyrics-prompter-load') return;
    if (window.opener && event.source !== window.opener) return;
    const key = msg.lineupKey;
    const idx = parseInt(msg.currentIndex, 10);
    if (!key || Number.isNaN(idx)) return;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    lineupKey = key;
    data = JSON.parse(raw);
    setText(idx);
    document.title = key;
    try {
        const u = new URL(window.location.href);
        u.searchParams.set('title', key);
        u.searchParams.set('current', String(idx));
        history.replaceState(null, '', u.pathname + u.search);
    } catch (e) {
        /* file:// or older browsers */
    }
});

//Initial theme
if (sessionStorage.getItem('prompterType') === 'LYRICS_PROMPTER') {
    prompterContainer.classList.add('lyricsPrompter');
    prompterContainer.classList.remove('blackwhite');
} else {
    prompterContainer.classList.remove('lyricsPrompter');
    prompterContainer.classList.add('blackwhite');
}

//Full Screen — initial open only; keyboard shortcuts live in the main workspace.
function requestFullscreen() {
    const body = document.documentElement;
    if (body.requestFullscreen) body.requestFullscreen();
    else if (body.webkitRequestFullscreen) body.webkitRequestFullscreen();
    else if (body.mozRequestFullscreen) body.mozRequestFullscreen();
}

//Keyboard Shortcuts — remote only (see prompter-shortcuts.js in main app)
function togglePrompterTheme() {
    if (sessionStorage.getItem('prompterType') === 'LYRICS_PROMPTER') sessionStorage.setItem('prompterType', 'BLACK_AND_WHITE');
    else sessionStorage.setItem('prompterType', 'LYRICS_PROMPTER');
    prompterContainer.classList.toggle('lyricsPrompter');
    prompterContainer.classList.toggle('blackwhite');
    broadcastPrompterState();
}

function handleMainKeys(event) {
    switch (event.code) {
        case 'Space':
            event.preventDefault();
            playPauseScroll();
            broadcastPrompterState();
            break;
        case 'Digit1':
            event.preventDefault();
            scrollSpeed = 0.5;
            persistScrollSpeed();
            broadcastPrompterState();
            break;
        case 'Digit2':
            event.preventDefault();
            scrollSpeed = 1;
            persistScrollSpeed();
            broadcastPrompterState();
            break;
        case 'Digit3':
            event.preventDefault();
            scrollSpeed = 1.5;
            persistScrollSpeed();
            broadcastPrompterState();
            break;
        case 'Digit4':
            event.preventDefault();
            scrollSpeed = 2;
            persistScrollSpeed();
            broadcastPrompterState();
            break;
        case 'Digit5':
            event.preventDefault();
            scrollSpeed = 2.5;
            persistScrollSpeed();
            broadcastPrompterState();
            break;
        case 'Digit6':
            event.preventDefault();
            scrollSpeed = 3;
            persistScrollSpeed();
            broadcastPrompterState();
            break;
        case 'Digit7':
            event.preventDefault();
            scrollSpeed = 3.5;
            persistScrollSpeed();
            broadcastPrompterState();
            break;
        case 'Digit8':
            event.preventDefault();
            scrollSpeed = 4;
            persistScrollSpeed();
            broadcastPrompterState();
            break;
        case 'Digit9':
            event.preventDefault();
            scrollSpeed = 4.5;
            persistScrollSpeed();
            broadcastPrompterState();
            break;
        case 'Digit0':
            event.preventDefault();
            pauseScroll();
            broadcastPrompterState();
            break;
        case 'KeyP':
            event.preventDefault();
            togglePrompterTheme();
            break;
        case 'BracketLeft':
            event.preventDefault();
            setPrompterFontSizePx(readPrompterFontSizePx() - 2);
            broadcastPrompterState();
            break;
        case 'BracketRight':
            event.preventDefault();
            setPrompterFontSizePx(readPrompterFontSizePx() + 2);
            broadcastPrompterState();
            break;
        case 'Minus':
            event.preventDefault();
            var currentWidthMinus = readPrompterWidthPx() - 50;
            if (currentWidthMinus >= STAGE_VW / 3) {
                setPrompterWidthPx(currentWidthMinus);
                broadcastPrompterState();
            }
            break;
        case 'Equal':
            event.preventDefault();
            var currentWidthEq = readPrompterWidthPx() + 50;
            if (currentWidthEq <= STAGE_VW) {
                setPrompterWidthPx(currentWidthEq);
                broadcastPrompterState();
            }
            break;
        case 'KeyT':
            event.preventDefault();
            applyPrompterScrollTop();
            break;
        case 'NumpadSubtract':
            event.preventDefault();
            if (scrollSpeed - SPEED_CONTROL > 0) scrollSpeed -= SPEED_CONTROL;
            else pauseScroll();
            persistScrollSpeed();
            broadcastPrompterState();
            break;
        case 'NumpadAdd':
            event.preventDefault();
            if (scrollSpeed + SPEED_CONTROL <= TOP_SPEED) scrollSpeed += SPEED_CONTROL;
            if (!scrollingNow) playScroll();
            persistScrollSpeed();
            broadcastPrompterState();
            break;
    }
}

//Scroll Wheel — plain wheel scrolls lyrics; Ctrl/meta wheel is browser zoom, not scroll.
var wheelListener = function (event) {
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    pauseScroll();
    const step = wheelScrollStepPx();
    if (event.deltaY < 0) scrollPosition += step;
    else scrollPosition -= step;
    applyScrollPosition();
    broadcastPrompterState();
};
document.addEventListener('wheel', wheelListener, { passive: false });

document.addEventListener('contextmenu', event => event.preventDefault());

initPrompterKeyboardShortcuts();

/** Try fullscreen once loaded (may be blocked without a direct user gesture on some browsers). */
function tryInitialPrompterFullscreen() {
    const root = document.documentElement;
    const req = root.requestFullscreen || root.webkitRequestFullscreen || root.webkitEnterFullscreen;
    if (req) {
        req.call(root).catch(() => {});
    }
}
