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
    assert.ok(start >= 0 && end > start, 'expected to locate sync setup');
    return `${videoIndex.slice(start, end)}\n globalThis.__syncTest = { updateSyncPreviewLayout, setReadingMarkerRatio, syncToggles, getMarkerRatio: () => readingMarkerRatio, getChannel: () => prompterPositionChannel };`;
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

    append(...children) {
        for (const child of children) {
            if (child.parentNode) {
                const oldSiblings = child.parentNode.children;
                oldSiblings.splice(oldSiblings.indexOf(child), 1);
            }
            child.parentNode = this;
            this.children.push(child);
        }
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
    click() { this.listeners.click?.forEach(handler => handler()); }
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
    const videoCard = new FakeNode('video preview card', [new FakeNode('video preview controls')]);
    const videoAppearance = new FakeNode('video appearance', [new FakeNode('video settings controls')]);
    const videoInspector = new FakeNode('video inspector', [videoCard, videoAppearance]);
    const videoPreviewContent = new FakeNode('video preview content');
    const videoPreviewHost = new FakeNode('video preview host', [videoPreviewContent]);
    const videoStatus = new FakeNode('video status');
    videoStatus.textContent = 'Normal Video status';
    const videoDescription = new FakeNode('video description');
    const syncFeedback = new FakeNode('sync feedback');
    syncFeedback.hidden = true;
    const textWorkspace = new FakeNode('text workspace');
    const textSyncToggle = { checked: false, listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; } };
    const statuses = [{ textContent: 'Off by default' }];
    const documentListeners = {}, windowListeners = {}, channelMessages = [], outputCalls = [];
    let defaultBackgroundRequests = 0;
    const localValues = new Map(storedRatio === null ? [] : [['eclyrics-prompter-reading-marker-ratio', String(storedRatio)]]);
    const textLineup = textPopupOpen ? {
        lineupKey: 'text-lineup-a',
        blocks: [{ blockIndex: 0, title: 'Text block', lines: [{ sourceLineIndex: 0, text: 'First line' }] }],
    } : null;
    const model = {
        state: { sync: { enabled: false, status: 'Off by default', latestPosition: null, lineupKey: null, projection: [] } },
        getState() { return this.state; },
        setTextLineup(source) {
            this.state.sync.lineupKey = source?.lineupKey || null;
            this.state.sync.projection = source?.blocks || [];
        },
        setSyncEnabled(enabled) {
            this.state.sync.enabled = Boolean(enabled);
            this.state.sync.status = enabled ? 'Sync on · Send text lyrics to start.' : 'Sync off.';
        },
    };
    const document = {
        getElementById(id) {
            return ({
                'workspace-preview-panel': textPreview,
                workspace: textWorkspace,
                'lyrics-sync-video-preview': videoPreviewHost,
                'lyrics-sync-feedback': syncFeedback,
                'lyrics-sync-reading-marker': marker,
                'preview-viewfinder-stage': stage,
                'panel-text': textPanel,
                'lyrics-sync-video-content': videoPreviewContent,
                'video-lyrics-description': videoDescription,
                'video-lyrics-status': videoStatus,
            })[id] || null;
        },
        querySelector(selector) {
            if (selector === '.sidebar-nav button.is-active') return { dataset: { panel: textPanel.classList.contains('is-active') ? 'text' : 'image' } };
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '[data-lyrics-sync-toggle]') return [textSyncToggle];
            if (selector === '.lyrics-sync-status') return statuses;
            return [];
        },
        addEventListener(name, handler) { documentListeners[name] = handler; },
    };
    const panel = { querySelector: selector => selector === '.video-lyrics-preview-card' ? videoCard : selector === '.video-lyrics-appearance' ? videoAppearance : null };
    const window = {
        eclyricsEditorPrompter: {
            getBoundLineupKey: () => boundLineupKey,
            getBoundLineup: () => textLineup,
        },
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
        context, document, model, marker, stage, textPreview, textPanel, videoCard, videoAppearance, videoInspector,
        videoPreviewHost, videoPreviewContent, videoStatus, videoDescription, syncFeedback, textWorkspace, statuses, documentListeners, windowListeners, channelMessages, outputCalls,
        getDefaultBackgroundRequests: () => defaultBackgroundRequests,
        toggles: [textSyncToggle],
        setTextPopupOpen(open) { boundLineupKey = open ? 'text-lineup-a' : null; },
        setTextPanelActive(active) {
            if (active) textPanel.classList.add('is-active');
            else textPanel.classList.remove('is-active');
        },
    };
}

test('Text Lyrics remains the default workspace; Sync gives lyric blocks the left column and stacks preview-control rows on the right', () => {
    const text = read('public/modules/text-lyrics.html');
    const video = read('public/modules/video-lyrics.html');
    const styles = read('public/assets/css/index.css');
    const workspaceStart = text.indexOf('<div class="workspace" id="workspace">');
    const textPreviewIndex = text.indexOf('id="workspace-preview-panel"', workspaceStart);
    const videoPreviewIndex = text.indexOf('id="lyrics-sync-video-preview"', workspaceStart);
    const workspaceEnd = text.indexOf('id="lineup-dialog"', videoPreviewIndex);

    assert.match(text, /id="panel-text" class="panel is-active"/);
    assert.match(text, /id="workspace"/);
    assert.match(video, /id="panel-video" class="panel video-lyrics-panel"/);
    assert.match(video, /class="video-lyrics-workspace"/);
    assert.equal((text.match(/data-lyrics-sync-toggle/g) || []).length, 1, 'Text Lyrics has the sole Sync control');
    assert.equal((video.match(/data-lyrics-sync-toggle/g) || []).length, 0, 'Video Lyrics has no Sync control');
    const previewHeading = text.match(/<div class="preview-viewfinder-heading">([\s\S]*?)<div class="preview-viewfinder-slot">/)?.[1] || '';
    assert.match(previewHeading, /Prompter preview[\s\S]*?class="lyrics-sync-control"[\s\S]*?Sync video/,
        'the Sync toggle sits in the Text preview header');
    const toolbarHeading = text.match(/<div class="lyrics-toolbar-heading-row">([\s\S]*?)<div class="tabs-toolbar-row">/)?.[1] || '';
    assert.doesNotMatch(toolbarHeading, /lyrics-sync-control/, 'Sync is not attached to the Text Lyrics title');
    assert.match(text, /id="lyrics-sync-feedback" role="status" aria-live="polite" hidden/,
        'popup feedback is an initially hidden live status separate from the normal Video status');
    assert.doesNotMatch(text.match(/<input[^>]*data-lyrics-sync-toggle[^>]*>/)?.[0] || '', /\bchecked\b/, 'Sync starts off');
    assert.ok(workspaceStart >= 0 && textPreviewIndex > workspaceStart && videoPreviewIndex > textPreviewIndex && workspaceEnd > videoPreviewIndex,
        'the editor and both preview rows remain in the same Text workspace');
    const desktopGrid = styles.match(/\.workspace\.is-video-sync-workspace\s*\{([^}]*)\}/)?.[1] || '';
    const editorPlacement = styles.match(/\.workspace\.is-video-sync-workspace\s*>\s*\.workspace-editor\s*\{([^}]*)\}/)?.[1] || '';
    const textPreviewPlacement = [...styles.matchAll(/\.workspace\.is-video-sync-workspace\s*>\s*\.workspace-preview\s*\{([^}]*)\}/g)]
        .map(([, rule]) => rule).find(rule => /grid-column:/.test(rule)) || '';
    const videoPreviewPlacement = [...styles.matchAll(/\.workspace\.is-video-sync-workspace\s*>\s*\.lyrics-sync-video-preview\s*\{([^}]*)\}/g)]
        .map(([, rule]) => rule).find(rule => /grid-column:/.test(rule)) || '';
    assert.match(desktopGrid, /display:\s*grid/);
    assert.match(desktopGrid, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*2fr\)/,
        'Sync gives the lyric editor one column and the preview workspace two columns');
    assert.match(desktopGrid, /grid-template-rows:\s*minmax\(0,\s*0\.9fr\)\s+minmax\(0,\s*1\.1fr\)/,
        'Text and Video preview rows use the intended 0.9fr/1.1fr height balance');
    assert.match(editorPlacement, /grid-column:\s*1/);
    assert.match(editorPlacement, /grid-row:\s*1\s*\/\s*span\s*2/,
        'the editor spans the height of both preview rows');
    assert.match(textPreviewPlacement, /grid-column:\s*2/);
    assert.match(textPreviewPlacement, /grid-row:\s*1/,
        'Text preview is the top row');
    assert.match(videoPreviewPlacement, /grid-column:\s*2/);
    assert.match(videoPreviewPlacement, /grid-row:\s*2/,
        'Video preview is the bottom row');
    assert.match(styles, /@media\s*\(max-width:\s*1300px\)[\s\S]*?\.workspace\.is-video-sync-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*grid-template-rows:\s*auto\s+minmax\(360px,\s*1fr\)\s+minmax\(420px,\s*1\.1fr\)/s,
        'medium screens move the editor above two stacked preview rows');
    assert.match(styles, /@media\s*\(max-width:\s*960px\)[\s\S]*?\.workspace\.is-video-sync-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*grid-template-rows:\s*auto/s,
        'narrow screens use natural single-column stacking');
    assert.doesNotMatch(styles, /is-video-sync-preview-closed/, 'Sync has no separate closed-preview layout state');
    assert.match(text, /id="lyrics-sync-reading-marker"[\s\S]*?aria-valuenow="50"[\s\S]*?hidden/);
    assert.match(styles, /\.lyrics-sync-reading-marker::before\s*\{[^}]*height:\s*2px/s);
    const textStageSlotIndex = text.indexOf('class="preview-viewfinder-slot"', textPreviewIndex);
    const textControlsIndex = text.indexOf('class="preview-prompter-dock"', textPreviewIndex);
    assert.ok(textStageSlotIndex >= 0 && textControlsIndex > textStageSlotIndex,
        'Text controls follow the preview stage in document order');
    const textPreviewRow = styles.match(/\.workspace\.is-video-sync-workspace\s*>\s*\.workspace-preview\s*>\s*\.preview-frame\s*\{([^}]*)\}/)?.[1] || '';
    const textControlsPlacement = styles.match(/\.workspace\.is-video-sync-workspace\s*>\s*\.workspace-preview\s*\.preview-prompter-dock\s*\{([^}]*)\}/)?.[1] || '';
    assert.match(textPreviewRow, /grid-template-columns:\s*minmax\(0,\s*1\.15fr\)\s+minmax\(17rem,\s*0\.85fr\)/,
        'Text preview stage and controls share one horizontal row');
    assert.match(textControlsPlacement, /grid-column:\s*2/);
    assert.match(textControlsPlacement, /grid-row:\s*2/,
        'Text controls occupy the right side of the Text preview row');
    assert.match(styles, /\.workspace\.is-video-sync-workspace\s*>\s*\.workspace-preview \.preview-prompter-dock\s*>\s*:first-child\s*\{[^}]*margin-block-start:\s*auto/s,
        'Text controls center vertically beside the preview');
    assert.match(styles, /\.workspace\.is-video-sync-workspace\s*>\s*\.workspace-preview \.preview-prompter-dock\s*>\s*:last-child\s*\{[^}]*margin-block-end:\s*auto/s,
        'Text controls center vertically without accumulating empty space at the bottom');
    const sendActionRule = styles.match(/\.workspace\.is-video-sync-workspace\s*>\s*\.workspace-preview \.preview-send-btn\s*\{([^}]*)\}/)?.[1] || '';
    const sendLabelRule = styles.match(/\.workspace\.is-video-sync-workspace\s*>\s*\.workspace-preview \.preview-send-btn-label\s*\{([^}]*)\}/)?.[1] || '';
    assert.match(sendActionRule, /flex:\s*0 0 100%/);
    assert.match(sendActionRule, /width:\s*100%/);
    assert.match(sendActionRule, /min-width:\s*0/);
    assert.match(sendActionRule, /height:\s*2\.55rem/);
    assert.match(sendLabelRule, /display:\s*inline/,
        'Sync keeps the full Send to Prompter label visible despite narrow-dock icon-only rules');
    const sendButtonMarkup = text.match(/<button[^>]*id="send-prompter-btn"[^>]*>([\s\S]*?)<\/button>/)?.[0] || '';
    assert.match(sendButtonMarkup, /preview-send-btn-label">Send to prompter/);
    assert.match(styles, /\.preview-send-btn:disabled\s*\{[^}]*opacity:\s*0\.55[^}]*cursor:\s*not-allowed/s,
        'the visible Send button retains its disabled treatment when there are no lyrics');
    assert.match(styles, /\.workspace\.is-video-sync-workspace \.textareas-row\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
        'Text blocks use two columns only in Sync mode');
    assert.match(styles, /\.textareas-row\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
        'standalone Text Lyrics keeps its normal three-column block layout');

    const videoCss = read('public/assets/css/video-lyrics.css');
    assert.match(videoCss, /\.workspace\.is-video-sync-workspace \.lyrics-sync-video-content\s*\{[^}]*align-content:\s*center/s,
        'the Video preview and controls group is balanced vertically within its row');
    assert.match(videoCss, /\.workspace\.is-video-sync-workspace \.lyrics-sync-video-content\s*>\s*\.video-lyrics-appearance\s*\{[^}]*align-self:\s*start/s,
        'Video appearance controls stay at their natural height');
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
    const inspector = video.match(/<aside class="video-lyrics-inspector"[\s\S]*?<\/aside>/)?.[0] || '';
    assert.ok(inspector.indexOf('class="video-lyrics-preview-card"') < inspector.indexOf('class="video-lyrics-appearance"'),
        'the preview card and full appearance inspector remain siblings in the standalone Video inspector');
    assert.doesNotMatch(inspector, /video-lyrics-preview-close/, 'the embedded preview is not independently closable');
    for (const id of ['video-lyrics-weight', 'video-lyrics-size', 'video-lyrics-color', 'video-lyrics-hex', 'video-lyrics-fade', 'video-lyrics-fade-value', 'video-lyrics-y', 'video-lyrics-playback-rate', 'video-lyrics-playback-rate-value', 'video-lyrics-dimming', 'video-lyrics-status']) {
        assert.equal((inspector.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} remains in the movable Video appearance inspector`);
    }
    assert.match(inspector, /id="video-lyrics-fade"[^>]*step="100"/,
        'the same 100 ms fade control remains in the inspector that moves into Text Sync');
    assert.match(inspector, /id="video-lyrics-fade-value"[^>]*type="number"[^>]*step="100"/,
        'the editable fade value shares the slider stops in the inspector that moves into Text Sync');
    assert.match(inspector, /id="video-lyrics-y"[^>]*type="number"[^>]*max="1080"[^>]*step="10"/,
        'the vertical pixel field remains available in synced Text Lyrics');
    assert.match(videoCss, /\.video-lyrics-appearance label\s*\{[^}]*display:flex/s,
        'appearance labels retain their layout after the inspector moves outside the Video panel');
    assert.match(videoCss, /\.video-lyrics-appearance input,\.video-lyrics-appearance select\s*\{[^}]*width:100%/s,
        'appearance fields retain their sizing after reparenting');
    assert.match(videoCss, /\.video-lyrics-appearance input\[type=range\]/,
        'the dimming range keeps its appearance-control styles after reparenting');
    assert.match(text, /id="lyrics-sync-video-content"/);
    assert.doesNotMatch(text, /lyrics-sync-video-show|Show Video preview/, 'Sync itself shows the Video preview without a separate button');
    assert.doesNotMatch(video, /id="video-lyrics-preview-close"/, 'the preview has no close action separate from Sync');
    assert.match(videoCss, /\.lyrics-sync-video-preview \.video-lyrics-preview-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,minmax\(0,1fr\)\)/s,
        'the embedded controls share one compact, consistent row');
    assert.match(videoCss, /\.lyrics-sync-video-preview \.video-lyrics-action\s*\{[^}]*height:\s*2\.55rem[^}]*border-radius:\s*\.7rem/s,
        'embedded Video controls match the height and corner treatment of Text controls');
    const videoPreviewContentRule = videoCss.match(/\.workspace\.is-video-sync-workspace \.lyrics-sync-video-content\s*\{([^}]*)\}/)?.[1] || '';
    const videoStagePlacement = videoCss.match(/\.workspace\.is-video-sync-workspace \.video-lyrics-preview-stage-slot\s*\{([^}]*)\}/)?.[1] || '';
    const videoControlsPlacement = videoCss.match(/\.workspace\.is-video-sync-workspace \.video-lyrics-preview-actions\s*\{([^}]*)\}/)?.[1] || '';
    assert.match(videoPreviewContentRule, /display:\s*grid/);
    assert.match(videoPreviewContentRule, /grid-template-columns\s*:\s*minmax\(0\s*,\s*1\.15fr\)\s+minmax\(17rem\s*,\s*\.85fr\)/,
        'Video preview and its controls use the same horizontal composition as Text');
    assert.match(videoStagePlacement, /grid-column:\s*1/);
    assert.match(videoStagePlacement, /grid-row:\s*2\s*\/\s*span\s*2/,
        'Video stage occupies the left side of its row');
    assert.match(videoControlsPlacement, /grid-column:\s*2/);
    assert.match(videoControlsPlacement, /grid-row:\s*2/,
        'Video actions occupy the right side of its row');
    assert.match(videoCss, /@media\s*\(max-width:\s*960px\)[\s\S]*?\.workspace\.is-video-sync-workspace \.lyrics-sync-video-content\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column/s,
        'Video preview and its controls stack vertically on narrow screens');
    const embeddedCardRule = videoCss.match(/\.lyrics-sync-video-content > \.video-lyrics-preview-card\s*\{([^}]*)\}/)?.[1] || '';
    assert.match(embeddedCardRule, /display:\s*contents/,
        'the Video preview card contents participate directly in the shared preview-control grid');
    assert.match(videoCss, /\.workspace\.is-video-sync-workspace > \.lyrics-sync-video-preview \.video-lyrics-appearance\s*\{[^}]*width:100%;[^}]*box-sizing:border-box/s,
        'the moved appearance inspector keeps its column sizing');
    assert.doesNotMatch(videoCss, /lyrics-sync-video-show|video-lyrics-preview-close/, 'styles contain no separate Show or close affordance');
    assert.match(videoCss, /\.workspace\.is-video-sync-workspace > \.lyrics-sync-video-preview \.video-lyrics-preview-actions\s*>\s*#video-lyrics-open\s*\{[^}]*display:none/s,
        'Open Prompter is hidden only in the embedded Text Sync preview');
    const hiddenOpenSelectors = [...videoCss.matchAll(/([^{}]+#video-lyrics-open[^{}]*)\{([^{}]*)\}/g)]
        .filter(([, , declarations]) => /display:\s*none/.test(declarations))
        .map(([, selector]) => selector.trim());
    assert.ok(hiddenOpenSelectors.every(selector => selector.includes('.workspace.is-video-sync-workspace') && selector.includes('.lyrics-sync-video-preview')),
        'Open Prompter is hidden only under the embedded Text Sync preview');
    assert.doesNotMatch(styles, /is-video-sync-preview-closed|lyrics-sync-video-show|video-lyrics-preview-close/,
        'workspace CSS has no alternate Show or close states');

    const textStageRule = [...styles.matchAll(/\.preview-viewfinder-16x9\s*\{([^}]*)\}/g)]
        .map(([, rule]) => rule).find(rule => /aspect-ratio:\s*16\s*\/\s*9/.test(rule)) || '';
    const videoStageRule = videoCss.match(/\.video-lyrics-preview-stage\s*\{([^}]*)\}/)?.[1] || '';
    const syncStageSlotsRule = styles.match(/\.workspace\.is-video-sync-workspace > \.workspace-preview \.preview-viewfinder-slot,[\s\S]*?\.workspace\.is-video-sync-workspace > \.lyrics-sync-video-preview \.video-lyrics-preview-stage-slot\s*\{([^}]*)\}/)?.[1] || '';
    const syncStagesRule = styles.match(/\.workspace\.is-video-sync-workspace > \.workspace-preview \.preview-viewfinder-slot \.preview-viewfinder-16x9,[\s\S]*?\.workspace\.is-video-sync-workspace > \.lyrics-sync-video-preview \.video-lyrics-preview-stage\s*\{([^}]*)\}/)?.[1] || '';
    assert.match(textStageRule, /aspect-ratio:\s*16\s*\/\s*9/);
    assert.match(videoStageRule, /aspect-ratio:\s*16\s*\/\s*9/);
    assert.match(syncStageSlotsRule, /flex:\s*0 0 auto/);
    assert.match(syncStageSlotsRule, /width:\s*100%/);
    assert.match(syncStageSlotsRule, /aspect-ratio:\s*16\s*\/\s*9/);
    assert.match(syncStagesRule, /width:\s*100%/);
    assert.match(syncStagesRule, /height:\s*auto/);
    assert.match(syncStagesRule, /aspect-ratio:\s*16\s*\/\s*9/);
});

test('Sync automatically shows the Video preview and inspector, then restores standalone placement when disabled', () => {
    const harness = createSyncHarness({ textPopupOpen: true });
    const { updateSyncPreviewLayout } = harness.context.__syncTest;

    harness.toggles[0].checked = true;
    harness.toggles[0].listeners.change();
    updateSyncPreviewLayout(true);
    assert.equal(harness.model.state.sync.enabled, true);
    assert.deepEqual(harness.outputCalls, ['video'], 'the active Video output window is open while the preview is embedded');
    assert.equal(harness.videoCard.parentNode, harness.videoPreviewContent, `video card parent after layout: ${harness.videoCard.parentNode?.name}; host hidden=${harness.videoPreviewHost.hidden}`);
    assert.equal(harness.videoAppearance.parentNode, harness.videoPreviewContent, `appearance parent after layout: ${harness.videoAppearance.parentNode?.name}; content children=${harness.videoPreviewContent.children.map(node => node.name)}`);
    assert.deepEqual(harness.videoPreviewContent.children, [harness.videoCard, harness.videoAppearance], 'the same preview and settings nodes move into the Text workspace');
    assert.equal(harness.textPreview.children[0].name, 'text preview frame', 'the existing Text preview remains in place');
    assert.ok(harness.textWorkspace.classList.contains('is-video-sync-workspace'));
    assert.ok(harness.textPreview.classList.contains('is-video-sync-preview'));
    assert.equal(harness.videoPreviewHost.hidden, false);
    assert.equal(harness.videoPreviewContent.hidden, false);
    assert.equal(harness.marker.hidden, false);
    assert.equal(harness.videoStatus.textContent, 'Normal Video status', 'sync layout does not change the normal Video status');

    harness.toggles[0].checked = false;
    harness.toggles[0].listeners.change();
    updateSyncPreviewLayout(false);
    assert.deepEqual(harness.videoInspector.children, [harness.videoCard, harness.videoAppearance]);
    assert.equal(harness.videoCard.parentNode, harness.videoInspector, 'the preview card returns to its original inspector');
    assert.equal(harness.videoAppearance.parentNode, harness.videoInspector, 'the appearance node returns to its original inspector');
    assert.ok(!harness.textWorkspace.classList.contains('is-video-sync-workspace'));
    assert.ok(!harness.textPreview.classList.contains('is-video-sync-preview'));
    assert.equal(harness.videoPreviewHost.hidden, true);
    assert.equal(harness.videoPreviewContent.hidden, false, 'the embedded content returns visible inside its hidden host');
    assert.equal(harness.marker.hidden, true);
    assert.equal(harness.videoStatus.textContent, 'Normal Video status', 'standalone status remains untouched after restoring Video');
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

test('turning Sync off clears popup-block feedback text and restores its hidden state', () => {
    const harness = createSyncHarness({ textPopupOpen: true, videoResult: { ok: false, reason: 'popup-blocked' } });
    harness.toggles[0].checked = true;
    harness.toggles[0].listeners.change();

    assert.match(harness.syncFeedback.textContent, /Allow pop-ups/);
    assert.equal(harness.syncFeedback.hidden, false, 'a blocked Video popup exposes feedback');

    harness.toggles[0].checked = false;
    harness.toggles[0].listeners.change();
    assert.equal(harness.syncFeedback.textContent, '', 'turning Sync off clears stale feedback text');
    assert.equal(harness.syncFeedback.hidden, true, 'turning Sync off hides the feedback element');
    assert.equal(harness.videoStatus.textContent, 'Normal Video status', 'popup feedback does not replace the ordinary Video status');
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
    const source = `let syncFeedbackTimer = 0;\n${extractFunction(videoIndex, 'showSyncFeedback')}\n${extractFunction(editor, 'openVideoPrompterWhenSyncIsEnabled')}\n${extractFunction(editor, 'sendPrompt')}\nwindow.eclyricsVideoLyrics.showSyncFeedback = showSyncFeedback;\nglobalThis.sendForTest = sendPrompt;`;

    function sendHarness(syncEnabled, videoResult = { ok: true }) {
        const calls = [], projectionCalls = [], store = new Map();
        const statuses = [{ textContent: '' }, { textContent: '' }];
        const syncFeedback = { textContent: '', hidden: true };
        const textarea = { id: 'textarea-1-1', value: 'First\nSecond', closest: () => ({ classList: { add() {} } }) };
        const document = {
            getElementById(id) { return id === textarea.id ? textarea : id === 'lyrics-sync-feedback' ? syncFeedback : null; },
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
            publishTextLineupProjection(tabId) { projectionCalls.push(tabId); },
            isPrompterWindowOpen: () => Boolean(popup && !popup.closed),
            prompterPopupWindow: null,
        };
        vm.runInNewContext(source, context);
        return { calls, context, popup: () => popup, statuses, syncFeedback, projectionCalls };
    }

    const syncOff = sendHarness(false);
    syncOff.context.sendForTest(1, 1);
    assert.deepEqual(syncOff.calls, ['text']);

    const syncOn = sendHarness(true);
    syncOn.context.sendForTest(1, 1);
    assert.deepEqual(syncOn.calls, ['text', 'video']);
    assert.deepEqual(syncOn.projectionCalls, [1, 1], 'Send publishes the active Text blocks before and after opening the prompter');
    assert.ok(syncOn.popup(), 'the Text popup opened from the same Send interaction');
    syncOn.context.sendForTest(1, 1);
    assert.deepEqual(syncOn.calls, ['text', 'video', 'text-update', 'video'], 'sending another block updates Text and keeps Video in sync');
    assert.deepEqual(syncOn.projectionCalls, [1, 1, 1], 'subsequent Text sends refresh the Video lineup projection');

    const blocked = sendHarness(true, { ok: false, reason: 'popup-blocked' });
    blocked.context.sendForTest(1, 1);
    assert.deepEqual(blocked.calls, ['text', 'video'], 'the existing Text-first Send flow still attempts to open Video');
    assert.ok(blocked.popup(), 'the Text prompter remains open when the Video popup is blocked');
    assert.equal(blocked.syncFeedback.textContent, 'Sync is on. Allow pop-ups to open the video prompter.');
    assert.equal(blocked.syncFeedback.hidden, false, 'the blocked Video popup uses the visible Sync feedback element');
    assert.deepEqual(blocked.statuses.map(status => status.textContent), ['', ''], 'popup feedback does not replace normal status text');
});
