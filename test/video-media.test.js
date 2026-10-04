const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function media(options) {
    const window = {};
    vm.runInNewContext(fs.readFileSync('public/js/features/video-lyrics/local-media.js', 'utf8'), { window, Blob, fetch });
    return window.eclyricsVideoLocalMedia.create(options);
}
const entry = { id: 'ambient', version: 1, url: '/ambient.mp4' };
test('concurrent loads deduplicate downloads; explicit save persists versioned built-in media', async () => {
    const saved = new Map(); let downloads = 0, writes = 0;
    const blob = new Blob(['video']);
    const m = media({ store: { get: async key => saved.get(key), put: async (key, value) => { writes++; saved.set(key, value); } }, fetchMedia: async () => { downloads++; return { ok: true, blob: async () => blob }; } });
    const results = await Promise.all([m.load(entry), m.load(entry)]);
    assert.equal(results[0], blob); assert.equal(results[1], blob); assert.equal(downloads, 1); assert.equal(writes, 0);
    assert.equal(await m.save(entry), true); assert.equal(await m.save(entry), false); assert.equal(writes, 1);
    assert.equal(await m.isSaved(entry), true);
    await m.load({ ...entry, version: 2 }); assert.equal(downloads, 2);
});
test('persisted media works offline in a new session', async () => {
    const blob = new Blob(['cached']); let downloads = 0;
    const m = media({ store: { get: async () => blob }, fetchMedia: async () => { downloads++; throw new Error('offline'); } });
    assert.equal(await m.load(entry), blob); assert.equal(downloads, 0);
});
test('IndexedDB open rejection clears the cached attempt so a later request can retry', async () => {
    let opens = 0;
    const cached = new Blob(['cached']);
    const database = {
        onversionchange: null,
        close() {},
        createObjectStore() {},
        transaction() {
            const operation = {
                oncomplete: null,
                objectStore: () => ({ get: () => ({ result: cached }) }),
            };
            setImmediate(() => operation.oncomplete());
            return operation;
        },
    };
    const indexedDB = {
        open() {
            opens++;
            const request = {};
            if (opens === 1) setImmediate(() => request.onblocked());
            else {
                request.result = database;
                setImmediate(() => {
                    request.onupgradeneeded();
                    request.onsuccess();
                });
            }
            return request;
        },
    };
    const window = { indexedDB };
    vm.runInNewContext(fs.readFileSync('public/js/features/video-lyrics/local-media.js', 'utf8'), { window, indexedDB, Blob, fetch });
    const store = window.eclyricsVideoLocalMedia.createStore();

    await assert.rejects(store.get('ambient:1'), /Close other EC Lyrics tabs/);
    assert.equal(await store.get('ambient:1'), cached);
    assert.equal(opens, 2);
});
test('storage quota failure preserves session playback without claiming persistence', async () => {
    let downloads = 0;
    const m = media({ store: { get: async () => undefined, put: async () => { throw new Error('quota'); } }, fetchMedia: async () => { downloads++; return { ok: true, blob: async () => new Blob(['video']) }; } });
    await assert.rejects(m.save(entry), /quota/); assert.equal(await m.isSaved(entry), false);
    assert.ok(await m.load(entry)); assert.equal(downloads, 1);
});
test('Video activation persists only selected videos and background previews mount only while picker is open', async () => {
    const callbacks = [], saveCalls = new Map(), saved = new Set(), videos = []; let active = false, selected = [], loads = 0;
    const panelListeners = new Map();
    const panel = { classList: { contains: name => name === 'is-active' && active }, addEventListener(name, callback) { panelListeners.set(name, callback); }, append() {} };
    const controller = { panel, status() {}, getState: () => ({ background: selected.at(-1) || null }), setBackground: value => selected.push(value) };
    const mediaApi = {
        async isSaved(item) { return saved.has(`${item.id}:${item.version}`); },
        async save(item) {
            const key = `${item.id}:${item.version}`;
            if (saved.has(key)) return false;
            saveCalls.set(key, (saveCalls.get(key) || 0) + 1);
            saved.add(key);
            return true;
        },
        async load(item) { loads++; return { id: item.id, version: item.version }; },
        async probe() {},
    };
    const window = { eclyricsVideoLyrics: controller, eclyricsVideoLocalMedia: { create: () => mediaApi, probe: async () => {} } };
    const elements = [];
    function element(tag = 'div') {
        const listeners = new Map();
        const node = {
            tagName: tag.toUpperCase(), children: [], dataset: {}, classList: { add() {}, contains: () => false },
            setAttribute() {}, addEventListener(name, callback) { listeners.set(name, callback); }, append(...children) { this.children.push(...children); },
            after() {}, play() { return Promise.resolve(); }, pause() {}, load() {}, removeAttribute(name) { delete this[name]; },
            listeners, close() { this.open = false; this.listeners.get('close')?.(); }, showModal() { this.open = true; },
        };
        if (tag === 'dialog') node.querySelector = selector => {
            if (selector === '.video-background-grid') return (node.grid ||= element('div'));
            if (selector === '[role=status]') return (node.message ||= element('p'));
            if (selector === 'button') return (node.closeButton ||= element('button'));
        };
        if (tag === 'video') videos.push(node);
        elements.push(node); return node;
    }
    const document = { activeElement: { focus() {} }, createElement: element };
    vm.runInNewContext(fs.readFileSync('public/js/features/video-lyrics/backgrounds.js', 'utf8'), {
        window, document,
        MutationObserver: class { constructor(callback) { callbacks.push(callback); } observe() {} disconnect() {} },
    });
    const expectedCatalogue = [
        ['white-stars', 'Background 1', 'White Stars', 'assets/videos/white-stars.mp4'],
        ['blue-weightless', 'Background 2', 'Blue Weightless', 'assets/videos/blue-weightless.mp4'],
        ['green-lense-glare', 'Background 3', 'Green Lens', 'assets/videos/green-lense-glare.mp4'],
        ['orange-hexagons', 'Background 4', 'Orange Hexagons', 'assets/videos/orange-hexagons.mp4'],
        ['pink-hearts', 'Background 5', 'Pink Hearts', 'assets/videos/pink-hearts.mp4'],
        ['purple-fiber', 'Background 6', 'Purple Fiber', 'assets/videos/purple-fiber.mp4'],
        ['purple-lense-glare', 'Background 7', 'Purple Lens Glare', 'assets/videos/purple-lense-glare.mp4'],
    ];
    const catalogue = window.eclyricsVideoBackgrounds.catalogue;
    assert.deepEqual(JSON.parse(JSON.stringify(catalogue.map(({ id, name, description, url }) => [id, name, description, url]))), expectedCatalogue,
        'the catalogue uses the requested order, concise proper-cased descriptions, and White Stars first');
    assert.equal(catalogue.some(item => item.id === 'ambient' || item.url.includes('ambient-worship')), false,
        'the removed ambient background is absent');
    for (const [, , , url] of expectedCatalogue) {
        const filePath = path.join('public', url);
        assert.equal(path.extname(filePath), '.mp4');
        assert.ok(fs.statSync(filePath).size > 0, `${url} exists as a non-empty repository asset`);
    }
    assert.equal(videos.length, 7);
    assert.equal(videos.every(video => video.src === undefined), true, 'preview videos have no mounted source before opening the picker');
    assert.equal(saveCalls.size, 0, 'do not fetch or persist backgrounds before entering Video Lyrics');
    active = true; callbacks[0]();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([...saveCalls.keys()], ['white-stars:1'], 'the first activation persists only the selected default');
    assert.equal(selected[0].name, 'Background 1', 'the first curated background is selected automatically');
    assert.equal(selected[0].id, 'white-stars', 'White Stars is the default background');
    assert.equal(loads, 1, 'normal first activation loads the selected default for playback');
    await window.eclyricsVideoBackgrounds.select(catalogue[1]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([...saveCalls.keys()], ['white-stars:1', 'blue-weightless:1'], 'choosing another preset saves only that selected video');

    const dialog = elements.find(item => item.tagName === 'DIALOG');
    panelListeners.get('video-lyrics-background')();
    assert.equal(dialog.open, true, 'background picker opens in response to its panel event');
    assert.ok(videos.every(video => video.src === video.dataset.src), 'preview sources are assigned while the picker is open');
    dialog.close();
    assert.ok(videos.every(video => video.src === undefined), 'closing the picker removes each mounted preview source');
    active = false; callbacks[0](); active = true; callbacks[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([...saveCalls.keys()], ['white-stars:1', 'blue-weightless:1'], 'revisiting the page does not persist unselected videos');
});
test('failed and empty downloads reject and can be retried', async () => {
    let attempt = 0;
    const m = media({ store: { get: async () => { throw new Error('unavailable'); } }, fetchMedia: async () => { attempt++; return { ok: attempt !== 1, blob: async () => new Blob(attempt === 2 ? [] : ['video']) }; } });
    await assert.rejects(m.load(entry), /could not download/); await assert.rejects(m.load(entry), /empty/);
    assert.ok(await m.load(entry)); assert.equal(attempt, 3);
});
test('personal selection is session-only, validated, and never sent to cache or network', async () => {
    const elements = [], backgrounds = [], statuses = []; let loads = 0, saves = 0, probes = 0;
    function element() {
        const node = { children: [], dataset: {}, classList: { contains: () => false, add() {}, remove() {} }, append(...children) { this.children.push(...children); }, after(...children) { this.afterChildren = children; }, setAttribute() {}, addEventListener() {}, close() { this.open = false; }, pause() {}, load() {}, removeAttribute(name) { delete this[name]; }, querySelector(selector) { if (!this.queries) this.queries = {}; return this.queries[selector] ||= element(); } };
        elements.push(node); return node;
    }
    const panel = element(), window = {
        eclyricsVideoLyrics: { panel, status: (message, error) => statuses.push({ message, error }), getState: () => ({ background: backgrounds.at(-1) }), setBackground: value => backgrounds.push(value) },
        eclyricsVideoLocalMedia: { create: () => ({ load: async () => { loads++; }, save: async () => { saves++; }, isSaved: async () => false }), probe: async file => { probes++; if (file.name === 'invalid') throw new Error('Unsupported video'); } },
    };
    vm.runInNewContext(fs.readFileSync('public/js/features/video-lyrics/backgrounds.js', 'utf8'), { window, document: { createElement: element }, MutationObserver: class { observe() {} disconnect() {} } });
    assert.equal(loads, 0, 'inactive Video panel must not download default media');
    const picker = elements.find(n => n.type === 'file');
    const file = { name: 'personal.mp4', size: 100 };
    picker.files = [file]; await picker.onchange(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(backgrounds.length, 1); assert.equal(backgrounds[0].blob, file); assert.equal(backgrounds[0].id, 'session-1');
    assert.equal(loads, 0); assert.equal(saves, 0); assert.equal(probes, 1);
    picker.files = [{ name: 'empty', size: 0 }]; await picker.onchange(); await new Promise(resolve => setImmediate(resolve));
    picker.files = [{ name: 'invalid', size: 1 }]; await picker.onchange(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(backgrounds.length, 1); assert.equal(statuses.at(-1).error, true);
});
