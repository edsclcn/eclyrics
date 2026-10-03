const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

function extractFunction(source, functionName) {
    const start = source.indexOf(`function ${functionName}(`);
    assert.notEqual(start, -1, `expected ${functionName} declaration`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    assert.fail(`expected ${functionName} closing brace`);
}

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
    };
}

test('Text Lyrics workspace preview defaults to 1444px and honors a saved width', () => {
    const source = read('public/js/features/editor/index.js');
    const declaration = source.match(/const DEFAULT_PROMPTER_WIDTH_PX = (\d+);/)?.[0];
    assert.equal(declaration, 'const DEFAULT_PROMPTER_WIDTH_PX = 1444;');

    const storage = memoryStorage();
    const context = {
        localStorage: storage,
        PREVIEW_PROMPTER_SPEED_KEY: 'eclyrics-preview-prompter-speed',
        PREVIEW_STAGE_THEME_KEY: 'eclyrics-preview-stage-theme',
        PROMPTER_POPUP_W: 1920,
        PROMPTER_POPUP_H: 1080,
        DEFAULT_PROMPTER_WIDTH_PX: 1444,
        PREVIEW_PROMPTER: { defaultSpeed: 0.5 },
        Number,
    };
    vm.runInNewContext(`${extractFunction(source, 'defaultPrompterSync')}\nthis.defaultPrompterSync = defaultPrompterSync;`, context);

    assert.equal(context.defaultPrompterSync().cw, 1444);
    storage.setItem('eclyrics-prompter-width', '1580');
    assert.equal(context.defaultPrompterSync().cw, 1580);
});

test('Text Lyrics popup defaults to 1444px while retaining its saved width', () => {
    const source = read('public/js/features/prompter/prompter.js');
    const declaration = source.match(/const DEFAULT_PROMPTER_WIDTH_PX = (\d+);/)?.[0];
    assert.equal(declaration, 'const DEFAULT_PROMPTER_WIDTH_PX = 1444;');

    const storage = memoryStorage();
    const context = {
        sessionStorage: storage,
        prompterContent: { style: {} },
        DEFAULT_PROMPTER_WIDTH_PX: 1444,
        Number,
        parseFloat,
    };
    vm.runInNewContext(`${extractFunction(source, 'readPrompterWidthPx')}\nthis.readPrompterWidthPx = readPrompterWidthPx;`, context);

    assert.equal(context.readPrompterWidthPx(), 1444);
    storage.setItem('prompterWidth', '1580');
    assert.equal(context.readPrompterWidthPx(), 1580);
});

test('Text Lyrics popup CSS uses the same 1444px default width', () => {
    const css = read('public/assets/css/prompter.css');
    assert.match(css, /#prompter-content\s*\{[^}]*width:\s*1444px;/s);
});
