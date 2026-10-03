const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = file => fs.readFileSync(`public/js/features/${file}`, 'utf8');
const settings = { fontFamily: 'Satoshi', fontWeight: 700, fontSize: 64, color: '#ffffff', alignment: 'center', fadeMs: 300 };
const state = (revision, text, extra = {}) => ({ revision, text, settings: { ...settings }, ...extra });
function stageHarness() {
    const nodes = [], fonts = [];
    class Node {
        constructor() { this.children = []; this.style = {}; this.listeners = {}; this.textContent = ''; this.classList = { add() {} }; this.clientWidth = 1920; this.clientHeight = 1080; this.plays = 0; this.animations = []; nodes.push(this); }
        append(...nodes) { nodes.forEach(n => { n.parent = this; this.children.push(n); }); }
        prepend(n) { n.parent = this; this.children.unshift(n); }
        insertBefore(n, before) { n.parent = this; this.children.splice(this.children.indexOf(before), 0, n); }
        replaceChildren() { this.children = []; }
        remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
        addEventListener(name, fn) { this.listeners[name] = fn; }
        play() { this.plays++; return Promise.resolve(); }
        pause() {} load() {} removeAttribute() {}
        cloneNode(deep = false) { const n = new Node(); n.textContent = this.textContent; n.style = { ...this.style }; n.className = this.className; if (deep) this.children.forEach(child => n.append(child.cloneNode(true))); return n; }
        getBoundingClientRect() { return { width: this.className === 'video-stage-lyric' ? 1600 : 1920 }; }
        animate(frames, options) { const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } }; this.animations.push(animation); return animation; }
    }
    const window = {}, host = new Node();
    const document = {
        createElement: () => new Node(),
        fonts: { load: () => new Promise(resolve => fonts.push(resolve)) },
    };
    vm.runInNewContext(read('video-lyrics/stage.js'), { window, document, Blob, URL, location: { href: 'https://example.org/', origin: 'https://example.org' }, ResizeObserver: class { observe() {} disconnect() {} }, matchMedia: () => ({ matches: false }) });
    return { api: window.eclyricsVideoStage, renderer: window.eclyricsVideoStage.create(host), host, nodes, fonts };
}
test('stage validation rejects malformed settings, revisions and media; renders a fixed-size two-line cue layer', async () => {
    const { api } = stageHarness();
    assert.ok(api.validate(state(0, 'valid')));
    for (const invalid of [state(-1, 'bad'), state(1, 5), state(1, 'x', { settings: { ...settings, fontFamily: 'Unknown' } }), state(1, 'x', { background: { id: 'broken' } })]) assert.equal(api.validate(invalid), null);
    const cue = 'Bless His name '.repeat(40);
    const h = stageHarness(); const request = h.renderer.update(state(1, cue, { background: { id: 'ambient', url: '/ambient.mp4' } })); h.fonts[0](); await request;
    const lyric = h.nodes.find(node => node.className === 'video-stage-lyric');
    const line = h.nodes.find(node => node.className === 'video-stage-line');
    assert.equal(line.textContent, cue);
    assert.equal(lyric.style.fontSize, '64px', 'long cues retain the selected font size');
    const css = require('node:fs').readFileSync('public/assets/css/video-prompter.css', 'utf8');
    assert.match(css, /\.video-stage-line\s*\{[^}]*-webkit-line-clamp:\s*2/);
    assert.match(css, /\.video-stage-line\s*\{[^}]*max-height:\s*2\.4em/);
    assert.equal(h.host.children[0].children.filter(node => node.className === 'video-stage-lyric').length, 1);
    assert.equal(h.nodes.find(node => node.className === 'video-stage-scrim').style.opacity, .3);
});
test('latest asynchronous font request wins; cue crossfade does not restart background', async () => {
    const h = stageHarness(), background = { id: 'ambient', version: 1, url: '/ambient.mp4' };
    const first = h.renderer.update(state(1, 'First', { background })); h.fonts.shift()(); assert.equal(await first, true);
    const video = h.nodes.find(n => n.className === 'video-stage-video'); video.listeners.loadeddata();
    const old = h.renderer.update(state(2, 'Stale', { background }));
    const latest = h.renderer.update(state(3, 'Latest', { background }));
    h.fonts[1](); assert.equal(await latest, true); h.fonts[0](); assert.equal(await old, false);
    assert.equal(h.nodes.find(n => n.className === 'video-stage-line').textContent, 'Latest');
    assert.equal(h.nodes.filter(n => n.className === 'video-stage-video').length, 1); assert.equal(video.plays, 1);
    assert.ok(h.nodes.some(n => n.className === 'video-stage-line' && n.textContent === 'First'), 'the previous cue is retained in the crossfade layer');
    const clear = h.renderer.update(state(4, '')); h.fonts[2](); await clear;
    assert.equal(h.nodes.find(n => n.className === 'video-stage-line').textContent, '');
    assert.equal(h.nodes.find(n => n.className === 'video-stage-scrim').style.opacity, .3);
    assert.equal(video.plays, 1); h.renderer.destroy(); assert.equal(h.host.children.length, 0);
});
test('popup verifies source and origin, ignores stale revisions and acknowledges only latest applied cue', async () => {
    const listeners = {}, messages = [], pending = [], updates = [];
    const opener = { postMessage: message => messages.push(message) }, location = { origin: 'https://example.org', href: 'https://example.org/video-prompter.html' };
    const stage = { update: payload => { updates.push(payload); return new Promise(resolve => pending.push(resolve)); }, invalidate() {}, destroy() {}, play: async () => {} };
    const window = {
        opener, addEventListener: (type, fn) => { listeners[type] = fn; },
        eclyricsVideoFonts: { allowedFamilies: ['Satoshi'], validDescriptor: () => false, ensure: async () => true },
        eclyricsVideoStage: { CHANNEL: 'video', validate: payload => Number.isSafeInteger(payload?.revision) ? payload : null, create: () => stage },
    };
    const document = { getElementById: () => ({}), addEventListener() {} };
    vm.runInNewContext(read('video-prompter/prompter.js'), { window, document, location, Blob, URL });
    const send = (payload, overrides = {}) => listeners.message({ origin: location.origin, source: opener, data: { channel: 'video', type: 'state', payload }, ...overrides });
    await send(state(1, 'bad'), { origin: 'https://evil.org' }); await send(state(1, 'bad'), { source: {} }); assert.equal(updates.length, 0);
    const background = { id: 'ambient', url: 'https://example.org/ambient.mp4' };
    const old = send(state(1, 'old', { background })), latest = send(state(2, 'new'));
    await new Promise(resolve => setImmediate(resolve));
    pending[0](true); await old; assert.equal(messages.filter(m => m.type === 'ack').length, 0);
    pending[1](true); await latest; assert.deepEqual(messages.filter(m => m.type === 'ack').map(m => m.revision), [2]);
    assert.equal(updates[1].background, background); await send(state(1, 'stale')); assert.equal(updates.length, 2);
});

test('invalid envelopes do not consume a revision or replace the current background', async () => {
    const listeners = {}, updates = [], messages = [], opener = { postMessage: message => messages.push(message) };
    const stage = { update: async payload => { updates.push(payload); return true; }, invalidate() {}, destroy() {}, play: async () => {} };
    const window = {
        opener, addEventListener: (type, fn) => { listeners[type] = fn; },
        eclyricsVideoFonts: { allowedFamilies: ['Satoshi'], validDescriptor: () => false, ensure: async () => true },
        eclyricsVideoStage: { CHANNEL: 'video', validate: payload => {
            if (!Number.isSafeInteger(payload?.revision) || typeof payload.text !== 'string') return null;
            if (payload.background && typeof payload.background.url !== 'string') return null;
            return payload;
        }, create: () => stage },
    };
    vm.runInNewContext(read('video-prompter/prompter.js'), { window, document: { getElementById: () => ({}), addEventListener() {} }, location: { origin: 'https://example.org', href: 'https://example.org/video-prompter.html' }, Blob, URL });
    const send = payload => listeners.message({ origin: 'https://example.org', source: opener, data: { channel: 'video', type: 'state', payload } });
    await send(state(4, 'bad', { background: { id: 'invalid' } }));
    await send(state(4, 'valid', { background: { id: 'good', url: 'https://example.org/good.mp4' } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(updates.length, 1);
    assert.equal(updates[0].text, 'valid');
    assert.equal(updates[0].background.id, 'good');
});

test('a faster cue waits for an in-flight custom font and keeps its earlier background', async () => {
    const listeners = {}, updates = [], opener = { postMessage() {} };
    let finishFont;
    const custom = { family: 'ECVideoFont_1234567890abcdef1234567890abcdef', name: 'Imported', category: 'Serif', blob: new Blob(['font']) };
    let registered = false;
    const fonts = {
        get allowedFamilies() { return registered ? ['Satoshi', custom.family] : ['Satoshi']; },
        validDescriptor: value => value?.family === custom.family && value.blob instanceof Blob,
        register: () => new Promise(resolve => { finishFont = () => { registered = true; resolve(custom); }; }),
        ensure: async family => family === 'Satoshi' || registered,
    };
    const stage = { update: async payload => { updates.push(payload); return true; }, invalidate() {}, destroy() {}, play: async () => {} };
    const window = { opener, eclyricsVideoFonts: fonts, addEventListener: (type, fn) => { listeners[type] = fn; }, eclyricsVideoStage: {
        CHANNEL: 'video', validate: payload => payload.settings.fontFamily === 'Satoshi' || registered ? payload : null, create: () => stage,
    } };
    vm.runInNewContext(read('video-prompter/prompter.js'), { window, document: { getElementById: () => ({}), addEventListener() {} }, location: { origin: 'https://example.org', href: 'https://example.org/video-prompter.html' }, Blob, URL });
    const send = payload => listeners.message({ origin: 'https://example.org', source: opener, data: { channel: 'video', type: 'state', payload } });
    const background = { id: 'ambient', url: 'https://example.org/ambient.mp4' };
    const first = send({ ...state(1, 'Old custom cue', { background }), font: custom, settings: { ...settings, fontFamily: custom.family } });
    const second = send(state(2, 'Latest cue'));
    await new Promise(resolve => setImmediate(resolve));
    finishFont();
    await Promise.all([first, second]);
    assert.equal(updates.at(-1).text, 'Latest cue');
    assert.equal(updates.at(-1).background.id, 'ambient');
});
test('output reconnect sends full background to reopened popup and checks origin/source', () => {
    const listeners = {}, panelListeners = {}, sent = [], popups = [], changes = [];
    const descriptor = { family: 'ECVideoFont_1234567890abcdef1234567890abcdef', name: 'Imported', category: 'Serif', blob: new Blob(['font']) };
    const value = { live: { text: 'Current' }, blackout: false, settings: { ...settings, fontFamily: descriptor.family }, background: { id: 'ambient' } };
    const api = { getState: () => value, status() {}, subscribe: fn => changes.push(fn), advance: delta => sent.push({ delta }), panel: { addEventListener: (type, fn) => { panelListeners[type] = fn; } } };
    const window = { eclyricsVideoLyrics: api, eclyricsVideoFonts: { descriptor: family => family === descriptor.family ? descriptor : null }, eclyricsVideoStage: { CHANNEL: 'video', create: () => ({ update() {}, destroy() {} }) }, addEventListener: (type, fn) => { listeners[type] = fn; }, open: () => { const popup = { closed: false, postMessage: message => sent.push(message), focus() {} }; popups.push(popup); return popup; } };
    const location = { origin: 'https://example.org' };
    vm.runInNewContext(read('video-lyrics/output.js'), { window, location, document: { getElementById() {} }, setInterval: () => 1, clearInterval() {} });
    panelListeners['video-lyrics-open']();
    const ready = (source, origin = location.origin) => listeners.message({ source, origin, data: { channel: 'video', type: 'ready' } });
    ready({}, location.origin); ready(popups[0], 'https://evil.org'); assert.equal(sent.length, 0);
    ready(popups[0]); assert.equal(sent[0].payload.background, value.background); assert.equal(sent[0].payload.font.blob, descriptor.blob);
    changes[0](); assert.equal(Object.hasOwn(sent[1].payload, 'background'), false); assert.equal(Object.hasOwn(sent[1].payload, 'font'), false);
    popups[0].closed = true; panelListeners['video-lyrics-open'](); ready(popups[1]);
    assert.equal(sent[2].payload.background, value.background); assert.equal(sent[2].payload.font.blob, descriptor.blob);
});

test('prompter arrow keys request manual line changes and ignore modified or unrelated keys', () => {
    const listeners = {}, sent = [];
    const opener = { closed: false, postMessage: message => sent.push(message) };
    const window = {
        opener,
        addEventListener(type, fn) { listeners[type] = fn; },
        eclyricsVideoStage: {
            CHANNEL: 'video',
            create: () => ({ update: async () => true, destroy() {}, play: async () => {} }),
            validate: payload => payload,
        },
    };
    const document = {
        getElementById: () => ({ hidden: true }),
        addEventListener(type, fn) { listeners[`document:${type}`] = fn; },
    };
    vm.runInNewContext(read('video-prompter/prompter.js'), { window, document, location: { origin: 'https://example.org' } });

    const keydown = listeners['document:keydown'];
    const down = { key: 'ArrowDown', preventDefault() { this.prevented = true; } };
    const up = { key: 'ArrowUp', preventDefault() { this.prevented = true; } };
    const modified = { key: 'ArrowDown', ctrlKey: true, preventDefault() { this.prevented = true; } };
    const other = { key: 'Enter', preventDefault() { this.prevented = true; } };
    keydown(down); keydown(up); keydown(modified); keydown(other);

    assert.deepEqual(sent.map(message => message.type), ['ready', 'advance', 'advance']);
    assert.deepEqual(sent.slice(1).map(message => message.delta), [1, -1]);
    assert.equal(down.prevented, true);
    assert.equal(up.prevented, true);
    assert.equal(modified.prevented, undefined);
    assert.equal(other.prevented, undefined);
});
