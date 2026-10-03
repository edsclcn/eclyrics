const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
test('first Video Lyrics activation caches curated videos and later visits reuse the cache', async () => {
    const callbacks = [], downloads = new Map(), saved = new Set(); let active = false, selected = [];
    const panel = { classList: { contains: name => name === 'is-active' && active }, addEventListener() {}, append() {} };
    const controller = { panel, status() {}, getState: () => ({ background: selected.at(-1) || null }), setBackground: value => selected.push(value) };
    const mediaApi = {
        async isSaved(item) { return saved.has(`${item.id}:${item.version}`); },
        async save(item) {
            const key = `${item.id}:${item.version}`;
            if (saved.has(key)) return false;
            downloads.set(key, (downloads.get(key) || 0) + 1);
            saved.add(key);
            return true;
        },
        async load(item) { return { id: item.id, version: item.version }; },
        async probe() {},
    };
    const window = { eclyricsVideoLyrics: controller, eclyricsVideoLocalMedia: { create: () => mediaApi, probe: async () => {} } };
    const element = () => ({ classList: { add() {}, contains: () => false }, setAttribute() {}, addEventListener() {}, append() {}, after() {}, querySelector: () => element() });
    vm.runInNewContext(fs.readFileSync('public/js/features/video-lyrics/backgrounds.js', 'utf8'), {
        window, document: { createElement: element },
        MutationObserver: class { constructor(callback) { callbacks.push(callback); } observe() {} disconnect() {} },
    });
    assert.equal(downloads.size, 0, 'do not fetch before entering Video Lyrics');
    active = true; callbacks[0]();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(downloads.size, 1, 'one curated background is downloaded on first activation');
    assert.equal(selected[0].name, 'Background 1', 'the first curated background is selected automatically');
    callbacks[0](); await new Promise(resolve => setImmediate(resolve));
    assert.equal(downloads.size, 1, 'repeated activation checks the local cache without downloading again');
    active = false; callbacks[0](); active = true; callbacks[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(downloads.size, 1, 'revisiting the page reuses the saved background');
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
        const node = { children: [], classList: { contains: () => false, add() {}, remove() {} }, append(...children) { this.children.push(...children); }, after(...children) { this.afterChildren = children; }, setAttribute() {}, addEventListener() {}, close() { this.open = false; }, querySelector(selector) { if (!this.queries) this.queries = {}; return this.queries[selector] ||= element(); } };
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
