(function () {
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

    function buildSearchIndex(songs) {
        if (!Array.isArray(songs) || songs.length === 0) return null;
        if (typeof MiniSearch !== 'function') return null;
        const miniSearch = new MiniSearch({
            fields: ['hymnNum', 'title', 'adaptOf', 'lyrics'],
            storeFields: ['id'],
            searchOptions: SEARCH_OPTIONS,
            tokenize: (string) => String(string || '').split(/\s+/).filter(Boolean),
            processTerm: (term) => normalizeSearchQueryToken(term),
        });
        miniSearch.addAll(songs.map(songToSearchDocument));
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
            if (fields.title.includes(compactText) || haystackContainsTerm(song?.title, text)) {
                score += 1000 * weight;
            } else if (fields.adaptOf.includes(compactText) || haystackContainsTerm(song?.adaptOf, text)) {
                score += 300 * weight;
            } else if (fields.hymnNum.includes(compactText) || haystackContainsTerm(song?.hymnNum, text)) {
                score += 200 * weight;
            } else if (fields.lyrics.includes(compactText) || haystackContainsTerm(song?.lyrics, text)) {
                score += 10 * weight;
            }
        }
        return score;
    }

    function resolveStoredSong(entry, songsById) {
        if (!entry) return null;
        const id = typeof entry === 'string' ? entry : entry.id;
        if (id && songsById.has(id)) return songsById.get(id);
        if (entry && entry.id && entry.title) return entry;
        return null;
    }

    function rankMatchedSongs(entries, parsed, songsById) {
        return entries
            .map((entry) => {
                const song = resolveStoredSong(entry, songsById);
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

    function filterSongsFallback(songs, parsed) {
        const searchParts = parsed || parseSearchQuery('');
        if (!searchParts.phrases.length && !searchParts.terms.length) return songs.slice();
        return songs
            .filter((song) => songMatchesParsedQuery(song, searchParts))
            .map((song) => ({ song, score: computeFieldMatchScore(song, searchParts) }))
            .sort((a, b) => b.score - a.score)
            .map((entry) => entry.song);
    }

    function matchSongs(songs, searchIndex, query) {
        const q = String(query || '').trim();
        if (!q) return songs.slice();

        const parsed = parseSearchQuery(q);
        if (!parsed.miniSearchQuery) return [];
        const songsById = new Map(songs.map((song) => [song.id, song]));

        if (searchIndex) {
            let raw = searchIndex.search(parsed.miniSearchQuery, SEARCH_OPTIONS);
            if (parsed.phrases.length > 0) {
                raw = raw.filter((entry) => {
                    const song = resolveStoredSong(entry, songsById);
                    return song && songMatchesPhrases(song, parsed.phrases);
                });
            }
            raw = raw.filter((entry) => {
                const song = resolveStoredSong(entry, songsById);
                return song && songMatchesParsedQuery(song, parsed);
            });
            const ranked = rankMatchedSongs(raw, parsed, songsById);
            if (ranked.length > 0) return ranked;
            if (parsed.phrases.length || parsed.terms.length) return filterSongsFallback(songs, parsed);
            return ranked;
        }

        return filterSongsFallback(songs, parsed);
    }

    function search(songs, searchIndex, query, limitOrOptions) {
        let limit;
        if (typeof limitOrOptions === 'number') {
            limit = limitOrOptions;
        } else if (limitOrOptions && typeof limitOrOptions === 'object') {
            limit = limitOrOptions.limit;
        }

        const q = String(query || '').trim();
        let matches = matchSongs(songs, searchIndex, q);
        if (!q) {
            matches.sort(compareBrowseOrder);
            const effectiveLimit = limit ?? LIMITS.BROWSE;
            return matches.slice(0, effectiveLimit);
        }

        const effectiveLimit = limit ?? LIMITS.SEARCH;
        return matches.slice(0, effectiveLimit);
    }

    function searchAdmin(songs, searchIndex, query) {
        const q = String(query || '').trim();
        let matches = matchSongs(songs, searchIndex, q);
        if (!q) {
            matches.sort(compareAdminAlpha);
            return matches;
        }
        return matches.slice(0, LIMITS.SEARCH);
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

    window.eclyricsSongSearch = {
        LIMITS,
        SEARCH_OPTIONS,
        buildSearchIndex,
        parseSearchQuery,
        matchSongs,
        search,
        searchAdmin,
        sortSongsForCategoryFilters,
    };
})();
