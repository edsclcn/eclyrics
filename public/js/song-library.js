(function () {
    const FIRESTORE_LYRICS_COLLECTION = 'lyrics';
    const DEFAULT_RESULT_LIMIT = 80;

    const state = {
        songs: [],
        searchIndex: null,
        loaded: false,
        error: '',
        unsubscribe: null,
        started: false,
    };

    const listeners = new Set();

    function notify() {
        listeners.forEach((listener) => {
            try {
                listener(getState());
            } catch (e) {
                // Ignore listener errors to keep state updates flowing.
            }
        });
    }

    function asNonEmptyString(value) {
        const s = String(value == null ? '' : value).trim();
        return s || '';
    }

    function asStringArray(value) {
        if (!Array.isArray(value)) return [];
        return value.map((item) => asNonEmptyString(item)).filter(Boolean);
    }

    function normalizeLyricsDoc(docSnap) {
        const data = docSnap?.data?.();
        if (!data || typeof data !== 'object') return null;
        const title = asNonEmptyString(data.title);
        const lyrics = asNonEmptyString(data.lyrics);
        if (!title && !lyrics) return null;
        const category = asStringArray(data.category);
        const adaptOf = asNonEmptyString(data['adapt-of'] || data.adaptOf);
        return {
            id: String(docSnap.id),
            title: title || '(Untitled)',
            lyrics,
            hymnNum: asNonEmptyString(data['hymn-num'] || data.hymnNum),
            category,
            version: asNonEmptyString(data.version),
            adaptOf,
        };
    }

    function buildSearchIndex() {
        if (!Array.isArray(state.songs) || state.songs.length === 0) return null;
        if (typeof MiniSearch !== 'function') return null;
        const miniSearch = new MiniSearch({
            fields: ['hymnNum', 'title', 'lyrics'],
            storeFields: ['id', 'hymnNum', 'title', 'lyrics', 'category', 'version', 'adaptOf'],
            searchOptions: {
                prefix: true,
                fuzzy: 0.2,
            },
        });
        miniSearch.addAll(state.songs);
        return miniSearch;
    }

    function isFirebaseConfigReady() {
        if (typeof firebaseConfig === 'undefined' || !firebaseConfig) return false;
        return !!firebaseConfig.apiKey && !!firebaseConfig.projectId;
    }

    function ensureFirebaseApp() {
        if (typeof firebase === 'undefined') return null;
        if (firebase.apps?.length) return firebase.apps[0];
        if (!isFirebaseConfigReady()) return null;
        try {
            return firebase.initializeApp(firebaseConfig);
        } catch (e) {
            if (firebase.apps?.length) return firebase.apps[0];
            return null;
        }
    }

    function waitForAuthReady(timeoutMs = 3000) {
        return new Promise((resolve) => {
            const authState = window.__eclyricsAuth;
            if (!authState || authState.ready) {
                resolve();
                return;
            }
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                document.removeEventListener('eclyrics-auth-changed', onAuthChanged);
                clearTimeout(timer);
                resolve();
            };
            const onAuthChanged = () => finish();
            const timer = setTimeout(finish, timeoutMs);
            document.addEventListener('eclyrics-auth-changed', onAuthChanged, { once: true });
        });
    }

    async function ensureAuthForFirestoreRead() {
        if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') return;
        await waitForAuthReady();
        const auth = firebase.auth();
        if (auth.currentUser) return;
        try {
            await auth.signInAnonymously();
        } catch (e) {
            // Continue: public-read rules can still work without auth.
        }
    }

    function applySnapshot(snap) {
        state.songs = snap.docs.map(normalizeLyricsDoc).filter(Boolean);
        state.searchIndex = buildSearchIndex();
        state.loaded = true;
        state.error = '';
        notify();
    }

    function applyError(error) {
        state.songs = [];
        state.searchIndex = null;
        state.error = `Firestore read failed: ${error?.message || String(error)}`;
        state.loaded = true;
        notify();
    }

    async function start() {
        if (state.started) return;
        state.started = true;
        state.loaded = false;
        state.error = '';
        notify();

        const app = ensureFirebaseApp();
        if (!app) {
            state.error = 'Firebase is not ready. Check js/firebase-config.js.';
            state.loaded = true;
            notify();
            return;
        }

        await ensureAuthForFirestoreRead();

        if (typeof state.unsubscribe === 'function') {
            state.unsubscribe();
            state.unsubscribe = null;
        }

        state.unsubscribe = firebase
            .firestore()
            .collection(FIRESTORE_LYRICS_COLLECTION)
            .onSnapshot(applySnapshot, applyError);
    }

    function stop() {
        if (typeof state.unsubscribe === 'function') state.unsubscribe();
        state.unsubscribe = null;
        state.started = false;
    }

    function getState() {
        return {
            loaded: state.loaded,
            error: state.error,
            count: state.songs.length,
        };
    }

    function search(query, limit = DEFAULT_RESULT_LIMIT) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return state.songs.slice(0, limit);
        const results = state.searchIndex
            ? state.searchIndex.search(q)
            : state.songs.filter(
                  (song) =>
                      song.hymnNum.toLowerCase().includes(q) ||
                      song.title.toLowerCase().includes(q) ||
                      song.lyrics.toLowerCase().includes(q),
              );
        return results.slice(0, limit);
    }

    function onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    window.eclyricsSongLibrary = {
        start,
        stop,
        search,
        onChange,
        getState,
    };
})();
