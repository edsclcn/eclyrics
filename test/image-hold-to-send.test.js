const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const imageScript = fs.readFileSync(path.join(repoRoot, 'public/js/features/image-lyrics/index.js'), 'utf8');

function createImageHoldHarness({ populated = true, twoBlocks = false } = {}) {
    const start = imageScript.indexOf('function resetImageSendHold()');
    const end = imageScript.indexOf('\nexportButton.addEventListener', start);
    assert.ok(start >= 0 && end > start, 'expected the Image Lyrics hold-to-send implementation');

    let now = 0;
    let nextTimerId = 1;
    let nextFrameId = 1;
    const timers = new Map();
    const frames = new Map();
    const listeners = new Map();
    const opened = [];
    const classes = new Set();
    const styles = new Map();
    const articles = Array.from({ length: twoBlocks ? 2 : 1 }, () => {
        let indicator = null;
        return {
            isConnected: true,
            getClientRects: () => [{}],
            querySelector: (selector) => selector === '.image-lyrics-send-hold-indicator' ? indicator : null,
            append: (element) => { indicator = element; },
        };
    });
    const makeTarget = (article, isControl = false) => ({
        closest(selector) {
            if (selector === '.image-lyrics-block') return article;
            if (isControl && selector === 'button, input') return this;
            return null;
        },
    });
    const target = makeTarget(articles[0]);
    const targetB = articles[1] ? makeTarget(articles[1]) : null;
    const buttonTarget = makeTarget(articles[0], true);
    const blocksEl = {
        children: articles,
        contains: (element) => articles.includes(element),
    };
    const panel = { classList: { contains: (name) => name === 'is-active' } };
    const document = {
        addEventListener(type, listener, options) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push({ listener, options });
        },
        createElement: () => ({
            className: '',
            classList: {
                add: (name) => classes.add(name),
                remove: (name) => classes.delete(name),
            },
            style: { setProperty: (name, value) => styles.set(name, value) },
            setAttribute: () => {},
        }),
    };
    const window = { addEventListener(type, listener) { listeners.set(`window:${type}`, [{ listener }]); } };
    const context = {
        document,
        window,
        performance: { now: () => now },
        requestAnimationFrame(callback) {
            const id = nextFrameId++;
            frames.set(id, callback);
            return id;
        },
        cancelAnimationFrame(id) { frames.delete(id); },
        setTimeout(callback, delay) {
            const id = nextTimerId++;
            timers.set(id, { at: now + delay, callback });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
    };
    const state = `
        let pendingImageSendHold = null;
        const IMAGE_SEND_HOLD_MS = 600, IMAGE_SEND_MOVE_TOLERANCE = 8;
        let selected = 0, scrollTop = 123, active = 1;
        const activeTab = { id: 1, blocks: ${JSON.stringify(Array.from({ length: twoBlocks ? 2 : 1 }, () => ({ file: populated ? { name: 'photo.png', type: 'image/png' } : null, url: '' })))} };
        const tab = () => activeTab;
        const panel = { classList: { contains: name => name === 'is-active' } };
        const blocksEl = { children: articles, contains: item => articles.includes(item) };
        const render = () => {};
        const open = () => opened.push({ selected, scrollTop });
    `;
    vm.runInNewContext(
        `${state}\n${imageScript.slice(start, end)}\nwindow.__testState = { get selected() { return selected; }, get pending() { return pendingImageSendHold; } };`,
        { ...context, articles, opened },
        { filename: 'public/js/features/image-lyrics/index.js (hold-to-send test extraction)' },
    );

    function dispatch(type, event = {}) {
        for (const { listener } of listeners.get(type) || []) listener(event);
    }
    function advanceTime(ms) {
        now += ms;
        const dueTimers = [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at);
        for (const [id, timer] of dueTimers) {
            if (timers.delete(id)) timer.callback();
        }
    }
    function pointerdown(targetNode = target, overrides = {}) {
        dispatch('pointerdown', { target: targetNode, isPrimary: true, button: 0, pointerId: 7, clientX: 20, clientY: 30, ...overrides });
    }

    return {
        advanceTime,
        dispatch,
        opened,
        indicatorVisible: () => classes.has('is-pending'),
        progress: () => styles.get('--image-send-hold-progress'),
        pointerdown,
        target,
        targetB,
        buttonTarget,
        currentSelection: () => window.__testState.selected,
    };
}

test('holding a populated Image Lyrics block sends that pressed block once', () => {
    const harness = createImageHoldHarness();

    harness.pointerdown();
    harness.advanceTime(600);

    assert.equal(harness.opened.length, 1);
    assert.equal(harness.opened[0].selected, 0);
    assert.equal(harness.opened[0].scrollTop, 0);
    assert.equal(harness.indicatorVisible(), false);
    assert.equal(harness.progress(), '0deg');
});

test('holding block B sends block B when block A was selected', () => {
    const harness = createImageHoldHarness({ twoBlocks: true });

    assert.equal(harness.currentSelection(), 0, 'block A should initially be selected');
    harness.pointerdown(harness.targetB);
    harness.advanceTime(600);

    assert.equal(harness.opened.length, 1);
    assert.equal(harness.opened[0].selected, 1, 'the pressed second block should be selected for sending');
    assert.equal(harness.opened[0].scrollTop, 0);
});

test('early release, movement, pointer cancellation, lost capture, and blur cancel Image Lyrics hold', () => {
    const cancellations = [
        ['pointerup', 100],
        ['pointermove', 200],
        ['pointercancel', 200],
        ['lostpointercapture', 200],
        ['blur', 200],
    ];
    for (const [eventType, elapsed] of cancellations) {
        const harness = createImageHoldHarness();
        harness.pointerdown();
        harness.advanceTime(elapsed);
        if (eventType === 'pointermove') {
            harness.dispatch(eventType, { pointerId: 7, clientX: 29, clientY: 30 });
        } else if (eventType === 'blur') {
            harness.dispatch('window:blur');
        } else {
            harness.dispatch(eventType, { pointerId: 7 });
        }
        harness.advanceTime(1000);

        assert.deepEqual(harness.opened, [], `${eventType} should cancel without sending`);
        assert.equal(harness.indicatorVisible(), false, `${eventType} should hide the progress indicator`);
        assert.equal(harness.progress(), '0deg', `${eventType} should reset progress`);
    }
});

test('empty Image Lyrics blocks and remove controls do not start a send hold', () => {
    for (const options of [{ populated: false }, { populated: true, target: 'button' }]) {
        const harness = createImageHoldHarness(options);
        harness.pointerdown(options.target === 'button' ? harness.buttonTarget : harness.target);
        harness.advanceTime(1000);

        assert.deepEqual(harness.opened, []);
        assert.equal(harness.indicatorVisible(), false);
    }
});

test('Image Lyrics retains ordinary block selection, file selection, and Backquote send', () => {
    assert.match(imageScript, /a\.onclick=e=>\{if\(e\.target\.closest\('button,label,input'\)\)return;choose\(i\)\}/);
    assert.match(imageScript, /input\.type='file';input\.accept='image\/\*'/);
    assert.match(imageScript, /input\.onchange=e=>assign\(i,e\.target\.files\?\.\[0\]\)/);
    assert.match(imageScript, /if \(event\.code === 'Backquote'\) action = 'send'/);
});

test('Image Lyrics hold ring, Shortcuts label, and hold-to-send help remain visible in the UI contract', () => {
    const textHtml = fs.readFileSync(path.join(repoRoot, 'public/modules/text-lyrics.html'), 'utf8');
    const imageHtml = fs.readFileSync(path.join(repoRoot, 'public/modules/image-lyrics.html'), 'utf8');
    const css = fs.readFileSync(path.join(repoRoot, 'public/assets/css/image-lyrics.css'), 'utf8');
    const textCss = fs.readFileSync(path.join(repoRoot, 'public/assets/css/index.css'), 'utf8');
    const indicatorRule = css.match(/\.image-lyrics-send-hold-indicator\s*\{([^}]+)\}/);
    const textIndicatorRule = textCss.match(/\.textarea-send-hold-indicator\s*\{([^}]+)\}/);
    const imageShortcutButton = imageHtml.match(/<button[^>]*id="image-lyrics-shortcuts-help-btn"[^>]*>([\s\S]*?)<\/button>/);
    const textShortcutButton = textHtml.match(/<button[^>]*id="preview-shortcuts-help-btn"[^>]*>([\s\S]*?)<\/button>/);

    assert.ok(indicatorRule, 'expected Image Lyrics hold progress ring CSS');
    assert.match(indicatorRule[1], /width:\s*18px/);
    assert.match(indicatorRule[1], /height:\s*18px/);
    assert.ok(textIndicatorRule, 'expected Text Lyrics hold progress ring CSS');
    assert.match(textIndicatorRule[1], /width:\s*18px/);
    assert.match(textIndicatorRule[1], /height:\s*18px/);
    assert.ok(imageShortcutButton);
    assert.ok(textShortcutButton);
    assert.match(imageShortcutButton[1], /<span>Shortcuts<\/span>/);
    assert.match(textShortcutButton[1], /<span>Shortcuts<\/span>/);
    assert.match(imageHtml, /<i class="preview-shortcuts-dialog__hold-icon fa-regular fa-circle" aria-hidden="true"><\/i>Hold to send<\/dt><dd>Click and hold an image block to send it to the prompter<\/dd>/);
});
