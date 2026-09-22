const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function loadBrowserScript(relativePath, setup = {}) {
    const window = setup.window || {};
    const context = {
        window,
        console,
        setTimeout,
        clearTimeout,
        requestAnimationFrame: () => 0,
        ...setup,
    };
    context.globalThis = context;
    vm.runInNewContext(
        fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
        context,
        { filename: relativePath },
    );
    return window;
}

test('song model omits original versions and formats named versions in uppercase', () => {
    const window = loadBrowserScript('public/js/library/song-model.js');
    const model = window.eclyricsSongModel;

    assert.equal(model.formatSongVersionDisplay('Original'), '');
    assert.equal(model.formatSongVersionDisplay('Congregational'), 'CONGREGATIONAL');
    assert.equal(model.formatSongVersionDisplay('K&T, Original'), 'K&T, ORIGINAL');
});

test('smart quote normalization converts apostrophe and double-quote variants by context', () => {
    const window = loadBrowserScript('public/js/features/editor/smart-quotes.js');
    const normalize = window.eclyricsSmartQuotes.normalizeSmartQuotes;
    const input = `‘Di ‚wag ‛to ＇yan May’rong lumbay sa ‘yong mata H‘wag mangamba Kailan ma’y ‘di ka mag-iisa "My Way" „Another Way‟ ＂Last Way＂`;

    assert.equal(
        normalize(input),
        `’Di ’wag ’to ’yan May’rong lumbay sa ’yong mata H’wag mangamba Kailan ma’y ’di ka mag-iisa “My Way” “Another Way” “Last Way”`,
    );
});

test('future Firestore payloads normalize quote variants without changing audit fields', () => {
    const window = loadBrowserScript('public/js/features/editor/smart-quotes.js');
    loadBrowserScript('public/js/library/song-model.js', { window });
    const timestamp = { seconds: 123 };
    const payload = window.eclyricsSongModel.buildFirestorePayload(
        {
            title: '‘Di Ka Mag-iisa',
            lyrics: `Kapatid ko, H‘wag mangamba “Araw”`,
            version: 'Congregational',
            adaptOf: '“My Way”',
        },
        { email: 'admin@example.com' },
        () => timestamp,
    );

    assert.equal(payload.title, '’Di Ka Mag-iisa');
    assert.equal(payload.lyrics, `Kapatid ko, H’wag mangamba “Araw”`);
    assert.equal(payload.version, 'Congregational');
    assert.equal(payload['adapt-of'], '“My Way”');
    assert.equal(payload['last-modified'], timestamp);
});

test('song model only shows adaptation source when it differs from the title', () => {
    const window = loadBrowserScript('public/js/library/song-model.js');
    const model = window.eclyricsSongModel;
    const adaptation = { title: 'PANGAKO KO', category: ['ADAPTATION'], adaptOf: 'My Way' };
    const sameTitle = { title: 'PANGAKO KO', category: ['ADAPTATION'], adaptOf: 'pangako ko' };

    assert.equal(model.getSongAdaptationLabel(adaptation), '(Adaptation of “My Way”)');
    assert.equal(model.getSongAdaptationLabel(sameTitle), '');
});

test('song search fallback matches title, adaptation source, and lyrics with limits', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const songs = [
        { id: '1', title: 'Pangako Ko', adaptOf: 'My Way', hymnNum: '', lyrics: 'A promise in the night' },
        { id: '2', title: 'A New Meaning', adaptOf: '', hymnNum: '12', lyrics: 'A song about hope' },
        { id: '3', title: 'Other Song', adaptOf: '', hymnNum: '', lyrics: 'A promise for tomorrow' },
    ];

    assert.deepEqual(search.search(songs, null, 'my way', 10).map((song) => song.id), ['1']);
    assert.deepEqual(search.search(songs, null, 'promise', 1).map((song) => song.id), ['1']);
    assert.deepEqual(search.search(songs, null, '', 2).length, 2);
});

test('block-source module exposes its internal bridge without touching the DOM at load time', () => {
    const window = loadBrowserScript('public/js/features/editor/block-source.js');
    const bridge = window.eclyricsEditorBlockSource;

    assert.equal(typeof bridge.init, 'function');
    assert.equal(typeof bridge.open, 'function');
    assert.equal(typeof bridge.close, 'function');
    assert.equal(typeof bridge.isOpen, 'function');
    assert.equal(bridge.AUTO_PASTE_MIN_CHARS, 50);
});
