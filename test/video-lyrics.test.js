const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function model() {
    const window = { eclyricsVideoFonts: { allowedFamilies: ['Satoshi', 'Inter'] } };
    vm.runInNewContext(fs.readFileSync('public/js/features/video-lyrics/model.js', 'utf8'), { window });
    return window.eclyricsVideoModel.create();
}
const song = { id: 'same', title: 'Song', category: ['Original'], lyrics: 'First\r\n\r\nSecond\nThird' };
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
test('blank output clears the live lyric, notifies subscribers, and keeps prepared song and background', () => {
    const m = model(), first = m.add(song), next = m.add({ ...song, title: 'Next song', lyrics: 'Next lyric' });
    const background = { id: 'ambient' };
    m.setBackground(background);
    m.prepare(first);
    m.cue(1);

    const notifications = [];
    const unsubscribe = m.subscribe(state => notifications.push({
        live: state.live && { ...state.live },
        preparedId: state.preparedId,
        preparedIndex: state.preparedIndex,
        background: state.background,
    }));
    m.blankOutput();

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].live, null);
    assert.equal(notifications[0].preparedId, first);
    assert.equal(notifications[0].preparedIndex, 1);
    assert.equal(notifications[0].background, background);
    assert.equal(m.getState().live, null);
    assert.equal(m.getState().preparedId, first);
    assert.equal(m.getState().preparedIndex, 1);
    assert.equal(m.getState().background, background);

    m.advance(1);
    assert.equal(notifications.length, 2);
    assert.equal(m.getState().live.text, 'Second');
    assert.equal(m.getState().preparedId, first);
    assert.equal(m.getState().background, background);
    unsubscribe();
    m.prepare(next);
    assert.equal(notifications.length, 2);
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

test('Video cue and advance cannot move Text while synced; standalone Video controls work when Sync is off', () => {
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
    m.setSyncEnabled(true);
    const position = sourceLineIndex => ({ lineupKey: 'text-tab-a', blockIndex: 0, sourceLineIndex, lineText: ['First', 'Second', 'Third'][sourceLineIndex] });
    m.updateTextPosition(position(0));
    m.updateTextPosition(position(1));
    assert.equal(m.getState().live.text, 'Second');

    const syncedPosition = { ...m.getState().sync.latestPosition };
    assert.equal(m.cue(4), false, 'a Video cue cannot take control from Text');
    assert.equal(m.advance(-1), false, 'Video previous/next and popup advance are rejected during Sync');
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
