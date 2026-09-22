(function () {
let blockSourceTargetTextarea = null;
let blockSourceSearchRequest = 0;
let blockSourceSearchTimer = null;
let editorCallbacks = {};
const SONG_LIBRARY_BROWSE_LIMIT = 20;
const SONG_LIBRARY_SEARCH_LIMIT = 10;
/** Pasted text at or above this length in the add-lyrics dialog auto-fills the block. */
const BLOCK_SOURCE_AUTO_PASTE_MIN_CHARS = 50;

/* ─────────────────────────────────────────────────────────
 * SONG CATEGORY PILLS — colors, filters, restricted states
 *
 *   himnario    light blue
 *   adaptation  yellow
 *   original    dark blue
 *   asop/f      purple
 *   revision    orange  (non-selectable)
 *   archived    red     (non-selectable)
 *
 *   revision/archived → visible in search, not addable to blocks; editable in admin
 * ───────────────────────────────────────────────────────── */
const SONG_CATEGORY_FILTERS = [
    { slug: 'himnario', label: 'Himnario' },
    { slug: 'original', label: 'Original' },
    { slug: 'adaptation', label: 'Adaptation' },
    { slug: 'asop-f', label: 'ASOP/F', aliases: ['asop/f', 'asopf'] },
    { slug: 'revision', label: 'Revision' },
    { slug: 'archived', label: 'Archived' },
];

const RESTRICTED_CATEGORY_SLUGS = new Set(['revision', 'archived']);

/** @type {Set<string>} */
let blockSourceActiveCategoryFilters = new Set();

function getBlockSourceDialogTitle(textarea) {
    const label = editorCallbacks.getBlockSourceDialogTitle?.(textarea) || '';
    return label && label !== '—' ? `Add lyrics · ${label}` : 'Add lyrics to block';
}

function renderSongLibraryNote(message, show = true) {
    const note = document.getElementById('block-source-library-note');
    if (!note) return;
    note.textContent = message;
    note.hidden = !show;
}

function updateSongLibraryStatus() {
    const api = getSongLibraryApi();
    const state = api?.getState?.();
    if (!state) {
        renderSongLibraryNote('Song library module is not loaded.', true);
        return;
    }
    if (state.error && state.count === 0) {
        renderSongLibraryNote(state.error, true);
    } else if (!state.loaded) {
        renderSongLibraryNote('Loading song library…', true);
    } else if (state.count === 0 && !state.syncing) {
        renderSongLibraryNote('No songs found in Firestore library.', true);
    } else if (state.syncing) {
        renderSongLibraryNote('Updating song library…', true);
    } else {
        renderSongLibraryNote('', false);
    }
}

function getSongLibraryApi() {
    return window.eclyricsSongLibrary || null;
}

function categoryToSlug(category) {
    const normalized = String(category || '').trim().toLowerCase();
    if (normalized === 'asop/f' || normalized === 'asopf' || normalized === 'asop-f') return 'asop-f';
    return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function songHasCategorySlug(song, slug) {
    if (!Array.isArray(song?.category)) return false;
    const filterDef = SONG_CATEGORY_FILTERS.find((entry) => entry.slug === slug);
    const aliases = filterDef?.aliases || [];
    return song.category.some((entry) => {
        const entrySlug = categoryToSlug(entry);
        return entrySlug === slug || aliases.includes(String(entry || '').trim().toLowerCase());
    });
}

function isAdaptationCategory(song) {
    return songHasCategorySlug(song, 'adaptation');
}

function shouldOmitHymnNumForSong(song) {
    return songHasCategorySlug(song, 'adaptation') && songHasCategorySlug(song, 'himnario');
}

function isRestrictedSong(song) {
    return [...RESTRICTED_CATEGORY_SLUGS].some((slug) => songHasCategorySlug(song, slug));
}

function buildSongCategoryPills(song) {
    const categories = Array.isArray(song?.category) ? song.category.filter(Boolean) : [];
    if (categories.length === 0) return [];

    const slugs = categories.map((entry) => categoryToSlug(entry));
    const hasRevision = slugs.includes('revision');
    const hasArchived = slugs.includes('archived');

    if (hasRevision || hasArchived) {
        const pills = [];
        if (hasRevision) pills.push({ text: 'REVISION', slug: 'revision' });
        if (hasArchived) pills.push({ text: 'ARCHIVED', slug: 'archived' });
        return pills;
    }

    return categories.map((category) => ({
        text: String(category).trim().toUpperCase(),
        slug: categoryToSlug(category),
    }));
}

function queryTargetsRestrictedCategory(query) {
    const q = String(query || '').trim().toLowerCase();
    return q.includes('revision') || q.includes('archived') || q.includes('archive');
}

function isFilteringRestrictedCategories() {
    return blockSourceActiveCategoryFilters.has('revision') || blockSourceActiveCategoryFilters.has('archived');
}

function deprioritizeRestrictedResults(songs, query) {
    if (isFilteringRestrictedCategories() || queryTargetsRestrictedCategory(query)) {
        return songs;
    }
    const normal = [];
    const restricted = [];
    songs.forEach((song) => {
        if (isRestrictedSong(song)) restricted.push(song);
        else normal.push(song);
    });
    return [...normal, ...restricted];
}

function applyRestrictedSearchRules(songs, query) {
    return deprioritizeRestrictedResults(songs, query);
}

function shouldIncludeRestrictedInBlockSource(query) {
    const q = String(query || '').trim();
    if (q.length > 0) return true;
    if (isFilteringRestrictedCategories()) return true;
    return queryTargetsRestrictedCategory(q);
}

function sortBlockSourceMatches(matches, query) {
    const api = getSongLibraryApi();
    const q = String(query || '').trim();
    if (!api?.sortSongsForCategoryFilters) return matches;
    if (!blockSourceActiveCategoryFilters.has('himnario')) return matches;
    // Empty search + Himnario: hymn order. With a query, keep library search ranking.
    if (q.length > 0) return matches;

    if (!shouldIncludeRestrictedInBlockSource(query)) {
        return api.sortSongsForCategoryFilters(matches, blockSourceActiveCategoryFilters);
    }

    const normal = [];
    const restricted = [];
    matches.forEach((song) => {
        if (isRestrictedSong(song)) restricted.push(song);
        else normal.push(song);
    });
    const sortedNormal = api.sortSongsForCategoryFilters(normal, blockSourceActiveCategoryFilters);
    const sortedRestricted = api.sortSongsForCategoryFilters(restricted, blockSourceActiveCategoryFilters);
    return [...sortedNormal, ...sortedRestricted];
}

function fetchBlockSourceSearchResults(query) {
    const api = getSongLibraryApi();
    if (!api?.matchAllSongs) throw new Error('Song library is not available.');

    const q = String(query || '').trim();
    const limit = q ? SONG_LIBRARY_SEARCH_LIMIT : SONG_LIBRARY_BROWSE_LIMIT;
    let matches = api.matchAllSongs(q);
    if (blockSourceActiveCategoryFilters.size > 0) {
        matches = matches.filter((song) =>
            [...blockSourceActiveCategoryFilters].every((slug) => songHasCategorySlug(song, slug)),
        );
    }
    matches = applyRestrictedSearchRules(matches, q);
    matches = sortBlockSourceMatches(matches, q);
    const total = matches.length;
    return {
        matches: matches.slice(0, limit),
        total,
        hasMore: total > limit,
    };
}

function renderBlockSourceCategoryFilters() {
    const wrap = document.getElementById('block-source-filters');
    if (!wrap) return;
    wrap.replaceChildren();
    SONG_CATEGORY_FILTERS.forEach(({ slug, label }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'block-source-filter-pill';
        btn.dataset.category = slug;
        btn.textContent = label;
        const isActive = blockSourceActiveCategoryFilters.has(slug);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        if (isActive) {
            btn.classList.add('block-source-filter-pill--active', `block-source-filter-pill--${slug}`);
        }
        btn.addEventListener('click', () => {
            if (blockSourceActiveCategoryFilters.has(slug)) {
                blockSourceActiveCategoryFilters.delete(slug);
            } else {
                blockSourceActiveCategoryFilters.add(slug);
            }
            renderBlockSourceCategoryFilters();
            const search = document.getElementById('block-source-search');
            renderBlockSourceSearchResults(search?.value || '');
        });
        wrap.appendChild(btn);
    });
    if (blockSourceActiveCategoryFilters.size > 0) {
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'block-source-filter-clear';
        clearBtn.setAttribute('aria-label', 'Clear category filters');
        clearBtn.title = 'Clear category filters';
        clearBtn.innerHTML = '<span aria-hidden="true">×</span><span>Clear</span>';
        clearBtn.addEventListener('click', () => {
            blockSourceActiveCategoryFilters.clear();
            renderBlockSourceCategoryFilters();
            const search = document.getElementById('block-source-search');
            renderBlockSourceSearchResults(search?.value || '');
        });
        wrap.appendChild(clearBtn);
    }
}

function getSongVersionDisplay(version) {
    return getSongLibraryApi()?.formatSongVersionDisplay?.(version) || '';
}

function getSongAdaptationLabel(song) {
    return getSongLibraryApi()?.getSongAdaptationLabel?.(song) || '';
}

function getSongAdaptationSearchLabel(song) {
    return getSongLibraryApi()?.getSongAdaptationSearchLabel?.(song) || '';
}

function truncateLyricsPreview(lyrics, maxChars = 150) {
    return getSongLibraryApi()?.truncateLyricsPreview?.(lyrics, maxChars) || '';
}

function getPopupSongTitle(song) {
    return getSongLibraryApi()?.getPopupSongTitle?.(song) || '(Untitled)';
}

function updateBlockSourceDialogHeader(textarea) {
    const titleEl = document.getElementById('block-source-dialog-title');
    if (titleEl && textarea) titleEl.textContent = getBlockSourceDialogTitle(textarea);
}

function resetBlockSourceDialog(shouldLoad = true) {
    blockSourceSearchRequest += 1;
    const search = document.getElementById('block-source-search');
    blockSourceActiveCategoryFilters.clear();
    renderBlockSourceCategoryFilters();
    if (search) {
        search.value = '';
        if (shouldLoad) {
            void renderBlockSourceSearchResults('');
        } else {
            document.getElementById('block-source-results')?.replaceChildren();
            renderSongLibraryNote('', false);
        }
    }
    if (blockSourceTargetTextarea) updateBlockSourceDialogHeader(blockSourceTargetTextarea);
}

function focusBlockSourceSearch() {
    const search = document.getElementById('block-source-search');
    if (!search) return;
    requestAnimationFrame(() => search.focus());
}

async function renderBlockSourceSearchResults(query) {
    const list = document.getElementById('block-source-results');
    if (!list) return;
    const requestId = ++blockSourceSearchRequest;
    const q = String(query || '').trim();
    list.replaceChildren();

    const loading = document.createElement('li');
    loading.className = 'block-source-results-empty';
    loading.textContent = 'Searching song library…';
    list.appendChild(loading);
    renderSongLibraryNote('', false);

    let result;
    try {
        result = await fetchBlockSourceSearchResults(q);
    } catch (error) {
        if (requestId !== blockSourceSearchRequest) return;
        list.replaceChildren();
        const li = document.createElement('li');
        li.className = 'block-source-results-empty';
        li.textContent = error?.message || 'Unable to search the lyrics library.';
        list.appendChild(li);
        renderSongLibraryNote('Search is temporarily unavailable.', true);
        return;
    }

    if (requestId !== blockSourceSearchRequest) return;
    const { matches, total, hasMore } = result;
    list.replaceChildren();
    if (matches.length === 0) {
        const li = document.createElement('li');
        li.className = 'block-source-results-empty';
        const libraryState = getSongLibraryApi()?.getState?.();
        if (libraryState?.error && libraryState.count === 0) {
            li.textContent = libraryState.error;
        } else if (!libraryState?.loaded || libraryState?.syncing) {
            li.textContent = 'Loading song library…';
        } else if (blockSourceActiveCategoryFilters.size > 0) {
            li.textContent = 'No songs match your search and filters.';
        } else li.textContent = q ? 'No songs match your search.' : 'No songs in library yet.';
        list.appendChild(li);
        return;
    }

    if (hasMore) {
        renderSongLibraryNote(
            q
                ? `Showing top ${SONG_LIBRARY_SEARCH_LIMIT} of ${total} matches. Refine search for more.`
                : `Showing ${SONG_LIBRARY_BROWSE_LIMIT} of ${total} songs. Search to find more.`,
            true,
        );
    } else {
        renderSongLibraryNote('', false);
    }
    matches.forEach((song) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        const restricted = isRestrictedSong(song);
        btn.className = restricted
            ? 'block-source-result block-source-result--restricted'
            : 'block-source-result';
        btn.setAttribute('role', 'option');
        if (restricted) {
            btn.disabled = true;
            btn.setAttribute('aria-disabled', 'true');
            btn.title = 'Revision and archived lyrics cannot be added to blocks';
        }
        const topRow = document.createElement('span');
        topRow.className = 'block-source-result__top';
        const titleWrap = document.createElement('span');
        titleWrap.className = 'block-source-result__title-wrap';
        const titleLine = document.createElement('span');
        titleLine.className = 'block-source-result__title-line';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'block-source-result__title';
        titleSpan.textContent = getPopupSongTitle(song);
        titleLine.appendChild(titleSpan);
        const versionDisplay = getSongVersionDisplay(song.version);
        if (versionDisplay) {
            const versionSpan = document.createElement('span');
            versionSpan.className = 'block-source-result__version';
            versionSpan.textContent = versionDisplay;
            titleLine.appendChild(versionSpan);
        }
        titleWrap.appendChild(titleLine);
        const adaptLabel = getSongAdaptationSearchLabel(song);
        if (adaptLabel) {
            const adaptSpan = document.createElement('span');
            adaptSpan.className = 'block-source-result__adapt';
            adaptSpan.textContent = adaptLabel;
            titleWrap.appendChild(adaptSpan);
        }
        const pillWrap = document.createElement('span');
        pillWrap.className = 'block-source-result__pills';
        buildSongCategoryPills(song).forEach((pillData) => {
            const pill = document.createElement('span');
            pill.className = `block-source-pill block-source-pill--${pillData.slug}`;
            pill.textContent = pillData.text;
            pillWrap.appendChild(pill);
        });
        topRow.append(titleWrap, pillWrap);
        const metaSpan = document.createElement('span');
        metaSpan.className = 'block-source-result__meta';
        metaSpan.textContent = truncateLyricsPreview(song.lyrics);
        btn.append(topRow, metaSpan);
        if (!restricted) {
            btn.addEventListener('click', () => {
                if (!blockSourceTargetTextarea) return;
                const hymnNum = shouldOmitHymnNumForSong(song) ? '' : song.hymnNum;
                editorCallbacks.applyLyricsToBlock?.(blockSourceTargetTextarea, song.lyrics, song.title, hymnNum, {
                    adaptationLabel: getSongAdaptationLabel(song),
                });
                close();
            });
        }
        li.appendChild(btn);
        list.appendChild(li);
    });
}

function open(textarea) {
    const dlg = document.getElementById('block-source-dialog');
    if (!dlg || !textarea) return;
    blockSourceTargetTextarea = textarea;
    resetBlockSourceDialog();
    dlg.hidden = false;
    dlg.setAttribute('aria-hidden', 'false');
    focusBlockSourceSearch();
}

function close() {
    const dlg = document.getElementById('block-source-dialog');
    if (!dlg) return;
    dlg.hidden = true;
    dlg.setAttribute('aria-hidden', 'true');
    blockSourceTargetTextarea = null;
    resetBlockSourceDialog(false);
}

function isOpen() {
    const dlg = document.getElementById('block-source-dialog');
    return !!dlg && !dlg.hidden;
}

function handleBlockSourceDialogPaste(e) {
    if (!isOpen() || !blockSourceTargetTextarea) return;

    const raw = e.clipboardData?.getData('text/plain') ?? '';
    if (raw.trim().length < BLOCK_SOURCE_AUTO_PASTE_MIN_CHARS) return;

    e.preventDefault();
    const ta = blockSourceTargetTextarea;
    close();
    editorCallbacks.pasteLyricsFromClipboard?.(ta, raw);
}

function init(context = {}) {
    editorCallbacks = {
        ...editorCallbacks,
        ...context,
    };
    const dlg = document.getElementById('block-source-dialog');
    if (!dlg) return;

    dlg.addEventListener('paste', handleBlockSourceDialogPaste, true);

    document.getElementById('block-source-dialog-close')?.addEventListener('click', close);
    document.getElementById('block-source-dialog-backdrop')?.addEventListener('click', close);

    document.getElementById('block-source-type')?.addEventListener('click', () => {
        if (!blockSourceTargetTextarea) return;
        const ta = blockSourceTargetTextarea;
        close();
        editorCallbacks.activateBlockTypeMode?.(ta);
    });

    document.getElementById('block-source-paste')?.addEventListener('click', () => {
        if (!blockSourceTargetTextarea) return;
        const ta = blockSourceTargetTextarea;
        close();
        void editorCallbacks.pasteLyricsFromClipboard?.(ta);
    });

    const search = document.getElementById('block-source-search');
    search?.addEventListener('input', () => {
        clearTimeout(blockSourceSearchTimer);
        blockSourceSearchTimer = setTimeout(() => {
            void renderBlockSourceSearchResults(search.value);
        }, 180);
    });

    renderBlockSourceCategoryFilters();
    const libraryApi = getSongLibraryApi();
    if (libraryApi) {
        libraryApi.onChange?.(() => {
            updateSongLibraryStatus();
            void renderBlockSourceSearchResults(document.getElementById('block-source-search')?.value || '');
        });
        updateSongLibraryStatus();
        void libraryApi.start?.();
    } else {
        updateSongLibraryStatus();
    }

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || dlg.hidden) return;
        e.preventDefault();
        close();
    });
}

window.eclyricsEditorBlockSource = {
    init,
    open,
    close,
    isOpen,
    AUTO_PASTE_MIN_CHARS: BLOCK_SOURCE_AUTO_PASTE_MIN_CHARS,
};
})();
