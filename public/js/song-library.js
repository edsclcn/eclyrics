(function () {
    const FIRESTORE_LYRICS_COLLECTION = 'lyrics';
    const CACHE_STORAGE_KEY = 'eclyrics-song-library-v1';
    const CACHE_SCHEMA_VERSION = 1;

    const LIMITS = {
        BROWSE: 20,
        SEARCH: 10,
    };

    const SEARCH_OPTIONS = {
        prefix: true,
        fuzzy: 0.2,
        combineWith: 'AND',
        boost: {
            title: 5,
            adaptOf: 3,
            hymnNum: 2.5,
            lyrics: 1,
        },
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
        if (typeof firebase === 'undefined' || !firebase.firestore?.Timestamp) {
            throw new Error('Firestore is not ready.');
        }
        payload['last-modified'] = firebase.firestore.Timestamp.now();
        payload['last-modified-by'] = email;
        return payload;
    }

    function rebuildSongsById() {
        state.songsById = new Map(state.songs.map((song) => [song.id, song]));
    }

    function normalizeSearchText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /** Letters and digits only — e.g. "pag-asa" and "pagasa" both become "pagasa". */
    function normalizeSearchCompact(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, '');
    }

    function normalizeSearchQueryToken(term) {
        const compact = normalizeSearchCompact(term);
        return compact || String(term || '').toLowerCase().trim();
    }

    /** Tokens for MiniSearch fields (title, lyrics, etc.), including compact hyphenated words. */
    function tokensFromSearchField(value) {
        const tokens = new Set();
        const raw = String(value || '').toLowerCase();
        raw.split(/\s+/).forEach((segment) => {
            const piece = segment.trim();
            if (!piece) return;
            const compact = normalizeSearchCompact(piece);
            if (compact) tokens.add(compact);
            normalizeSearchText(piece)
                .split(/\s+/)
                .forEach((word) => {
                    if (word) tokens.add(word);
                });
        });
        normalizeSearchText(raw)
            .split(/\s+/)
            .forEach((word) => {
                if (word) tokens.add(word);
            });
        return [...tokens];
    }

    function fieldSearchString(value) {
        const tokens = tokensFromSearchField(value);
        return tokens.length ? tokens.join(' ') : '';
    }

    function songToSearchDocument(song) {
        return {
            id: song.id,
            hymnNum: fieldSearchString(song.hymnNum),
            title: fieldSearchString(song.title),
            adaptOf: fieldSearchString(song.adaptOf),
            lyrics: fieldSearchString(song.lyrics),
        };
    }

    function buildSearchIndex() {
        if (!Array.isArray(state.songs) || state.songs.length === 0) return null;
        if (typeof MiniSearch !== 'function') return null;
        const miniSearch = new MiniSearch({
            fields: ['hymnNum', 'title', 'adaptOf', 'lyrics'],
            storeFields: ['id'],
            searchOptions: SEARCH_OPTIONS,
            tokenize: (string) => String(string || '').split(/\s+/).filter(Boolean),
            processTerm: (term) => normalizeSearchQueryToken(term),
        });
        miniSearch.addAll(state.songs.map(songToSearchDocument));
        return miniSearch;
    }

    function parseSearchQuery(query) {
        const q = String(query || '').trim();
        if (!q) {
            return { phrases: [], terms: [], miniSearchQuery: '' };
        }

        const phrases = [];
        const withoutQuoted = q.replace(/"([^"]+)"/g, (_, phrase) => {
            const p = normalizeSearchText(String(phrase || '').trim());
            if (p) phrases.push(p);
            return ' ';
        });

        const terms = withoutQuoted
            .toLowerCase()
            .split(/\s+/)
            .map((term) => term.trim())
            .filter(Boolean)
            .map(normalizeSearchQueryToken)
            .filter(Boolean);

        const miniSearchTerms = [];
        phrases.forEach((phrase) => {
            phrase
                .split(/\s+/)
                .filter(Boolean)
                .forEach((part) => miniSearchTerms.push(normalizeSearchQueryToken(part)));
        });
        terms.forEach((term) => miniSearchTerms.push(term));

        return {
            phrases,
            terms,
            miniSearchQuery: [...new Set(miniSearchTerms)].join(' '),
        };
    }

    function levenshteinDistance(a, b) {
        const left = String(a || '');
        const right = String(b || '');
        if (left === right) return 0;
        if (!left.length) return right.length;
        if (!right.length) return left.length;

        const rows = left.length + 1;
        const cols = right.length + 1;
        const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
        for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
        for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

        for (let i = 1; i < rows; i += 1) {
            for (let j = 1; j < cols; j += 1) {
                const cost = left[i - 1] === right[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + cost,
                );
            }
        }
        return matrix[rows - 1][cols - 1];
    }

    function maxFuzzyDistance(term) {
        const length = String(term || '').length;
        if (length < 3) return 0;
        return Math.max(1, Math.round(length * 0.2));
    }

    function fuzzyTokenMatch(token, term) {
        const normalizedToken = String(token || '').toLowerCase();
        const normalizedTerm = String(term || '').toLowerCase();
        if (!normalizedToken || !normalizedTerm) return false;
        if (normalizedToken.includes(normalizedTerm) || normalizedTerm.includes(normalizedToken)) return true;
        return levenshteinDistance(normalizedToken, normalizedTerm) <= maxFuzzyDistance(normalizedTerm);
    }

    function haystackContainsTerm(haystack, term) {
        const compactHaystack = normalizeSearchCompact(haystack);
        const compactTerm = normalizeSearchQueryToken(term);
        if (!compactTerm) return true;
        if (compactHaystack.includes(compactTerm)) return true;
        return normalizeSearchText(haystack)
            .split(/\s+/)
            .some((token) => fuzzyTokenMatch(normalizeSearchCompact(token), compactTerm));
    }

    function songFieldValues(song) {
        return {
            title: normalizeSearchCompact(song?.title),
            adaptOf: normalizeSearchCompact(song?.adaptOf),
            hymnNum: normalizeSearchCompact(song?.hymnNum),
            lyrics: normalizeSearchCompact(song?.lyrics),
        };
    }

    function songMatchesPhrases(song, phrases) {
        if (!phrases.length) return true;
        const fields = songFieldValues(song);
        const haystack = [fields.title, fields.adaptOf, fields.hymnNum, fields.lyrics].join('');
        return phrases.every((phrase) => {
            const compactPhrase = normalizeSearchCompact(phrase);
            return compactPhrase && haystack.includes(compactPhrase);
        });
    }

    function songMatchesParsedQuery(song, parsed) {
        if (!songMatchesPhrases(song, parsed.phrases)) return false;
        return parsed.terms.every((term) => {
            const fields = songFieldValues(song);
            return (
                haystackContainsTerm(fields.title, term) ||
                haystackContainsTerm(fields.adaptOf, term) ||
                haystackContainsTerm(fields.hymnNum, term) ||
                haystackContainsTerm(fields.lyrics, term)
            );
        });
    }

    function computeFieldMatchScore(song, parsed) {
        const fields = songFieldValues(song);
        const checks = [
            ...parsed.phrases.map((text) => ({ text, weight: 2 })),
            ...parsed.terms.map((text) => ({ text, weight: 1 })),
        ];
        if (checks.length === 0) return 0;

        let score = 0;
        for (const { text, weight } of checks) {
            const compactText = normalizeSearchQueryToken(text);
            if (
                fields.title.includes(compactText) ||
                haystackContainsTerm(song?.title, text)
            ) {
                score += 1000 * weight;
            } else if (
                fields.adaptOf.includes(compactText) ||
                haystackContainsTerm(song?.adaptOf, text)
            ) {
                score += 300 * weight;
            } else if (
                fields.hymnNum.includes(compactText) ||
                haystackContainsTerm(song?.hymnNum, text)
            ) {
                score += 200 * weight;
            } else if (
                fields.lyrics.includes(compactText) ||
                haystackContainsTerm(song?.lyrics, text)
            ) {
                score += 10 * weight;
            }
        }
        return score;
    }

    function rankMatchedSongs(entries, parsed) {
        return entries
            .map((entry) => {
                const song = resolveStoredSong(entry);
                if (!song) return null;
                const indexScore = typeof entry?.score === 'number' ? entry.score : 0;
                return {
                    song,
                    score: indexScore + computeFieldMatchScore(song, parsed),
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score)
            .map((entry) => entry.song);
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

    function sortSongsForCategoryFilters(songs, activeFilterSlugs) {
        if (!Array.isArray(songs) || songs.length === 0) return songs;
        const slugs =
            activeFilterSlugs instanceof Set
                ? activeFilterSlugs
                : new Set(Array.isArray(activeFilterSlugs) ? activeFilterSlugs : []);
        if (!slugs.has('himnario')) return songs;
        return songs.slice().sort(compareBrowseOrder);
    }

    function resolveStoredSong(entry) {
        if (!entry) return null;
        const id = typeof entry === 'string' ? entry : entry.id;
        if (id && state.songsById.has(id)) return state.songsById.get(id);
        if (entry && entry.id && entry.title) return entry;
        return null;
    }

    function filterSongsFallback(parsed) {
        const searchParts = parsed || parseSearchQuery('');
        if (!searchParts.phrases.length && !searchParts.terms.length) return state.songs.slice();
        return state.songs
            .filter((song) => songMatchesParsedQuery(song, searchParts))
            .map((song) => ({ song, score: computeFieldMatchScore(song, searchParts) }))
            .sort((a, b) => b.score - a.score)
            .map((entry) => entry.song);
    }

    function matchSongs(query) {
        const q = String(query || '').trim();
        if (!q) return state.songs.slice();

        const parsed = parseSearchQuery(q);
        if (!parsed.miniSearchQuery) return [];

        if (state.searchIndex) {
            let raw = state.searchIndex.search(parsed.miniSearchQuery, SEARCH_OPTIONS);
            if (parsed.phrases.length > 0) {
                raw = raw.filter((entry) => {
                    const song = resolveStoredSong(entry);
                    return song && songMatchesPhrases(song, parsed.phrases);
                });
            }
            raw = raw.filter((entry) => {
                const song = resolveStoredSong(entry);
                return song && songMatchesParsedQuery(song, parsed);
            });
            const ranked = rankMatchedSongs(raw, parsed);
            if (ranked.length > 0) return ranked;
            if (parsed.phrases.length || parsed.terms.length) {
                return filterSongsFallback(parsed);
            }
            return ranked;
        }

        return filterSongsFallback(parsed);
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
        const q = String(query || '').trim();
        let matches = matchSongs(q);
        if (!q) {
            matches.sort(compareAdminAlpha);
            return matches;
        }
        return matches.slice(0, LIMITS.SEARCH);
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
        sortSongsForCategoryFilters,
        matchAllSongs: matchSongs,
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
