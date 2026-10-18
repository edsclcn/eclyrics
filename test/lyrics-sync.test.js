const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name}() exists`);
    const signatureEnd = source.indexOf(') {', start);
    const bodyStart = signatureEnd + 2;
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    assert.fail(`${name}() has a complete body`);
}

test('Text Lyrics is the only Sync control and stays the primary workspace', () => {
    const text = read('public/modules/text-lyrics.html');
    const video = read('public/modules/video-lyrics.html');
    const textToggles = [...text.matchAll(/<input[^>]*data-lyrics-sync-toggle[^>]*>/g)];
    const videoToggles = [...video.matchAll(/<input[^>]*data-lyrics-sync-toggle[^>]*>/g)];

    assert.match(text, /id="panel-text" class="panel is-active"/);
    assert.match(text, /id="workspace"/);
    assert.match(video, /id="panel-video" class="panel video-lyrics-panel"/);
    assert.match(video, /class="video-lyrics-workspace"/);
    assert.equal(textToggles.length, 1, 'Text Lyrics exposes the Sync switch');
    assert.equal(videoToggles.length, 0, 'Video Lyrics has no independent Sync switch');
    assert.doesNotMatch(textToggles[0][0], /\bchecked\b/, 'Sync is off by default');
});

test('the Text to Video sync and preview refinement cache tokens match their entry points', () => {
    const oneWayToken = '20261017-text-video-one-way';
    const previewToken = '20261017-sync-preview-refinement';
    const videoPositionToken = '20261017-video-position-controls';
    const compactVideoRowToken = '20261017-sync-balanced-preview-rows';
    const shell = read('public/index.html');
    const prompter = read('public/prompter.html');
    const bootstrap = read('public/js/core/app-bootstrap.js');

    assert.match(shell, new RegExp(`assets/css/index\\.css\\?v=${compactVideoRowToken}`));
    assert.match(shell, new RegExp(`assets/css/video-lyrics\\.css\\?v=${compactVideoRowToken}`));
    assert.match(shell, new RegExp(`assets/css/video-prompter\\.css\\?v=${compactVideoRowToken}`));
    assert.match(shell, new RegExp(`js/core/app-bootstrap\\.js\\?v=${compactVideoRowToken}`));
    assert.match(prompter, new RegExp(`js/features/prompter/prompter\\.js\\?v=${oneWayToken}`));
    assert.ok(bootstrap.includes(`js/features/editor/index.js?v=${oneWayToken}`), 'Text editor uses the one-way sync token');
    assert.ok(bootstrap.includes(`js/features/video-lyrics/index.js?v=${videoPositionToken}`), 'Video control behavior uses the position and speed token');
    assert.ok(bootstrap.includes(`js/features/video-lyrics/backgrounds.js?v=${previewToken}`), 'Video backgrounds retain their preview refinement token');
    assert.ok(bootstrap.includes(`js/features/video-lyrics/model.js?v=${videoPositionToken}`), 'Video model settings use the position and speed token');
    assert.ok(bootstrap.includes(`js/features/video-lyrics/stage.js?v=${videoPositionToken}`), 'Video output stage uses the position and speed token');
    assert.ok(bootstrap.includes(`js/features/video-lyrics/output.js?v=${videoPositionToken}`), 'Video output bridge uses the position and speed token');
    assert.match(bootstrap, new RegExp(`cacheVersion: '${previewToken}'`));
    assert.equal((bootstrap.match(new RegExp(`cacheVersion: '${previewToken}'`, 'g')) || []).length, 1,
        'the Text fragment retains its preview refinement token');
    assert.ok(bootstrap.includes(`file: 'video-lyrics.html', panelId: 'panel-video', cacheVersion: '${videoPositionToken}'`),
        'the lazy-loaded Video fragment uses the position and speed token');
});

test('each source lyric line is retained as one semantic span for direct video sync', () => {
    const source = read('public/js/features/editor/textformatting.js');
    const window = {};
    const context = { window };
    vm.runInNewContext(`${source}\nglobalThis.formatForTest = formatText;`, context);

    assert.equal(context.formatForTest('First source line\nSecond source line'),
        '<span data-prompter-source-line="0">First source line</span>\n<span data-prompter-source-line="1">Second source line</span>');
});

test('the Video lineup projection includes each Text block and preserves original source line indexes', () => {
    const source = read('public/js/features/editor/index.js');
    const projection = extractFunction(source, 'buildTextLineupProjection');
    const values = new Map([
        ['textarea-tab-a-1', 'Opening\n\nSecond line'],
        ['textarea-tab-a-2', '  Chorus  \nLast line'],
    ]);
    const document = { getElementById: id => values.has(id) ? { value: values.get(id) } : null };
    const normalizeSmartQuotes = text => text.replace(/[’‘]/g, "'");
    const build = new Function(
        'document', 'window', 'getLineupKeyForTab',
        `${projection}; return buildTextLineupProjection;`,
    )(document, { eclyricsSmartQuotes: { normalizeSmartQuotes } }, tabId => `text-${tabId}`);

    assert.deepEqual(build('tab-a'), {
        lineupKey: 'text-tab-a',
        blocks: [
            { blockIndex: 0, title: 'Opening', lines: [{ sourceLineIndex: 0, text: 'Opening' }, { sourceLineIndex: 2, text: 'Second line' }] },
            { blockIndex: 1, title: 'Chorus', lines: [{ sourceLineIndex: 0, text: 'Chorus' }, { sourceLineIndex: 1, text: 'Last line' }] },
        ],
    });
});

test('the default 50% marker selects the Text line at its reading point, and moving it changes the selected line', () => {
    const source = read('public/js/features/prompter/prompter.js');
    const scan = extractFunction(source, 'getActiveSourceLine');
    const stage = { getBoundingClientRect: () => ({ top: 100, height: 200 }) };
    const sourceLines = [
        { textContent: 'First source line', dataset: { prompterSourceLine: '0' }, getClientRects: () => [{ top: 120, bottom: 150, width: 180, height: 30 }] },
        { textContent: '  A wrapped\nsource line  ', dataset: { prompterSourceLine: '1' }, getClientRects: () => [
            { top: 180, bottom: 198, width: 180, height: 18 },
            { top: 198, bottom: 220, width: 120, height: 22 },
        ] },
    ];
    const content = { querySelectorAll: selector => selector === '[data-prompter-source-line]' ? sourceLines : [] };
    const getActive = ratio => new Function(
        'prompterContainer', 'prompterContent', 'prompterReadingMarkerRatio',
        `${scan}; return getActiveSourceLine;`,
    )(stage, content, ratio)();

    assert.deepEqual(getActive(0.5), { lineText: 'A wrapped source line', sourceLineIndex: 1 }, 'the default marker uses the full semantic source line, including its wrapped fragment');
    assert.deepEqual(getActive(0.15), { lineText: 'First source line', sourceLineIndex: 0 }, 'moving the marker upward selects the earlier source lyric');
});

test('the open Text prompter accepts and persists marker changes, then immediately rebroadcasts its line position', () => {
    const source = read('public/js/features/prompter/prompter.js');
    const handlerStart = source.indexOf("prompterBroadcastChannel.addEventListener('message', event => {");
    const bodyStart = source.indexOf('=> {', handlerStart) + 3;
    let depth = 0, handlerEnd = -1;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}' && --depth === 0) { handlerEnd = index; break; }
    }
    assert.ok(handlerStart >= 0 && handlerEnd > bodyStart, 'the BroadcastChannel handler exists');
    const handlerBody = source.slice(bodyStart + 1, handlerEnd);
    const scanCalls = [];
    const context = {
        ratio: 0.5,
        saved: new Map(),
        scans: scanCalls,
        clampPrompterReadingMarkerRatio: value => Math.max(0.1, Math.min(0.9, Number(value))),
        localStorage: { saved: new Map(), setItem(key, value) { this.saved.set(key, value); } },
        PROMPTER_READING_MARKER_STORAGE_KEY: 'eclyrics-prompter-reading-marker-ratio',
        broadcastSemanticPosition(force) { scanCalls.push(force); },
    };
    const executable = `let prompterReadingMarkerRatio = ratio;\nfunction receive(event) {${handlerBody}}\nglobalThis.getRatio = () => prompterReadingMarkerRatio;`;
    vm.runInNewContext(executable, context);

    context.receive({ data: { type: 'eclyrics-prompter-marker', ratio: 0.73 } });
    assert.equal(context.getRatio(), 0.73);
    assert.equal(context.localStorage.saved.get('eclyrics-prompter-reading-marker-ratio'), '0.73');
    assert.deepEqual(context.scans, [true]);

    context.receive({ data: { type: 'eclyrics-prompter-marker', ratio: 1.4 } });
    assert.equal(context.getRatio(), 0.9, 'the receiving prompter enforces the same safe stage margin');
    assert.deepEqual(context.scans, [true, true]);
});
