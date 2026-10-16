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

test('Text and Video lyric sync remain off by default and Text Lyrics stays the primary workspace', () => {
    const text = read('public/modules/text-lyrics.html');
    const video = read('public/modules/video-lyrics.html');
    const textToggle = text.match(/<input[^>]*data-lyrics-sync-toggle[^>]*>/)?.[0];
    const videoToggle = video.match(/<input[^>]*data-lyrics-sync-toggle[^>]*>/)?.[0];

    assert.match(text, /id="panel-text" class="panel is-active"/);
    assert.match(text, /id="workspace"/);
    assert.match(video, /id="panel-video" class="panel video-lyrics-panel"/);
    assert.match(video, /class="video-lyrics-workspace"/);
    assert.ok(textToggle && videoToggle, 'both modes expose the optional Sync switch');
    assert.doesNotMatch(textToggle, /\bchecked\b/);
    assert.doesNotMatch(videoToggle, /\bchecked\b/);
});

test('each source lyric line is retained as one semantic span for direct video sync', () => {
    const source = read('public/js/features/editor/textformatting.js');
    const window = {};
    const context = { window };
    vm.runInNewContext(`${source}\nglobalThis.formatForTest = formatText;`, context);

    assert.equal(context.formatForTest('First source line\nSecond source line'),
        '<span data-prompter-source-line="0">First source line</span>\n<span data-prompter-source-line="1">Second source line</span>');
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
