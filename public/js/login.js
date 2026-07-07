/**
 * Login gate UI — blocks the main app until the user signs in with Google.
 * Depends on auth.js for Firebase Auth state and eclyrics-auth-changed events.
 */
(function () {
    const gate = document.getElementById('auth-gate');
    const appShell = document.getElementById('app-shell');
    const btnSignIn = document.getElementById('auth-sign-in-google');
    const authErrorEl = document.getElementById('auth-error');

    function formatAuthError(err) {
        if (!err || !err.code) return err?.message || String(err);
        if (err.code === 'auth/unauthorized-domain') {
            return 'Add this site’s host to Firebase → Authentication → Settings → Authorized domains (try localhost and 127.0.0.1).';
        }
        return err.message || String(err);
    }

    function showAuthGate(visible) {
        if (gate) {
            gate.classList.toggle('auth-gate--hidden', !visible);
            gate.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }
        if (appShell) {
            appShell.classList.toggle('app-shell--gated', visible);
            appShell.setAttribute('aria-hidden', visible ? 'true' : 'false');
        }
    }

    function onAuthChanged() {
        const u = window.__eclyricsAuth?.user;
        showAuthGate(!u);
    }

    document.addEventListener('eclyrics-auth-changed', onAuthChanged);

    if (btnSignIn) {
        btnSignIn.addEventListener('click', async () => {
            if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') {
                if (authErrorEl) authErrorEl.textContent = 'Firebase Auth is not ready.';
                return;
            }
            const auth = firebase.auth();
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onAuthChanged);
    } else {
        onAuthChanged();
    }
})();
