const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function registryHarness() {
    const faces = [], added = [];
    class FontFace {
        constructor(family, bytes) { this.family = family; this.bytes = bytes; faces.push(this); }
        async load() { return this; }
    }
    const window = {};
    const document = { fonts: { add: face => added.push(face) } };
    const crypto = { randomUUID: () => '12345678-1234-1234-1234-1234567890ab' };
    vm.runInNewContext(fs.readFileSync('public/js/features/video-lyrics/fonts.js', 'utf8'), { window, document, Blob, FontFace, crypto });
    return { registry: window.eclyricsVideoFonts, faces, added };
}

const bytesWithSignature = signature => {
    const bytes = new Uint8Array(8);
    bytes.set(signature);
    return new Blob([bytes]);
};

test('session font registry validates accepted file headers and imports each family once', async () => {
    const { registry, faces, added } = registryHarness();
    const file = bytesWithSignature([0, 1, 0, 0]);
    Object.defineProperty(file, 'name', { value: 'Serif.ttf' });

    const font = await registry.importFile(file, 'Serif');

    assert.equal(font.name, 'Serif');
    assert.equal(font.imported, true);
    assert.equal(font.category, 'Serif');
    assert.equal(faces.length, 1);
    assert.equal(added.length, 1);
    assert.equal(registry.descriptor(font.family).blob, file);
    assert.equal(await registry.ensure(font.family), true);
});

test('invalid font signatures and over-limit files are rejected without registration', async () => {
    const { registry, faces, added } = registryHarness();
    const invalid = bytesWithSignature([0, 0, 0, 0]);
    Object.defineProperty(invalid, 'name', { value: 'bad.woff' });

    await assert.rejects(registry.importFile(invalid), /valid TTF, OTF, WOFF or WOFF2/);
    await assert.rejects(registry.importFile({ name: 'large.ttf', size: registry.MAX_BYTES + 1 }), /up to 10 MB/);
    assert.equal(faces.length, 0, 'invalid signature is rejected before FontFace construction');
    assert.equal(added.length, 0);
    assert.equal(registry.metadata().filter(font => font.imported).length, 0);
});
