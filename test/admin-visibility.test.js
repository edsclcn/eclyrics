const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function makeElement(initial = {}) {
    return {
        hidden: initial.hidden ?? false,
        textContent: '',
        listeners: {},
        classList: {
            contains: (name) => initial.active === name,
        },
        addEventListener(name, callback) {
            this.listeners[name] = callback;
        },
        click: initial.onClick || (() => {}),
    };
}

async function setupAuth({ adminEmails = [], adminUidExists = false } = {}) {
    const textNav = makeElement();
    const adminNav = makeElement({ hidden: true });
    const adminPanel = makeElement({ hidden: true });
    const signOut = makeElement();
    const userLabel = makeElement();
    const authError = makeElement();
    let authStateChanged;
    const document = {
        readyState: 'complete',
        querySelector(selector) {
            if (selector === '.sidebar-nav [data-panel="admin"]') return adminNav;
            if (selector === '.sidebar-nav [data-panel="text"]') return textNav;
            return null;
        },
        getElementById(id) {
            return ({
                'auth-sign-out': signOut,
                'auth-user-label': userLabel,
                'auth-error': authError,
                'panel-admin': adminPanel,
            })[id] || null;
        },
        addEventListener() {},
        dispatchEvent() {},
    };
    const firebase = {
        apps: [{}],
        auth: Object.assign(function auth() {
            return {
                setPersistence: async () => {},
                getRedirectResult: async () => {},
                onAuthStateChanged(callback) { authStateChanged = callback; },
                signOut: async () => {},
            };
        }, { Auth: { Persistence: { LOCAL: 'local' } } }),
        firestore() {
            return {
                doc: () => ({
                    get: async () => ({ exists: true, data: () => ({ adminEmails }) }),
                }),
                collection: () => ({
                    doc: () => ({ get: async () => ({ exists: adminUidExists }) }),
                }),
            };
        },
    };
    const window = { location: { protocol: 'https:' } };
    const context = {
        window,
        document,
        firebase,
        firebaseConfig: { apiKey: 'configured', projectId: 'configured' },
        CustomEvent: function CustomEvent(name, options) { this.type = name; this.detail = options.detail; },
        console,
    };
    context.globalThis = context;
    vm.runInNewContext(
        fs.readFileSync(path.join(repoRoot, 'public/js/auth/auth.js'), 'utf8'),
        context,
        { filename: 'public/js/auth/auth.js' },
    );
    await new Promise(setImmediate);
    assert.equal(typeof authStateChanged, 'function', 'auth state listener is registered');

    return {
        window,
        adminNav,
        adminPanel,
        signOut,
        userLabel,
        async changeUser(user) {
            await authStateChanged(user);
        },
    };
}

test('Admin navigation and panel start hidden in the page markup', () => {
    const shell = fs.readFileSync(path.join(repoRoot, 'public/index.html'), 'utf8');
    const adminModule = fs.readFileSync(path.join(repoRoot, 'public/modules/admin.html'), 'utf8');
    assert.match(shell, /<button[^>]*data-panel="admin"[^>]*\shidden(?:\s|>)/);
    assert.match(adminModule, /<section[^>]*id="panel-admin"[^>]*\shidden(?:\s|>)/);
});

test('hidden Admin navigation remains display-none despite sidebar flex styles', () => {
    const css = fs.readFileSync(path.join(repoRoot, 'public/assets/css/index.css'), 'utf8');
    assert.match(css, /\.sidebar-nav\s+button\[hidden\]\s*\{\s*display:\s*none(?:\s*!important)?\s*;\s*\}/);
});

test('Admin search clear button appears for a query and clears and refocuses the input', () => {
    const search = {
        value: '', listeners: {}, focusCount: 0,
        addEventListener(name, callback) { this.listeners[name] = callback; },
        dispatchEvent(event) { this.listeners[event.type](event); },
        focus() { this.focusCount++; },
    };
    const clear = {
        hidden: true, listeners: {},
        addEventListener(name, callback) { this.listeners[name] = callback; },
        click() { this.listeners.click(); },
    };
    const document = {
        readyState: 'complete',
        getElementById(id) { return ({ 'admin-search': search, 'admin-search-clear': clear })[id] || null; },
    };
    const window = { setTimeout: () => 1, clearTimeout() {}, cancelAnimationFrame() {} };
    const context = { window, document, Event: class Event { constructor(type, options) { this.type = type; this.bubbles = options.bubbles; } } };
    context.globalThis = context;
    vm.runInNewContext(
        fs.readFileSync(path.join(repoRoot, 'public/js/features/admin/admin-panel.js'), 'utf8'),
        context,
        { filename: 'public/js/features/admin/admin-panel.js' },
    );

    search.value = '  hymn  ';
    search.listeners.input();
    assert.equal(clear.hidden, false);
    clear.click();
    assert.equal(search.value, '');
    assert.equal(clear.hidden, true);
    assert.equal(search.focusCount, 1);
});

test('signed-out and non-admin users do not see Admin', async () => {
    const auth = await setupAuth();
    assert.equal(auth.adminNav.hidden, true);
    assert.equal(auth.adminPanel.hidden, true);

    await auth.changeUser(null);
    assert.equal(auth.window.__eclyricsAuth.isAdmin, false);
    assert.equal(auth.adminNav.hidden, true);
    assert.equal(auth.adminPanel.hidden, true);

    await auth.changeUser({ uid: 'member-1', email: 'member@example.com' });
    assert.equal(auth.window.__eclyricsAuth.isAdmin, false);
    assert.equal(auth.adminNav.hidden, true);
    assert.equal(auth.adminPanel.hidden, true);
});

test('an email listed in RBAC can see Admin; losing the role hides Admin navigation and panel', async () => {
    const adminEmails = ['admin@example.com'];
    const auth = await setupAuth({
        adminEmails,
    });

    await auth.changeUser({ uid: 'admin-1', email: 'ADMIN@example.com' });
    assert.equal(auth.window.__eclyricsAuth.isAdmin, true);
    assert.equal(auth.adminNav.hidden, false);
    assert.equal(auth.adminPanel.hidden, false);

    auth.adminNav.classList.contains = (name) => name === 'is-active';
    adminEmails.length = 0;
    await auth.changeUser({ uid: 'admin-1', email: 'admin@example.com' });
    assert.equal(auth.window.__eclyricsAuth.isAdmin, false);
    assert.equal(auth.adminNav.hidden, true);
    assert.equal(auth.adminPanel.hidden, true);
});
