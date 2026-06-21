const TOP_SPEED = 6.5;
const SPEED_CONTROL = 0.1;
const DEFAULT_SCROLL_SPEED = 0.5;
/** Manual scroll (arrows / wheel) at default speed — scales with scrollSpeed. */
const ARROW_SCROLL_BASE_PX = 50;
const WHEEL_SCROLL_BASE_PX = 100;

function scrollStepPx() {
    return ARROW_SCROLL_BASE_PX * (scrollSpeed / DEFAULT_SCROLL_SPEED);
}

function wheelScrollStepPx() {
    return WHEEL_SCROLL_BASE_PX * (scrollSpeed / DEFAULT_SCROLL_SPEED);
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

function getPrompterThemeId() {
    return sessionStorage.getItem('prompterType') === 'LYRICS_PROMPTER' ? 'lyrics' : 'bw';
}

function broadcastPrompterState() {
    if (!prompterBroadcastChannel || !prompterContent) return;
    const cs = window.getComputedStyle(prompterContent);
    const fs = parseFloat(cs.fontSize);
    const guard = typeof EclyricsPrompterSyncGuard !== 'undefined' ? EclyricsPrompterSyncGuard : null;
    const blockHtml = data && data[currentIndex] != null ? String(data[currentIndex]) : '';
    prompterBroadcastChannel.postMessage({
        type: 'eclyrics-prompter-sync',
        top: scrollPosition,
        vw: window.innerWidth,
        vh: window.innerHeight,
        fs: Number.isNaN(fs) ? 138 : fs,
        ls: cs.letterSpacing,
        lh: cs.lineHeight,
        cw: prompterContent.offsetWidth,
        speed: scrollSpeed,
        playing: scrollingNow,
        theme: getPrompterThemeId(),
        lineupKey: lineupKey || null,
        currentIndex,
        contentFingerprint: guard ? guard.hashString(blockHtml) : null,
    });
}

let scrollBroadcastTick = 0;

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
    broadcastPrompterState();
    setTimeout(tryInitialPrompterFullscreen, 150);
};

//Font size (default 138px matches 1920-wide stage; synced for main-app preview)
let fontSize = sessionStorage.getItem('fontSize');
if (fontSize) prompterContent.style.fontSize = fontSize + 'px';
else {
    prompterContent.style.fontSize = '138px';
    sessionStorage.setItem('fontSize', '138');
}
syncPreviewMetricsFromSession();

//Prompter width
let prompterWidth = sessionStorage.getItem('prompterWidth');
if (prompterWidth) prompterContent.style.width = prompterWidth + "px";
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
    const viewH = window.innerHeight;
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
    if (scrollBroadcastTick++ % 2 === 0) broadcastPrompterState();
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

window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'eclyrics-prompter-key') {
        if (!window.opener || event.source !== window.opener) return;
        const code = msg.code || '';
        const key = msg.key || '';
        const sc = typeof EclyricsPrompterShortcuts !== 'undefined' ? EclyricsPrompterShortcuts : null;
        if (sc && !sc.assertRemotePrompterKeySupported(code)) return;
        handleMainKeys({ code, key, preventDefault() {} });
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
                if (!scrollingNow) {
                    scrollPosition = 0;
                    applyScrollPosition();
                    broadcastPrompterState();
                }
                break;
            case 'scrollBy':
                if (typeof msg.delta !== 'number' || Number.isNaN(msg.delta)) break;
                pauseScroll();
                scrollPosition += msg.delta;
                applyScrollPosition();
                broadcastPrompterState();
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
        case 'ArrowUp':
            event.preventDefault();
            pauseScroll();
            scrollPosition += scrollStepPx();
            applyScrollPosition();
            broadcastPrompterState();
            break;
        case 'ArrowDown':
            event.preventDefault();
            pauseScroll();
            scrollPosition -= scrollStepPx();
            applyScrollPosition();
            broadcastPrompterState();
            break;
        case 'ArrowLeft':
            event.preventDefault();
            if (currentIndex > 0) setText(currentIndex - 1);
            break;
        case 'ArrowRight':
            event.preventDefault();
            if (data && currentIndex < data.length - 1) setText(currentIndex + 1);
            break;
        case 'BracketLeft':
            event.preventDefault();
            var newSizeL = parseInt(window.getComputedStyle(prompterContent).fontSize, 10) - 2;
            prompterContent.style.fontSize = newSizeL + 'px';
            sessionStorage.setItem('fontSize', String(newSizeL));
            localStorage.setItem('eclyrics-prompter-fontSize', String(newSizeL));
            broadcastPrompterState();
            break;
        case 'BracketRight':
            event.preventDefault();
            var newSizeR = parseInt(window.getComputedStyle(prompterContent).fontSize, 10) + 2;
            prompterContent.style.fontSize = newSizeR + 'px';
            sessionStorage.setItem('fontSize', String(newSizeR));
            localStorage.setItem('eclyrics-prompter-fontSize', String(newSizeR));
            broadcastPrompterState();
            break;
        case 'Minus':
            event.preventDefault();
            var currentWidthMinus = parseInt(window.getComputedStyle(prompterContent).width, 10) - 50;
            if (currentWidthMinus >= screen.availWidth / 3) {
                prompterContent.style.width = currentWidthMinus + 'px';
                sessionStorage.setItem('prompterWidth', String(currentWidthMinus));
                localStorage.setItem('eclyrics-prompter-width', String(currentWidthMinus));
                broadcastPrompterState();
            }
            break;
        case 'Equal':
            event.preventDefault();
            var currentWidthEq = parseInt(window.getComputedStyle(prompterContent).width, 10) + 50;
            if (currentWidthEq <= screen.availWidth) {
                prompterContent.style.width = currentWidthEq + 'px';
                sessionStorage.setItem('prompterWidth', String(currentWidthEq));
                localStorage.setItem('eclyrics-prompter-width', String(currentWidthEq));
                broadcastPrompterState();
            }
            break;
        case 'KeyT':
            event.preventDefault();
            if (scrollingNow) break;
            scrollPosition = 0;
            prompterContent.style.top = '0px';
            broadcastPrompterState();
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

//Scroll Wheel
var wheelListener = function (event) {
    if (event.ctrlKey) {
        if (event.deltaY < 0) {
            var newSize = parseInt(window.getComputedStyle(prompterContent).fontSize) + 2;
            prompterContent.style.fontSize = newSize + 'px';
            sessionStorage.setItem('fontSize', newSize);
            localStorage.setItem('eclyrics-prompter-fontSize', String(newSize));
            broadcastPrompterState();
        } else {
            var newSize = parseInt(window.getComputedStyle(prompterContent).fontSize) - 2;
            prompterContent.style.fontSize = newSize + 'px';
            sessionStorage.setItem('fontSize', newSize);
            localStorage.setItem('eclyrics-prompter-fontSize', String(newSize));
            broadcastPrompterState();
        }
    } else {
        pauseScroll();
        const step = wheelScrollStepPx();
        if (event.deltaY < 0) scrollPosition += step;
        else scrollPosition -= step;
        applyScrollPosition();
        broadcastPrompterState();
    }
};
document.addEventListener('wheel', wheelListener);

window.addEventListener('resize', () => {
    broadcastPrompterState();
});

document.addEventListener('contextmenu', event => event.preventDefault());

function initPrompterHelpOverlay() {
    const helpCard = document.getElementById('helpCard');
    const tbody = document.getElementById('prompter-help-table');
    const sc = typeof EclyricsPrompterShortcuts !== 'undefined' ? EclyricsPrompterShortcuts : null;
    if (sc) sc.renderPrompterHelpTable(tbody);

    function showHelp() {
        if (!helpCard) return;
        helpCard.style.display = 'block';
        helpCard.setAttribute('aria-hidden', 'false');
    }

    function hideHelp() {
        if (!helpCard) return;
        helpCard.style.display = 'none';
        helpCard.setAttribute('aria-hidden', 'true');
    }

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;
        showHelp();
        event.preventDefault();
    });

    window.addEventListener('keyup', (event) => {
        if (event.key !== 'Tab') return;
        hideHelp();
        event.preventDefault();
    });

    window.addEventListener('blur', hideHelp);
}

initPrompterHelpOverlay();

/** Try fullscreen once loaded (may be blocked without a direct user gesture on some browsers). */
function tryInitialPrompterFullscreen() {
    const root = document.documentElement;
    const req = root.requestFullscreen || root.webkitRequestFullscreen || root.webkitEnterFullscreen;
    if (req) {
        req.call(root).catch(() => {});
    }
}
