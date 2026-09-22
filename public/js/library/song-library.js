(function () {
    const FIRESTORE_LYRICS_COLLECTION = 'lyrics';
    const CACHE_STORAGE_KEY = 'eclyrics-song-library-v1';
    const CACHE_SCHEMA_VERSION = 1;

    /*
     * Development switch: set false to use the local song cache only.
     * Set true before release so users receive Firestore updates in realtime.
     */
    const ENABLE_LYRICS_REALTIME_SYNC = true; // Set to true for production release. Check before committing.
    const songModel = window.eclyricsSongModel;
    const songSearch = window.eclyricsSongSearch;

    const state = {
        songs: [],
        searchIndex: null,
        loaded: false,
        syncing: false,
        fromCache: false,
        error: '',
        unsubscribe: null,
        started: false,
        snapshotReady: false,
    };

    const listeners = new Set();
    let cacheSaveTimer = null;

    function notify() {
        listeners.forEach((listener) => {
            try {
                listener(getState());
            } catch (e) {
                // Ignore listener errors to keep state updates flowing.
            }
        });
    }

    function refreshLibraryIndex() {
        state.searchIndex = songSearch.buildSearchIndex(state.songs);
    }

    function persistSongsToCache(songs) {
        try {
            localStorage.setItem(
                CACHE_STORAGE_KEY,
                JSON.stringify({
                    version: CACHE_SCHEMA_VERSION,
                    savedAt: Date.now(),
                    songs,
                }),
            );
        } catch (e) {
            // Quota or private mode — in-memory cache still works for this session.
        }
    }

    function scheduleCacheSave() {
        clearTimeout(cacheSaveTimer);
        cacheSaveTimer = setTimeout(() => persistSongsToCache(state.songs), 400);
    }

    function isAutoSyncEnabled() {
        return ENABLE_LYRICS_REALTIME_SYNC;
    }

    function hydrateFromLocalCache() {
        try {
            const raw = localStorage.getItem(CACHE_STORAGE_KEY);
            if (!raw) return false;
            const parsed = JSON.parse(raw);
            if (!parsed || parsed.version !== CACHE_SCHEMA_VERSION || !Array.isArray(parsed.songs)) {
                return false;
            }
            state.songs = parsed.songs.filter((song) => song && song.id).map(songModel.normalizeCachedSong);
            scheduleCacheSave();
            refreshLibraryIndex();
            state.loaded = true;
            state.fromCache = true;
            state.syncing = true;
            state.error = '';
            notify();
            return state.songs.length > 0;
        } catch (e) {
            return false;
        }
    }

    function setSongs(nextSongs) {
        state.songs = nextSongs;
        refreshLibraryIndex();
        state.loaded = true;
        state.error = '';
        scheduleCacheSave();
        notify();
    }

    function upsertSong(song) {
        if (!song?.id) return;
        const idx = state.songs.findIndex((entry) => entry.id === song.id);
        if (idx === -1) state.songs.push(song);
        else state.songs[idx] = song;
    }

    function removeSongById(id) {
        state.songs = state.songs.filter((entry) => entry.id !== id);
    }

    function applyLocalWrite(id, payload) {
        const song = songModel.normalizeLyricsDoc({
            id: String(id),
            data: () => payload,
        });
        if (!song) return;
        upsertSong(song);
        refreshLibraryIndex();
        state.loaded = true;
        state.error = '';
        scheduleCacheSave();
        notify();
    }

    function applyLocalDelete(id) {
        removeSongById(String(id));
        refreshLibraryIndex();
        state.loaded = true;
        state.error = '';
        scheduleCacheSave();
        notify();
    }

    function applyInitialSnapshot(snap) {
        setSongs(snap.docs.map(songModel.normalizeLyricsDoc).filter(Boolean));
        state.fromCache = false;
        state.syncing = false;
        state.snapshotReady = true;
        notify();
    }

    function applyDocChanges(changes) {
        if (!Array.isArray(changes) || changes.length === 0) return false;
        let changed = false;
        changes.forEach((change) => {
            if (change.type === 'removed') {
                removeSongById(String(change.doc.id));
                changed = true;
                return;
            }
            const song = songModel.normalizeLyricsDoc(change.doc);
            if (song) {
                upsertSong(song);
                changed = true;
            }
        });
        if (!changed) return false;
        refreshLibraryIndex();
        scheduleCacheSave();
        notify();
        return true;
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

    async function waitForSignedInUser(timeoutMs = 15000) {
        if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') return null;
        await waitForAuthReady();
        const auth = firebase.auth();
        if (auth.currentUser && !auth.currentUser.isAnonymous) return auth.currentUser;

        return new Promise((resolve) => {
            let done = false;
            const finish = (user) => {
                if (done) return;
                done = true;
                auth.removeAuthStateListener(onAuth);
                clearTimeout(timer);
                resolve(user && !user.isAnonymous ? user : null);
            };
            const onAuth = (user) => finish(user);
            const timer = setTimeout(() => finish(auth.currentUser), timeoutMs);
            auth.onAuthStateChanged(onAuth);
        });
    }

    function applyError(error) {
        if (state.songs.length === 0) state.searchIndex = null;
        state.error = `Firestore read failed: ${error?.message || String(error)}`;
        state.loaded = true;
        state.syncing = false;
        notify();
    }

    async function start(options = {}) {
        if (state.started) return;
        const shouldSync = options.sync ?? isAutoSyncEnabled();
        state.started = true;
        state.error = '';
        state.syncing = true;

        if (!state.loaded) {
            hydrateFromLocalCache();
        }
        if (!state.loaded) {
            state.loaded = false;
            notify();
        }

        if (!shouldSync) {
            state.syncing = false;
            state.loaded = true;
            state.fromCache = state.songs.length > 0;
            state.error = state.songs.length
                ? ''
                : 'Automatic library sync is off. Turn it on to load songs.';
            notify();
            return;
        }

        const app = ensureFirebaseApp();
        if (!app) {
            state.error = state.songs.length
                ? ''
                : 'Firebase is not ready. Check js/core/firebase-config.js.';
            state.loaded = true;
            state.syncing = false;
            notify();
            return;
        }

        if (typeof state.unsubscribe === 'function') {
            state.unsubscribe();
            state.unsubscribe = null;
        }

        state.unsubscribe = firebase
            .firestore()
            .collection(FIRESTORE_LYRICS_COLLECTION)
            .onSnapshot(
                (snap) => {
                    if (!state.snapshotReady) {
                        applyInitialSnapshot(snap);
                        return;
                    }
                    applyDocChanges(snap.docChanges());
                    state.fromCache = false;
                    state.syncing = false;
                    state.error = '';
                },
                applyError,
            );
    }

    function stop() {
        if (typeof state.unsubscribe === 'function') state.unsubscribe();
        state.unsubscribe = null;
        state.started = false;
        state.snapshotReady = false;
        clearTimeout(cacheSaveTimer);
    }

    async function refresh() {
        stop();
        state.loaded = false;
        state.snapshotReady = false;
        state.error = '';
        await start({ sync: true });
    }

    function getState() {
        return {
            loaded: state.loaded,
            syncing: state.syncing,
            fromCache: state.fromCache,
            error: state.error,
            count: state.songs.length,
            autoSyncEnabled: isAutoSyncEnabled(),
        };
    }

    function getSongs() {
        return state.songs.slice();
    }

    function formatFirestoreError(err) {
        const code = err?.code || '';
        const message = err?.message || String(err);
        if (code === 'permission-denied' || message.includes('Missing or insufficient permissions')) {
            return (
                'Firestore denied this action. Confirm your email is in rbac/config.adminEmails (lowercase), ' +
                'sign in with Google (not anonymous), and deploy the latest firestore.rules.'
            );
        }
        return message;
    }

    async function requireAdminForWrite() {
        if (!window.__eclyricsAuth?.isAdmin) {
            throw new Error('Admin access required.');
        }
        const user = await waitForSignedInUser();
        if (!user) {
            throw new Error('Sign in with Google before saving lyrics.');
        }
        try {
            await user.getIdToken(true);
        } catch (e) {
            // Continue; Firestore will still use the current session if valid.
        }
        return user;
    }

    function buildFirestorePayload(data, user) {
        const timestampFactory =
            typeof firebase !== 'undefined' && firebase.firestore?.Timestamp
                ? () => firebase.firestore.Timestamp.now()
                : null;
        return songModel.buildFirestorePayload(data, user, timestampFactory);
    }

    async function createLyric(data) {
        const user = await requireAdminForWrite();
        const payload = buildFirestorePayload(data, user);
        try {
            const ref = await firebase.firestore().collection(FIRESTORE_LYRICS_COLLECTION).add(payload);
            applyLocalWrite(ref.id, payload);
            return ref.id;
        } catch (err) {
            throw new Error(formatFirestoreError(err));
        }
    }

    async function updateLyric(id, data) {
        const user = await requireAdminForWrite();
        const docId = songModel.asNonEmptyString(id);
        if (!docId) throw new Error('Document ID is required.');
        const payload = buildFirestorePayload(data, user);
        try {
            await firebase.firestore().collection(FIRESTORE_LYRICS_COLLECTION).doc(docId).set(payload);
            applyLocalWrite(docId, payload);
        } catch (err) {
            throw new Error(formatFirestoreError(err));
        }
    }

    async function deleteLyric(id) {
        await requireAdminForWrite();
        const docId = songModel.asNonEmptyString(id);
        if (!docId) throw new Error('Document ID is required.');
        try {
            await firebase.firestore().collection(FIRESTORE_LYRICS_COLLECTION).doc(docId).delete();
            applyLocalDelete(docId);
        } catch (err) {
            throw new Error(formatFirestoreError(err));
        }
    }

    function onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    window.eclyricsSongLibrary = {
        start,
        stop,
        refresh,
        isAutoSyncEnabled,
        search: (query, limitOrOptions) => songSearch.search(state.songs, state.searchIndex, query, limitOrOptions),
        searchAdmin: (query) => songSearch.searchAdmin(state.songs, state.searchIndex, query),
        sortSongsForCategoryFilters: songSearch.sortSongsForCategoryFilters,
        matchAllSongs: (query) => songSearch.matchSongs(state.songs, state.searchIndex, query),
        getSongs,
        createLyric,
        updateLyric,
        deleteLyric,
        formatLastModifiedTimestamp: songModel.formatLastModifiedTimestamp,
        getPopupSongTitle: songModel.getPopupSongTitle,
        getSongAdaptationLabel: songModel.getSongAdaptationLabel,
        getSongAdaptationSearchLabel: songModel.getSongAdaptationSearchLabel,
        formatSongVersionDisplay: songModel.formatSongVersionDisplay,
        truncateLyricsPreview: songModel.truncateLyricsPreview,
        onChange,
        getState,
        LIMITS: songSearch.LIMITS,
    };
})();
