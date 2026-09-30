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

test('Add Lyrics ranks complete titles, lyric phrases, same-field matches, then scattered fuzzy matches', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const songs = [
        { id: 'scattered-fuzzy', title: 'hope', adaptOf: 'morning', lyrics: 'A juyful song' },
        { id: 'same-field', title: 'Another title', adaptOf: 'hope morning joyful', lyrics: '' },
        { id: 'lyric-phrase', title: 'A different title', lyrics: 'Hope morning joyful brings a new day' },
        { id: 'complete-title', title: 'Hope Morning Joyful', lyrics: '' },
    ];

    assert.deepEqual(
        search.matchSongsForAddLyrics(songs, 'hope morning joyful').map((song) => song.id),
        ['complete-title', 'lyric-phrase', 'same-field', 'scattered-fuzzy'],
    );
});

test('Add Lyrics ranks an unquoted contiguous lyric phrase above noncontiguous same-field terms', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const songs = [
        { id: 'noncontiguous', title: 'A Song', lyrics: 'Hope arrives each day in the morning' },
        { id: 'contiguous', title: 'Another Song', lyrics: 'Hope morning brings a new day' },
    ];

    assert.deepEqual(
        search.matchSongsForAddLyrics(songs, 'hope morning').map((song) => song.id),
        ['contiguous', 'noncontiguous'],
    );
});

test('Add Lyrics mixed queries award lyric-phrase rank only when the full ordered query is contiguous', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const songs = [
        {
            id: 'only-quoted-part-contiguous',
            title: 'A Song',
            lyrics: 'Hope morning begins the day, and joyful voices fill the night',
        },
        { id: 'full-query-contiguous', title: 'Another Song', lyrics: 'Hope morning joyful voices fill the night' },
    ];

    assert.deepEqual(
        search.matchSongsForAddLyrics(songs, '"hope morning" joyful').map((song) => song.id),
        ['full-query-contiguous', 'only-quoted-part-contiguous'],
    );
});

test('Add Lyrics ranks exact same-field matches above fuzzy contiguous lyric phrases', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const songs = [
        { id: 'fuzzy-phrase', title: 'A Song', lyrics: 'Hope mornng brings joy' },
        { id: 'exact-same-field', title: 'Another Song', lyrics: 'Hope arrives each morning with joy' },
    ];

    assert.deepEqual(
        search.matchSongsForAddLyrics(songs, 'hope morning joy').map((song) => song.id),
        ['exact-same-field', 'fuzzy-phrase'],
    );
});

test('Add Lyrics ranks exact same-field matches above prefix-only same-field matches', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const songs = [
        { id: 'prefix', title: 'A Song', lyrics: 'Hopeful mornings bring joy' },
        { id: 'exact', title: 'Another Song', lyrics: 'Hope morning brings joy' },
    ];

    assert.deepEqual(
        search.matchSongsForAddLyrics(songs, 'hope morning joy').map((song) => song.id),
        ['exact', 'prefix'],
    );
});

test('Add Lyrics ranks an exact lyric term above a prefix title term within the same tier', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const songs = [
        { id: 'prefix-title', title: 'Hopeful Song', adaptOf: 'Morning', lyrics: 'Joy' },
        { id: 'exact-lyrics', title: 'Another Song', adaptOf: 'Morning', hymnNum: 'Joy', lyrics: 'Hope' },
    ];

    assert.deepEqual(
        search.matchSongsForAddLyrics(songs, 'hope morning joy').map((song) => song.id),
        ['exact-lyrics', 'prefix-title'],
    );
});

test('Add Lyrics quoted phrases stay within word boundaries and a single field', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const songs = [
        { id: 'exact-phrase', title: 'A Song', lyrics: 'Hope morning brings a new day' },
        { id: 'split-fields', title: 'Hope', adaptOf: 'Morning', lyrics: '' },
        { id: 'inside-word', title: 'A Song', lyrics: 'Unhope morning brings a new day' },
    ];

    assert.deepEqual(
        search.matchSongsForAddLyrics(songs, '"hope morning"').map((song) => song.id),
        ['exact-phrase'],
    );
});

test('Add Lyrics accepts a missing-character typo in multiword titles and lyrics', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const songs = [
        { id: 'title-typo', title: 'Amazing Grace', lyrics: '' },
        { id: 'lyrics-typo', title: 'A Different Song', lyrics: 'Bright morning opens up the sky' },
    ];

    assert.deepEqual(search.matchSongsForAddLyrics(songs, 'amazing grce').map((song) => song.id), ['title-typo']);
    assert.deepEqual(search.matchSongsForAddLyrics(songs, 'bright mornng').map((song) => song.id), ['lyrics-typo']);
});

test('Add Lyrics rejects unrelated words and short non-prefix typo queries', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const songs = [{ id: 'grace', title: 'Amazing Grace', lyrics: 'A song about grace' }];

    assert.deepEqual(search.matchSongsForAddLyrics(songs, 'xylophone').map((song) => song.id), []);
    assert.deepEqual(search.matchSongsForAddLyrics(songs, 'gq').map((song) => song.id), []);
});

test('Add Lyrics matches compact search terms against hyphenated titles without accepting arbitrary infixes', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const song = { id: 'hyphenated-title', title: 'Ama Salamat (Sa Pag-ibig Mong Wagas)', lyrics: '' };

    assert.deepEqual(search.matchSongsForAddLyrics([song], 'pagibig mong wagas').map((match) => match.id), [
        'hyphenated-title',
    ]);
    assert.deepEqual(search.searchAdmin([song], null, 'pagibig mong wagas').map((match) => match.id), [
        'hyphenated-title',
    ]);
    assert.deepEqual(search.matchSongsForAddLyrics([song], 'pag').map((match) => match.id), ['hyphenated-title']);
    assert.deepEqual(search.matchSongsForAddLyrics([song], 'ibig').map((match) => match.id), ['hyphenated-title']);
    assert.deepEqual(search.matchSongsForAddLyrics([song], 'gibi').map((match) => match.id), []);
});

test('Add Lyrics matches and highlights the original hyphenated lyric word', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const song = {
        id: 'hyphenated-lyrics',
        title: 'A Different Song',
        lyrics: 'Ama Salamat, Sa Pag-ibig Mong Wagas.',
    };

    assert.deepEqual(search.matchSongsForAddLyrics([song], 'pagibig mong wagas').map((match) => match.id), [
        'hyphenated-lyrics',
    ]);
    assert.deepEqual(search.searchAdmin([song], null, 'pagibig mong wagas').map((match) => match.id), [
        'hyphenated-lyrics',
    ]);

    const details = search.getLyricsSearchPreviewDetails(song, 'pagibig mong wagas');
    assert.ok(
        details.ranges.some(({ start, end }) => details.text.slice(start, end).includes('Pag-ibig')),
        'a highlight range should cover the original hyphenated lyric word',
    );
});

test('Add Lyrics fully quoted phrase matches a hyphenated compound word', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const song = {
        id: 'hyphenated-phrase',
        title: 'A Different Song',
        lyrics: 'Pag-ibig Mong Wagas is our prayer.',
    };

    assert.deepEqual(
        window.eclyricsSongSearch.matchSongsForAddLyrics([song], '"pagibig mong wagas"').map((match) => match.id),
        ['hyphenated-phrase'],
    );
});

test('Add Lyrics unquoted hyphenated lyric phrase ranks above noncontiguous same-field terms', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const songs = [
        {
            id: 'noncontiguous',
            title: 'A Song',
            lyrics: 'Pag-ibig lights the way; Mong faith remains Wagas.',
        },
        { id: 'contiguous', title: 'Another Song', lyrics: 'Pag-ibig Mong Wagas is our prayer.' },
    ];

    assert.deepEqual(
        window.eclyricsSongSearch.matchSongsForAddLyrics(songs, 'pagibig mong wagas').map((song) => song.id),
        ['contiguous', 'noncontiguous'],
    );
});

test('fully quoted Admin exact search does not compact-match different punctuation', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const song = { id: 'hyphenated', title: 'Ama Salamat (Sa Pag-ibig Mong Wagas)', lyrics: '' };

    assert.deepEqual(
        window.eclyricsSongSearch.matchSongsForAddLyrics([song], '"pagibig mong wagas"').map((match) => match.id),
        ['hyphenated'],
    );
    assert.deepEqual(window.eclyricsSongSearch.searchAdmin([song], null, '"pagibig mong wagas"'), []);
});

test('Add Lyrics treats punctuation-joined Sa Yo as a compound in titles and lyrics', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const songs = [
        { id: 'title-apostrophe', title: "Sa 'Yo", lyrics: '' },
        { id: 'title-hyphen', title: 'Sa-yo', lyrics: '' },
        { id: 'lyrics-apostrophe', title: 'A Song', lyrics: "Singing Sa 'Yo today" },
        { id: 'lyrics-hyphen', title: 'Another Song', lyrics: 'Singing Sa-yo today' },
        { id: 'plain-spaced', title: 'Sa yo', lyrics: '' },
    ];
    const expected = ['title-apostrophe', 'title-hyphen', 'lyrics-apostrophe', 'lyrics-hyphen'];

    assert.deepEqual(search.matchSongsForAddLyrics(songs, 'sayo').map((song) => song.id), expected);
    assert.deepEqual(search.searchAdmin(songs, null, 'sayo').map((song) => song.id), expected);
    assert.deepEqual(search.matchSongsForAddLyrics(songs, '"sayo"').map((song) => song.id), expected);
    assert.deepEqual(search.matchSongsForAddLyrics([songs[4]], 'sayo').map((song) => song.id), []);
});

test('Add Lyrics preview highlights the original punctuation compound and exact Admin stays literal', () => {
    const window = loadBrowserScript('public/js/features/editor/smart-quotes.js');
    loadBrowserScript('public/js/library/song-search.js', { window });
    const search = window.eclyricsSongSearch;
    const song = { id: 'lyrics-apostrophe', title: 'A Song', lyrics: "Singing Sa 'Yo today" };
    const details = search.getLyricsSearchPreviewDetails(song, 'sayo');

    assert.ok(
        details.ranges.some(({ start, end }) => details.text.slice(start, end).includes("Sa 'Yo")),
        'the highlight should include the original apostrophe compound',
    );
    assert.deepEqual(search.matchSongsForAddLyrics([song], '"sayo"').map((match) => match.id), ['lyrics-apostrophe']);
    assert.deepEqual(search.searchAdmin([song], null, '"sayo"'), []);
});

test('Add Lyrics still rejects arbitrary infixes when matching punctuation compounds', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const song = { id: 'pagibig', title: 'Ama Salamat (Sa Pag-ibig Mong Wagas)', lyrics: '' };

    assert.deepEqual(search.matchSongsForAddLyrics([song], 'gibi').map((match) => match.id), []);
});

test('Add Lyrics preview centers a later exact lyric match', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const lyrics = `BEGINNING-ONLY MARKER. ${'pre match filler '.repeat(20)}Here is the promised light for everyone. ${'post match filler '.repeat(20)}`;
    const preview = window.eclyricsSongSearch.getLyricsSearchPreview(
        { title: 'A Song', lyrics },
        '"promised light"',
        100,
    );

    assert.match(preview, /promised light/);
    assert.match(preview, /^…/);
    assert.match(preview, /…$/);
    assert.ok(preview.length <= 100);
    assert.doesNotMatch(preview, /BEGINNING-ONLY MARKER/);
});

test('lyric preview details return excerpt-relative ranges for a later phrase', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const lyrics = `BEGINNING-ONLY MARKER. ${'pre match filler '.repeat(20)}Here is the promised light for everyone. ${'post match filler '.repeat(20)}`;
    const details = window.eclyricsSongSearch.getLyricsSearchPreviewDetails(
        { title: 'A Song', lyrics },
        '"promised light"',
        100,
    );

    assert.match(details.text, /promised light/);
    assert.equal(details.ranges.map(({ start, end }) => details.text.slice(start, end)).join(' '), 'promised light');
    assert.ok(details.ranges[0].start > 0);
    assert.ok(details.text.length <= 100);
});

test('lyric preview details highlight the actual lyric word for a typo query', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const lyrics = `BEGINNING-ONLY MARKER. ${'pre match filler '.repeat(20)}Here is the promised light for everyone. ${'post match filler '.repeat(20)}`;
    const details = window.eclyricsSongSearch.getLyricsSearchPreviewDetails(
        { title: 'A Song', lyrics },
        'promisd',
        100,
    );

    assert.equal(details.ranges.map(({ start, end }) => details.text.slice(start, end)).join(''), 'promised');
    assert.match(details.text, /promised/);
});

test('a title-complete match uses the plain preview instead of a focused lyric excerpt', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const details = window.eclyricsSongSearch.getLyricsSearchPreviewDetails(
        { title: 'Amazing Grace', lyrics: 'Amazing Grace appears again in these lyrics.' },
        'amazing grace',
    );

    assert.equal(details.titleMatch, true);
    assert.equal(details.ranges.length, 0);
    assert.equal(details.text, null);
});

test('Admin exact quoted preview highlights the literal phrase in lyrics only', () => {
    const window = loadBrowserScript('public/js/features/editor/smart-quotes.js');
    loadBrowserScript('public/js/library/song-search.js', { window });
    const details = window.eclyricsSongSearch.getLyricsSearchPreviewDetails(
        { title: 'A Different Title', lyrics: 'Sing SA ’YO today.' },
        `"sa 'yo"`,
        150,
        { exactPhrase: true },
    );

    assert.equal(details.titleMatch, false);
    assert.equal(details.ranges.length, 1);
    const { start, end } = details.ranges[0];
    assert.equal(details.text.slice(start, end), 'SA ’YO');
    assert.equal(details.ranges.length, 1, 'the range should cover the literal lyric phrase only');
});

test('Admin exact quoted preview keeps highlight offsets correct after Unicode lowercase expansions', () => {
    const window = loadBrowserScript('public/js/features/editor/smart-quotes.js');
    loadBrowserScript('public/js/library/song-search.js', { window });
    const details = window.eclyricsSongSearch.getLyricsSearchPreviewDetails(
        { title: 'A Different Title', lyrics: 'İntro\tthen\nExact Phrase appears here.' },
        '"exact phrase"',
        24,
        { exactPhrase: true },
    );

    assert.equal(details.text.slice(details.ranges[0].start, details.ranges[0].end), 'Exact Phrase');
});

test('Add Lyrics preview centers a later close typo match', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const lyrics = `BEGINNING-ONLY MARKER. ${'pre match filler '.repeat(20)}Here is the promised light for everyone. ${'post match filler '.repeat(20)}`;
    const preview = window.eclyricsSongSearch.getLyricsSearchPreview(
        { title: 'A Song', lyrics },
        'promisd',
        100,
    );

    assert.match(preview, /promised/);
    assert.match(preview, /^…/);
    assert.match(preview, /…$/);
    assert.ok(preview.length <= 100);
    assert.doesNotMatch(preview, /BEGINNING-ONLY MARKER/);
});

test('Add Lyrics preview prefers a later complete mixed query over an earlier quoted subphrase', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const lyrics = `EARLY-ONLY. Hope morning. ${'unrelated lyric filler '.repeat(20)}LATER-FULL-QUERY. Hope morning joyful brings light. ${'closing lyric filler '.repeat(20)}`;
    const preview = window.eclyricsSongSearch.getLyricsSearchPreview(
        { title: 'A Song', lyrics },
        '"hope morning" joyful',
        100,
    );

    assert.match(preview, /LATER-FULL-QUERY/);
    assert.match(preview, /Hope morning joyful/);
    assert.doesNotMatch(preview, /EARLY-ONLY/);
    assert.ok(preview.length <= 100);
});

test('metadata-only search preview falls back to the normal lyric preview', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    loadBrowserScript('public/js/library/song-model.js', { window });
    const song = { title: 'Amazing Grace', lyrics: 'First lyric line. Second lyric line.' };
    const matchPreview = window.eclyricsSongSearch.getLyricsSearchPreview(song, 'amazing', 150);

    assert.equal(matchPreview, null);
    assert.equal(
        matchPreview || window.eclyricsSongModel.truncateLyricsPreview(song.lyrics),
        'First lyric line. Second lyric line.',
    );
});

test('Admin unquoted search uses Add Lyrics ranking while shared search keeps the legacy order', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const songs = [
        { id: 'split-fields', title: 'Hope', adaptOf: 'Morning', lyrics: '' },
        { id: 'same-field', title: 'A Song', lyrics: 'Hope arrives each day in the morning' },
    ];

    assert.deepEqual(search.matchSongsForAddLyrics(songs, 'hope morning').map((song) => song.id), [
        'same-field',
        'split-fields',
    ]);
    const legacyResults = search.matchSongs(songs, null, 'hope morning').map((song) => song.id);
    assert.deepEqual(legacyResults, ['split-fields', 'same-field']);
    assert.deepEqual(search.search(songs, null, 'hope morning', 10).map((song) => song.id), legacyResults);
    assert.deepEqual(search.searchAdmin(songs, null, 'hope morning').map((song) => song.id), [
        'same-field',
        'split-fields',
    ]);

    const typoSong = { id: 'typo', title: 'Amazing Grace', lyrics: '' };
    assert.deepEqual(search.searchAdmin([typoSong], null, 'amazing grce').map((song) => song.id), ['typo']);
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
        matches.map((song) => song.id),
        ['adapt', 'lyrics', 'smart-apostrophe', 'hymn', 'title'],
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

test('Admin exact quoted search is uncapped and alphabetical; unquoted results use Add Lyrics top ten', () => {
    const window = loadBrowserScript('public/js/library/song-search.js');
    const search = window.eclyricsSongSearch;
    const manyMatches = Array.from({ length: 12 }, (_, index) => ({
        id: `song-${index}`,
        title: `Song ${index}`,
        lyrics: `Sa 'yo appears here ${index}`,
    }));

    const exactMatches = search.searchAdmin(manyMatches, null, `"sa 'yo"`);
    assert.equal(exactMatches.length, 12);
    assert.deepEqual(
        exactMatches.map((song) => song.title),
        manyMatches
            .map((song) => song.title)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    );

    const ordinarySongs = Array.from({ length: 14 }, (_, index) => ({
        id: `ordinary-${index}`,
        title: `Unique phrase ${index}`,
        lyrics: 'An ordinary lyric',
    }));
    const query = 'unique phrase';
    assert.deepEqual(
        search.searchAdmin(ordinarySongs, null, query).map((song) => song.id),
        search.matchSongsForAddLyrics(ordinarySongs, query).slice(0, 10).map((song) => song.id),
    );
});

test('Admin rendering uses a query-centered preview for searches and opening preview for browse', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'public/js/features/admin/admin-panel.js'), 'utf8');

    assert.match(
        source,
        /appendLyricsSearchPreview\(\s*metaSpan,\s*q\s*\?\s*songDisplay\(\)\?\.getLyricsSearchPreviewDetails\?\.\(song, q, 150, \{ exactPhrase: exactPhraseSearch \}\)\s*:\s*null,\s*truncateLyricsPreviewForRow\(song\.lyrics\)/,
    );
});

test('Add Lyrics and Admin preview renderers insert highlight text without using innerHTML', () => {
    const renderers = [
        'public/js/features/editor/block-source.js',
        'public/js/features/admin/admin-panel.js',
    ];

    for (const relativePath of renderers) {
        const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
        const helperStart = source.indexOf('function appendLyricsSearchPreview(');
        assert.ok(helperStart >= 0, `${relativePath} should render search highlights`);
        const helperEnd = source.indexOf('function ', helperStart + 1);
        const helper = source.slice(helperStart, helperEnd);

        assert.match(helper, /document\.createTextNode/);
        assert.match(helper, /mark\.textContent/);
        assert.doesNotMatch(helper, /innerHTML/);
    }
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
