const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const videoIndex = read('public/js/features/video-lyrics/index.js');

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `expected ${name}() to exist`);
    const signatureEnd = source.indexOf(') {', start);
    assert.ok(signatureEnd >= 0, `expected ${name}() to have a body`);
    const bodyStart = signatureEnd + 2;
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    assert.fail(`expected ${name}() to have a complete body`);
}

function syncSetupSource() {
    const start = videoIndex.indexOf('    const syncToggles = [...document.querySelectorAll(\'[data-lyrics-sync-toggle]\')];');
    const end = videoIndex.indexOf('    function status(', start);
    assert.ok(start >= 0 && end > start, 'expected to locate sync setup and event wiring');
    return `${videoIndex.slice(start, end)}\n globalThis.__syncTest = { updateSyncPreviewLayout, setReadingMarkerRatio, syncToggles, getSyncFeedback: () => syncFeedback, getMarkerRatio: () => readingMarkerRatio, getChannel: () => prompterPositionChannel };`;
}

class FakeNode {
    constructor(name, children = []) {
        this.name = name;
        this.children = [];
        this.parentNode = null;
        this.hidden = false;
        this.style = {};
        this.attributes = {};
        this.listeners = {};
        this.classList = {
            values: new Set(),
            add: name => this.classList.values.add(name),
            remove: name => this.classList.values.delete(name),
            contains: name => this.classList.values.has(name),
            toggle: (name, enabled) => enabled ? this.classList.values.add(name) : this.classList.values.delete(name),
        };
        for (const child of children) this.append(child);
    }

    get nextSibling() {
        if (!this.parentNode) return null;
        const siblings = this.parentNode.children;
        return siblings[siblings.indexOf(this) + 1] || null;
    }

    append(child) {
        if (child.parentNode) {
            const oldSiblings = child.parentNode.children;
            oldSiblings.splice(oldSiblings.indexOf(child), 1);
        }
        child.parentNode = this;
        this.children.push(child);
    }

    insertBefore(child, before) {
        if (child.parentNode) {
            const oldSiblings = child.parentNode.children;
            oldSiblings.splice(oldSiblings.indexOf(child), 1);
        }
        const index = before ? this.children.indexOf(before) : -1;
        child.parentNode = this;
        this.children.splice(index < 0 ? this.children.length : index, 0, child);
    }

    addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
    querySelector() { return null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    setPointerCapture(pointerId) { this.capturedPointerId = pointerId; }
    getBoundingClientRect() { return this.name === 'preview stage' ? { top: 100, height: 200 } : { top: 0, height: 200 }; }
}

function createSyncHarness({ textPopupOpen = false, videoResult = { ok: true }, storedRatio = null } = {}) {
    let boundLineupKey = textPopupOpen ? 'text-lineup-a' : null;
    const textPreview = new FakeNode('text preview column', [new FakeNode('text preview frame')]);
    const marker = new FakeNode('reading marker');
    const stage = new FakeNode('preview stage', [marker]);
    textPreview.children[0].append(stage);
    const textPanel = new FakeNode('text panel');
    textPanel.classList.add('is-active');
    const videoCard = new FakeNode('video preview card');
    const videoInspector = new FakeNode('video inspector', [new FakeNode('before video card'), videoCard, new FakeNode('after video card')]);
    const videoPreviewHost = new FakeNode('video preview host');
    const toggleA = { checked: false, listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; } };
    const toggleB = { checked: false, listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; } };
    const statuses = [{ textContent: 'Off by default' }, { textContent: 'Off by default' }];
    const documentListeners = {}, windowListeners = {}, channelMessages = [], outputCalls = [];
    let defaultBackgroundRequests = 0;
    const localValues = new Map(storedRatio === null ? [] : [['eclyrics-prompter-reading-marker-ratio', String(storedRatio)]]);
    const model = {
        state: { sync: { enabled: false, status: 'Off by default', latestPosition: null } },
        getState() { return this.state; },
        setSyncEnabled(enabled) {
            this.state.sync.enabled = Boolean(enabled);
            this.state.sync.status = enabled ? 'Sync on · Send text lyrics to start.' : 'Sync off.';
        },
    };
    const document = {
        getElementById(id) {
            return ({
                'workspace-preview-panel': textPreview,
                'lyrics-sync-video-preview': videoPreviewHost,
                'lyrics-sync-reading-marker': marker,
                'preview-viewfinder-stage': stage,
                'panel-text': textPanel,
            })[id] || null;
        },
        querySelector(selector) {
            if (selector === '.sidebar-nav button.is-active') return { dataset: { panel: textPanel.classList.contains('is-active') ? 'text' : 'image' } };
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '[data-lyrics-sync-toggle]') return [toggleA, toggleB];
            if (selector === '.lyrics-sync-status') return statuses;
            return [];
        },
        addEventListener(name, handler) { documentListeners[name] = handler; },
    };
    const panel = { querySelector: selector => selector === '.video-lyrics-preview-card' ? videoCard : null };
    const window = {
        eclyricsEditorPrompter: { getBoundLineupKey: () => boundLineupKey },
        eclyricsVideoLyrics: { openOutputWindow() { outputCalls.push('video'); return videoResult; } },
        eclyricsVideoBackgrounds: { ensureDefault() { defaultBackgroundRequests += 1; return Promise.resolve(); } },
        addEventListener(name, handler) { windowListeners[name] = handler; },
    };
    class BroadcastChannel {
        addEventListener() {}
        postMessage(message) { channelMessages.push(message); }
        close() {}
    }
    const context = {
        document, panel, model, window, BroadcastChannel,
        localStorage: {
            getItem(key) { return localValues.has(key) ? localValues.get(key) : null; },
            setItem(key, value) { localValues.set(key, String(value)); },
        },
        clearTimeout() {},
        setTimeout() { return 1; },
    };
    vm.runInNewContext(syncSetupSource(), context);
    return {
        context, document, model, marker, stage, textPreview, textPanel, videoCard, videoInspector,
        videoPreviewHost, statuses, documentListeners, windowListeners, channelMessages, outputCalls,
        getDefaultBackgroundRequests: () => defaultBackgroundRequests,
        toggles: [toggleA, toggleB],
        setTextPopupOpen(open) { boundLineupKey = open ? 'text-lineup-a' : null; },
        setTextPanelActive(active) {
            if (active) textPanel.classList.add('is-active');
            else textPanel.classList.remove('is-active');
        },
    };
}

test('Text Lyrics remains the default workspace and has an inline, vertically stacked sync preview slot', () => {
    const shell = read('public/index.html');
    const text = read('public/modules/text-lyrics.html');
    const video = read('public/modules/video-lyrics.html');
    const styles = read('public/assets/css/index.css');
    const previewPanel = text.match(/<aside[^>]*id="workspace-preview-panel"[\s\S]*?<\/aside>/)?.[0] || '';

    assert.match(text, /id="panel-text" class="panel is-active"/);
    assert.match(text, /id="workspace"/);
    assert.match(video, /id="panel-video" class="panel video-lyrics-panel"/);
    assert.match(video, /class="video-lyrics-workspace"/);
    assert.doesNotMatch(text.match(/<input[^>]*data-lyrics-sync-toggle[^>]*>/)?.[0] || '', /\bchecked\b/);
    assert.doesNotMatch(video.match(/<input[^>]*data-lyrics-sync-toggle[^>]*>/)?.[0] || '', /\bchecked\b/);
    assert.match(previewPanel, /class="preview-frame[\s\S]*?class="lyrics-sync-video-preview" id="lyrics-sync-video-preview" hidden/);
    assert.ok(previewPanel.indexOf('class="preview-frame') < previewPanel.indexOf('id="lyrics-sync-video-preview"'), 'Video preview slot follows the existing Text preview inside the same right column');
    assert.match(styles, /\.workspace-preview\s*\{[^}]*flex-direction:\s*column/s);
    assert.match(styles, /\.workspace-preview\.is-video-sync-preview\s*>\s*\.preview-frame,[\s\S]*?\.workspace-preview\.is-video-sync-preview\s*>\s*\.lyrics-sync-video-preview\s*\{[^}]*flex:\s*1 1 0/s);
    assert.doesNotMatch(shell + styles, /lyrics-sync-preview-dock/);
    assert.match(text, /id="lyrics-sync-reading-marker"[\s\S]*?aria-valuenow="50"[\s\S]*?hidden/);
    assert.match(styles, /\.lyrics-sync-reading-marker::before\s*\{[^}]*height:\s*2px/s);

    const videoCss = read('public/assets/css/video-lyrics.css');
    const videoActions = video.match(/<div class="video-lyrics-preview-actions">[\s\S]*?<\/div><\/div>/)?.[0] || '';
    for (const id of ['video-lyrics-open', 'video-lyrics-blank', 'video-lyrics-font-trigger', 'video-lyrics-background']) {
        assert.equal((video.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} is defined once in the reusable Video preview card`);
        assert.doesNotMatch(text, new RegExp(`id="${id}"`), `${id} is not duplicated in the Text module`);
    }
    assert.match(videoActions, /id="video-lyrics-open"/);
    assert.match(videoActions, /id="video-lyrics-blank"/);
    assert.match(videoActions, /id="video-lyrics-font-trigger"/);
    assert.match(videoActions, /id="video-lyrics-background"/);
    assert.match(video, /id="video-lyrics-background-name"/);
    assert.match(video, /id="video-lyrics-background-status"[^>]*role="status"/);
    assert.match(videoCss, /\.lyrics-sync-video-preview \.video-lyrics-preview-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,minmax\(0,1fr\)\)/s,
        'the embedded controls share one compact, consistent row');
    assert.match(videoCss, /\.lyrics-sync-video-preview \.video-lyrics-preview-actions\s*>\s*#video-lyrics-open\s*\{[^}]*display:\s*none/s,
        'Open Prompter is hidden only in the embedded Text Sync preview');
    const hiddenOpenSelectors = [...videoCss.matchAll(/([^{}]+#video-lyrics-open[^{}]*)\{([^{}]*)\}/g)]
        .filter(([, , declarations]) => /display:\s*none/.test(declarations))
        .map(([, selector]) => selector.trim());
    assert.ok(hiddenOpenSelectors.every(selector => selector.includes('.lyrics-sync-video-preview')),
        'Open Prompter is hidden only under the embedded Text Sync preview');

    const textStageRule = [...styles.matchAll(/\.preview-viewfinder-16x9\s*\{([^}]*)\}/g)]
        .map(([, rule]) => rule).find(rule => /aspect-ratio:\s*16\s*\/\s*9/.test(rule)) || '';
    const videoStageRule = videoCss.match(/\.video-lyrics-preview-stage\s*\{([^}]*)\}/)?.[1] || '';
    const embeddedVideoStageRule = videoCss.match(/\.lyrics-sync-video-preview \.video-lyrics-preview-stage\s*\{([^}]*)\}/)?.[1] || '';
    assert.match(textStageRule, /aspect-ratio:\s*16\s*\/\s*9/);
    assert.match(videoStageRule, /aspect-ratio:\s*16\s*\/\s*9/);
    assert.match(embeddedVideoStageRule, /width:\s*min\(100cqw,calc\(100cqh\s*\*\s*16\s*\/\s*9\)\)/);
    assert.match(embeddedVideoStageRule, /height:\s*min\(100cqh,calc\(100cqw\s*\*\s*9\s*\/\s*16\)\)/);
});

test('Sync moves only the Video preview card into the slot below Text, then restores its original position', () => {
    const harness = createSyncHarness();
    const { updateSyncPreviewLayout } = harness.context.__syncTest;

    updateSyncPreviewLayout(true);
    assert.equal(harness.videoPreviewHost.children[0], harness.videoCard);
    assert.equal(harness.videoCard.parentNode, harness.videoPreviewHost);
    assert.equal(harness.textPreview.children[0].name, 'text preview frame', 'the existing Text preview remains in place');
    assert.ok(harness.textPreview.classList.contains('is-video-sync-preview'));
    assert.equal(harness.videoPreviewHost.hidden, false);
    assert.equal(harness.marker.hidden, false);

    updateSyncPreviewLayout(false);
    assert.deepEqual(harness.videoInspector.children.map(node => node.name), ['before video card', 'video preview card', 'after video card']);
    assert.equal(harness.videoCard.parentNode, harness.videoInspector);
    assert.ok(!harness.textPreview.classList.contains('is-video-sync-preview'));
    assert.equal(harness.videoPreviewHost.hidden, true);
    assert.equal(harness.marker.hidden, true);
});

test('changing to a different panel restores the Video preview to its own inspector', () => {
    const harness = createSyncHarness();
    const { updateSyncPreviewLayout } = harness.context.__syncTest;
    updateSyncPreviewLayout(true);
    harness.setTextPanelActive(false);
    harness.documentListeners.click({ target: { closest: selector => selector === '.sidebar-nav button[data-panel]' ? {} : null } });

    assert.equal(harness.videoCard.parentNode, harness.videoInspector);
    assert.equal(harness.videoPreviewHost.hidden, true);
});

test('turning Sync on with no Text popup open opens no windows and waits for Send to prompter', () => {
    const harness = createSyncHarness({ textPopupOpen: false });
    harness.toggles[0].checked = true;
    harness.toggles[0].listeners.change();

    assert.equal(harness.model.state.sync.enabled, true);
    assert.deepEqual(harness.outputCalls, []);
    assert.deepEqual(harness.channelMessages, []);
    assert.equal(harness.getDefaultBackgroundRequests(), 1, 'using Sync lazily loads the default video background without opening a popup');
});

test('turning Sync on with Text already open opens only Video and requests the current Text position', () => {
    const harness = createSyncHarness({ textPopupOpen: true });
    harness.toggles[0].checked = true;
    const result = harness.toggles[0].listeners.change();

    assert.equal(result, undefined, 'popup opening stays synchronous in the switch gesture');
    assert.deepEqual(harness.outputCalls, ['video']);
    assert.deepEqual(harness.channelMessages.map(message => message.type), [
        'eclyrics-prompter-marker',
        'eclyrics-prompter-position-request',
    ]);
    assert.equal(harness.model.state.sync.enabled, true);
});

test('the Text preview marker starts at 50%, supports keyboard and pointer adjustment, clamps, persists and broadcasts', () => {
    const harness = createSyncHarness();
    const marker = harness.marker;
    const api = harness.context.__syncTest;

    assert.equal(marker.style.top, '50%');
    assert.equal(marker.attributes['aria-valuenow'], '50');
    marker.listeners.keydown[0]({ key: 'PageDown', preventDefault() {} });
    assert.equal(marker.style.top, '55%');
    assert.equal(marker.attributes['aria-valuetext'], '55 percent from the top');

    marker.listeners.pointerdown[0]({ button: 0, pointerId: 7, clientY: 180, preventDefault() {}, stopPropagation() {} });
    assert.equal(marker.capturedPointerId, 7);
    assert.equal(api.getMarkerRatio(), 0.4);
    marker.listeners.pointermove[0]({ pointerId: 7, clientY: 260, preventDefault() {} });
    assert.equal(api.getMarkerRatio(), 0.8);
    marker.listeners.pointerup[0]();
    marker.listeners.keydown[0]({ key: 'End', preventDefault() {} });
    assert.equal(api.getMarkerRatio(), 0.9, 'keyboard adjustment clamps to the safe lower stage margin');

    const markerMessages = harness.channelMessages.filter(message => message.type === 'eclyrics-prompter-marker');
    assert.deepEqual(markerMessages.map(message => message.ratio), [0.55, 0.4, 0.8, 0.9]);
});

test('Send to prompter opens Text first and opens Video in the same click only while Sync is enabled', () => {
    const editor = read('public/js/features/editor/index.js');
    const source = `let syncFeedback = '', syncFeedbackTimer = 0;\n${extractFunction(videoIndex, 'showSyncFeedback')}\n${extractFunction(editor, 'openVideoPrompterWhenSyncIsEnabled')}\n${extractFunction(editor, 'sendPrompt')}\nwindow.eclyricsVideoLyrics.showSyncFeedback = showSyncFeedback;\nglobalThis.sendForTest = sendPrompt;`;

    function sendHarness(syncEnabled, videoResult = { ok: true }) {
        const calls = [], store = new Map();
        const statuses = [{ textContent: '' }, { textContent: '' }];
        const textarea = { id: 'textarea-1-1', value: 'First\nSecond', closest: () => ({ classList: { add() {} } }) };
        const document = {
            getElementById(id) { return id === textarea.id ? textarea : null; },
            querySelectorAll(selector) { return selector === '.lyrics-sync-status' ? statuses : []; },
        };
        let popup = null;
        const window = {
            location: { origin: 'https://example.org' },
            screen: { availWidth: 1920, availHeight: 1080 },
            eclyricsVideoLyrics: {
                getState: () => ({ sync: { enabled: syncEnabled } }),
                openOutputWindow() { calls.push('video'); return videoResult; },
            },
            open() {
                calls.push('text');
                popup = { closed: false, focus() {}, postMessage() { calls.push('text-update'); } };
                return popup;
            },
        };
        const context = {
            document, window, SESSION_ID: 'session', PROMPTER_WINDOW_NAME: 'text-prompter', PROMPTER_POPUP_W: 1000, PROMPTER_POPUP_H: 700,
            localStorage: { setItem(key, value) { store.set(key, value); } },
            model: { getState: () => ({ sync: { status: 'Sync is on · Send text lyrics to start.' } }) },
            textNum: { '1': [] },
            formatText: value => value,
            clearAllLiveBlocks() {}, syncLiveBlockBadges() {}, updateActiveBlockToolbar() {}, updatePreview() {},
            updatePreviewPrompterDock() {}, postPrompterControl() {}, clearTimeout() {}, setTimeout() { return 1; },
            isPrompterWindowOpen: () => Boolean(popup && !popup.closed),
            prompterPopupWindow: null,
        };
        vm.runInNewContext(source, context);
        return { calls, context, popup: () => popup, statuses };
    }

    const syncOff = sendHarness(false);
    syncOff.context.sendForTest(1, 1);
    assert.deepEqual(syncOff.calls, ['text']);

    const syncOn = sendHarness(true);
    syncOn.context.sendForTest(1, 1);
    assert.deepEqual(syncOn.calls, ['text', 'video']);
    assert.ok(syncOn.popup(), 'the Text popup opened from the same Send interaction');
    syncOn.context.sendForTest(1, 1);
    assert.deepEqual(syncOn.calls, ['text', 'video', 'text-update', 'video'], 'sending another block updates Text and keeps Video in sync');

    const blocked = sendHarness(true, { ok: false, reason: 'popup-blocked' });
    blocked.context.sendForTest(1, 1);
    assert.deepEqual(blocked.calls, ['text', 'video'], 'the existing Text-first Send flow still attempts to open Video');
    assert.ok(blocked.popup(), 'the Text prompter remains open when the Video popup is blocked');
    assert.deepEqual(blocked.statuses.map(status => status.textContent), [
        'Sync is on. Allow pop-ups to open the video prompter.',
        'Sync is on. Allow pop-ups to open the video prompter.',
    ], 'the blocked Video popup is reported in the visible Sync status');
});
