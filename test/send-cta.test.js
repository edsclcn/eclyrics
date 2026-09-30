const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const editorSource = fs.readFileSync(path.join(repoRoot, 'public/js/features/editor/index.js'), 'utf8');
const imageSource = fs.readFileSync(path.join(repoRoot, 'public/js/features/image-lyrics/index.js'), 'utf8');

function sourceFunction(source, declaration, nextDeclaration) {
    const start = source.indexOf(declaration);
    const end = source.indexOf(nextDeclaration, start);
    assert.ok(start >= 0 && end > start, `expected ${declaration}`);
    return source.slice(start, end);
}

function createTextSendButtonHarness() {
    const activeTabElement = { dataset: { tabId: '2' } };
    const textarea = (id, value) => ({ id, value, dataset: {}, closest: () => null });
    const tabs = {
        1: [textarea('textarea-1-1', ''), textarea('textarea-1-2', 'filled lyric')],
        2: [textarea('textarea-2-1', '')],
    };
    const textNum = { 1: [2, 0, tabs[1][0]], 2: [1, 0, tabs[2][0]] };
    const sendButton = { disabled: false, title: '' };
    const title = { textContent: '', title: '' };
    const titleButton = { disabled: false };
    const document = {
        body: { contains: (element) => Object.values(tabs).flat().includes(element) },
        querySelector: (selector) => selector === '#tabs-list .tab.active'
            ? activeTabElement
            : selector.startsWith('#tab-') ? tabs[Number(selector.match(/^#tab-(\d+)/)[1])]?.[0] || null : null,
        querySelectorAll: (selector) => {
            const match = selector.match(/^#tab-(\d+) textarea$/);
            return match ? tabs[Number(match[1])] || [] : [];
        },
        getElementById: (id) => ({
            'send-prompter-btn': sendButton,
            'selected-block-title': title,
            'selected-block-title-btn': titleButton,
        })[id] || null,
    };
    const helpers = [
        sourceFunction(editorSource, 'function getActiveTabId()', '\nconst BLOCK_TITLE_MAX_LEN'),
        sourceFunction(editorSource, 'function isBlockEmpty(textarea)', '\nfunction getTabIdFromTextarea'),
        sourceFunction(editorSource, 'function hasSendableContentInTab(tabId)', '\nfunction updateActiveBlockToolbar'),
        sourceFunction(editorSource, 'function getSelectedTextareaForActiveTab()', '\nfunction updateLiveViewfinder'),
        sourceFunction(editorSource, 'function updateActiveBlockToolbar()', '\nfunction closeBlockTabsForTextarea'),
    ].join('\n');
    const window = {};
    const context = {
        document,
        window,
        textNum,
        selectTextarea: () => {},
        getBlockTitleFull: (ta) => ta.value || ta.id,
        updatePreviewAdjacentBlockButtons: () => {},
    };
    vm.runInNewContext(`${helpers}\nwindow.updateActiveBlockToolbar = updateActiveBlockToolbar;`, context);

    return {
        update: () => window.updateActiveBlockToolbar(),
        activateTab: (id) => { activeTabElement.dataset.tabId = String(id); },
        setValue: (tabId, index, value) => { tabs[tabId][index].value = value; },
        selected: (tabId, index) => { textNum[tabId][2] = tabs[tabId][index]; },
        button: sendButton,
    };
}

test('Text Send CTA follows active-tab content, including non-selected populated blocks', () => {
    const harness = createTextSendButtonHarness();

    harness.update();
    assert.equal(harness.button.disabled, true, 'empty active tab should disable Send');

    harness.activateTab(1);
    harness.selected(1, 0);
    harness.update();
    assert.equal(harness.button.disabled, false, 'another populated block enables Send when the selected block is empty');

    harness.setValue(1, 1, '');
    harness.update();
    assert.equal(harness.button.disabled, true, 'clearing the active tab content should disable Send');

    harness.setValue(1, 0, 'new lyrics');
    harness.update();
    assert.equal(harness.button.disabled, false, 'adding active tab content should enable Send');

    harness.activateTab(2);
    harness.update();
    assert.equal(harness.button.disabled, true, 'switching to an empty tab should disable Send');
    assert.match(editorSource, /if \(tabId === getActiveTabId\(\)\) updateActiveBlockToolbar\(\)/,
        'active content changes should refresh the CTA state');
    assert.match(editorSource, /textNum\[tabId\]\[2\] = textarea;\s*updateActiveBlockToolbar\(\)/,
        'selecting a block after a tab switch should refresh the CTA state');
});

test('Image Send CTA remains disabled without images and enabled for a populated active lineup', () => {
    const start = imageSource.indexOf('function updatePreview(){');
    const end = imageSource.indexOf('\nfunction render()', start);
    assert.ok(start >= 0 && end > start, 'expected Image Lyrics updatePreview');

    const sendButton = { disabled: false, title: '' };
    const blocks = [{ file: null, url: '' }];
    const preview = {
        dataset: {}, style: {}, hidden: false,
        hasAttribute: () => false,
        removeAttribute: () => {},
    };
    const empty = { hidden: false };
    const icon = { className: '' };
    const controls = Object.fromEntries(['play', 'prev', 'next', 'up', 'down', 'top', 'speed'].map((key) => [key, {
        disabled: false,
        setAttribute: () => {},
        querySelector: () => icon,
    }]));
    const window = {};
    const context = {
        window,
        preview,
        empty,
        sendBtn: sendButton,
        controls,
        paused: true,
        popup: null,
        tab: () => ({ blocks }),
        block: () => blocks[0],
        lineup: () => blocks.flatMap((block, index) => block.file ? [{ ...block, blockIndex: index }] : []),
        updatePreviewPosition: () => {},
        status: () => {},
    };
    vm.runInNewContext(`${imageSource.slice(start, end)}\nwindow.updatePreview = updatePreview;`, context);

    window.updatePreview();
    assert.equal(sendButton.disabled, true);
    assert.equal(sendButton.title, 'Add content to the active lineup before sending');

    blocks[0].file = { name: 'photo.png', type: 'image/png' };
    window.updatePreview();
    assert.equal(sendButton.disabled, false);
    assert.equal(sendButton.title, 'Send the active lineup to the prompter');
});

test('Text and Image Send CTAs share label, dimensions, and disabled styling', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/index.html'), 'utf8');
    const css = fs.readFileSync(path.join(repoRoot, 'public/assets/css/index.css'), 'utf8');
    const textButton = html.match(/<button[^>]*id="send-prompter-btn"[^>]*>([\s\S]*?)<\/button>/);
    const imageButton = html.match(/<button[^>]*id="image-lyrics-send"[^>]*>([\s\S]*?)<\/button>/);
    const dimensions = [...css.matchAll(/\.preview-send-btn\s*\{([^}]+)\}/g)]
        .find((match) => /width:\s*10rem/.test(match[1]));
    const disabledStyle = css.match(/\.preview-send-btn:disabled\s*\{([^}]+)\}/);

    assert.ok(textButton && imageButton);
    assert.match(textButton[0], /class="[^"]*preview-send-btn/);
    assert.match(imageButton[0], /class="[^"]*preview-send-btn/);
    assert.match(textButton[1], /<span class="preview-send-btn-label">Send to prompter<\/span>/);
    assert.match(imageButton[1], /<span class="preview-send-btn-label">Send to prompter<\/span>/);
    assert.ok(dimensions && disabledStyle);
    for (const expected of ['width: 10rem', 'min-width: 10rem', 'height: 2.5rem']) {
        assert.ok(dimensions[1].includes(expected), `shared CTA style should include ${expected}`);
    }
    assert.match(disabledStyle[1], /opacity:\s*0\.55/);
    assert.match(disabledStyle[1], /cursor:\s*not-allowed/);
    assert.match(disabledStyle[1], /border-color:\s*var\(--border\)/);
});

test('Image speed control group border height follows normal and narrow CTA dimensions', () => {
    const css = fs.readFileSync(path.join(repoRoot, 'public/assets/css/index.css'), 'utf8');

    assert.match(css, /#image-lyrics-dock \.preview-toolbar-group--stage\s*\{\s*height:\s*calc\(2\.5rem \+ 6px\);\s*\}/);
    assert.match(css, /@container preview-dock \(max-width: 360px\)\s*\{[\s\S]*?#image-lyrics-dock \.preview-toolbar-group--stage\s*\{\s*height:\s*calc\(2\.35rem \+ 6px\);\s*\}/);
});
