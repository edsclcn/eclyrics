const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

function withClock(run) {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
        run({ advance: milliseconds => { now += milliseconds; } });
    } finally {
        Date.now = originalNow;
    }
}

function loadImageMatcher(source, functionName, pendingCodeName, pendingAtName) {
    const start = source.indexOf(`function ${functionName}(`);
    assert.ok(start >= 0, `expected ${functionName} matcher`);
    const bodyStart = source.indexOf('{', start);
    assert.ok(bodyStart >= 0, `expected ${functionName} body`);
    let depth = 0;
    let end = -1;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}' && --depth === 0) { end = index + 1; break; }
    }
    assert.ok(end >= 0, `expected ${functionName} closing brace`);
    const functionSource = source.slice(start, end);
    const factory = new Function(
        `let ${pendingCodeName} = ''; let ${pendingAtName} = 0; ${functionSource}; return ${functionName};`,
    );
    return factory();
}

function assertDoublePressContract(createMatcher) {
    withClock(({ advance }) => {
        const matcher = createMatcher();
        assert.equal(matcher.press('ArrowLeft'), false, 'first press should only arm navigation');
        assert.equal(matcher.press('ArrowLeft'), true, 'same arrow within 400ms should navigate');

        assert.equal(matcher.press('ArrowRight'), false, 'first press after a match should re-arm');
        advance(400);
        assert.equal(matcher.press('ArrowRight'), true, 'the 400ms boundary is included');

        assert.equal(matcher.press('ArrowLeft'), false);
        advance(401);
        assert.equal(matcher.press('ArrowLeft'), false, 'a press after the window should re-arm');
        assert.equal(matcher.press('ArrowLeft'), true);

        assert.equal(matcher.press('ArrowLeft'), false);
        assert.equal(matcher.press('ArrowRight'), false, 'opposite direction should restart matching');
        assert.equal(matcher.press('ArrowRight'), true, 'the restarted direction should then match');

        assert.equal(matcher.press('ArrowLeft'), false);
        assert.equal(matcher.press('ArrowLeft', true), false, 'key repeat should not navigate');
        assert.equal(matcher.press('ArrowLeft'), true, 'a repeat should not count as the second press');
    });
}

test('Text workspace and popup each use an independent 400ms double-arrow matcher', () => {
    const shortcuts = require('../public/js/features/prompter/prompter-shortcuts.js');
    const workspace = read('public/js/features/editor/index.js');
    const popup = read('public/js/features/prompter/prompter.js');

    assertDoublePressContract(() => shortcuts.createDoublePressMatcher());
    assertDoublePressContract(() => shortcuts.createDoublePressMatcher());

    const workspaceMatcher = shortcuts.createDoublePressMatcher();
    const popupMatcher = shortcuts.createDoublePressMatcher();
    assert.equal(workspaceMatcher.press('ArrowLeft'), false);
    assert.equal(popupMatcher.press('ArrowLeft'), false, 'popup begins with its own empty matcher');
    assert.equal(workspaceMatcher.press('ArrowLeft'), true);
    assert.equal(popupMatcher.press('ArrowLeft'), true, 'workspace presses do not consume popup state');

    assert.match(workspace, /let adjacentBlockPressMatcher = null/);
    assert.match(workspace, /adjacentBlockPressMatcher = sc\.createDoublePressMatcher\(\)/);
    assert.match(popup, /let adjacentBlockPressMatcher = null/);
    assert.match(popup, /adjacentBlockPressMatcher = sc\.createDoublePressMatcher\(\)/);
    assert.notEqual(
        workspace.match(/adjacentBlockPressMatcher = sc\.createDoublePressMatcher\(\)/)?.[0],
        undefined,
        'workspace owns its matcher initialization',
    );
    assert.notEqual(
        popup.match(/adjacentBlockPressMatcher = sc\.createDoublePressMatcher\(\)/)?.[0],
        undefined,
        'popup owns a separate matcher initialization',
    );
});

test('Image workspace and Image popup use separate local double-arrow matcher state', () => {
    const workspace = read('public/js/features/image-lyrics/index.js');
    const popup = read('public/js/features/image-prompter/prompter.js');
    const workspaceMatcher = loadImageMatcher(workspace, 'matchImageArrow', 'pendingImageArrow', 'pendingImageArrowAt');
    const popupMatcher = loadImageMatcher(popup, 'matchNavigationArrow', 'pendingNavigationArrow', 'pendingNavigationArrowAt');

    assertDoublePressContract(() => ({ press: workspaceMatcher }));
    assertDoublePressContract(() => ({ press: popupMatcher }));
    const workspaceState = loadImageMatcher(workspace, 'matchImageArrow', 'pendingImageArrow', 'pendingImageArrowAt');
    const popupState = loadImageMatcher(popup, 'matchNavigationArrow', 'pendingNavigationArrow', 'pendingNavigationArrowAt');
    assert.equal(workspaceState('ArrowLeft'), false);
    assert.equal(popupState('ArrowLeft'), false, 'Image popup begins with its own empty matcher');
    assert.equal(workspaceState('ArrowLeft'), true);
    assert.equal(popupState('ArrowLeft'), true, 'workspace presses do not consume Image popup state');
    assert.match(workspace, /let pendingImageArrow='', pendingImageArrowAt=0/);
    assert.match(popup, /let pendingNavigationArrow = '';/);
    assert.match(popup, /let pendingNavigationArrowAt = 0;/);
    assert.doesNotMatch(workspace, /createDoublePressMatcher/);
    assert.doesNotMatch(popup, /createDoublePressMatcher/);
});

test('prev and next controls still navigate immediately on a single click', () => {
    const editor = read('public/js/features/editor/index.js');
    const imageWorkspace = read('public/js/features/image-lyrics/index.js');
    const html = read('public/index.html');

    assert.match(editor, /prevBtn\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*if \(prevBtn\.disabled\) return;\s*goToAdjacentBlockAndSend\(-1\);/);
    assert.match(editor, /nextBtn\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*if \(nextBtn\.disabled\) return;\s*goToAdjacentBlockAndSend\(1\);/);
    assert.match(imageWorkspace, /controls\.prev\.onclick=\(\)=>control\('previous'\)/);
    assert.match(imageWorkspace, /controls\.next\.onclick=\(\)=>control\('next'\)/);
    assert.match(html, /id="preview-btn-prev"\s+title="Previous block \(double-press ←\)"/);
    assert.match(html, /id="preview-btn-next"\s+title="Next block \(double-press →\)"/);
    assert.match(html, /id="image-lyrics-prev"\s+title="Previous image \(double-press ←\)"/);
    assert.match(html, /id="image-lyrics-next"\s+title="Next image \(double-press →\)"/);
    assert.doesNotMatch(editor.match(/if \(prevBtn\) \{([\s\S]*?)\n    \}/)?.[1] || '', /PressMatcher/);
    assert.doesNotMatch(editor.match(/if \(nextBtn\) \{([\s\S]*?)\n    \}/)?.[1] || '', /PressMatcher/);
});

test('Text and Image shortcut help both explain the double-press arrow behavior', () => {
    const shortcutRegistry = read('public/js/features/prompter/prompter-shortcuts.js');
    const html = read('public/index.html');

    assert.match(shortcutRegistry, /description: 'double-press the same arrow within 400 ms'/);
    assert.match(html, /<dt>Previous \/ next image<\/dt><dd>Double-press the same <kbd>←<\/kbd> or <kbd>→<\/kbd> key within 400 ms<\/dd>/);
});
