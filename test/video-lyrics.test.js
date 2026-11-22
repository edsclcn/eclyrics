const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function model() {
    const window = { eclyricsVideoFonts: { allowedFamilies: ['Satoshi', 'Inter'] } };
    vm.runInNewContext(fs.readFileSync('public/js/features/video-lyrics/model.js', 'utf8'), { window });
    return window.eclyricsVideoModel.create();
}
function extractPrompterPositionListener(source) {
    const anchor = "prompterPositionChannel.addEventListener('message', event => {";
    const anchorIndex = source.indexOf(anchor);
    assert.ok(anchorIndex >= 0, 'Video Lyrics registers the prompter position listener');
    const arrowStart = source.indexOf('event => {', anchorIndex);
    const bodyStart = source.indexOf('{', arrowStart);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}' && --depth === 0) return source.slice(arrowStart, index + 1);
    }
    assert.fail('the Video Lyrics position listener has a complete body');
}
const song = { id: 'same', title: 'Song', category: ['Original'], lyrics: 'First\r\n\r\nSecond\nThird' };

test('marker-selected Video line ignores stale forward positions and catches up after release', () => {
    const listenerSource = extractPrompterPositionListener(fs.readFileSync('public/js/features/video-lyrics/index.js', 'utf8'));
    const accepted = [];
    const model = { updateTextPosition: position => accepted.push(position.sourceLineIndex) };
    const listener = new Function(
        'model', 'getExpectedPrompterLineupKey',
        `let markerDrivenTextPosition = null;\nlet markerReleaseCatchup = null;\nlet markerMovementDirection = 0;\nlet lastRawTextPosition = null;\nreturn (${listenerSource});`,
    )(model, () => 'text-tab-a');
    const send = (type, sourceLineIndex, active) => listener({ data: {
        type,
        active,
        lineupKey: 'text-tab-a',
        blockIndex: 2,
        sourceLineIndex,
        lineText: `Line ${sourceLineIndex}`,
    } });

    send('eclyrics-prompter-position', 4);
    send('eclyrics-preview-marker-position', 5, true);
    send('eclyrics-prompter-position', 4);
    send('eclyrics-prompter-position', 5);
    assert.deepEqual(accepted, [4, 5], 'raw updates cannot replace the marker-selected line while it is active');

    send('eclyrics-preview-marker-position', 4, false);
    send('eclyrics-prompter-position', 4);
    assert.deepEqual(accepted, [4, 5], 'release waits while the raw position is still behind the marker during downward scrolling');
    send('eclyrics-prompter-position', 5);
    assert.deepEqual(accepted, [4, 5, 5], 'raw follow resumes when it catches up to the marker-selected line');
});

test('marker release preserves upward scrolling and backward navigation', () => {
    const listenerSource = extractPrompterPositionListener(fs.readFileSync('public/js/features/video-lyrics/index.js', 'utf8'));
    const accepted = [];
    const model = { updateTextPosition: position => accepted.push(position.sourceLineIndex) };
    const listener = new Function(
        'model', 'getExpectedPrompterLineupKey',
        `let markerDrivenTextPosition = null;\nlet markerReleaseCatchup = null;\nlet markerMovementDirection = 0;\nlet lastRawTextPosition = null;\nreturn (${listenerSource});`,
    )(model, () => 'text-tab-a');
    const send = (type, sourceLineIndex, active) => listener({ data: {
        type,
        active,
        lineupKey: 'text-tab-a',
        blockIndex: 2,
        sourceLineIndex,
        lineText: `Line ${sourceLineIndex}`,
    } });

    send('eclyrics-prompter-position', 6);
    send('eclyrics-preview-marker-position', 6, true);
    send('eclyrics-preview-marker-position', 5, true);
    send('eclyrics-prompter-position', 6);
    assert.deepEqual(accepted, [6, 6, 5], 'the marker can move backward while retaining the newer visual cue');

    send('eclyrics-preview-marker-position', 6, false);
    send('eclyrics-prompter-position', 6);
    assert.deepEqual(accepted, [6, 6, 5], 'an old later raw position is ignored after upward marker movement');
    send('eclyrics-prompter-position', 5);
    assert.deepEqual(accepted, [6, 6, 5, 5], 'raw follow resumes at the backward-scrolled line');
});

test('marker release with a null raw index keeps stale lines suppressed until catch-up', () => {
    const listenerSource = extractPrompterPositionListener(fs.readFileSync('public/js/features/video-lyrics/index.js', 'utf8'));
    const accepted = [];
    const model = { updateTextPosition: position => accepted.push(position.sourceLineIndex) };
    const listener = new Function(
        'model', 'getExpectedPrompterLineupKey',
        `let markerDrivenTextPosition = null;\nlet markerReleaseCatchup = null;\nlet markerMovementDirection = 0;\nlet lastRawTextPosition = null;\nreturn (${listenerSource});`,
    )(model, () => 'text-tab-a');
    const send = (type, sourceLineIndex, active) => listener({ data: {
        type,
        active,
        lineupKey: 'text-tab-a',
        blockIndex: 2,
        sourceLineIndex,
        lineText: Number.isInteger(sourceLineIndex) ? `Line ${sourceLineIndex}` : '',
    } });

    send('eclyrics-prompter-position', 4);
    send('eclyrics-preview-marker-position', 5, true);
    send('eclyrics-preview-marker-position', null, false);
    send('eclyrics-prompter-position', 4);
    assert.deepEqual(accepted, [4, 5], 'a null release cannot let the stale previous line replace the marker cue');
    send('eclyrics-prompter-position', 5);
    assert.deepEqual(accepted, [4, 5, 5], 'the raw position resumes after catching up');
});

test('raw direction reversal updates catch-up direction while the marker cue stays active', () => {
    const listenerSource = extractPrompterPositionListener(fs.readFileSync('public/js/features/video-lyrics/index.js', 'utf8'));
    const accepted = [];
    const model = { updateTextPosition: position => accepted.push(position.sourceLineIndex) };
    const listener = new Function(
        'model', 'getExpectedPrompterLineupKey',
        `let markerDrivenTextPosition = null;\nlet markerReleaseCatchup = null;\nlet markerMovementDirection = 0;\nlet lastRawTextPosition = null;\nreturn (${listenerSource});`,
    )(model, () => 'text-tab-a');
    const send = (type, sourceLineIndex, active) => listener({ data: {
        type,
        active,
        lineupKey: 'text-tab-a',
        blockIndex: 2,
        sourceLineIndex,
        lineText: `Line ${sourceLineIndex}`,
    } });

    send('eclyrics-prompter-position', 4);
    send('eclyrics-preview-marker-position', 5, true);
    send('eclyrics-prompter-position', 6);
    send('eclyrics-prompter-position', 4);
    assert.deepEqual(accepted, [4, 5], 'raw direction changes cannot override the still-active marker cue');
    send('eclyrics-preview-marker-position', 4, false);
    assert.deepEqual(accepted, [4, 5, 4], 'release follows the latest upward direction instead of waiting for the stale forward path');
});

test('duplicate songs retain independent stable identities through reorder and removal', () => {
    const m = model(), a = m.add(song), b = m.add(song), c = m.add(song);
    assert.notEqual(a, b); m.move(c, -1);
    assert.deepEqual(Array.from(m.getState().lineup, e => e.id), [a, c, b]);
    m.remove(c); m.move(a, -1); m.move(b, 1);
    assert.deepEqual(Array.from(m.getState().lineup, e => e.id), [a, b]);
});
test('preparing another song isolates live output; removing live clears lyrics but retains background', () => {
    const m = model(), a = m.add(song), b = m.add({ ...song, title: 'Upcoming' });
    const background = { id: 'ambient' }; m.setBackground(background); m.cue(2); m.prepare(b);
    assert.equal(m.getState().live.entryId, a); assert.equal(m.getState().live.text, 'Second');
    assert.equal(m.getState().preparedIndex, -1); m.remove(a);
    assert.equal(m.getState().live, null); assert.equal(m.getState().background, background);
    assert.equal(m.getState().preparedId, b);
});
test('song title is the first audience cue, then manual navigation skips blank lines and clamps', () => {
    const m = model(); m.advance(1); m.add(song);
    assert.deepEqual(Array.from(m.getState().lineup[0].cues, c => [c.text, c.section, c.isTitle, c.isOutro]), [['Song', -1, true, undefined], ['First', 0, undefined, undefined], ['Second', 1, undefined, undefined], ['Third', 1, undefined, undefined], ['To God be the Glory', 1, undefined, true]]);
    assert.equal(m.getState().live, null);
    m.advance(1); assert.equal(m.getState().live.text, 'Song');
    m.advance(1); assert.equal(m.getState().live.text, 'First');
    m.advance(-1); assert.equal(m.getState().live.index, 0);
    m.advance(1); m.advance(1); m.advance(1); m.advance(1); assert.equal(m.getState().live.index, 4);
    assert.equal(m.getState().live.text, 'To God be the Glory');
    m.cue(99); assert.equal(m.getState().live.index, 4);
    m.remove(m.getState().lineup[0].id); assert.equal(m.getState().live, null);
});
test('Video cue-only lines keep raw source positions while rendering and outputting blank text', () => {
    const standalone = model();
    const standaloneId = standalone.add({
        title: 'Cue Song',
        lyrics: 'First lyric\nInterlude\n ( Instrumental ) \nInterlude returns in a verse\nLast lyric',
    });
    const standaloneCues = standalone.getState().lineup[0].cues;
    assert.deepEqual(Array.from(standaloneCues, cue => [cue.text, cue.isCueOnly || false, cue.displayText]), [
        ['Cue Song', false, undefined],
        ['First lyric', false, undefined],
        ['Interlude', true, ''],
        ['( Instrumental )', true, ''],
        ['Interlude returns in a verse', false, undefined],
        ['Last lyric', false, undefined],
        ['To God be the Glory', false, undefined],
    ], 'standalone Video keeps cue source text and order while marking exact cue-only lines for blank display');

    standalone.prepare(standaloneId);
    assert.equal(standalone.cue(2), true);
    assert.equal(standalone.getState().live.text, '', 'a bare standalone cue has blank live output');
    assert.equal(standalone.getState().live.index, 2, 'the blank cue retains its standalone cue index');
    assert.equal(standalone.advance(1), true);
    assert.equal(standalone.getState().live.text, '', 'the parenthesized cue keeps its own blank row');
    assert.equal(standalone.getState().live.index, 3);
    assert.equal(standalone.advance(1), true, 'the next lyric remains reachable after blank cues');
    assert.equal(standalone.getState().live.text, 'Interlude returns in a verse', 'mixed-content cues remain visible in standalone output');

    const synced = model();
    synced.setTextLineup({ lineupKey: 'text-tab-a', title: 'Tab 1', songs: [{
        lineupKey: 'text-tab-a',
        title: 'Tab 1',
        blocks: [{
            blockIndex: 4,
            title: 'Verse',
            lines: [
                { sourceLineIndex: 10, text: 'First lyric' },
                { sourceLineIndex: 12, text: 'Interlude' },
                { sourceLineIndex: 15, text: ' ( Instrumental ) ' },
                { sourceLineIndex: 20, text: 'Interlude returns in a verse' },
                { sourceLineIndex: 21, text: 'Last lyric' },
            ],
        }],
    }] });
    synced.setTextFollowing(true);
    synced.setSyncEnabled(true);
    const projectedBlock = synced.getState().sync.songs[0].blocks[0];
    assert.deepEqual(Array.from(projectedBlock.lines, line => [line.sourceLineIndex, line.text, line.isCueOnly || false, line.displayText]), [
        [10, 'First lyric', false, undefined],
        [12, 'Interlude', true, ''],
        [15, '( Instrumental )', true, ''],
        [20, 'Interlude returns in a verse', false, undefined],
        [21, 'Last lyric', false, undefined],
    ], 'Text projection retains original source indexes and raw cue text');

    synced.updateTextPosition({ lineupKey: 'text-tab-a', blockIndex: 4, sourceLineIndex: 12, lineText: 'Interlude' });
    assert.equal(synced.getState().live.text, '', 'Text-synced cue output is blank');
    assert.equal(synced.getState().live.index, 12, 'Text-synced cue retains its source line index');
    synced.updateTextPosition({ lineupKey: 'text-tab-a', blockIndex: 4, sourceLineIndex: 15, lineText: '( Instrumental )' });
    assert.equal(synced.getState().live.text, '', 'parenthesized synced cue output is blank');
    assert.equal(synced.getState().live.index, 15);
    synced.updateTextPosition({ lineupKey: 'text-tab-a', blockIndex: 4, sourceLineIndex: 20, lineText: 'Interlude returns in a verse' });
    assert.equal(synced.getState().live.text, 'Interlude returns in a verse', 'mixed-content cues remain visible in Text-synced output');

    synced.setTextFollowing(false);
    assert.equal(synced.cueTextLine('text-tab-a', 4, 12), true);
    assert.equal(synced.getState().live.text, '', 'Video-local projected cue output is also blank');
    assert.equal(synced.getState().live.index, 12);
    assert.equal(synced.advance(1), true);
    assert.equal(synced.getState().live.text, '', 'Video advances to the following source cue without renumbering');
    assert.equal(synced.getState().live.index, 15);
    assert.equal(synced.advance(1), true, 'Video can advance beyond the blank cue placeholder');
    assert.equal(synced.getState().live.text, 'Interlude returns in a verse');
    assert.equal(synced.getState().live.index, 20);
});
test('Adaptation lines retain their source text and positions while Video displays them blank', () => {
    const standalone = model();
    const standaloneId = standalone.add({
        title: 'Adapted hymn',
        lyrics: 'Opening lyric\nAdaptation\n(Adaptation)\n(Adaptation of “My Way”)\nClosing lyric',
    });
    const standaloneCues = standalone.getState().lineup[0].cues;
    assert.deepEqual(Array.from(standaloneCues, cue => [cue.text, cue.displayText]), [
        ['Adapted hymn', undefined],
        ['Opening lyric', undefined],
        ['Adaptation', ''],
        ['(Adaptation)', ''],
        ['(Adaptation of “My Way”)', ''],
        ['Closing lyric', undefined],
        ['To God be the Glory', undefined],
    ], 'standalone Video keeps the raw Adaptation cue text and its lineup indexes');
    standalone.prepare(standaloneId);
    assert.equal(standalone.cue(2), true);
    assert.equal(standalone.getState().live.text, '');
    assert.equal(standalone.getState().live.index, 2);
    assert.equal(standalone.advance(1), true);
    assert.equal(standalone.getState().live.text, '');
    assert.equal(standalone.getState().live.index, 3);
    assert.equal(standalone.advance(1), true);
    assert.equal(standalone.getState().live.text, '', 'Adaptation of a named source is blank in Video output');
    assert.equal(standalone.getState().live.index, 4);
    assert.equal(standalone.advance(1), true);
    assert.equal(standalone.getState().live.text, 'Closing lyric', 'the next lyric stays reachable after blank Adaptation cues');

    const projected = model();
    projected.setTextLineup({ lineupKey: 'text-adaptation-tab', songs: [{
        lineupKey: 'text-adaptation-tab',
        title: 'Tab Adaptation',
        blocks: [{
            blockIndex: 3,
            title: 'Adapted verse',
            lines: [
                { sourceLineIndex: 4, text: 'Opening lyric' },
                { sourceLineIndex: 9, text: 'Adaptation' },
                { sourceLineIndex: 12, text: '(Adaptation)' },
                { sourceLineIndex: 20, text: 'Closing lyric' },
            ],
        }],
    }] });
    projected.setTextFollowing(true);
    projected.setSyncEnabled(true);
    const projectedLines = projected.getState().sync.songs[0].blocks[0].lines;
    assert.deepEqual(Array.from(projectedLines, line => [line.sourceLineIndex, line.text, line.displayText]), [
        [4, 'Opening lyric', undefined],
        [9, 'Adaptation', ''],
        [12, '(Adaptation)', ''],
        [20, 'Closing lyric', undefined],
    ], 'Video projection keeps Text source text and indexes while marking Adaptation lines blank for display');
    projected.updateTextPosition({ lineupKey: 'text-adaptation-tab', blockIndex: 3, sourceLineIndex: 9, lineText: 'Adaptation' });
    assert.equal(projected.getState().live.text, '', 'Text-following Video output blanks an Adaptation line');
    assert.equal(projected.getState().live.index, 9, 'the source line index remains unchanged');
    projected.updateTextPosition({ lineupKey: 'text-adaptation-tab', blockIndex: 3, sourceLineIndex: 12, lineText: '(Adaptation)' });
    assert.equal(projected.getState().live.text, '');
    assert.equal(projected.getState().live.index, 12);
    projected.setTextFollowing(false);
    assert.equal(projected.cueTextLine('text-adaptation-tab', 3, 9), true, 'Video can cue a projected Adaptation line locally');
    assert.equal(projected.getState().live.text, '');
    assert.equal(projected.getState().live.index, 9);
});
test('automatic closing cue appears once after the lyrics and remains last after edits', () => {
    const m = model();
    const empty = m.add({ ...song, title: 'Empty', lyrics: '' });
    assert.deepEqual(Array.from(m.getState().lineup[0].cues, cue => cue.text), ['Empty', 'To God be the Glory']);
    const hasOutro = m.add({ ...song, title: 'Has Outro', lyrics: 'Line\nTo God be the Glory' });
    const entry = m.getState().lineup.find(item => item.id === hasOutro);
    assert.deepEqual(Array.from(entry.cues, cue => cue.text), ['Has Outro', 'Line', 'To God be the Glory']);
    m.prepare(hasOutro); m.cue(2);
    m.edit(hasOutro, { title: 'Has Outro', lyrics: 'Line\nAnother line' });
    assert.equal(m.getState().live.text, 'To God be the Glory');
    assert.equal(m.getState().live.index, m.getState().lineup.find(item => item.id === hasOutro).cues.length - 1);
    m.remove(empty);
});
test('blank output toggles independently from the live cue and preserves navigation', () => {
    const m = model(), first = m.add(song), next = m.add({ ...song, title: 'Next song', lyrics: 'Next lyric' });
    const background = { id: 'ambient' };
    m.setBackground(background);
    assert.equal(m.getState().outputBlanked, false, 'Blank starts off');
    m.prepare(first);
    m.cue(1);

    const notifications = [];
    const unsubscribe = m.subscribe(state => notifications.push({
        live: state.live && { ...state.live },
        preparedId: state.preparedId,
        preparedIndex: state.preparedIndex,
        background: state.background,
        outputBlanked: state.outputBlanked,
    }));
    assert.equal(m.blankOutput(), true, 'the first toggle blanks Video output');

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].live.text, 'First', 'Blank preserves the current live cue');
    assert.equal(notifications[0].live.index, 1);
    assert.equal(notifications[0].preparedId, first);
    assert.equal(notifications[0].preparedIndex, 1);
    assert.equal(notifications[0].background, background);
    assert.equal(notifications[0].outputBlanked, true);
    assert.equal(m.getState().live.text, 'First');
    assert.equal(m.getState().preparedId, first);
    assert.equal(m.getState().preparedIndex, 1);
    assert.equal(m.getState().background, background);

    assert.equal(m.advance(1), true, 'navigation continues while output is blanked');
    assert.equal(notifications.length, 2);
    assert.equal(m.getState().live.text, 'Second');
    assert.equal(m.getState().live.index, 2);
    assert.equal(m.getState().outputBlanked, true);
    assert.equal(m.getState().preparedId, first);
    assert.equal(m.getState().background, background);
    assert.equal(m.blankOutput(), false, 'the second toggle restores Video output');
    assert.equal(notifications.length, 3);
    assert.equal(m.getState().outputBlanked, false);
    assert.equal(m.getState().live.text, 'Second', 'turning Blank off shows the latest cue');
    assert.equal(m.getState().live.index, 2);
    unsubscribe();
    m.prepare(next);
    assert.equal(notifications.length, 3);
});
test('Blank can toggle when there is no live cue', () => {
    const m = model();
    assert.equal(m.getState().live, null);
    assert.equal(m.blankOutput(), true);
    assert.equal(m.getState().outputBlanked, true);
    assert.equal(m.getState().live, null);
    assert.equal(m.blankOutput(), false);
    assert.equal(m.getState().outputBlanked, false);
    assert.equal(m.getState().live, null);
});
test('appearance accepts permitted fonts and colors and clamps numeric settings', () => {
    const m = model(); m.updateSettings({ fontFamily: 'Inter', color: '#AaBBcc', fontWeight: '500', fontSize: 999, fadeMs: -1 });
    const s = m.getState().settings;
    assert.equal(s.fontFamily, 'Inter'); assert.equal(s.color, '#aabbcc'); assert.equal(s.fontSize, 160);
    assert.equal(s.fadeMs, 0); assert.equal(s.fontWeight, 500);
    m.updateSettings({ fontFamily: 'Unknown', color: 'red', fontWeight: 42, fontSize: NaN });
    assert.equal(s.fontFamily, 'Inter'); assert.equal(s.color, '#aabbcc'); assert.equal(s.fontSize, 160);
});

test('video vertical position, fade stops, and playback speed use bounded shared settings', () => {
    const m = model(), settings = m.getState().settings;
    assert.equal(settings.y, 540, 'the default vertical anchor centers the lyric on a 1080 px stage');
    assert.equal(settings.positionUnit, 'stage-px-v1');
    assert.equal(Object.hasOwn(settings, 'x'), false, 'horizontal positioning is not a Video Lyrics setting');
    assert.equal(Object.hasOwn(settings, 'alignment'), false, 'text alignment is always centered');
    assert.equal(settings.playbackRate, 1);

    m.updateSettings({ y: -20, fadeMs: 449, playbackRate: 1.26 });
    assert.equal(settings.y, 0, 'the vertical anchor is clamped to the top edge');
    assert.equal(settings.fadeMs, 400, 'fade duration snaps to the nearest 100 ms stop');
    assert.equal(settings.playbackRate, 1.3, 'playback speed snaps to a tenth');

    m.updateSettings({ y: 547, fadeMs: 455, playbackRate: 0.1 });
    assert.equal(settings.y, 550, 'vertical position snaps to a 10 px control stop');
    assert.equal(settings.fadeMs, 500);
    assert.equal(settings.playbackRate, 0.5, 'playback speed clamps at its minimum');
    m.updateSettings({ y: 2400, fadeMs: 2400, playbackRate: 3 });
    assert.equal(settings.y, 1080, 'the vertical anchor is clamped to the bottom edge');
    assert.equal(settings.fadeMs, 2000);
    assert.equal(settings.playbackRate, 2, 'playback speed clamps at its maximum');
});

test('editing one duplicate lineup instance preserves the other and refreshes a clamped live cue', () => {
    const m = model();
    const first = m.add({ ...song, title: 'First copy' });
    const second = m.add({ ...song, title: 'Second copy' });
    m.prepare(first); m.cue(3);
    m.edit(first, { title: 'Edited', lyrics: 'Only line' });
    assert.equal(m.getState().lineup[0].title, 'Edited');
    assert.equal(m.getState().lineup[0].lyrics, 'Only line');
    assert.equal(m.getState().live.text, 'Only line');
    assert.equal(m.getState().live.index, 1);
    assert.equal(m.getState().lineup[1].title, 'Second copy');
    assert.equal(m.getState().lineup[1].lyrics, song.lyrics);
});

test('appearance defaults and video-only dimming clamps both boundaries', () => {
    const m = model(), settings = m.getState().settings;
    assert.equal(settings.fontSize, 120);
    assert.equal(settings.fadeMs, 400);
    assert.equal(settings.dimming, .3);
    m.updateSettings({ dimming: -1 }); assert.equal(settings.dimming, 0);
    m.updateSettings({ dimming: 2 }); assert.equal(settings.dimming, .9);
    m.updateSettings({ dimming: 'invalid' }); assert.equal(settings.dimming, .9);
});

test('Text sync follows projected blocks and source lines without requiring a separate Video lineup', () => {
    const m = model();
    assert.equal(m.getState().sync.enabled, false);
    assert.equal(m.getState().lineup.length, 0, 'Sync does not require a searched or prepared Video song');

    m.setTextLineup({ lineupKey: 'text-tab-a', blocks: [{
        blockIndex: 8,
        title: 'Text block 9',
        lines: [
            { sourceLineIndex: 14, text: 'Café, déjà-vu!' },
            { sourceLineIndex: 15, text: 'A line from the same Text block' },
        ],
    }] });
    m.setTextFollowing(true);
    m.setSyncEnabled(true);
    m.updateTextPosition({ lineupKey: 'text-tab-a', blockIndex: 8, sourceLineIndex: 14, lineText: '  Café, déjà-vu!  ' });

    assert.equal(m.getState().live.entryId, 'text-sync');
    assert.equal(m.getState().live.index, 14);
    assert.equal(m.getState().live.text, 'Café, déjà-vu!', 'video output uses the same active Text lyric, preserving its spelling and punctuation');
    assert.equal(m.getState().lineup.length, 0);

    m.updateTextPosition({ lineupKey: 'text-tab-a', blockIndex: 8, sourceLineIndex: 15, lineText: 'A line from the same Text block' });
    assert.equal(m.getState().live.text, 'A line from the same Text block');
    assert.equal(m.getState().live.index, 15);
});

test('a blank position at the adjustable Text marker keeps the last active Video lyric', () => {
    const m = model();
    m.setTextLineup({ lineupKey: 'text-tab-a', blocks: [{
        blockIndex: 0,
        title: 'Text block',
        lines: [{ sourceLineIndex: 2, text: 'Last active line' }],
    }] });
    m.setTextFollowing(true);
    m.setSyncEnabled(true);
    m.updateTextPosition({ lineupKey: 'text-tab-a', blockIndex: 0, sourceLineIndex: 2, lineText: 'Last active line' });
    m.updateTextPosition({ lineupKey: 'text-tab-a', blockIndex: 0, sourceLineIndex: null, lineText: '' });

    assert.equal(m.getState().live.text, 'Last active line');
    assert.match(m.getState().sync.status, /Waiting for a lyric at the text marker/);
});

test('sync off retains the cue and turning it on follows the latest text position', () => {
    const m = model();
    m.add({ title: 'Song', lyrics: 'First\nSecond\nThird' });
    m.setTextLineup({ lineupKey: 'text-tab-a', blocks: [{
        blockIndex: 0,
        title: 'Text block',
        lines: [
            { sourceLineIndex: 0, text: 'First' },
            { sourceLineIndex: 1, text: 'Second' },
            { sourceLineIndex: 2, text: 'Third' },
        ],
    }] });
    m.setTextFollowing(true);
    m.setSyncEnabled(true);
    const position = sourceLineIndex => ({ lineupKey: 'text-tab-a', blockIndex: 0, sourceLineIndex, lineText: ['First', 'Second', 'Third'][sourceLineIndex] });
    m.updateTextPosition(position(1));
    assert.equal(m.getState().live.text, 'Second');

    m.setSyncEnabled(false);
    assert.equal(m.getState().live.text, 'Second');
    m.updateTextPosition(position(2));
    assert.equal(m.getState().live.text, 'Second', 'positions received while off are stored without changing output');

    m.setSyncEnabled(true);
    assert.equal(m.getState().live.text, 'Third', 'resuming applies the most recently received position');
});

test('Text and Video control ownership hands off the current line without losing either position', () => {
    const m = model();
    const songId = m.add({ title: 'Independent song', lyrics: 'Local lyric' });
    const background = { name: 'Stars' };
    m.setBackground(background);
    m.updateSettings({ fontSize: 135, color: '#aabbcc' });
    m.setTextLineup({ activeLineupKey: 'text-tab-a', activeBlockIndex: 0, songs: [{
        lineupKey: 'text-tab-a',
        title: 'Tab 1',
        blocks: [{
            blockIndex: 0,
            title: 'Song title',
            lines: [
                { sourceLineIndex: 0, text: 'First' },
                { sourceLineIndex: 2, text: 'Second' },
                { sourceLineIndex: 3, text: 'Third' },
            ],
        }, {
            blockIndex: 1,
            title: 'Next block',
            lines: [{ sourceLineIndex: 0, text: 'Next block line' }],
        }],
    }] });
    m.setTextFollowing(true);
    m.setSyncEnabled(true);
    const position = (sourceLineIndex, lineText) => ({ lineupKey: 'text-tab-a', blockIndex: 0, sourceLineIndex, lineText });
    m.updateTextPosition(position(2, 'Second'));
    assert.equal(m.getState().live.text, 'Second', 'Text owns Video while the Text workspace is active');

    m.setTextFollowing(false);
    assert.equal(m.getState().sync.videoPosition.sourceLineIndex, 2, 'Video takes over at the current Text line');
    assert.equal(m.cueTextLine('text-tab-a', 0, 3), true, 'Video can select a projected lyric locally');
    assert.equal(m.getState().live.text, 'Third');
    assert.equal(m.getState().sync.latestPosition.sourceLineIndex, 2, 'Video cue selection leaves the Text position unchanged');
    assert.equal(m.advance(-1), true, 'Video previous control advances its local projected cursor');
    assert.equal(m.getState().live.text, 'Second');
    assert.equal(m.getState().sync.latestPosition.sourceLineIndex, 2);
    assert.equal(m.advance(-1), true);
    assert.equal(m.getState().live.text, 'First');
    assert.equal(m.advance(-1), false, 'Video stepping stops at the selected block boundary');
    assert.equal(m.getState().lineup.find(entry => entry.id === songId).title, 'Independent song', 'Sync keeps the independent Video lineup intact');

    m.updateTextPosition(position(3, 'Latest Text line'));
    assert.equal(m.getState().live.text, 'First', 'incoming Text positions are retained without taking over Video output');
    assert.equal(m.getState().sync.latestPosition.sourceLineIndex, 3);
    m.setTextFollowing(true);
    assert.equal(m.getState().live.text, 'Third', 'returning to Text applies its latest position');
    assert.equal(m.getState().live.entryId, 'text-sync');
    assert.equal(m.getState().settings.fontSize, 135);
    assert.equal(m.getState().settings.color, '#aabbcc');
    assert.equal(m.getState().background, background);
});

test('Video and Text navigation controls only operate in their owning mode', () => {
    const m = model();
    const songId = m.add({ title: 'Song', lyrics: 'First\nSecond\nThird' });
    m.prepare(songId);
    m.setTextLineup({ lineupKey: 'text-tab-a', blocks: [{
        blockIndex: 0,
        title: 'Text block',
        lines: [
            { sourceLineIndex: 0, text: 'First' },
            { sourceLineIndex: 1, text: 'Second' },
            { sourceLineIndex: 2, text: 'Third' },
        ],
    }] });
    m.setTextFollowing(true);
    m.setSyncEnabled(true);
    const position = sourceLineIndex => ({ lineupKey: 'text-tab-a', blockIndex: 0, sourceLineIndex, lineText: ['First', 'Second', 'Third'][sourceLineIndex] });
    m.updateTextPosition(position(1));
    assert.equal(m.getState().live.text, 'Second');

    const syncedPosition = { ...m.getState().sync.latestPosition };
    assert.equal(m.cue(2), false, 'Video cannot take cue control from Text');
    assert.equal(m.advance(-1), false, 'Video popup/buttons cannot advance while Text owns control');
    m.prepare(songId);
    assert.equal(m.getState().sync.enabled, true);
    assert.equal(m.getState().sync.latestPosition.lineText, syncedPosition.lineText);
    assert.equal(m.getState().live.text, 'Second');
    m.updateTextPosition(position(2));
    assert.equal(m.getState().live.text, 'Third');

    m.setSyncEnabled(false);
    assert.equal(m.cue(4), true, 'a Video cue works in standalone mode');
    assert.equal(m.getState().live.text, 'To God be the Glory');
    assert.equal(m.advance(-1), true, 'Video previous/next works in standalone mode');
    assert.equal(m.getState().live.text, 'Third');
});

test('Text projection preserves block order and source line indexes across Video blocks', () => {
    const m = model();
    m.setTextLineup({ lineupKey: 'text-tab-a', blocks: [
        { blockIndex: 0, title: 'Opening', lines: [{ sourceLineIndex: 0, text: 'First line' }, { sourceLineIndex: 2, text: 'Second line' }] },
        { blockIndex: 3, title: 'Chorus', lines: [{ sourceLineIndex: 1, text: 'Chorus line' }] },
    ] });
    m.setTextFollowing(true);
    m.setSyncEnabled(true);

    assert.deepEqual(Array.from(m.getState().sync.projection, block => [block.blockIndex, block.title, block.lines.map(line => line.sourceLineIndex)]), [
        [0, 'Opening', [0, 2]],
        [3, 'Chorus', [1]],
    ]);
    m.updateTextPosition({ lineupKey: 'text-tab-a', blockIndex: 0, sourceLineIndex: 2, lineText: 'Second line' });
    assert.equal(m.getState().live.text, 'Second line', 'Text position selects a matching line in the first Video block');
    m.updateTextPosition({ lineupKey: 'text-tab-a', blockIndex: 3, sourceLineIndex: 1, lineText: 'Chorus line' });
    assert.equal(m.getState().live.text, 'Chorus line', 'Text position selects a matching line across Video blocks');
    assert.equal(m.getState().live.blockIndex, 3);
    assert.equal(m.getState().lineup.length, 0, 'mirroring the Text lineup does not create a second editable Video lineup');
});
