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
            return { phrases: [], terms: [], orderedTerms: [], miniSearchQuery: '' };
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
        const orderedTerms = normalizeSearchText(q.replace(/"/g, ' '))
            .split(/\s+/)
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
            orderedTerms,
            miniSearchQuery: [...new Set(miniSearchTerms)].join(' '),
        };
    }

    function lyricWordMatchesPhrase(words, phraseWords) {
        if (!phraseWords.length || phraseWords.length > words.length) return null;
        for (let start = 0; start <= words.length - phraseWords.length; start += 1) {
            const qualities = phraseWords.map((word, offset) =>
                addLyricsTokenMatchQuality(words[start + offset].normalized, word),
            );
            if (qualities.every((quality) => quality > 0)) {
                return {
                    start: words[start].start,
                    end: words[start + phraseWords.length - 1].end,
                    ranges: words.slice(start, start + phraseWords.length).map(({ start: wordStart, end: wordEnd }) => ({
                        start: wordStart,
                        end: wordEnd,
                    })),
                    quality: Math.min(...qualities),
                };
            }
        }
        return null;
    }

    function makeLyricsExcerptDetails(lyrics, match, maxChars) {
        const limit = Math.max(1, Number(maxChars) || 150);
        if (lyrics.length <= limit) {
            const leading = lyrics.length - lyrics.trimStart().length;
            const text = lyrics.trim();
            return {
                text,
                ranges: (match.ranges || [{ start: match.start, end: match.end }])
                    .filter((range) => range.start >= leading && range.end <= leading + text.length)
                    .map((range) => ({ start: range.start - leading, end: range.end - leading })),
            };
        }

        const hasLeadingEllipsis = match.start > 0;
        const hasTrailingEllipsis = match.end < lyrics.length;
        const contentLimit = Math.max(1, limit - Number(hasLeadingEllipsis) - Number(hasTrailingEllipsis));
        const matchLength = match.end - match.start;
        let start = Math.max(0, match.start - Math.floor((contentLimit - matchLength) / 2));
        let end = Math.min(lyrics.length, start + contentLimit);
        start = Math.max(0, end - contentLimit);

        if (start > 0) {
            const whitespaceOffset = lyrics.slice(start).search(/\s/);
            const nextWhitespace = whitespaceOffset < 0 ? -1 : start + whitespaceOffset;
            if (nextWhitespace >= 0 && nextWhitespace < match.start) start = nextWhitespace + 1;
        }
        if (end < lyrics.length) {
            const previousWhitespace = lyrics.slice(0, end).match(/\s\S*$/)?.index ?? -1;
            if (previousWhitespace > match.end) end = previousWhitespace;
        }

        const rawExcerpt = lyrics.slice(start, end);
        const leading = rawExcerpt.length - rawExcerpt.trimStart().length;
        const excerpt = rawExcerpt.trim();
        const excerptStart = start + leading;
        const prefix = excerptStart > 0 ? '…' : '';
        const text = `${prefix}${excerpt}${end < lyrics.length ? '…' : ''}`;
        const sourceRanges = match.ranges || [{ start: match.start, end: match.end }];
        return {
            text,
            ranges: sourceRanges
                .filter((range) => range.start >= excerptStart && range.end <= excerptStart + excerpt.length)
                .map((range) => ({ start: prefix.length + range.start - excerptStart, end: prefix.length + range.end - excerptStart })),
        };
    }

    function getLyricsSearchPreview(song, query, maxChars = 150) {
        return getLyricsSearchPreviewDetails(song, query, maxChars)?.text || null;
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function getLyricsSearchPreviewDetails(song, query, maxChars = 150, options = {}) {
        const lyrics = String(song?.lyrics || '');
        if (!lyrics) return null;
        const q = String(query || '').trim();
        const parsed = parseSearchQuery(query);
        const components = addLyricsQueryComponents(parsed);
        let titleMatch = components.length > 0 && components.every(
            (component) => addLyricsFieldQuality(song, 'title', component) > 1,
        );

        if (options.exactPhrase) {
            const exact = q.match(/^(?:"([\s\S]*)"|“([\s\S]*)”)$/);
            const phrase = exact?.[1] ?? exact?.[2] ?? '';
            const exactPhrase = String(
                window.eclyricsSmartQuotes?.normalizeSmartQuotes?.(phrase) || phrase,
            );
            if (!exactPhrase) return null;
            const exactPattern = new RegExp(escapeRegExp(exactPhrase), 'iu');
            titleMatch = exactPattern.test(String(song?.title || ''));
            if (titleMatch) return { text: null, ranges: [], titleMatch };
            const literalMatch = exactPattern.exec(lyrics);
            if (!literalMatch) return { text: null, ranges: [], titleMatch };
            const matchAt = literalMatch.index;
            const match = {
                start: matchAt,
                end: matchAt + literalMatch[0].length,
                ranges: [{ start: matchAt, end: matchAt + literalMatch[0].length }],
            };
            return { ...makeLyricsExcerptDetails(lyrics, match, maxChars), titleMatch };
        }

        if (titleMatch) return { text: null, ranges: [], titleMatch };

        const words = [];
        const wordPattern = /[\p{L}\p{N}]+/gu;
        let wordMatch;
        while ((wordMatch = wordPattern.exec(lyrics))) {
            words.push({
                normalized: normalizeSearchCompact(wordMatch[0]),
                start: wordMatch.index,
                end: wordMatch.index + wordMatch[0].length,
            });
        }
        if (!words.length) return null;
        const singleWordMatches = [...words, ...addLyricsPunctuationJoinedWords(lyrics)];
        const collapsedWords = addLyricsCollapsedFieldWords(lyrics);

        const phraseCandidates = [
            ...(parsed.orderedTerms.length > 1 ? [parsed.orderedTerms] : []),
            ...parsed.phrases.map((phrase) => normalizeSearchText(phrase).split(/\s+/).filter(Boolean)),
            ...(parsed.terms.length > 1 ? [parsed.terms] : []),
        ];
        for (const phraseWords of phraseCandidates) {
            const normalizedWords = phraseWords.map(normalizeSearchCompact).filter(Boolean);
            const match =
                lyricWordMatchesPhrase(words, normalizedWords) ||
                lyricWordMatchesPhrase(collapsedWords, normalizedWords);
            if (match) {
                return { ...makeLyricsExcerptDetails(lyrics, match, maxChars), titleMatch };
            }
        }

        let bestMatch = null;
        for (const term of [...parsed.terms, ...parsed.phrases.flatMap((phrase) => phrase.split(/\s+/))]) {
            const normalizedTerm = normalizeSearchQueryToken(term);
            if (!normalizedTerm) continue;
            singleWordMatches.forEach((word) => {
                const quality = addLyricsTokenMatchQuality(word.normalized, normalizedTerm);
                if (!quality) return;
                if (!bestMatch || quality > bestMatch.quality) {
                    bestMatch = { start: word.start, end: word.end, ranges: [{ start: word.start, end: word.end }], quality };
                }
            });
        }
        if (!bestMatch) return { text: null, ranges: [], titleMatch };
        return { ...makeLyricsExcerptDetails(lyrics, bestMatch, maxChars), titleMatch };
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

    function rankMatchedSongs(entries, parsed, songsById) {
        return entries
            .map((entry) => {
                const song = resolveStoredSong(entry, songsById);
                if (!song) return null;
                const indexScore = typeof entry?.score === 'number' ? entry.score : 0;
                return { song, score: indexScore + computeFieldMatchScore(song, parsed) };
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

    function adjacentTranspositionMatch(token, term) {
        if (token.length !== term.length) return false;
        let first = -1;
        let second = -1;
        for (let index = 0; index < token.length; index += 1) {
            if (token[index] === term[index]) continue;
            if (first < 0) first = index;
            else if (second < 0) second = index;
            else return false;
        }
        return (
            second === first + 1 &&
            token[first] === term[second] &&
            token[second] === term[first]
        );
    }

    function addLyricsMaxFuzzyDistance(term) {
        const length = String(term || '').length;
        if (length < 3) return 0;
        return Math.min(2, Math.max(1, Math.floor(length * 0.2)));
    }

    function addLyricsTokenMatchQuality(token, term) {
        const normalizedToken = normalizeSearchCompact(token);
        const normalizedTerm = normalizeSearchQueryToken(term);
        if (!normalizedToken || !normalizedTerm) return 0;
        if (normalizedToken === normalizedTerm) return 4;
        if (normalizedToken.startsWith(normalizedTerm)) return 3;
        if (adjacentTranspositionMatch(normalizedToken, normalizedTerm)) return 1;
        return levenshteinDistance(normalizedToken, normalizedTerm) <= addLyricsMaxFuzzyDistance(normalizedTerm)
            ? 1
            : 0;
    }

    function addLyricsFieldWords(value) {
        const words = [];
        const pattern = /[\p{L}\p{N}]+/gu;
        const text = String(value || '');
        let match;
        while ((match = pattern.exec(text))) {
            words.push({ normalized: normalizeSearchCompact(match[0]), start: match.index, end: pattern.lastIndex });
        }
        return words;
    }

    function addLyricsPunctuationJoinedWords(value) {
        const words = [];
        const pattern = /[\p{L}\p{N}]+(?:\s*\p{P}+\s*[\p{L}\p{N}]+)+/gu;
        const text = String(value || '');
        let match;
        while ((match = pattern.exec(text))) {
            words.push({ normalized: normalizeSearchCompact(match[0]), start: match.index, end: pattern.lastIndex });
        }
        return words;
    }

    function addLyricsCollapsedFieldWords(value) {
        const words = [];
        const pattern = /[\p{L}\p{N}]+(?:\s*\p{P}+\s*[\p{L}\p{N}]+)+|[\p{L}\p{N}]+/gu;
        const text = String(value || '');
        let match;
        while ((match = pattern.exec(text))) {
            words.push({ normalized: normalizeSearchCompact(match[0]), start: match.index, end: pattern.lastIndex });
        }
        return words;
    }

    function addLyricsPhraseMatch(value, phrase) {
        const phraseWords = normalizeSearchText(phrase).split(/\s+/).filter(Boolean);
        return (
            lyricWordMatchesPhrase(addLyricsFieldWords(value), phraseWords) ||
            lyricWordMatchesPhrase(addLyricsCollapsedFieldWords(value), phraseWords)
        );
    }

    function addLyricsFieldQuality(song, field, component) {
        if (component.phrase) return addLyricsPhraseMatch(song?.[field], component.text)?.quality || 0;
        return [...addLyricsFieldWords(song?.[field]), ...addLyricsPunctuationJoinedWords(song?.[field])].reduce(
            (best, word) => Math.max(best, addLyricsTokenMatchQuality(word.normalized, component.text)),
            0,
        );
    }

    function addLyricsQueryComponents(parsed) {
        return [
            ...parsed.phrases.map((text) => ({ text, phrase: true })),
            ...parsed.terms.map((text) => ({ text, phrase: false })),
        ];
    }

    function addLyricsSongMatches(song, components) {
        const fields = ['title', 'adaptOf', 'hymnNum', 'lyrics'];
        return components.every((component) =>
            fields.some((field) => addLyricsFieldQuality(song, field, component) > 0),
        );
    }

    function addLyricsMatchRank(song, parsed, components) {
        const fields = ['title', 'adaptOf', 'hymnNum', 'lyrics'];
        const qualities = Object.fromEntries(
            fields.map((field) => [field, components.map((component) => addLyricsFieldQuality(song, field, component))]),
        );
        const completeInField = (field) => qualities[field].every((quality) => quality > 1);
        const completeTitle = completeInField('title');
        const lyricsPhrase =
            parsed.orderedTerms.length > 1 &&
            (addLyricsPhraseMatch(song?.lyrics, parsed.orderedTerms.join(' '))?.quality || 0) > 1;
        const completeField = fields.some((field) => completeInField(field));
        const tier = completeTitle ? 0 : lyricsPhrase ? 1 : completeField ? 2 : 3;
        const bestComponentQualities = components.map((_, index) =>
            Math.max(...fields.map((field) => qualities[field][index])),
        );
        const exactCount = bestComponentQualities.filter((quality) => quality === 4).length;
        const prefixCount = bestComponentQualities.filter((quality) => quality === 3).length;
        const totals = fields.map((field) => qualities[field].reduce((sum, quality) => sum + quality, 0));
        return [tier, exactCount, prefixCount, totals[0], totals[1], totals[2], totals[3]];
    }

    function addLyricsCompareRanks(a, b) {
        for (let index = 0; index < a.length; index += 1) {
            if (a[index] !== b[index]) return index === 0 ? a[index] - b[index] : b[index] - a[index];
        }
        return 0;
    }

    function matchSongsForAddLyrics(songs, query) {
        const q = String(query || '').trim();
        if (!q) return songs.slice();
        const parsed = parseSearchQuery(q);
        const components = addLyricsQueryComponents(parsed);
        if (!components.length) return [];
        return songs
            .filter((song) => addLyricsSongMatches(song, components))
            .map((song) => ({ song, rank: addLyricsMatchRank(song, parsed, components) }))
            .sort((a, b) => addLyricsCompareRanks(a.rank, b.rank))
            .map((entry) => entry.song);
    }

    function resolveStoredSong(entry, songsById) {
        if (!entry) return null;
        const id = typeof entry === 'string' ? entry : entry.id;
        if (id && songsById.has(id)) return songsById.get(id);
        if (entry && entry.id && entry.title) return entry;
        return null;
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
        if (!q) return songs.slice().sort(compareAdminAlpha);

        const exactMatch = q.match(/^(?:"([\s\S]*)"|“([\s\S]*)”)$/);
        if (exactMatch) {
            const rawPhrase = exactMatch[1] ?? exactMatch[2];
            const phrase = String(
                window.eclyricsSmartQuotes?.normalizeSmartQuotes?.(rawPhrase) || rawPhrase,
            ).toLowerCase();
            if (!phrase) return [];
            return songs
                .filter((song) =>
                    ['title', 'adaptOf', 'hymnNum', 'lyrics'].some((field) =>
                        String(song?.[field] ?? '').toLowerCase().includes(phrase),
                    ),
                )
                .sort(compareAdminAlpha);
        }

        const matches = matchSongsForAddLyrics(songs, q);
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
        getLyricsSearchPreview,
        getLyricsSearchPreviewDetails,
        matchSongs,
        matchSongsForAddLyrics,
        search,
        searchAdmin,
        sortSongsForCategoryFilters,
    };
})();
