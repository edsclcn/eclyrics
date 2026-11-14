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
    const textFormattingToken = '20261017-lyric-sync';
    const videoBlankAdaptationToken = '20261114-video-blank-adaptation';
    const textPreviewCssToken = '20261114-sync-two-column-lineup';
    const textPreviewHeadingToken = '20261114-text-preview-heading';
    const textPreviewScriptToken = '20261114-text-preview-future-line-opacity';
    const previewToken = '20261017-sync-preview-refinement';
    const videoPositionToken = '20261017-video-position-controls';
    const speedPresetToken = '20261114-number-speed-presets';
    const compactVideoRowToken = '20261017-sync-balanced-preview-rows';
    const shell = read('public/index.html');
    const prompter = read('public/prompter.html');
    const bootstrap = read('public/js/core/app-bootstrap.js');

    assert.match(shell, new RegExp(`assets/css/index\\.css\\?v=${textPreviewCssToken}`));
    assert.match(shell, new RegExp(`assets/css/video-lyrics\\.css\\?v=${videoBlankAdaptationToken}`));
    assert.match(shell, new RegExp(`assets/css/video-prompter\\.css\\?v=${compactVideoRowToken}`));
    assert.match(shell, new RegExp(`js/core/app-bootstrap\\.js\\?v=${videoBlankAdaptationToken}`));
    assert.match(prompter, new RegExp(`js/features/prompter/prompter\\.js\\?v=${speedPresetToken}`));
    assert.ok(bootstrap.includes(`js/features/editor/index.js?v=${textPreviewScriptToken}`), 'Text editor uses the future-line preview token');
    assert.ok(bootstrap.includes(`js/features/editor/textformatting.js?v=${textFormattingToken}`), 'Text formatting uses its restored lyric token');
    assert.ok(bootstrap.includes(`js/features/video-lyrics/index.js?v=${videoBlankAdaptationToken}`), 'Video UI uses the Blank and Adaptation token');
    assert.ok(bootstrap.includes(`js/features/video-lyrics/backgrounds.js?v=${previewToken}`), 'Video backgrounds retain their preview refinement token');
    assert.ok(bootstrap.includes(`js/features/video-lyrics/model.js?v=${videoBlankAdaptationToken}`), 'Video model uses the Blank and Adaptation token');
    assert.ok(bootstrap.includes(`js/features/video-lyrics/stage.js?v=${videoPositionToken}`), 'Video output stage uses the position and speed token');
    assert.ok(bootstrap.includes(`js/features/video-lyrics/output.js?v=${videoBlankAdaptationToken}`), 'Video output bridge uses the Blank token');
    assert.match(bootstrap, new RegExp(`cacheVersion: '${textPreviewHeadingToken}'`));
    assert.equal((bootstrap.match(new RegExp(`cacheVersion: '${textPreviewHeadingToken}'`, 'g')) || []).length, 1,
        'the Text fragment retains its preview-heading token');
    assert.ok(bootstrap.includes(`file: 'video-lyrics.html', panelId: 'panel-video', cacheVersion: '${videoBlankAdaptationToken}'`),
        'the lazy-loaded Video fragment uses the Blank and Adaptation token');
});

test('each source lyric line is retained as one semantic span for direct video sync', () => {
    const source = read('public/js/features/editor/textformatting.js');
    const window = {};
    const context = { window };
    vm.runInNewContext(`${source}\nglobalThis.formatForTest = formatText;`, context);

    assert.equal(context.formatForTest('First source line\nSecond source line'),
        '<span data-prompter-source-line="0">First source line</span>\n<span data-prompter-source-line="1">Second source line</span>');
    const wrappedLine = context.formatForTest('A wrapped line with (emphasis)');
    assert.equal(wrappedLine, '<span data-prompter-source-line="0">A wrapped line with <em>(emphasis)</em></span>');
    assert.equal((wrappedLine.match(/data-prompter-source-line/g) || []).length, 1,
        'nested formatting remains inside one semantic source-line span');
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

test('Text preview future-line dimming follows valid positions, survives rerenders, and stays preview-only', () => {
    const editor = read('public/js/features/editor/index.js');
    const updateOpacity = extractFunction(editor, 'updatePreviewFutureLineOpacity');
    const updateViewfinder = extractFunction(editor, 'updateLiveViewfinder');
    const initPrompterBroadcast = extractFunction(editor, 'initPrompterBroadcast');
    let sourceLines = [];
    const makeLine = sourceLineIndex => {
        const classes = new Set();
        return {
            dataset: { prompterSourceLine: String(sourceLineIndex) },
            classes,
            classList: {
                toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
                contains: name => classes.has(name),
            },
        };
    };
    sourceLines = [0, 1, 2].map(makeLine);
    const viewfinder = {
        className: '',
        textContent: '',
        set innerHTML(html) {
            this.html = html;
            sourceLines = [...String(html).matchAll(/data-prompter-source-line="(\d+)"/g)].map(match => makeLine(match[1]));
        },
        get innerHTML() { return this.html; },
        querySelectorAll(selector) {
            assert.equal(selector, '[data-prompter-source-line]');
            return sourceLines;
        },
    };
    const document = { getElementById: id => id === 'lyrics-preview-viewfinder' ? viewfinder : null };
    const liveTextarea = { value: 'First line\nCurrent line\nFuture line' };
    let stageHtml = null;
    const channel = { onmessage: null };
    function BroadcastChannel(name) {
        assert.equal(name, 'eclyrics-prompter');
        return channel;
    }
    document.querySelector = selector => {
        assert.ok(['.preview-viewfinder-16x9', '.preview-viewfinder-slot'].includes(selector));
        return null;
    };
    const preview = new Function(
        'document', 'getLivePrompterTextarea', 'isPrompterWindowOpen', 'getPrompterStageBlockHtml',
        'setLivePreviewHtml', 'applyViewfinderFromPrompterSync', 'window', 'BroadcastChannel', 'PROMPTER_BC_NAME',
        'handlePrompterWorkspaceShortcutMessage', 'getSyncGuardApi', 'ingestPrompterSyncBroadcast', 'ResizeObserver',
        `let lastPrompterPosition = null;\nlet lastPrompterSync = null;\nlet prompterBroadcast = null;\n${updateOpacity}\n${updateViewfinder}\n${initPrompterBroadcast}\nreturn {
            setSync(sync) { lastPrompterSync = sync; },
            render: updateLiveViewfinder,
            init: initPrompterBroadcast,
            channel: () => prompterBroadcast,
        };`,
    )(
        document,
        () => liveTextarea,
        () => true,
        () => stageHtml,
        (element, text) => {
            element.className = '';
            element.innerHTML = text.split('\n').map((line, index) => `<span data-prompter-source-line="${index}">${line}</span>`).join('\n');
        },
        () => {},
        { addEventListener(name, handler) { assert.equal(name, 'message'); assert.equal(typeof handler, 'function'); } },
        BroadcastChannel,
        'eclyrics-prompter',
        () => {},
        () => { throw new Error('position messages must bypass sync normalization'); },
        () => { throw new Error('position messages must bypass sync ingestion'); },
        undefined,
    );
    const sync = { lineupKey: 'text-tab-1', currentIndex: 0 };
    const dimmedIndexes = () => sourceLines.filter(line => line.classList.contains('is-future-source-line'))
        .map(line => Number(line.dataset.prompterSourceLine));
    const position = (lineupKey, blockIndex, sourceLineIndex) => ({
        type: 'eclyrics-prompter-position', lineupKey, blockIndex, sourceLineIndex,
    });
    const sendPosition = position => preview.channel().onmessage({ data: position });

    preview.setSync(sync);
    preview.init();
    assert.equal(typeof preview.channel().onmessage, 'function', 'initPrompterBroadcast registers the position message handler');
    sendPosition(position('text-tab-1', 0, null));
    assert.deepEqual(dimmedIndexes(), [], 'an initial null source-line position leaves the preview undimmed');

    sendPosition(position('text-tab-1', 0, 1));
    assert.deepEqual(dimmedIndexes(), [2], 'only lines after the current source line are dimmed');

    sendPosition(position('text-tab-1', 0, null));
    assert.deepEqual(dimmedIndexes(), [2], 'a null position in the same lineup and block preserves the last valid fade');

    sendPosition(position('text-tab-1', 0, 2));
    assert.deepEqual(dimmedIndexes(), [], 'a newer position restores lines that are no longer in the future');

    for (const otherPosition of [
        { type: 'eclyrics-prompter-position', lineupKey: 'another-tab', blockIndex: 0, sourceLineIndex: 1 },
        { type: 'eclyrics-prompter-position', lineupKey: 'text-tab-1', blockIndex: 1, sourceLineIndex: 1 },
    ]) {
        sendPosition(position('text-tab-1', 0, 0));
        assert.deepEqual(dimmedIndexes(), [1, 2], 'a valid position dims only later source lines');
        sendPosition(otherPosition);
        assert.deepEqual(dimmedIndexes(), [], 'valid positions from another lineup or block clear prior dimming');
    }

    for (const changedLocation of [
        position('text-tab-1', 1, null),
        position('another-tab', 0, null),
    ]) {
        sendPosition(position('text-tab-1', 0, 0));
        assert.deepEqual(dimmedIndexes(), [1, 2], 'a current valid line dims later lines before the null update');
        sendPosition(changedLocation);
        assert.deepEqual(dimmedIndexes(), [], 'a null position for a different block or lineup clears the old fade');
    }

    sendPosition(position('text-tab-1', 0, 1));
    assert.deepEqual(dimmedIndexes(), [2], 'a valid line after a cleared location establishes a new fade');
    preview.render();
    const firstRenderLines = sourceLines;
    assert.deepEqual(dimmedIndexes(), [2], 'the raw Text preview render receives the current dimming state');

    stageHtml = '<span data-prompter-source-line="0">First, refreshed</span><span data-prompter-source-line="1">Current, refreshed</span><span data-prompter-source-line="2">Future, refreshed</span><span data-prompter-source-line="3">Later</span>';
    preview.render();
    assert.notEqual(sourceLines[0], firstRenderLines[0], 'rerender creates new semantic source spans');
    assert.deepEqual(dimmedIndexes(), [2, 3], 'the stage HTML render reapplies the position to its new spans');

    const css = read('public/assets/css/index.css');
    const sourceLineRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map(([, selector, declarations]) => ({ selector: selector.trim(), declarations }))
        .filter(rule => rule.selector.includes('[data-prompter-source-line]'));
    const baseSourceLineRule = sourceLineRules.find(rule => rule.selector === '#lyrics-preview-viewfinder [data-prompter-source-line]');
    const opacityRules = sourceLineRules.filter(rule => /(?:^|;)\s*opacity\s*:/.test(rule.declarations));

    assert.ok(baseSourceLineRule, 'all Text preview source spans have a base rule');
    assert.match(baseSourceLineRule.declarations, /transition:\s*opacity 0\.2s ease;/,
        'the transition remains when the future class is removed');
    assert.deepEqual(opacityRules.map(rule => rule.selector), [
        '#lyrics-preview-viewfinder [data-prompter-source-line].is-future-source-line',
    ], 'opacity is declared only by the preview-scoped future-line rule');
    assert.match(opacityRules[0].declarations, /opacity:\s*0\.42;/);
});
