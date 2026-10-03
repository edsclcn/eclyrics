const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = file => fs.readFileSync(file, 'utf8');

function popupKeyHandler(kind) {
    const source = read({
        text: 'public/js/features/prompter/prompter.js',
        image: 'public/js/features/image-prompter/prompter.js',
        video: 'public/js/features/video-prompter/prompter.js',
    }[kind]);
    const patterns = {
        text: /function handleLocalPrompterShortcut\(event\)\s*\{([\s\S]*?)\n\}/,
        image: /window\.addEventListener\('keydown',\s*\(event\)\s*=>\s*\{([\s\S]*?)\n    \}\);/,
        video: /document\.addEventListener\('keydown',\s*event\s*=>\s*\{([\s\S]*?)\n    \}\);/,
    };
    const body = source.match(patterns[kind])?.[1];
    assert.ok(body, `expected ${kind} popup key handler`);

    const calls = { request: 0, exit: 0, reset: 0 };
    const document = {
        fullscreenElement: null,
        documentElement: { requestFullscreen() { calls.request++; return Promise.resolve(); } },
        exitFullscreen() { calls.exit++; return Promise.resolve(); },
    };
    const context = {
        document,
        getFullscreenElement: () => document.fullscreenElement,
        toggleFullscreen() {
            if (document.fullscreenElement) context.exitFullscreen();
            else {
                calls.request++;
                document.fullscreenElement = {};
            }
        },
        exitFullscreen() { calls.exit++; document.fullscreenElement = null; },
        resetNavigationArrow() { calls.reset++; },
        getPrompterShortcutsApi: () => ({
            shouldIgnorePrompterShortcut: () => false,
            resolvePrompterShortcut: () => null,
        }),
        adjacentBlockPressMatcher: null,
    };
    const handler = vm.runInNewContext(`(event) => {${body}\n}`, context);
    return { calls, document, handler };
}

for (const kind of ['text', 'image', 'video']) {
    test(`${kind} popup fullscreen shortcuts toggle on one unmodified F press and exit on Escape once`, () => {
        const { calls, document, handler } = popupKeyHandler(kind);
        const press = (code, overrides = {}) => {
            const event = { code, repeat: false, preventDefault() { this.prevented = true; }, ...overrides };
            handler(event);
            return event;
        };

        const f = press('KeyF');
        assert.equal(f.prevented, true);
        assert.equal(calls.request, 1, 'F enters fullscreen');
        press('KeyF', { repeat: true });
        for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) press('KeyF', { [modifier]: true });
        assert.equal(calls.request, 1, 'held or modified F does not toggle fullscreen');

        document.fullscreenElement = {};
        const exitWithF = press('KeyF');
        assert.equal(exitWithF.prevented, true);
        assert.equal(calls.exit, 1, 'F exits fullscreen');
        press('KeyF', { repeat: true });
        assert.equal(calls.exit, 1, 'held F does not request repeated exits');

        document.fullscreenElement = null;
        const f11 = press('F11');
        assert.equal(f11.prevented, true);
        assert.equal(calls.request, 2, 'F11 enters webpage fullscreen through the same API as F');
        press('F11', { repeat: true });
        assert.equal(calls.request, 2, 'held F11 does not repeatedly toggle fullscreen');

        document.fullscreenElement = {};
        const exitWithF11 = press('F11');
        assert.equal(exitWithF11.prevented, true);
        assert.equal(calls.exit, 2, 'F11 exits webpage fullscreen through the same API as F');
        press('F11', { repeat: true });
        assert.equal(calls.exit, 2, 'held F11 does not request repeated exits');

        document.fullscreenElement = {};
        const escape = press('Escape');
        assert.equal(escape.prevented, true);
        assert.equal(calls.exit, 3, 'Escape exits fullscreen on the first press');
        press('Escape', { repeat: true });
        assert.equal(calls.exit, 3, 'held Escape does not request repeated exits');

        document.fullscreenElement = null;
        const plainEscape = press('Escape');
        assert.equal(plainEscape.prevented, undefined, 'Escape outside fullscreen keeps its existing behavior');
        assert.equal(calls.exit, 3, 'Escape outside fullscreen does not request an exit');
    });
}
