const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const shortcuts = require('../public/js/features/prompter/prompter-shortcuts.js');
const digitPresets = Array.from({ length: 9 }, (_, index) => [`Digit${index + 1}`, 1.5 + index * 0.5])
    .concat([['Digit0', 6.0]]);

function extractFunction(source, functionName) {
    const start = source.indexOf(`function ${functionName}(`);
    assert.notEqual(start, -1, `expected ${functionName} declaration`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    assert.fail(`expected ${functionName} closing brace`);
}

function extractListenerBody(source, marker, endMarker) {
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `expected listener ${marker}`);
    const bodyStart = source.indexOf('{', start);
    const end = source.indexOf(endMarker, bodyStart);
    assert.ok(end > bodyStart, `expected listener terminator ${endMarker}`);
    return source.slice(bodyStart + 1, end);
}

function loadBrowserShortcuts() {
    const createElement = tagName => ({ tagName, children: [], appendChild(child) { this.children.push(child); return child; }, replaceChildren(...children) { this.children = children; } });
    const document = {
        getElementById: () => ({ hidden: true }),
        createElement,
        createTextNode: textContent => ({ textContent: String(textContent) }),
    };
    const context = { module: { exports: {} }, document, Node: { ELEMENT_NODE: 1 } };
    context.globalThis = context;
    vm.runInNewContext(read('public/js/features/prompter/prompter-shortcuts.js'), context);
    return context.module.exports;
}

function createTextWorkspaceHandler(shortcutApi, panelActive = true) {
    const source = read('public/js/features/editor/index.js');
    const document = {
        getElementById: id => id === 'panel-text' ? { classList: { contains: () => panelActive } } : null,
    };
    const sentKeys = [];
    const handler = new Function('document', 'shortcuts', 'sentKeys', 'isPrompterWindowOpen', `
        let adjacentBlockPressMatcher = { reset() {} };
        function getPrompterShortcutsApi() { return shortcuts; }
        function postPrompterKey(code, key) { sentKeys.push({ code, key }); }
        function postPrompterControl() {}
        function goToAdjacentBlockAndSend() {}
        const PREVIEW_KEYBOARD_SCROLL_PX = 100;
        ${extractFunction(source, 'handleGlobalPrompterShortcut')}
        return handleGlobalPrompterShortcut;
    `)(document, shortcutApi, sentKeys, () => true);
    return { handler, sentKeys };
}

function createTextPopupHandler(shortcutApi, initialPlaying) {
    const source = read('public/js/features/prompter/prompter.js');
    return new Function('shortcuts', 'initialPlaying', `
        let scrollSpeed = 0.5;
        let scrollingNow = initialPlaying;
        let pauseCalls = 0, playCalls = 0, playPauseCalls = 0;
        const persistedSpeeds = [], broadcasts = [];
        const window = { EclyricsPrompterShortcuts: shortcuts };
        const TOP_SPEED = 6.5, SPEED_CONTROL = 0.1;
        function persistScrollSpeed() { persistedSpeeds.push(scrollSpeed); }
        function broadcastPrompterState() { broadcasts.push({ speed: scrollSpeed, playing: scrollingNow }); }
        function pauseScroll() { pauseCalls += 1; scrollingNow = false; }
        function playScroll() { playCalls += 1; scrollingNow = true; }
        function playPauseScroll() { playPauseCalls += 1; scrollingNow = !scrollingNow; }
        ${extractFunction(source, 'handleMainKeys')}
        return {
            handle: handleMainKeys,
            state: () => ({ speed: scrollSpeed, playing: scrollingNow, pauseCalls, playCalls, playPauseCalls, persistedSpeeds, broadcasts }),
        };
    `)(shortcutApi, initialPlaying);
}

function createImageWorkspaceHandler(shortcutApi, { paused = true, panelActive = true } = {}) {
    const source = read('public/js/features/image-lyrics/index.js');
    const body = extractListenerBody(source, "document.addEventListener('keydown', (event) => {", '\n}, true);');
    return new Function('shortcuts', 'initialPaused', 'panelActive', 'interactive', `
        let speed = 0.5, paused = initialPaused, pendingImageArrow = '', pendingImageArrowAt = 0;
        const calls = [], controls = { speed: { value: '' } }, speedValue = { value: '' };
        const panel = { classList: { contains: () => panelActive } }, shortcutsDialog = { hidden: true };
        const window = { EclyricsPrompterShortcuts: shortcuts };
        function resetImageArrow() { pendingImageArrow = ''; pendingImageArrowAt = 0; }
        function control(action, values) { calls.push({ action, values }); }
        function $() { return speedValue; }
        function handle(event) { ${body} }
        return { handle, state: () => ({ speed, paused, calls, controls, speedValue }) };
    `)(shortcutApi, paused, panelActive);
}

function createImagePopupHandler(shortcutApi, initialPaused) {
    const source = read('public/js/features/image-prompter/prompter.js');
    const speedSetter = extractFunction(source, 'setSpeed');
    const body = extractListenerBody(source, "window.addEventListener('keydown', (event) => {", '\n    });');
    return new Function('shortcuts', 'initialPaused', `
        let speed = 0.5, paused = initialPaused, scrollTop = 0, currentIndex = 0, animationFrame = 0;
        let pauseCalls = 0, playPauseCalls = 0;
        const notifications = [];
        const TOP_SPEED = 6.5, MIN_SPEED = 0.1, MANUAL_SCROLL_PX = 100;
        const window = { EclyricsPrompterShortcuts: shortcuts };
        function notifyState() { notifications.push({ speed, paused }); }
        function setPaused(nextPaused) { pauseCalls += 1; paused = Boolean(nextPaused); }
        function resetNavigationArrow() {}
        function getFullscreenElement() { return null; }
        function exitFullscreen() {}
        function cancelAnimationFrame() {}
        function requestAnimationFrame() { return 1; }
        function setCurrentIndex() {}
        function renderScroll() {}
        function nudgeSpeed(delta) { setSpeed(speed + delta); if (delta > 0 && paused) setPaused(false); }
        function playPause() { playPauseCalls += 1; setPaused(!paused); }
        ${speedSetter}
        function handle(event) {
            ${body.replace("setPaused(!paused);", "playPause();")}
        }
        return { handle, state: () => ({ speed, paused, pauseCalls, playPauseCalls, notifications }) };
    `)(shortcutApi, initialPaused);
}

function keyboardEvent(code, overrides = {}) {
    let prevented = false;
    return {
        code,
        key: code.replace(/^Digit/, ''),
        repeat: false,
        target: { nodeType: 1, tagName: 'BODY', isContentEditable: false, closest: () => null },
        preventDefault() { prevented = true; },
        stopImmediatePropagation() {},
        wasPrevented: () => prevented,
        ...overrides,
    };
}

test('shared number-row speed presets map all ten digits and reject numpad codes', () => {
    for (const [code, speed] of digitPresets) assert.equal(shortcuts.getScrollSpeedPreset(code), speed, `${code} maps to ${speed.toFixed(1)}`);
    assert.equal(shortcuts.getScrollSpeedPreset('Numpad0'), null);
    assert.equal(shortcuts.getScrollSpeedPreset('NumpadAdd'), null);
});

test('Text workspace forwards number presets and Text popup applies speed without changing play state', () => {
    const shortcutApi = loadBrowserShortcuts();
    for (const initiallyPlaying of [false, true]) {
        for (const [code, expectedSpeed] of digitPresets) {
            const workspace = createTextWorkspaceHandler(shortcutApi);
            const workspaceEvent = keyboardEvent(code);
            workspace.handler(workspaceEvent);
            assert.equal(workspaceEvent.wasPrevented(), true);
            assert.deepEqual(workspace.sentKeys, [{ code, key: code.slice(-1) }], `${code} is forwarded to the open Text popup`);

            const popup = createTextPopupHandler(shortcutApi, initiallyPlaying);
            popup.handle(keyboardEvent(code));
            const state = popup.state();
            assert.equal(state.speed, expectedSpeed, `${code} sets the Text popup speed`);
            assert.equal(state.playing, initiallyPlaying, `${code} preserves Text popup play state`);
            assert.equal(state.pauseCalls, 0, `${code} does not pause scrolling`);
            assert.equal(state.playPauseCalls, 0, `${code} does not toggle play/pause`);
            assert.deepEqual(state.persistedSpeeds, [expectedSpeed]);
            assert.deepEqual(state.broadcasts, [{ speed: expectedSpeed, playing: initiallyPlaying }]);
        }
    }

    const blocked = createTextWorkspaceHandler(shortcutApi);
    const repeatedDigit = keyboardEvent('Digit0', { repeat: true });
    blocked.handler(repeatedDigit);
    assert.deepEqual(blocked.sentKeys, [], 'repeated number keys stay ignored by the Text shortcut guard');
    assert.equal(repeatedDigit.wasPrevented(), false);
    const editable = keyboardEvent('Digit0', { target: { nodeType: 1, tagName: 'INPUT', getAttribute: () => 'text', closest: () => null } });
    blocked.handler(editable);
    assert.deepEqual(blocked.sentKeys, [], 'editable Text fields keep their shortcut guard');
    const inactiveWorkspace = createTextWorkspaceHandler(shortcutApi, false);
    inactiveWorkspace.handler(keyboardEvent('Digit0'));
    assert.deepEqual(inactiveWorkspace.sentKeys, [], 'the Text workspace shortcut stays scoped to its active panel');
});

test('Text popup keeps Space play/pause and Numpad speed nudges', () => {
    const popup = createTextPopupHandler(shortcuts, false);
    popup.handle(keyboardEvent('NumpadAdd'));
    assert.equal(popup.state().speed, 0.6, 'Numpad + still nudges speed by 0.1');
    assert.equal(popup.state().playing, true, 'Numpad + retains its existing start-if-paused behavior');
    popup.handle(keyboardEvent('NumpadSubtract'));
    assert.equal(popup.state().speed, 0.5, 'Numpad − still nudges speed by 0.1');
    assert.equal(popup.state().playing, true);
    popup.handle(keyboardEvent('Space'));
    assert.equal(popup.state().playing, false, 'Space remains the play/pause toggle');
    assert.equal(popup.state().playPauseCalls, 1);
});

test('Image workspace sends speed controls for digits while preserving popup state and guards', () => {
    const shortcutApi = loadBrowserShortcuts();
    for (const initiallyPaused of [false, true]) {
        for (const [code, expectedSpeed] of digitPresets) {
            const workspace = createImageWorkspaceHandler(shortcutApi, { paused: initiallyPaused });
            const event = keyboardEvent(code);
            workspace.handle(event);
            const state = workspace.state();
            assert.equal(event.wasPrevented(), true, `${code} is handled by Image Lyrics`);
            assert.equal(state.speed, expectedSpeed);
            assert.equal(state.controls.speed.value, String(expectedSpeed), 'the Image speed slider follows the preset');
            assert.equal(state.speedValue.value, expectedSpeed.toFixed(1), 'the Image speed readout follows the preset');
            assert.equal(state.paused, initiallyPaused, 'the workspace speed preset does not mutate play state');
            assert.deepEqual(state.calls, [{ action: 'speed', values: { speed: expectedSpeed } }], `${code} dispatches speed rather than pause`);

            const popup = createImagePopupHandler(shortcutApi, initiallyPaused);
            popup.handle(keyboardEvent(code));
            const popupState = popup.state();
            assert.equal(popupState.speed, expectedSpeed, `${code} applies in the Image popup`);
            assert.equal(popupState.paused, initiallyPaused, `${code} preserves Image popup pause state`);
            assert.equal(popupState.pauseCalls, 0, `${code} does not call pause in the Image popup`);
            assert.equal(popupState.playPauseCalls, 0, `${code} does not toggle playback in the Image popup`);
        }
    }

    for (const overrides of [
        { repeat: true },
        { ctrlKey: true },
        { metaKey: true },
        { altKey: true },
        { defaultPrevented: true },
    ]) {
        const workspace = createImageWorkspaceHandler(shortcutApi);
        const event = keyboardEvent('Digit0', overrides);
        workspace.handle(event);
        assert.deepEqual(workspace.state().calls, [], `Image workspace preserves key guard ${JSON.stringify(overrides)}`);
    }
    const interactive = createImageWorkspaceHandler(shortcutApi);
    interactive.handle(keyboardEvent('Digit0', { target: { closest: () => ({}) } }));
    assert.deepEqual(interactive.state().calls, [], 'interactive controls keep their Image shortcut guard');
    const inactive = createImageWorkspaceHandler(shortcutApi, { panelActive: false });
    inactive.handle(keyboardEvent('Digit0'));
    assert.deepEqual(inactive.state().calls, [], 'the Image shortcut stays scoped to its active panel');

    const numpad = createImageWorkspaceHandler(shortcutApi);
    numpad.handle(keyboardEvent('NumpadAdd'));
    numpad.handle(keyboardEvent('NumpadSubtract'));
    assert.deepEqual(numpad.state().calls, [
        { action: 'speedNudge', values: { delta: 0.1 } },
        { action: 'speedNudge', values: { delta: -0.1 } },
    ], 'numpad keys retain the existing incremental speed control');
});

test('Image popup still toggles with Space and keeps numpad speed nudges', () => {
    const shortcutApi = loadBrowserShortcuts();
    const popup = createImagePopupHandler(shortcutApi, true);
    popup.handle(keyboardEvent('Space'));
    assert.equal(popup.state().paused, false, 'Space still resumes Image scrolling');
    assert.equal(popup.state().playPauseCalls, 1);
    popup.handle(keyboardEvent('NumpadAdd'));
    assert.equal(popup.state().speed, 0.6, 'Numpad + remains a 0.1 speed nudge');
});

test('shortcut help describes presets, Numpad remains a nudge, and changed entry points share a cache token', () => {
    const shortcutApi = loadBrowserShortcuts();
    const tbody = { children: [], replaceChildren(...children) { this.children = children; }, appendChild(child) { this.children.push(child); } };
    shortcutApi.renderPrompterHelpTable(tbody);
    const speedRow = tbody.children.find(row => row.children[0].textContent === '1–9, 0');
    assert.ok(speedRow, 'Text shortcut help displays the number-row preset keys');
    assert.equal(speedRow.children[1].textContent,
        'Scroll speed — 1–9 set 1.5–5.5 in 0.5 steps; 0 sets 6.0. Presets keep the current play/pause state.');

    const imageHelp = read('public/modules/image-lyrics.html');
    assert.match(imageHelp, /<dt>Scroll speed<\/dt><dd><kbd>1<\/kbd>–<kbd>9<\/kbd> set 1\.5–5\.5 in 0\.5 steps; <kbd>0<\/kbd> sets 6\.0\. Presets keep the current play\/pause state\.<\/dd>/);
    assert.match(read('public/js/features/editor/workspace-tour.js'), /1–9: 1\.5–5\.5 by 0\.5; 0: 6\.0; playback state unchanged/);

    const token = '20261114-number-speed-presets';
    const bootstrapToken = '20261122-marker-hit-oscillation';
    assert.match(read('public/index.html'), new RegExp(`js/core/app-bootstrap\\.js\\?v=${bootstrapToken}`));
    assert.match(read('public/prompter.html'), new RegExp(`js/features/prompter/prompter-shortcuts\\.js\\?v=${token}`));
    assert.match(read('public/prompter.html'), new RegExp(`js/features/prompter/prompter\\.js\\?v=${token}`));
    assert.match(read('public/image-prompter.html'), new RegExp(`js/features/prompter/prompter-shortcuts\\.js\\?v=${token}`));
    assert.match(read('public/image-prompter.html'), new RegExp(`js/features/image-prompter/prompter\\.js\\?v=${token}`));
    const bootstrap = read('public/js/core/app-bootstrap.js');
    for (const entry of [
        `js/features/prompter/prompter-shortcuts.js?v=${token}`,
        `js/features/editor/workspace-tour.js?v=${token}`,
        `js/features/image-lyrics/index.js?v=${token}`,
        `file: 'image-lyrics.html', panelId: 'panel-image', cacheVersion: '${token}'`,
    ]) assert.ok(bootstrap.includes(entry), `bootstrap contains ${entry}`);
});
