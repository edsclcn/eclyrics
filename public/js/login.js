/**
 * Login gate UI — blocks the main app until the user signs in with Google.
 * Depends on auth.js for Firebase Auth state and eclyrics-auth-changed events.
 */
(function () {
    const gate = document.getElementById('auth-gate');
    const appShell = document.getElementById('app-shell');
    const btnSignIn = document.getElementById('auth-sign-in-google');
    const authErrorEl = document.getElementById('auth-error');
    const statusEl = document.getElementById('auth-gate-status');
    const themeBtn = document.getElementById('auth-gate-theme-toggle');

    let signInInProgress = false;

    function formatAuthError(err) {
        if (!err || !err.code) return err?.message || String(err);
        if (err.code === 'auth/unauthorized-domain') {
            return 'Add this site’s host to Firebase → Authentication → Settings → Authorized domains (try localhost and 127.0.0.1).';
        }
        return err.message || String(err);
    }

    function shouldShowAuthGate() {
        const auth = window.__eclyricsAuth || {};
        return signInInProgress || !auth.ready || !auth.user;
    }

    function setSignInButtonLoading(loading) {
        if (!btnSignIn) return;
        btnSignIn.classList.toggle('auth-gate-google-btn--loading', loading);
        btnSignIn.setAttribute('aria-busy', loading ? 'true' : 'false');
        const label = btnSignIn.querySelector('.auth-gate-google-btn__label');
        if (label) {
            label.textContent = loading ? 'Opening Google sign-in…' : 'Continue with Google';
        }
    }

    function updateGateStatus() {
        const auth = window.__eclyricsAuth || {};
        if (!statusEl) return;

        if (signInInProgress) {
            statusEl.textContent = 'Complete sign-in in the Google window, then return here.';
            return;
        }
        if (!auth.ready) {
            statusEl.textContent = 'Checking session…';
            return;
        }
        if (!auth.user) {
            statusEl.textContent = 'Sign in required to open the lyrics workspace.';
            return;
        }
        statusEl.textContent = '';
    }

    function syncSignInButtonState() {
        if (!btnSignIn) return;
        const auth = window.__eclyricsAuth || {};
        btnSignIn.disabled = !auth.ready || signInInProgress;
    }

    function showAuthGate(visible) {
        document.body.classList.toggle('auth-gate-open', visible);

        if (gate) {
            gate.hidden = !visible;
            gate.classList.toggle('auth-gate--hidden', !visible);
            gate.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }

        if (appShell) {
            appShell.classList.toggle('app-shell--gated', visible);
            appShell.toggleAttribute('inert', visible);
            appShell.setAttribute('aria-hidden', visible ? 'true' : 'false');
        }

        updateGateStatus();
        syncSignInButtonState();
    }

    function onAuthChanged() {
        showAuthGate(shouldShowAuthGate());
    }

    function syncGateThemeToggle() {
        if (!themeBtn) return;
        const dark = document.documentElement.classList.contains('dark');
        const icon = themeBtn.querySelector('i');
        const modeLabel = dark ? 'Light mode' : 'Dark mode';
        themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
        themeBtn.setAttribute('aria-label', modeLabel);
        themeBtn.title = modeLabel;
        if (icon) icon.className = dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }

    document.addEventListener('eclyrics-auth-changed', onAuthChanged);

    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const dark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('eclyrics-theme', dark ? 'dark' : 'light');
            document.documentElement.dataset.theme = dark ? 'dark' : 'light';
            syncGateThemeToggle();
        });
        syncGateThemeToggle();
    }

    if (btnSignIn) {
        btnSignIn.addEventListener('click', async () => {
            if (signInInProgress || btnSignIn.disabled) return;

            if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') {
                if (authErrorEl) authErrorEl.textContent = 'Firebase Auth is not ready.';
                return;
            }

            const auth = firebase.auth();
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });

            signInInProgress = true;
            if (authErrorEl) authErrorEl.textContent = '';
            setSignInButtonLoading(true);
            showAuthGate(true);

            let keepSignInPending = false;
            try {
                await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
                await auth.signInWithPopup(provider);
                if (authErrorEl) authErrorEl.textContent = '';
            } catch (err) {
                if (err.code === 'auth/popup-blocked') {
                    try {
                        keepSignInPending = true;
                        await auth.signInWithRedirect(provider);
                    } catch (e2) {
                        keepSignInPending = false;
                        if (authErrorEl) authErrorEl.textContent = formatAuthError(e2);
                    }
                    return;
                }
                if (err.code === 'auth/popup-closed-by-user') {
                    if (authErrorEl) authErrorEl.textContent = 'Sign-in was cancelled. Try again when you are ready.';
                    return;
                }
                if (authErrorEl) authErrorEl.textContent = formatAuthError(err);
            } finally {
                if (!keepSignInPending) {
                    signInInProgress = false;
                    setSignInButtonLoading(false);
                    onAuthChanged();
                }
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onAuthChanged);
    } else {
        onAuthChanged();
    }
})();
