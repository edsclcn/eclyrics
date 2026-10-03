const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const cssPath = 'public/assets/css/video-lyrics.css';
const controllerPath = 'public/js/features/video-lyrics/index.js';

function buildFontRows(categoryValue, searchValue, fonts) {
    const source = fs.readFileSync(controllerPath, 'utf8');
    const renderSource = source.match(/function renderFonts\(\) \{[\s\S]*?\n    \}/)?.[0];
    assert.ok(renderSource, 'font picker renderer exists');

    const list = {
        children: [], textContent: '',
        replaceChildren(...children) { this.children = children; this.textContent = ''; },
    };
    const document = {
        createElement(tag) {
            return {
                tagName: tag,
                style: {},
                children: [],
                attributes: {},
                setAttribute(name, value) { this.attributes[name] = value; },
                append(...children) { this.children.push(...children); },
            };
        },
        fonts: { load: () => Promise.resolve() },
    };
    const button = (_text, label, callback, className) => ({
        label, callback, className, style: {}, children: [], attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        append(...children) { this.children.push(...children); },
    });
    const fontCategory = { value: categoryValue };
    const fontSearch = { value: searchValue };
    const fontRegistry = { metadata: () => fonts };
    const model = { getState: () => ({ settings: { fontFamily: 'Satoshi' } }) };

    vm.runInNewContext(`(${renderSource})()`, { document, button, fontCategory, fontSearch, fontList: list, fontRegistry, model });
    return { rows: list.children, emptyMessage: list.textContent };
}

test('font category filter has stable options matching the available categories', () => {
    const source = fs.readFileSync(controllerPath, 'utf8');
    const select = source.match(/<select aria-label="Font category">([\s\S]*?)<\/select>/)?.[1] || '';
    const optionValues = [...select.matchAll(/<option value="([^"]+)">/g)].map(match => match[1]);

    assert.deepEqual(optionValues, ['All', 'Sans Serif', 'Serif', 'Cursive']);
});

test('font picker combines category and search filters, including session fonts', () => {
    const window = {};
    vm.runInNewContext(fs.readFileSync('public/js/features/video-lyrics/fonts.js', 'utf8'), {
        window, Blob, document: { fonts: { add() {} } }, FontFace: class {}, crypto: { randomUUID: () => 'id' },
    });
    const fonts = window.eclyricsVideoFonts.metadata();
    fonts.push({ family: 'SessionSerif', name: 'Session Serif', category: 'Serif', imported: true, weights: [400], defaultWeight: 400 });

    for (const category of ['Sans Serif', 'Serif', 'Cursive']) {
        const { rows } = buildFontRows(category, '', fonts);
        assert.ok(rows.length > 0, `${category} has matching fonts`);
        assert.ok(rows.every(row => fonts.find(font => font.name === row.children[0].textContent)?.category === category), `${category} excludes fonts assigned to other categories`);
    }

    const serifSearch = buildFontRows('Serif', 'session', fonts).rows;
    assert.equal(serifSearch.length, 1, 'search narrows within the selected category');
    assert.equal(serifSearch[0].children[0].textContent, 'Session Serif');
    assert.equal(serifSearch[0].children[1].textContent, 'Session font');
    assert.equal(buildFontRows('Cursive', 'session', fonts).rows.length, 0, 'a match outside the selected category stays filtered out');
    assert.match(buildFontRows('All', 'not-a-font', fonts).emptyMessage, /No fonts match/);
});

test('font picker keeps a fixed responsive dialog while the font list owns scrolling', () => {
    const css = fs.readFileSync(cssPath, 'utf8');
    const dialog = css.match(/\.video-font-dialog\s*\{([^}]*)\}/)?.[1] || '';
    const list = css.match(/\.video-font-list\s*\{([^}]*)\}/)?.[1] || '';
    const option = css.match(/\.video-font-option\s*\{([^}]*)\}/)?.[1] || '';

    assert.match(dialog, /height\s*:\s*min\(46rem,\s*calc\(100dvh\s*-\s*2rem\)\)/);
    assert.match(dialog, /max-height\s*:\s*calc\(100dvh\s*-\s*1rem\)/);
    assert.match(list, /flex\s*:\s*1\s+1\s+auto/);
    assert.match(list, /min-height\s*:\s*0/);
    assert.match(list, /overflow\s*:\s*auto/);
    assert.match(option, /display\s*:\s*grid/);
    assert.match(option, /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+auto\s+1rem/,
        'font name, category, and trailing checkmark each have a consistent column');
});
