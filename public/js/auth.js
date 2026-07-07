/**
 * Firebase Auth state + Firestore-backed admin RBAC.
 * Login UI lives in login.js; admin lyrics CRUD lives in admin-panel.js.
 */
(function () {
    window.__eclyricsAuth = { user: null, isAdmin: false, ready: false };

    const btnSignOut = document.getElementById('auth-sign-out');
    const authUserLabel = document.getElementById('auth-user-label');
    const authErrorEl = document.getElementById('auth-error');
    const adminNavBtn = document.querySelector('.sidebar-nav [data-panel="admin"]');

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
        if (!user || user.isAnonymous) {
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
            if (authUserLabel) authUserLabel.textContent = u.email || u.displayName || 'Signed in';
            if (btnSignOut) btnSignOut.hidden = false;
            setAdminNavVisibility(window.__eclyricsAuth.isAdmin);
        } else {
            if (authUserLabel) authUserLabel.textContent = '';
            if (btnSignOut) btnSignOut.hidden = true;
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

    async function initAuth() {
        if (typeof firebase === 'undefined') {
            console.error('eclyrics: Firebase SDK not loaded');
            if (authErrorEl) {
                authErrorEl.textContent =
                    'Firebase SDK failed to load. Check network / ad blockers, or see README.';
            }
            return;
        }

        if (window.location.protocol === 'file:') {
            if (authErrorEl) {
                authErrorEl.textContent =
                    'Google sign-in does not work from file://. Use http://localhost (e.g. firebase serve).';
            }
            return;
        }

        if (!firebase.apps.length) {
            if (firebaseConfigIncomplete()) {
                console.error('eclyrics: Edit public/js/firebase-config.js with Firebase Console values.');
                if (authErrorEl) {
                    authErrorEl.textContent =
                        'Paste your web app firebaseConfig into js/firebase-config.js (see README).';
                }
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

        try {
            await auth.getRedirectResult();
            if (authErrorEl) authErrorEl.textContent = '';
        } catch (err) {
            console.error('eclyrics: getRedirectResult', err);
            if (authErrorEl) authErrorEl.textContent = err.message || String(err);
        }

        auth.onAuthStateChanged(async (user) => {
            window.__eclyricsAuth.user = user;
            if (authErrorEl && user) authErrorEl.textContent = '';
            await refreshAdminRole(user);
            updateAuthChrome();
        });

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
