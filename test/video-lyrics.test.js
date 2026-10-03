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
    assert.deepEqual(Array.from(m.getState().lineup[0].cues, c => [c.text, c.section, c.isTitle]), [['Song', -1, true], ['First', 0, undefined], ['Second', 1, undefined], ['Third', 1, undefined]]);
    assert.equal(m.getState().live, null);
    m.advance(1); assert.equal(m.getState().live.text, 'Song');
    m.advance(1); assert.equal(m.getState().live.text, 'First');
    m.advance(-1); assert.equal(m.getState().live.index, 0);
    m.advance(1); m.advance(1); m.advance(1); m.advance(1); assert.equal(m.getState().live.index, 3);
    m.cue(99); assert.equal(m.getState().live.index, 3);
    m.remove(m.getState().lineup[0].id); assert.equal(m.getState().live, null);
});
test('appearance accepts permitted fonts and colors and clamps numeric settings', () => {
    const m = model(); m.updateSettings({ fontFamily: 'Inter', color: '#AaBBcc', fontWeight: '500', fontSize: 999, fadeMs: -1, alignment: 'right' });
    const s = m.getState().settings;
    assert.equal(s.fontFamily, 'Inter'); assert.equal(s.color, '#aabbcc'); assert.equal(s.fontSize, 160);
    assert.equal(s.fadeMs, 0); assert.equal(s.fontWeight, 500);
    m.updateSettings({ fontFamily: 'Unknown', color: 'red', fontWeight: 42, fontSize: NaN, alignment: 'bad' });
    assert.equal(s.fontFamily, 'Inter'); assert.equal(s.color, '#aabbcc'); assert.equal(s.fontSize, 160); assert.equal(s.alignment, 'right');
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
    assert.equal(settings.dimming, 0);
    m.updateSettings({ dimming: -1 }); assert.equal(settings.dimming, 0);
    m.updateSettings({ dimming: 2 }); assert.equal(settings.dimming, .9);
    m.updateSettings({ dimming: 'invalid' }); assert.equal(settings.dimming, .9);
});
