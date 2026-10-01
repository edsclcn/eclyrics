const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const editorSource = fs.readFileSync(path.join(repoRoot, 'public/js/features/editor/index.js'), 'utf8');

function createRouteHarness(pathname, { search = '', hash = '', ready = true, user = null, isAdmin = false } = {}) {
    const location = { origin: 'https://lyrics.example', pathname, search, hash };
    const historyCalls = [];
    const updateLocation = (value) => {
        const url = new URL(value, location.origin);
        Object.assign(location, { pathname: url.pathname, search: url.search, hash: url.hash });
    };
    const navButtons = ['text', 'image', 'video', 'admin'].map((id) => ({
        dataset: { panel: id },
        hidden: false,
        attrs: {},
        listeners: {},
        classList: {
            values: new Set(id === 'text' ? ['is-active'] : []),
            toggle(name, enabled) { enabled ? this.values.add(name) : this.values.delete(name); },
            remove(name) { this.values.delete(name); },
        },
        addEventListener(name, handler) { this.listeners[name] = handler; },
        setAttribute(name, value) { this.attrs[name] = value; },
        removeAttribute(name) { delete this.attrs[name]; },
    }));
    const panels = ['text', 'image', 'video', 'admin'].map((id) => ({
        id: `panel-${id}`,
        classList: {
            values: new Set(id === 'text' ? ['is-active'] : []),
            toggle(name, enabled) { enabled ? this.values.add(name) : this.values.delete(name); },
            remove(name) { this.values.delete(name); },
        },
    }));
    const listeners = {};
    const document = {
        querySelector(selector) {
            const match = selector.match(/data-panel="([^"]+)"/);
            return navButtons.find((button) => button.dataset.panel === match?.[1]) || null;
        },
        querySelectorAll(selector) {
            return selector === '.sidebar-nav button' ? navButtons : panels;
        },
        getElementById(id) { return panels.find((panel) => panel.id === id) || null; },
        addEventListener(name, handler) { listeners[name] = handler; },
    };
    const window = {
        location,
        __eclyricsAuth: { ready, user, isAdmin },
        history: {
            replaceState(_state, _title, url) {
                historyCalls.push({ method: 'replaceState', url });
                updateLocation(url);
            },
            pushState(_state, _title, url) {
                historyCalls.push({ method: 'pushState', url });
                updateLocation(url);
            },
        },
        addEventListener(name, handler) { listeners[name] = handler; },
    };

    const start = editorSource.indexOf('    const panelRoutes = {');
    const end = editorSource.indexOf("    const sendBtn = document.getElementById('send-prompter-btn');", start);
    assert.ok(start >= 0 && end > start, 'expected to locate the workspace route controller');
    vm.runInNewContext(editorSource.slice(start, end), { window, document, URL, URLSearchParams });
    return { window, document, navButtons, panels, listeners, historyCalls };
}

test('signed-out direct workspace routes go to sign-in with a same-origin return path', () => {
    const app = createRouteHarness('/image-lyrics', { search: '?campaign=one', hash: '#block-2' });

    assert.equal(app.window.location.pathname, '/sign-in');
    assert.deepEqual(app.historyCalls, [{
        method: 'replaceState',
        url: '/sign-in?returnTo=%2Fimage-lyrics%3Fcampaign%3Done%23block-2',
    }]);
    const returnTo = new URLSearchParams(app.window.location.search).get('returnTo');
    assert.equal(returnTo, '/image-lyrics?campaign=one#block-2');
});

test('sign-in restores allowed workspace paths and rejects external return paths', () => {
    const app = createRouteHarness('/sign-in', {
        search: '?returnTo=%2Fimage-lyrics%3Ftab%3D2%23block-3',
        user: { uid: 'member' },
    });

    assert.equal(app.window.location.pathname, '/image-lyrics');
    assert.equal(app.window.location.search, '?tab=2');
    assert.equal(app.window.location.hash, '#block-3');
    assert.equal(app.panels.find((panel) => panel.id === 'panel-image').classList.values.has('is-active'), true);
    assert.deepEqual(app.historyCalls, [{ method: 'replaceState', url: '/image-lyrics?tab=2#block-3' }]);

    const external = createRouteHarness('/sign-in', {
        search: `?returnTo=${encodeURIComponent('//evil.example/admin')}`,
        user: { uid: 'member' },
    });
    assert.equal(external.window.location.pathname, '/text-lyrics');
});

test('admin route is available to an admin and redirects other signed-in users', () => {
    const admin = createRouteHarness('/admin', { user: { uid: 'admin' }, isAdmin: true });
    assert.equal(admin.window.location.pathname, '/admin');
    assert.equal(admin.panels.find((panel) => panel.id === 'panel-admin').classList.values.has('is-active'), true);

    const member = createRouteHarness('/admin', { user: { uid: 'member' } });
    assert.equal(member.window.location.pathname, '/text-lyrics');
    assert.equal(member.panels.find((panel) => panel.id === 'panel-admin').classList.values.has('is-active'), false);
    assert.deepEqual(member.historyCalls, [{ method: 'replaceState', url: '/text-lyrics' }]);

    admin.navButtons.find((button) => button.dataset.panel === 'admin').listeners.click();
    assert.equal(admin.window.location.pathname, '/admin');
    assert.deepEqual(admin.historyCalls, [{ method: 'pushState', url: '/admin' }]);
});

test('workspace panels are direct children of the flexing app main container', () => {
    const shell = fs.readFileSync(path.join(repoRoot, 'public/index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(repoRoot, 'public/assets/css/index.css'), 'utf8');

    assert.match(shell, /<div class="app-main" id="workspace-panels"><\/div>/);
    assert.match(styles, /\.app-main\s*\{[^}]*\bflex:\s*1;[^}]*\bdisplay:\s*flex;[^}]*\bflex-direction:\s*column;/s);
    assert.match(styles, /\.panel\s*\{[^}]*\bflex:\s*1;[^}]*\bmin-height:\s*0;/s);
});

test('sign-in fragment mounts into the auth gate before auth scripts load', () => {
    const shell = fs.readFileSync(path.join(repoRoot, 'public/index.html'), 'utf8');
    const bootstrap = fs.readFileSync(path.join(repoRoot, 'public/js/core/app-bootstrap.js'), 'utf8');
    const signIn = fs.readFileSync(path.join(repoRoot, 'public/modules/sign-in.html'), 'utf8');

    assert.match(shell, /<div id="auth-gate-mount"><\/div>/);
    assert.match(shell, /<script defer src="js\/core\/app-bootstrap\.js(?:\?[^\"]*)?"><\/script>/);
    assert.match(bootstrap, /\{ file: 'sign-in\.html', mountId: 'auth-gate-mount', rootId: 'auth-gate' \}/);
    assert.match(signIn, /<div id="auth-gate" class="auth-gate"/);
    assert.match(signIn, /id="auth-sign-in-google"/);
    assert.match(signIn, /id="auth-gate-status"/);

    const fragmentsFetched = bootstrap.indexOf('const fragments = await Promise.all(');
    const fragmentsMounted = bootstrap.indexOf('for (const { definition, markup } of fragments)', fragmentsFetched);
    const signInMounted = bootstrap.indexOf('mount.append(content)', fragmentsMounted);
    const scriptsLoaded = bootstrap.indexOf('for (const src of appScripts) await loadScript(src)', signInMounted);
    assert.ok(fragmentsFetched >= 0 && fragmentsMounted > fragmentsFetched);
    assert.ok(signInMounted > fragmentsMounted && scriptsLoaded > signInMounted);
    assert.match(bootstrap, /'js\/auth\/auth\.js',[\s\S]*?'js\/auth\/login\.js'/);
});

test('admin and sign-in use the shared SPA shell without standalone hosting routes', () => {
    const shell = fs.readFileSync(path.join(repoRoot, 'public/index.html'), 'utf8');
    const bootstrap = fs.readFileSync(path.join(repoRoot, 'public/js/core/app-bootstrap.js'), 'utf8');
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'firebase.json'), 'utf8'));
    const publicRoot = path.join(repoRoot, 'public');

    for (const fragment of ['text-lyrics.html', 'image-lyrics.html', 'video-lyrics.html', 'admin.html', 'sign-in.html']) {
        assert.ok(bootstrap.includes(`file: '${fragment}'`), `bootstrap should mount ${fragment}`);
    }
    assert.match(bootstrap, /for \(const src of appScripts\) await loadScript\(src\)/);
    assert.equal((shell.match(/js\/core\/app-bootstrap\.js/g) || []).length, 1);
    assert.equal(fs.existsSync(path.join(publicRoot, 'admin.html')), false);
    assert.equal(fs.existsSync(path.join(publicRoot, 'sign-in.html')), false);
    assert.equal(fs.existsSync(path.join(publicRoot, 'js/standalone-page.js')), false);
    assert.equal(fs.existsSync(path.join(publicRoot, 'assets/css/standalone-admin.css')), false);
    assert.equal(config.hosting.rewrites.some((rewrite) => rewrite.source === '/admin' || rewrite.source === '/sign-in'), false);
    assert.ok(config.hosting.rewrites.some((rewrite) => rewrite.source === '**' && rewrite.destination === '/index.html'));
});
