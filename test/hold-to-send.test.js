const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function createHoldHarness() {
    const source = fs.readFileSync(path.join(repoRoot, 'public/js/features/editor/index.js'), 'utf8');
    const start = source.indexOf('function sendTextareaToPrompter(textarea)');
    const end = source.indexOf('\nfunction initShell()', start);
    assert.ok(start >= 0 && end > start, 'expected the text block hold-to-send implementation');

    let now = 0;
    let nextTimerId = 1;
    let nextAnimationFrameId = 1;
    const timers = new Map();
    const animationFrames = new Map();
    const listeners = new Map();
    const containerListeners = new Map();
    const windowListeners = new Map();
    const sentPrompts = [];
    const indicatorClasses = new Set();
    const indicatorStyles = new Map();
    let indicator = null;
    let elementAtPointer = null;

    const addListener = (map, type, listener, options) => {
        if (!map.has(type)) map.set(type, []);
        map.get(type).push({ listener, options });
    };
    const dispatch = (map, type, event = {}) => {
        for (const { listener } of map.get(type) || []) listener(event);
    };

    const body = {
        querySelector: (selector) => (selector === '.textarea-send-hold-indicator' ? indicator : null),
        appendChild: (node) => {
            indicator = node;
        },
    };
    const cell = { classList: { contains: () => false } };
    const textarea = {
        id: 'textarea-2-3',
        isConnected: true,
        selectionStart: 5,
        selectionEnd: 5,
        closest(selector) {
            if (selector === '#tab-content .textarea-cell textarea') return this;
            if (selector === '.textarea-cell-body') return body;
            if (selector === '.textarea-cell') return cell;
            return null;
        },
        getClientRects: () => [{}],
    };
    const otherTextarea = { ...textarea, id: 'textarea-8-9' };
    elementAtPointer = textarea;
    const container = { addEventListener: (type, listener) => addListener(containerListeners, type, listener) };
    const document = {
        activeElement: textarea,
        addEventListener: (type, listener, options) => addListener(listeners, type, listener, options),
        createElement: () => ({
            className: '',
            classList: {
                add: (name) => indicatorClasses.add(name),
                remove: (name) => indicatorClasses.delete(name),
                contains: (name) => indicatorClasses.has(name),
            },
            style: { setProperty: (name, value) => indicatorStyles.set(name, value) },
            setAttribute: () => {},
        }),
        elementFromPoint: () => elementAtPointer,
    };
    const window = { addEventListener: (type, listener) => addListener(windowListeners, type, listener) };
    const context = {
        window,
        document,
        performance: { now: () => now },
        getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
        requestAnimationFrame(callback) {
            const id = nextAnimationFrameId++;
            animationFrames.set(id, callback);
            return id;
        },
        cancelAnimationFrame(id) {
            animationFrames.delete(id);
        },
        setTimeout(callback, delay) {
            const id = nextTimerId++;
            timers.set(id, { at: now + delay, callback });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        sendPrompt: (...args) => sentPrompts.push(args),
    };

    vm.runInNewContext(
        `const TEXT_BLOCK_SEND_HOLD_MS = 600;\n` +
            `const TEXT_BLOCK_SEND_MOVE_TOLERANCE = 8;\n` +
            `let pendingTextBlockSend = null;\n` +
            source.slice(start, end) +
            `\nwindow.testInitTextBlockHoldSend = initTextBlockHoldSend;`,
        context,
        { filename: 'public/js/features/editor/index.js (hold-to-send test extraction)' },
    );

    function advanceTime(ms) {
        now += ms;
        const dueTimers = [...timers.entries()]
            .filter(([, timer]) => timer.at <= now)
            .sort((a, b) => a[1].at - b[1].at);
        for (const [id, timer] of dueTimers) {
            if (!timers.delete(id)) continue;
            timer.callback();
        }
    }

    function flushAnimationFrames() {
        const frames = [...animationFrames.values()];
        animationFrames.clear();
        frames.forEach((callback) => callback(now));
    }

    const pointer = {
        isPrimary: true,
        button: 0,
        pointerId: 7,
        clientX: 20,
        clientY: 30,
        target: textarea,
    };

    window.testInitTextBlockHoldSend(container);

    return {
        advanceTime,
        containerListeners,
        dispatchDocument: (type, event) => dispatch(listeners, type, event),
        dispatchWindow: (type, event) => dispatch(windowListeners, type, event),
        flushAnimationFrames,
        setElementFromPoint: (element) => {
            elementAtPointer = element;
        },
        indicatorVisible: () => indicatorClasses.has('is-pending'),
        progress: () => indicatorStyles.get('--send-hold-progress'),
        pointer: { ...pointer },
        otherTextarea,
        sentPrompts,
        pointerdownListeners: () => listeners.get('pointerdown') || [],
        focusedTextareaSelection: () => [document.activeElement.selectionStart, document.activeElement.selectionEnd],
        startHold: (overrides = {}) =>
            dispatch(listeners, 'pointerdown', { ...pointer, ...overrides }),
        startHoldWithBubblingStop: (overrides = {}) => {
            const event = { ...pointer, ...overrides, propagationStopped: false };
            event.stopPropagation = () => {
                event.propagationStopped = true;
            };
            addListener(containerListeners, 'pointerdown', (bubblingEvent) => bubblingEvent.stopPropagation());
            dispatch(listeners, 'pointerdown', event);
            if (!event.propagationStopped) dispatch(containerListeners, 'pointerdown', event);
            return event;
        },
    };
}

test('holding a visible textarea sends that block once at completion', () => {
    const harness = createHoldHarness();

    harness.startHold();
    assert.equal(harness.indicatorVisible(), false);
    harness.advanceTime(150);
    harness.flushAnimationFrames();
    assert.equal(harness.indicatorVisible(), true);
    const progressAt150 = parseFloat(harness.progress());
    harness.advanceTime(150);
    harness.flushAnimationFrames();
    const progressAt300 = parseFloat(harness.progress());
    assert.ok(progressAt300 > progressAt150, `progress should increase (${progressAt150}° → ${progressAt300}°)`);
    harness.advanceTime(299);
    harness.flushAnimationFrames();
    assert.deepEqual(harness.sentPrompts, []);
    harness.advanceTime(1);
    harness.dispatchDocument('pointerup', { pointerId: harness.pointer.pointerId });
    harness.advanceTime(1000);

    assert.deepEqual(harness.sentPrompts, [[2, 3]]);
    assert.equal(harness.indicatorVisible(), false);
    assert.equal(harness.progress(), '0deg');
});

test('hold completion sends the pressed textarea even when pointer position targets another textarea', () => {
    const harness = createHoldHarness();

    harness.startHold();
    harness.advanceTime(200);
    harness.setElementFromPoint(harness.otherTextarea);
    harness.advanceTime(400);

    assert.deepEqual(harness.sentPrompts, [[2, 3]]);
    assert.equal(harness.indicatorVisible(), false);
    assert.equal(harness.progress(), '0deg');
});

test('document capture starts a hold for the pressed textarea when a bubbling handler stops propagation', () => {
    const harness = createHoldHarness();
    const event = harness.startHoldWithBubblingStop({ target: harness.otherTextarea });

    assert.deepEqual(harness.focusedTextareaSelection(), [5, 5], 'textarea A should remain focused with a caret');
    assert.equal(harness.pointerdownListeners().length, 1);
    assert.equal(harness.pointerdownListeners()[0].options, true, 'pointerdown listener should use document capture');
    assert.equal(event.propagationStopped, true);
    harness.advanceTime(600);

    assert.deepEqual(harness.sentPrompts, [[8, 9]], 'the pressed textarea should send despite another textarea being focused');
});

test('early pointerup cancels the hold and a quick click does not send', () => {
    const harness = createHoldHarness();

    harness.startHold();
    harness.advanceTime(100);
    harness.dispatchDocument('pointerup', { pointerId: harness.pointer.pointerId });
    harness.advanceTime(1000);

    assert.deepEqual(harness.sentPrompts, []);
    assert.equal(harness.indicatorVisible(), false);
    assert.equal(harness.progress(), '0deg');
});

test('non-primary and right-click pointerdown are ignored without preventing native selection', () => {
    for (const pointerOverrides of [
        { isPrimary: false, button: 0 },
        { isPrimary: true, button: 2 },
    ]) {
        const harness = createHoldHarness();
        let prevented = false;

        harness.startHold({
            ...pointerOverrides,
            preventDefault: () => {
                prevented = true;
            },
        });
        harness.advanceTime(1000);

        assert.deepEqual(harness.sentPrompts, []);
        assert.equal(harness.indicatorVisible(), false);
        assert.equal(prevented, false);
    }

    const primaryPointerHarness = createHoldHarness();
    let primaryPrevented = false;
    primaryPointerHarness.startHold({
        preventDefault: () => {
            primaryPrevented = true;
        },
    });
    primaryPointerHarness.dispatchDocument('pointerup', { pointerId: primaryPointerHarness.pointer.pointerId });

    assert.equal(primaryPrevented, false, 'normal pointerdown should preserve native text selection');
    assert.deepEqual(primaryPointerHarness.sentPrompts, []);
});

test('pointer movement beyond the tolerance cancels the hold', () => {
    const harness = createHoldHarness();

    harness.startHold();
    harness.advanceTime(200);
    harness.flushAnimationFrames();
    assert.ok(parseFloat(harness.progress()) > 0);
    assert.equal(harness.indicatorVisible(), true);
    harness.dispatchDocument('pointermove', {
        pointerId: harness.pointer.pointerId,
        clientX: harness.pointer.clientX + 9,
        clientY: harness.pointer.clientY,
    });
    harness.advanceTime(1000);

    assert.deepEqual(harness.sentPrompts, []);
    assert.equal(harness.indicatorVisible(), false);
    assert.equal(harness.progress(), '0deg');
});

for (const eventType of ['pointercancel', 'lostpointercapture']) {
    test(`${eventType} cancels the hold and hides its indicator`, () => {
        const harness = createHoldHarness();

        harness.startHold();
        harness.advanceTime(200);
        harness.flushAnimationFrames();
        assert.ok(parseFloat(harness.progress()) > 0);
        assert.equal(harness.indicatorVisible(), true);
        harness.dispatchDocument(eventType, { pointerId: harness.pointer.pointerId });
        harness.advanceTime(1000);

        assert.deepEqual(harness.sentPrompts, []);
        assert.equal(harness.indicatorVisible(), false);
        assert.equal(harness.progress(), '0deg');
    });
}

test('window blur cancels the hold and hides its indicator', () => {
    const harness = createHoldHarness();

    harness.startHold();
    harness.advanceTime(200);
    harness.flushAnimationFrames();
    assert.ok(parseFloat(harness.progress()) > 0);
    assert.equal(harness.indicatorVisible(), true);
    harness.dispatchWindow('blur');
    harness.advanceTime(1000);

    assert.deepEqual(harness.sentPrompts, []);
    assert.equal(harness.indicatorVisible(), false);
    assert.equal(harness.progress(), '0deg');
});

test('Text Lyrics shortcut registry omits Backquote while Image Lyrics retains it', () => {
    const shortcuts = require('../public/js/features/prompter/prompter-shortcuts.js');
    const imageEditor = fs.readFileSync(
        path.join(repoRoot, 'public/js/features/image-lyrics/index.js'),
        'utf8',
    );
    const textShortcutCodes = shortcuts.PROMPTER_SHORTCUT_REGISTRY.flatMap((entry) => entry.codes || []);

    assert.equal(textShortcutCodes.includes('Backquote'), false);
    assert.match(imageEditor, /event\.code === 'Backquote'\) action = 'send'/);
});
