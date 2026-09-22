(function () {
    function asNonEmptyString(value) {
        const s = String(value == null ? '' : value).trim();
        return s || '';
    }

    function asStringArray(value) {
        if (!Array.isArray(value)) return [];
        return value.map((item) => asNonEmptyString(item)).filter(Boolean);
    }

    function normalizeText(value) {
        const text = asNonEmptyString(value);
        return window.eclyricsSmartQuotes?.normalizeSmartQuotes?.(text) || text;
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

    function getSongAdaptationSource(song) {
        if (!songHasCategorySlug(song, 'adaptation')) return '';
        const adaptOf = String(song?.adaptOf || '').trim();
        const title = String(song?.title || '').trim();
        if (adaptOf && title && adaptOf.localeCompare(title, undefined, { sensitivity: 'accent' }) === 0) {
            return '';
        }
        return adaptOf;
    }

    function getSongAdaptationLabel(song) {
        const adaptOf = getSongAdaptationSource(song);
        return adaptOf ? `(Adaptation of “${adaptOf}”)` : '';
    }

    function getSongAdaptationSearchLabel(song) {
        const adaptOf = getSongAdaptationSource(song);
        return adaptOf ? `Adapted from “${adaptOf}”` : '';
    }

    function formatVersionWord(word) {
        const w = String(word || '').trim();
        if (!w) return '';
        return w.toUpperCase();
    }

    function formatSongVersionDisplay(version) {
        const v = asNonEmptyString(version).toLowerCase();
        if (!v || v === 'original') return '';
        const formatted = v.split(/\s+/).map(formatVersionWord).join(' ');
        return formatted;
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
        const title = normalizeText(data.title);
        const lyrics = normalizeText(data.lyrics);
        if (!title && !lyrics) return null;
        const category = asStringArray(data.category);
        const adaptOf = normalizeText(data['adapt-of'] || data.adaptOf);
        return {
            id: String(docSnap.id),
            title: title || '(Untitled)',
            lyrics,
            hymnNum: asNonEmptyString(data['hymn-num'] || data.hymnNum),
            category,
            version: normalizeText(data.version),
            adaptOf,
            lastModified: formatLastModifiedDisplay(data['last-modified'] ?? data.lastModified),
            lastModifiedBy: asNonEmptyString(data['last-modified-by'] || data.lastModifiedBy),
        };
    }

    function appendAuditFields(payload, user, timestampFactory) {
        const email = asNonEmptyString(user?.email);
        if (!email) throw new Error('Signed-in user email is required to save lyrics.');
        if (typeof timestampFactory !== 'function') throw new Error('Firestore is not ready.');
        return {
            ...payload,
            'last-modified': timestampFactory(),
            'last-modified-by': email,
        };
    }

    function normalizeCachedSong(song) {
        if (!song || typeof song !== 'object') return song;
        return {
            ...song,
            title: normalizeText(song.title),
            lyrics: normalizeText(song.lyrics),
            version: normalizeText(song.version),
            adaptOf: normalizeText(song.adaptOf),
        };
    }

    function buildFirestorePayload(data, user, timestampFactory) {
        const title = normalizeText(data.title);
        const lyrics = normalizeText(data.lyrics);
        if (!title) throw new Error('Title is required.');
        const payload = { title, lyrics };
        const hymnNum = asNonEmptyString(data.hymnNum);
        if (hymnNum) payload['hymn-num'] = hymnNum;
        const category = asStringArray(data.category);
        if (category.length) payload.category = category;
        const version = normalizeText(data.version) || 'original';
        payload.version = version;
        const adaptOf = normalizeText(data.adaptOf);
        if (adaptOf) payload['adapt-of'] = adaptOf;
        return appendAuditFields(payload, user, timestampFactory);
    }

    window.eclyricsSongModel = {
        asNonEmptyString,
        asStringArray,
        normalizeText,
        categoryToSlug,
        songHasCategorySlug,
        normalizeLyricsDoc,
        normalizeCachedSong,
        appendAuditFields,
        buildFirestorePayload,
        getPopupSongTitle,
        getSongAdaptationLabel,
        getSongAdaptationSearchLabel,
        formatSongVersionDisplay,
        truncateLyricsPreview,
        formatLastModifiedTimestamp,
        formatLastModifiedDisplay,
    };
})();
