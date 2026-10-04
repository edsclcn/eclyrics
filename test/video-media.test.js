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
function readTopLevelMp4Boxes(filePath) {
    const descriptor = fs.openSync(filePath, 'r');
    const fileSize = fs.fstatSync(descriptor).size;
    const boxes = [];
    let offset = 0;
    try {
        while (offset + 8 <= fileSize) {
            const header = Buffer.alloc(16);
            const bytesRead = fs.readSync(descriptor, header, 0, Math.min(header.length, fileSize - offset), offset);
            assert.ok(bytesRead >= 8, `complete MP4 box header at byte ${offset}`);

            let boxSize = header.readUInt32BE(0);
            const type = header.toString('ascii', 4, 8);
            let headerSize = 8;
            if (boxSize === 1) {
                assert.ok(bytesRead >= 16, `complete extended MP4 box header at byte ${offset}`);
                const extendedSize = header.readBigUInt64BE(8);
                assert.ok(extendedSize <= BigInt(Number.MAX_SAFE_INTEGER), `${type} box size is safely addressable`);
                boxSize = Number(extendedSize);
                headerSize = 16;
            } else if (boxSize === 0) {
                boxSize = fileSize - offset;
            }

            assert.ok(boxSize >= headerSize, `${type} box has a valid size`);
            assert.ok(offset + boxSize <= fileSize, `${type} box ends within the file`);
            boxes.push({ type, offset, size: boxSize });
            offset += boxSize;
        }
    } finally {
        fs.closeSync(descriptor);
    }
    assert.equal(offset, fileSize, 'top-level MP4 boxes cover the complete file');
    return boxes;
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
test('White Stars MP4 places its playback index before video data for streaming previews', () => {
    const filePath = path.join('public', 'assets', 'videos', 'white-stars.mp4');
    const boxes = readTopLevelMp4Boxes(filePath);
    const moovIndex = boxes.findIndex(box => box.type === 'moov');
    const mediaDataIndex = boxes.findIndex(box => box.type === 'mdat');

    assert.notEqual(moovIndex, -1, 'White Stars contains a movie index box');
    assert.notEqual(mediaDataIndex, -1, 'White Stars contains a media data box');
    assert.ok(moovIndex < mediaDataIndex, 'the movie index precedes media data so browsers can render a streaming preview');
});
test('Video activation persists only selected videos and background previews mount only while picker is open', async () => {
    const callbacks = [], saveCalls = new Map(), saved = new Set(), videos = []; let active = false, selected = [], loads = 0, nextLoad = null, nextProbe = null;
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
        async load(item) { loads++; if (nextLoad) { const request = nextLoad; nextLoad = null; return request.promise; } return { id: item.id, version: item.version }; },
        async probe() { if (nextProbe) { const request = nextProbe; nextProbe = null; return request.promise; } },
    };
    const window = { eclyricsVideoLyrics: controller, eclyricsVideoLocalMedia: { create: () => mediaApi, probe: (...args) => mediaApi.probe(...args) } };
    const elements = [];
    function element(tag = 'div') {
        const listeners = new Map();
        const node = {
            tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {}, classList: {
                add(name) { node.className = `${node.className || ''} ${name}`.trim(); },
                contains(name) { return (node.className || '').split(/\s+/).includes(name); },
            },
            setAttribute(name, value) { this.attributes[name] = String(value); }, addEventListener(name, callback) { listeners.set(name, callback); },
            removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); }, append(...children) { this.children.push(...children); },
            after() {}, play() { return Promise.resolve(); }, pause() {}, load() {}, removeAttribute(name) { delete this[name]; },
            listeners, querySelector(selector) {
                const matches = candidate => selector.startsWith('.') ? candidate.classList.contains(selector.slice(1))
                    : selector === '[role=status]' ? candidate.attributes.role === 'status'
                        : selector === 'button' ? candidate.tagName === 'BUTTON' : false;
                const find = candidate => {
                    if (matches(candidate)) return candidate;
                    for (const child of candidate.children) { const found = find(child); if (found) return found; }
                    return null;
                };
                return this.children.map(find).find(Boolean) || null;
            },
            close() { this.open = false; this.listeners.get('close')?.(); }, showModal() { this.open = true; },
        };
        if (tag === 'dialog') {
            const grid = element('div'); grid.className = 'video-background-grid';
            const message = element('p'); message.setAttribute('role', 'status');
            const header = element('header'), closeButton = element('button'); header.append(closeButton);
            node.append(header, grid, message);
        }
        if (tag === 'video') videos.push(node);
        node.dispatch = name => node.listeners.get(name)?.();
        elements.push(node); return node;
    }
    const document = { activeElement: { focus() {} }, createElement: element };
    vm.runInNewContext(fs.readFileSync('public/js/features/video-lyrics/backgrounds.js', 'utf8'), {
        window, document,
        MutationObserver: class { constructor(callback) { callbacks.push(callback); } observe() {} disconnect() {} },
    });
    const expectedCatalogue = [
        ['white-stars', 'Background 1', 'White Stars', 'assets/videos/white-stars.mp4?v=2'],
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
        const filePath = path.join('public', url.split('?')[0]);
        assert.equal(path.extname(filePath), '.mp4');
        assert.ok(fs.statSync(filePath).size > 0, `${url} exists as a non-empty repository asset`);
    }
    assert.equal(videos.length, 7);
    assert.equal(videos.every(video => video.src === undefined), true, 'preview videos have no mounted source before opening the picker');
    assert.equal(saveCalls.size, 0, 'do not fetch or persist backgrounds before entering Video Lyrics');
    active = true; callbacks[0]();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([...saveCalls.keys()], ['white-stars:2'], 'the first activation persists only the selected default');
    assert.equal(selected[0].name, 'Background 1', 'the first curated background is selected automatically');
    assert.equal(selected[0].id, 'white-stars', 'White Stars is the default background');
    assert.equal(loads, 1, 'normal first activation loads the selected default for playback');
    await window.eclyricsVideoBackgrounds.select(catalogue[1]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([...saveCalls.keys()], ['white-stars:2', 'blue-weightless:1'], 'choosing another preset saves only that selected video');

    const dialog = elements.find(item => item.tagName === 'DIALOG');
    panelListeners.get('video-lyrics-background')();
    assert.equal(dialog.open, true, 'background picker opens in response to its panel event');
    assert.ok(videos.every(video => video.src === video.dataset.src), 'preview sources are assigned while the picker is open');
    const previewCards = dialog.querySelector('.video-background-grid').children.slice(0, catalogue.length);
    assert.ok(previewCards.every(button => button.dataset.previewBusy === 'true' && button.attributes['aria-busy'] === 'true'),
        'each preview card shows a busy state while its preview is loading');
    assert.ok(previewCards.every(button => button.attributes['aria-label'].endsWith('Loading preview.')),
        'accessible preview labels announce loading');
    assert.ok(previewCards.every(button => button.children[0].dataset.previewState === 'loading'), 'preview frames expose their loading state');
    videos[0].dispatch('loadeddata');
    assert.equal(previewCards[0].children[0].dataset.previewState, 'ready', 'loadeddata marks a preview ready');
    assert.equal(previewCards[0].dataset.previewBusy, 'false', 'loadeddata clears that preview busy state');
    videos[1].dispatch('error');
    assert.equal(previewCards[1].children[0].dataset.previewState, 'unavailable', 'a preview error reaches a terminal unavailable state');
    assert.equal(previewCards[1].dataset.previewBusy, 'false', 'a failed preview does not keep spinning');
    assert.equal(previewCards[1].attributes['aria-busy'], 'false');
    assert.equal(previewCards[1].attributes['aria-label'], 'Background 2. Blue Weightless. Preview unavailable.',
        'an unavailable preview is announced in its accessible label');
    for (const video of videos.slice(2)) video.dispatch('loadeddata');

    function deferred() { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
    const loading = deferred(); nextLoad = loading;
    const selection = window.eclyricsVideoBackgrounds.select(catalogue[2], { close: false });
    assert.equal(previewCards[2].dataset.selectionBusy, 'true', 'selection shows busy while the video is loading');
    assert.equal(previewCards[2].attributes['aria-busy'], 'true');
    assert.equal(previewCards[2].attributes['aria-label'], 'Background 3. Green Lens. Loading background.',
        'selection loading is announced in the accessible label');
    const probing = deferred(); nextProbe = probing;
    loading.resolve({ id: catalogue[2].id, version: catalogue[2].version });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(previewCards[2].dataset.selectionBusy, 'true', 'selection stays busy while the loaded video is being probed');
    probing.resolve();
    await selection;
    assert.equal(previewCards[2].dataset.selectionBusy, 'false', 'successful selection clears its busy state');

    const failedLoad = deferred(); nextLoad = failedLoad;
    const failedSelection = window.eclyricsVideoBackgrounds.select(catalogue[3], { close: false });
    assert.equal(previewCards[3].dataset.selectionBusy, 'true');
    failedLoad.reject(new Error('download failed'));
    await failedSelection;
    assert.equal(previewCards[3].dataset.selectionBusy, 'false', 'failed selection clears its busy state');

    const staleLoadedData = videos[4].listeners.get('loadeddata');
    dialog.close();
    assert.ok(videos.every(video => video.src === undefined), 'closing the picker removes each mounted preview source');
    assert.ok(previewCards.every(button => button.dataset.previewBusy === 'false'), 'closing the picker clears preview loading states');
    assert.ok(previewCards.every(button => button.attributes['aria-busy'] === 'false'), 'closing the picker clears card busy accessibility states');
    assert.ok(previewCards.every(button => button.children[0].dataset.previewState === 'idle'), 'closing the picker resets preview state');
    assert.ok(videos.every(video => !video.listeners.has('loadeddata') && !video.listeners.has('error')),
        'closing the picker removes the temporary preview handlers');
    panelListeners.get('video-lyrics-background')();
    assert.equal(previewCards[4].children[0].dataset.previewState, 'loading');
    staleLoadedData();
    assert.equal(previewCards[4].children[0].dataset.previewState, 'loading', 'a stale event from the previous open cannot clear the current loading state');
    videos[4].dispatch('loadeddata');
    assert.equal(previewCards[4].children[0].dataset.previewState, 'ready', 'the current open handler still handles loadeddata');
    dialog.close();
    active = false; callbacks[0](); active = true; callbacks[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([...saveCalls.keys()], ['white-stars:2', 'blue-weightless:1', 'green-lense-glare:1'], 'revisiting the page does not persist unselected videos');
});
test('failed and empty downloads reject and can be retried', async () => {
    let attempt = 0;
    const m = media({ store: { get: async () => { throw new Error('unavailable'); } }, fetchMedia: async () => { attempt++; return { ok: attempt !== 1, blob: async () => new Blob(attempt === 2 ? [] : ['video']) }; } });
    await assert.rejects(m.load(entry), /could not download/); await assert.rejects(m.load(entry), /empty/);
    assert.ok(await m.load(entry)); assert.equal(attempt, 3);
});
test('personal selection is session-only, validated, and never sent to cache or network', async () => {
    const elements = [], backgrounds = [], statuses = []; let loads = 0, saves = 0, probes = 0, deferredProbe = null;
    function element() {
        const node = { children: [], dataset: {}, attributes: {}, classList: { contains: () => false, add() {}, remove() {} }, append(...children) { this.children.push(...children); }, after(...children) { this.afterChildren = children; }, setAttribute(name, value) { this.attributes[name] = String(value); }, addEventListener() {}, close() { this.open = false; }, pause() {}, load() {}, removeAttribute(name) { delete this[name]; }, querySelector(selector) { if (!this.queries) this.queries = {}; return this.queries[selector] ||= element(); } };
        elements.push(node); return node;
    }
    const panel = element(), window = {
        eclyricsVideoLyrics: { panel, status: (message, error) => statuses.push({ message, error }), getState: () => ({ background: backgrounds.at(-1) }), setBackground: value => backgrounds.push(value) },
        eclyricsVideoLocalMedia: { create: () => ({ load: async () => { loads++; }, save: async () => { saves++; }, isSaved: async () => false }), probe: async file => { probes++; if (deferredProbe) { const request = deferredProbe; deferredProbe = null; await request.promise; } if (file.name === 'invalid') throw new Error('Unsupported video'); } },
    };
    vm.runInNewContext(fs.readFileSync('public/js/features/video-lyrics/backgrounds.js', 'utf8'), { window, document: { createElement: element }, MutationObserver: class { observe() {} disconnect() {} } });
    assert.equal(loads, 0, 'inactive Video panel must not download default media');
    const picker = elements.find(n => n.type === 'file');
    const uploadButton = elements.find(n => n.dataset.baseLabel === 'Add your own video for this session');
    const file = { name: 'personal.mp4', size: 100 };
    let finishProbe; deferredProbe = { promise: new Promise(resolve => { finishProbe = resolve; }) };
    picker.files = [file]; picker.onchange();
    assert.equal(uploadButton.attributes['aria-label'], 'Add your own video for this session. Checking video.', 'the upload card announces that the selected video is being checked');
    assert.equal(uploadButton.attributes['aria-busy'], 'true');
    finishProbe(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(backgrounds.length, 1); assert.equal(backgrounds[0].blob, file); assert.equal(backgrounds[0].id, 'session-1');
    assert.equal(loads, 0); assert.equal(saves, 0); assert.equal(probes, 1);
    assert.equal(uploadButton.attributes['aria-label'], 'Add your own video for this session', 'the upload card restores its session-only label after import');
    assert.equal(uploadButton.attributes['aria-busy'], 'false');
    picker.files = [{ name: 'empty', size: 0 }]; await picker.onchange(); await new Promise(resolve => setImmediate(resolve));
    picker.files = [{ name: 'invalid', size: 1 }]; await picker.onchange(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(backgrounds.length, 1); assert.equal(statuses.at(-1).error, true);
    assert.equal(uploadButton.attributes['aria-label'], 'Add your own video for this session', 'the session-only upload label is restored after a rejected import too');
    assert.equal(uploadButton.attributes['aria-busy'], 'false');
});
