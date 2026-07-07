(function () {
    const FIRESTORE_LYRICS_COLLECTION = 'lyrics';
    const CACHE_STORAGE_KEY = 'eclyrics-song-library-v1';
    const CACHE_SCHEMA_VERSION = 1;

    const LIMITS = {
        BROWSE: 20,
        SEARCH: 10,
    };

    const state = {
        songs: [],
        songsById: new Map(),
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

    function asNonEmptyString(value) {
        const s = String(value == null ? '' : value).trim();
        return s || '';
    }

    function asStringArray(value) {
        if (!Array.isArray(value)) return [];
        return value.map((item) => asNonEmptyString(item)).filter(Boolean);
    }

    function categoryToSlug(category) {
        const normalized = String(category || '').trim().toLowerCase();
        if (normalized === 'asop/f' || normalized === 'asopf' || normalized === 'asop-f') return 'asop-f';
        return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function songHasCategorySlug(song, slug) {
        if (!Array.isArray(song?.category)) return false;
        return song.category.some((entry) => categoryToSlug(entry) === slug);
    }

    function getPopupSongTitle(song) {
        const hymnNum = String(song?.hymnNum || '').trim();
        const title = String(song?.title || '').trim() || '(Untitled)';
        return hymnNum ? `${hymnNum} - ${title}` : title;
    }

    function getSongAdaptationLabel(song) {
        if (!songHasCategorySlug(song, 'adaptation') || !song?.adaptOf) return '';
        const adaptOf = String(song.adaptOf).trim();
        const title = String(song?.title || '').trim();
        if (adaptOf && title && adaptOf.localeCompare(title, undefined, { sensitivity: 'accent' }) === 0) {
            return '';
        }
        return `${adaptOf} Adapt.`;
    }

    function formatVersionWord(word) {
        const w = String(word || '').trim();
        if (!w) return '';
        if (w.toLowerCase() === 'k&t') return 'K&T';
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }

    function formatSongVersionDisplay(version) {
        const v = asNonEmptyString(version).toLowerCase();
        if (!v || v === 'original') return '';
        const formatted = v.split(/\s+/).map(formatVersionWord).join(' ');
        return `- ${formatted}`;
    }

    function truncateLyricsPreview(lyrics, maxChars = 150) {
        const normalized = String(lyrics || '').replace(/\s+/g, ' ').trim();
        if (!normalized) return 'No lyrics text yet.';
        if (normalized.length <= maxChars) return normalized;
        return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
    }

    function formatLastModifiedTimestamp(date = new Date()) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Manila',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
        }).formatToParts(date);
        const get = (type) => parts.find((part) => part.type === type)?.value || '';
        return `${get('month')} ${get('day')}, ${get('year')} at ${get('hour')}:${get('minute')}:${get('second')}${get('dayPeriod')} UTC+8`;
    }

    function formatLastModifiedDisplay(value) {
        if (value == null || value === '') return '';
        if (typeof value === 'string') {
            const s = value.trim();
            if (!s || s.startsWith('Timestamp(')) return '';
            return s;
        }
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return formatLastModifiedTimestamp(value);
        }
        if (typeof value === 'object' && typeof value.toDate === 'function') {
            try {
                return formatLastModifiedTimestamp(value.toDate());
            } catch (e) {
                return '';
            }
        }
        if (typeof value === 'object' && typeof value.seconds === 'number') {
            return formatLastModifiedTimestamp(new Date(value.seconds * 1000));
        }
        const s = String(value).trim();
        if (!s || s.startsWith('Timestamp(')) return '';
        return s;
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
            lastModified: formatLastModifiedDisplay(data['last-modified'] ?? data.lastModified),
            lastModifiedBy: asNonEmptyString(data['last-modified-by'] || data.lastModifiedBy),
        };
    }

    function appendAuditFields(payload, user) {
        const email = asNonEmptyString(user?.email);
        if (!email) throw new Error('Signed-in user email is required to save lyrics.');
        payload['last-modified'] = formatLastModifiedTimestamp();
        payload['last-modified-by'] = email;
        return payload;
    }

    function rebuildSongsById() {
        state.songsById = new Map(state.songs.map((song) => [song.id, song]));
    }

    function buildSearchIndex() {
        if (!Array.isArray(state.songs) || state.songs.length === 0) return null;
        if (typeof MiniSearch !== 'function') return null;
        const miniSearch = new MiniSearch({
            fields: ['hymnNum', 'title', 'adaptOf', 'lyrics'],
            storeFields: ['id'],
            searchOptions: {
                prefix: true,
                fuzzy: 0.2,
            },
        });
        miniSearch.addAll(state.songs);
        return miniSearch;
    }

    function refreshLibraryIndex() {
        rebuildSongsById();
        state.searchIndex = buildSearchIndex();
    }

    function compareBrowseOrder(a, b) {
        const ha = parseInt(a.hymnNum, 10);
        const hb = parseInt(b.hymnNum, 10);
        if (Number.isFinite(ha) && Number.isFinite(hb) && ha !== hb) return ha - hb;
        const hymnCmp = String(a.hymnNum || '').localeCompare(String(b.hymnNum || ''), undefined, {
            numeric: true,
            sensitivity: 'base',
        });
        if (hymnCmp !== 0) return hymnCmp;
        return String(a.title || '').localeCompare(String(b.title || ''), undefined, {
            sensitivity: 'base',
        });
    }

    function compareAdminAlpha(a, b) {
        const titleCmp = String(a.title || '').localeCompare(String(b.title || ''), undefined, {
            sensitivity: 'base',
        });
        if (titleCmp !== 0) return titleCmp;
        return String(a.hymnNum || '').localeCompare(String(b.hymnNum || ''), undefined, {
            numeric: true,
            sensitivity: 'base',
        });
    }

    function resolveStoredSong(entry) {
        if (!entry) return null;
        const id = typeof entry === 'string' ? entry : entry.id;
        if (id && state.songsById.has(id)) return state.songsById.get(id);
        if (entry && entry.id && entry.title) return entry;
        return null;
    }

    function filterSongsFallback(query) {
        const q = String(query || '').trim().toLowerCase();
        return state.songs.filter(
            (song) =>
                song.hymnNum.toLowerCase().includes(q) ||
                song.title.toLowerCase().includes(q) ||
                String(song.adaptOf || '').toLowerCase().includes(q) ||
                song.lyrics.toLowerCase().includes(q),
        );
    }

    function matchSongs(query) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return state.songs.slice();
        const raw = state.searchIndex ? state.searchIndex.search(q) : filterSongsFallback(q);
        return raw.map(resolveStoredSong).filter(Boolean);
    }

    function search(query, limitOrOptions) {
        let limit;
        if (typeof limitOrOptions === 'number') {
            limit = limitOrOptions;
        } else if (limitOrOptions && typeof limitOrOptions === 'object') {
            limit = limitOrOptions.limit;
        }

        const q = String(query || '').trim();
        let matches = matchSongs(q);
        if (!q) {
            matches.sort(compareBrowseOrder);
            const effectiveLimit = limit ?? LIMITS.BROWSE;
            return matches.slice(0, effectiveLimit);
        }

        const effectiveLimit = limit ?? LIMITS.SEARCH;
        return matches.slice(0, effectiveLimit);
    }

    function searchAdmin(query) {
        const matches = matchSongs(query);
        matches.sort(compareAdminAlpha);
        return matches;
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

    function hydrateFromLocalCache() {
        try {
            const raw = localStorage.getItem(CACHE_STORAGE_KEY);
            if (!raw) return false;
            const parsed = JSON.parse(raw);
            if (!parsed || parsed.version !== CACHE_SCHEMA_VERSION || !Array.isArray(parsed.songs)) {
                return false;
            }
            state.songs = parsed.songs.filter((song) => song && song.id);
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

    function applyInitialSnapshot(snap) {
        setSongs(snap.docs.map(normalizeLyricsDoc).filter(Boolean));
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
            const song = normalizeLyricsDoc(change.doc);
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
        if (state.songs.length === 0) {
            state.searchIndex = null;
            state.songsById = new Map();
        }
        state.error = `Firestore read failed: ${error?.message || String(error)}`;
        state.loaded = true;
        state.syncing = false;
        notify();
    }

    async function start() {
        if (state.started) return;
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

        const app = ensureFirebaseApp();
        if (!app) {
            state.error = state.songs.length
                ? ''
                : 'Firebase is not ready. Check js/firebase-config.js.';
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

    function getState() {
        return {
            loaded: state.loaded,
            syncing: state.syncing,
            fromCache: state.fromCache,
            error: state.error,
            count: state.songs.length,
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
        const title = asNonEmptyString(data.title);
        const lyrics = asNonEmptyString(data.lyrics);
        if (!title) throw new Error('Title is required.');
        const payload = { title, lyrics };
        const hymnNum = asNonEmptyString(data.hymnNum);
        if (hymnNum) payload['hymn-num'] = hymnNum;
        const category = asStringArray(data.category);
        if (category.length) payload.category = category;
        const version = asNonEmptyString(data.version);
        if (version) payload.version = version;
        const adaptOf = asNonEmptyString(data.adaptOf);
        if (adaptOf) payload['adapt-of'] = adaptOf;
        return appendAuditFields(payload, user);
    }

    async function createLyric(data) {
        const user = await requireAdminForWrite();
        const payload = buildFirestorePayload(data, user);
        try {
            const ref = await firebase.firestore().collection(FIRESTORE_LYRICS_COLLECTION).add(payload);
            return ref.id;
        } catch (err) {
            throw new Error(formatFirestoreError(err));
        }
    }

    async function updateLyric(id, data) {
        const user = await requireAdminForWrite();
        const docId = asNonEmptyString(id);
        if (!docId) throw new Error('Document ID is required.');
        const payload = buildFirestorePayload(data, user);
        try {
            await firebase.firestore().collection(FIRESTORE_LYRICS_COLLECTION).doc(docId).set(payload);
        } catch (err) {
            throw new Error(formatFirestoreError(err));
        }
    }

    async function deleteLyric(id) {
        await requireAdminForWrite();
        const docId = asNonEmptyString(id);
        if (!docId) throw new Error('Document ID is required.');
        try {
            await firebase.firestore().collection(FIRESTORE_LYRICS_COLLECTION).doc(docId).delete();
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
        search,
        searchAdmin,
        getSongs,
        createLyric,
        updateLyric,
        deleteLyric,
        formatLastModifiedTimestamp,
        getPopupSongTitle,
        getSongAdaptationLabel,
        formatSongVersionDisplay,
        truncateLyricsPreview,
        onChange,
        getState,
        LIMITS,
    };
})();
