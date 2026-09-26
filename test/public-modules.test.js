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

test('smart quote normalization maps every requested single-quote form to an apostrophe', () => {
    const window = loadBrowserScript('public/js/features/editor/smart-quotes.js');
    const normalize = window.eclyricsSmartQuotes.normalizeSmartQuotes;

    assert.equal(normalize("'‘‛＇ʼʻˈ\u0060"), '’’’’’’’’');
    assert.equal(normalize('‘quoted’ \u0060word\u0060'), '’quoted’ ’word’');
    assert.equal(normalize('"quoted"'), '“quoted”');
    assert.equal(normalize('“quoted“'), '“quoted”');
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

test('song model labels matching adaptation titles and names their differing source', () => {
    const window = loadBrowserScript('public/js/library/song-model.js');
    const model = window.eclyricsSongModel;
    const adaptation = { title: 'PANGAKO KO', category: ['ADAPTATION'], adaptOf: 'My Way' };
    const sameTitle = { title: 'PANGAKO KO', category: ['ADAPTATION'], adaptOf: 'pangako ko' };
    const nonAdaptation = { title: 'PANGAKO KO', category: ['ORIGINAL'], adaptOf: 'pangako ko' };

    assert.equal(model.getSongAdaptationLabel(adaptation), '(Adaptation of “My Way”)');
    assert.equal(model.getSongAdaptationLabel(sameTitle), '(Adaptation)');
    assert.equal(model.getSongAdaptationLabel(nonAdaptation), '');
});

test('lineup parser omits the adaptation marker from exported lyrics', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'public/js/features/editor/port.js'), 'utf8');
    const window = {};
    const context = {
        window,
        document: { getElementById: () => null, addEventListener: () => {} },
        console,
        setTimeout,
        clearTimeout,
    };
    context.globalThis = context;
    vm.runInNewContext(`${source}\nwindow.testParseBlockSummary = parseBlockSummary;`, context, {
        filename: 'public/js/features/editor/port.js',
    });

    const summary = window.testParseBlockSummary('PANGAKO KO\n(Adaptation)\n\nFirst lyric line');

    assert.equal(summary.title, 'PANGAKO KO');
    assert.equal(summary.lyrics, 'First lyric line');
});

test('prompt formatter italicizes the matching adaptation marker', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'public/js/features/editor/textformatting.js'), 'utf8');
    const window = {};
    const context = { window };
    context.globalThis = context;
    vm.runInNewContext(`${source}\nwindow.testFormatText = formatText;`, context, {
        filename: 'public/js/features/editor/textformatting.js',
    });

    assert.equal(window.testFormatText('(Adaptation)'), '<em>(Adaptation)</em>');
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

test('Admin quoted search matches an exact phrase across fields without normalizing spacing or punctuation', () => {
    const window = loadBrowserScript('public/js/features/editor/smart-quotes.js');
    loadBrowserScript('public/js/library/song-search.js', { window });
    const search = window.eclyricsSongSearch;
    const songs = [
        { id: 'title', title: 'Sa ’yo, Mahal' },
        { id: 'adapt', title: 'Other', adaptOf: 'SA ’YO' },
        { id: 'hymn', title: 'Other', hymnNum: 'sa ’yo' },
        { id: 'lyrics', title: 'Other', lyrics: 'Sing SA ’YO today' },
        // Quoted search normalizes the input apostrophe to match normalized saved text.
        { id: 'smart-apostrophe', title: 'Other', lyrics: 'sa ’yo' },
        { id: 'missing-apostrophe', title: 'Other', lyrics: 'sa yo' },
        { id: 'extra-space', title: 'Other', lyrics: "sa  'yo" },
        { id: 'different-punctuation', title: 'Other', lyrics: 'sa-yo' },
    ];

    const matches = search.searchAdmin(songs, null, `"sa 'yo"`);
    assert.deepEqual(
        matches.map((song) => song.id).sort(),
        ['title', 'adapt', 'hymn', 'lyrics', 'smart-apostrophe'].sort(),
    );

    // The shared search still treats quoted text as a normalized phrase.
    assert.ok(search.search(songs, null, `"sa 'yo"`, 10).some((song) => song.id === 'missing-apostrophe'));
});

test('Admin exact search accepts ASCII and smart quote delimiters while preserving hyphens', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const songs = [
        { id: 'hyphenated', title: 'Pag-ibig' },
        { id: 'spaced', title: 'Pag ibig' },
        { id: 'joined', title: 'Pagibig' },
    ];

    for (const query of ['"Pag-ibig"', '“Pag-ibig”']) {
        assert.deepEqual(
            search.searchAdmin(songs, null, query).map((song) => song.id),
            ['hyphenated'],
        );
    }
});

test('Admin exact quoted search returns every match while unquoted search keeps the shared limit and ranking', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const manyMatches = Array.from({ length: 12 }, (_, index) => ({
        id: `song-${index}`,
        title: `Song ${index}`,
        lyrics: `Sa 'yo appears here ${index}`,
    }));

    assert.equal(search.searchAdmin(manyMatches, null, `"sa 'yo"`).length, 12);

    const ordinarySongs = Array.from({ length: 14 }, (_, index) => ({
        id: `ordinary-${index}`,
        title: `Unique phrase ${index}`,
        lyrics: 'An ordinary lyric',
    }));
    const query = 'unique phrase';
    assert.deepEqual(
        search.searchAdmin(ordinarySongs, null, query).map((song) => song.id),
        search.search(ordinarySongs, null, query, 10).map((song) => song.id),
    );
});

test('workspace help removes the category step and skip control', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/index.html'), 'utf8');
    const tour = fs.readFileSync(path.join(repoRoot, 'public/js/features/editor/workspace-tour.js'), 'utf8');

    assert.match(html, /<span class="sidebar-utility-label">Help<\/span>/);
    assert.match(html, /title="Help" aria-label="Help"/);
    assert.match(html, /aria-label="Close help"/);
    assert.doesNotMatch(html, /Help &amp; tour|Help and workspace tour|workspace-tour-skip|Skip tour/);
    assert.doesNotMatch(tour, /Know the library categories|workspace-tour-skip/);
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
