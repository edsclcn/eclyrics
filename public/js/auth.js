/**
 * Firebase Auth (Google) + Firestore-backed admin role.
 * Requires compat SDK scripts (e.g. gstatic) + global firebaseConfig in js/firebase-config.js.
 */
(function () {
    window.__eclyricsAuth = { user: null, isAdmin: false, ready: false };

    const gate = document.getElementById('auth-gate');
    const btnSignIn = document.getElementById('auth-sign-in-google');
    const btnSignOut = document.getElementById('auth-sign-out');
    const authUserLabel = document.getElementById('auth-user-label');
    const authErrorEl = document.getElementById('auth-error');
    const adminNavBtn = document.querySelector('.sidebar-nav [data-panel="admin"]');

    function showAuthGate(visible) {
        if (!gate) return;
        gate.classList.toggle('auth-gate--hidden', !visible);
        gate.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    function exitAdminPanelIfNeeded() {
        if (!adminNavBtn || !adminNavBtn.classList.contains('is-active')) return;
        const textBtn = document.querySelector('.sidebar-nav [data-panel="text"]');
        if (textBtn) textBtn.click();
    }

    function setAdminNavVisibility(show) {
        if (!adminNavBtn) return;
        adminNavBtn.hidden = !show;
        if (!show) exitAdminPanelIfNeeded();
    }

    async function refreshAdminRole(user) {
        if (!user) {
            window.__eclyricsAuth.isAdmin = false;
            return;
        }

        const emailNorm = String(user.email || '')
            .trim()
            .toLowerCase();

        try {
            const cfgSnap = await firebase.firestore().doc('rbac/config').get();
            if (cfgSnap.exists) {
                const raw = cfgSnap.data()?.adminEmails;
                if (Array.isArray(raw) && emailNorm) {
                    const listed = raw.map((e) => String(e || '').trim().toLowerCase());
                    if (listed.indexOf(emailNorm) !== -1) {
                        window.__eclyricsAuth.isAdmin = true;
                        return;
                    }
                }
            }
        } catch (e) {
            console.warn('eclyrics: rbac/config read failed', e);
        }

        try {
            const snap = await firebase.firestore().collection('admins').doc(user.uid).get();
            window.__eclyricsAuth.isAdmin = snap.exists;
        } catch (e) {
            console.error('eclyrics: admin role check failed', e);
            window.__eclyricsAuth.isAdmin = false;
        }
    }

    function updateAuthChrome() {
        const u = window.__eclyricsAuth.user;
        window.__eclyricsAuth.ready = true;

        if (u) {
            showAuthGate(false);
            if (authUserLabel) authUserLabel.textContent = u.email || u.displayName || 'Signed in';
            if (btnSignOut) btnSignOut.hidden = false;
            if (btnSignIn) btnSignIn.hidden = true;
            setAdminNavVisibility(window.__eclyricsAuth.isAdmin);
        } else {
            showAuthGate(true);
            if (authUserLabel) authUserLabel.textContent = '';
            if (btnSignOut) btnSignOut.hidden = true;
            if (btnSignIn) btnSignIn.hidden = false;
            setAdminNavVisibility(false);
        }

        document.dispatchEvent(
            new CustomEvent('eclyrics-auth-changed', {
                detail: {
                    user: window.__eclyricsAuth.user,
                    isAdmin: window.__eclyricsAuth.isAdmin,
                },
            }),
        );
    }

    window.eclyricsLoadAdminPanel = async function eclyricsLoadAdminPanel() {
        const sample = document.getElementById('admin-panel-firestore-sample');
        if (!sample) return;
        if (!window.__eclyricsAuth?.isAdmin) {
            sample.textContent = 'Not authorized.';
            return;
        }
        sample.textContent = 'Loading…';
        try {
            const snap = await firebase.firestore().doc('admin_data/welcome').get();
            if (snap.exists) {
                sample.textContent = JSON.stringify(snap.data(), null, 2);
            } else {
                sample.textContent =
                    'No admin_data/welcome document yet. Create it in Firebase Console (Firestore) to verify admin reads.';
            }
        } catch (e) {
            sample.textContent = `Firestore denied or error: ${e.message}`;
        }
    };

    function firebaseConfigIncomplete() {
        const c = typeof firebaseConfig !== 'undefined' ? firebaseConfig : null;
        if (!c || !c.apiKey || !c.projectId) return true;
        const api = String(c.apiKey);
        const mid = c.messagingSenderId != null ? String(c.messagingSenderId) : '';
        const aid = c.appId != null ? String(c.appId) : '';
        if (api.includes('REPLACE')) return true;
        if (mid.includes('REPLACE') || aid.includes('REPLACE')) return true;
        return false;
    }

    function formatAuthError(err) {
        if (!err || !err.code) return err?.message || String(err);
        if (err.code === 'auth/unauthorized-domain') {
            return 'Add this site’s host to Firebase → Authentication → Settings → Authorized domains (try localhost and 127.0.0.1). See README.';
        }
        return err.message || String(err);
    }

    async function initAuth() {
        if (typeof firebase === 'undefined') {
            console.error('eclyrics: Firebase SDK not loaded (blocked network, offline, or scripts missing)');
            if (authErrorEl) {
                authErrorEl.textContent =
                    'Firebase SDK failed to load. Check network / ad blockers, or see README (CDN scripts).';
            }
            return;
        }

        if (window.location.protocol === 'file:') {
            if (authErrorEl) {
                authErrorEl.textContent =
                    'Google sign-in does not work from file://. Use http://localhost (e.g. firebase serve or a local static server).';
            }
            showAuthGate(true);
            return;
        }

        if (!firebase.apps.length) {
            if (firebaseConfigIncomplete()) {
                console.error(
                    'eclyrics: Edit public/js/firebase-config.js with values from Firebase Console → Project settings → Your apps.',
                );
                if (authErrorEl) {
                    authErrorEl.textContent =
                        'Paste your web app firebaseConfig into js/firebase-config.js (see README).';
                }
                showAuthGate(true);
                return;
            }
            firebase.initializeApp(firebaseConfig);
        }

        const auth = firebase.auth();

        try {
            await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        } catch (e) {
            console.warn('eclyrics: setPersistence', e);
        }

        /** Must finish before onAuthStateChanged, or the first callback is often null and the gate never clears after redirect. */
        try {
            await auth.getRedirectResult();
            if (authErrorEl) authErrorEl.textContent = '';
        } catch (err) {
            console.error('eclyrics: getRedirectResult', err);
            if (authErrorEl) authErrorEl.textContent = formatAuthError(err);
        }

        auth.onAuthStateChanged(async (user) => {
            window.__eclyricsAuth.user = user;
            if (authErrorEl) authErrorEl.textContent = '';
            await refreshAdminRole(user);
            updateAuthChrome();
        });

        if (btnSignIn) {
            btnSignIn.addEventListener('click', async () => {
                const provider = new firebase.auth.GoogleAuthProvider();
                provider.setCustomParameters({ prompt: 'select_account' });
                try {
                    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
                    await auth.signInWithPopup(provider);
                    if (authErrorEl) authErrorEl.textContent = '';
                } catch (err) {
                    if (err.code === 'auth/popup-blocked') {
                        try {
                            await auth.signInWithRedirect(provider);
                        } catch (e2) {
                            if (authErrorEl) authErrorEl.textContent = formatAuthError(e2);
                        }
                        return;
                    }
                    if (err.code === 'auth/popup-closed-by-user') return;
                    if (authErrorEl) authErrorEl.textContent = formatAuthError(err);
                }
            });
        }

        if (btnSignOut) {
            btnSignOut.addEventListener('click', () => firebase.auth().signOut());
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            void initAuth();
        });
    } else {
        void initAuth();
    }
})();
