/**
 * Admin panel — lyrics CRUD for admins only.
 * RBAC: client hides nav + early returns; Firestore rules enforce writes.
 */
(function () {
    const CATEGORY_FILTERS = [
        { slug: 'himnario', label: 'Himnario' },
        { slug: 'original', label: 'Original' },
        { slug: 'adaptation', label: 'Adaptation' },
        { slug: 'asop-f', label: 'ASOP/F', aliases: ['asop/f', 'asopf'] },
        { slug: 'revision', label: 'Revision' },
        { slug: 'archived', label: 'Archived' },
    ];

    let activeCategoryFilters = new Set();
    let selectedSongId = null;
    let formMode = 'create';
    let unsubscribeLibrary = null;

    function $(id) {
        return document.getElementById(id);
    }

    function categoryToSlug(category) {
        const normalized = String(category || '').trim().toLowerCase();
        if (normalized === 'asop/f' || normalized === 'asopf' || normalized === 'asop-f') return 'asop-f';
        return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function songHasCategorySlug(song, slug) {
        if (!Array.isArray(song?.category)) return false;
        const filterDef = CATEGORY_FILTERS.find((entry) => entry.slug === slug);
        const aliases = filterDef?.aliases || [];
        return song.category.some((entry) => {
            const entrySlug = categoryToSlug(entry);
            return entrySlug === slug || aliases.includes(String(entry || '').trim().toLowerCase());
        });
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

    function songDisplay() {
        return getLibraryApi();
    }

    function getSongVersionDisplay(version) {
        return songDisplay()?.formatSongVersionDisplay?.(version) || '';
    }

    function getPopupSongTitleForRow(song) {
        return songDisplay()?.getPopupSongTitle?.(song) || '(Untitled)';
    }

    function getSongAdaptationLabelForRow(song) {
        return songDisplay()?.getSongAdaptationLabel?.(song) || '';
    }

    function truncateLyricsPreviewForRow(lyrics) {
        return songDisplay()?.truncateLyricsPreview?.(lyrics, 120) || '';
    }

    function getLibraryApi() {
        return window.eclyricsSongLibrary || null;
    }

    function filterSongsByCategory(songs) {
        if (activeCategoryFilters.size === 0) return songs;
        return songs.filter((song) =>
            [...activeCategoryFilters].every((slug) => songHasCategorySlug(song, slug)),
        );
    }

    function formCategoriesInclude(slug) {
        return getSelectedFormCategories().some((entry) => categoryToSlug(entry) === slug);
    }

    function syncConditionalFields() {
        const showHymn = formCategoriesInclude('himnario');
        const showAdapt = formCategoriesInclude('adaptation');
        const hymnWrap = $('admin-form-field-hymn');
        const adaptWrap = $('admin-form-field-adapt');
        const hymnInput = $('admin-form-hymn-num');
        const adaptInput = $('admin-form-adapt-of');

        if (hymnWrap) {
            hymnWrap.classList.toggle('admin-form-field--visible', showHymn);
            hymnWrap.setAttribute('aria-hidden', showHymn ? 'false' : 'true');
        }
        if (adaptWrap) {
            adaptWrap.classList.toggle('admin-form-field--visible', showAdapt);
            adaptWrap.setAttribute('aria-hidden', showAdapt ? 'false' : 'true');
        }
        if (hymnInput) hymnInput.disabled = !showHymn;
        if (adaptInput) adaptInput.disabled = !showAdapt;
        if (!showHymn && hymnInput) hymnInput.value = '';
        if (!showAdapt && adaptInput) adaptInput.value = '';
    }

    function setStatus(message, isError = false) {
        const el = $('admin-status');
        if (!el) return;
        el.textContent = message || '';
        el.classList.toggle('admin-status--error', isError);
        el.classList.toggle('admin-status--success', !isError && !!message);
        el.hidden = !message;
    }

    function setFormMode(mode) {
        formMode = mode;
        const deleteBtn = $('admin-delete-btn');
        const saveBtn = $('admin-save-btn');
        if (deleteBtn) deleteBtn.hidden = mode !== 'edit';
        if (saveBtn) {
            saveBtn.innerHTML =
                mode === 'edit'
                    ? '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save changes'
                    : '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Add to library';
        }
    }

    function updateFormMeta(song) {
        const meta = $('admin-form-meta');
        if (!meta) return;
        const when = song?.lastModified;
        const by = song?.lastModifiedBy;
        if (when && by) {
            meta.textContent = `Last modified ${when} by ${by}`;
            meta.hidden = false;
        } else if (when) {
            meta.textContent = `Last modified ${when}`;
            meta.hidden = false;
        } else {
            meta.textContent = '';
            meta.hidden = true;
        }
    }

    function clearForm() {
        selectedSongId = null;
        $('admin-form-title').value = '';
        $('admin-form-hymn-num').value = '';
        $('admin-form-version').value = '';
        $('admin-form-adapt-of').value = '';
        $('admin-form-lyrics').value = '';
        renderFormCategoryPills([]);
        updateFormMeta(null);
        syncConditionalFields();
        document.querySelectorAll('.admin-results-item').forEach((el) => {
            el.classList.remove('admin-results-item--selected');
        });
    }

    function getSelectedFormCategories() {
        const selected = [];
        document.querySelectorAll('#admin-form-categories [data-selected="true"]').forEach((btn) => {
            selected.push(btn.dataset.category);
        });
        return selected;
    }

    function renderFormCategoryPills(selectedSlugs) {
        const wrap = $('admin-form-categories');
        if (!wrap) return;
        wrap.replaceChildren();
        const selected = new Set(selectedSlugs.map(categoryToSlug));
        CATEGORY_FILTERS.forEach(({ slug, label }) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'block-source-filter-pill admin-form-category-pill';
            btn.dataset.category = slug;
            btn.textContent = label;
            const isActive = selected.has(slug);
            btn.dataset.selected = isActive ? 'true' : 'false';
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            if (isActive) {
                btn.classList.add('block-source-filter-pill--active', `block-source-filter-pill--${slug}`);
            }
            btn.addEventListener('click', () => {
                const nowSelected = btn.dataset.selected !== 'true';
                btn.dataset.selected = nowSelected ? 'true' : 'false';
                btn.setAttribute('aria-pressed', nowSelected ? 'true' : 'false');
                btn.classList.toggle('block-source-filter-pill--active', nowSelected);
                btn.classList.toggle(`block-source-filter-pill--${slug}`, nowSelected);
                syncConditionalFields();
            });
            wrap.appendChild(btn);
        });
        syncConditionalFields();
    }

    function populateFormFromSong(song) {
        selectedSongId = song.id;
        $('admin-form-title').value = song.title === '(Untitled)' ? '' : song.title || '';
        $('admin-form-hymn-num').value = song.hymnNum || '';
        $('admin-form-version').value = song.version || '';
        $('admin-form-adapt-of').value = song.adaptOf || '';
        $('admin-form-lyrics').value = song.lyrics || '';
        renderFormCategoryPills(song.category || []);
        updateFormMeta(song);
        syncConditionalFields();
    }

    function renderSearchFilters() {
        const wrap = $('admin-search-filters');
        if (!wrap) return;
        wrap.replaceChildren();
        CATEGORY_FILTERS.forEach(({ slug, label }) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'block-source-filter-pill';
            btn.dataset.category = slug;
            btn.textContent = label;
            const isActive = activeCategoryFilters.has(slug);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            if (isActive) {
                btn.classList.add('block-source-filter-pill--active', `block-source-filter-pill--${slug}`);
            }
            btn.addEventListener('click', () => {
                if (activeCategoryFilters.has(slug)) activeCategoryFilters.delete(slug);
                else activeCategoryFilters.add(slug);
                renderSearchFilters();
                renderSearchResults($('admin-search')?.value || '');
            });
            wrap.appendChild(btn);
        });
    }

    function renderSearchResults(query) {
        const list = $('admin-results');
        const note = $('admin-results-note');
        if (!list) return;

        const api = getLibraryApi();
        const state = api?.getState?.() || { loaded: false, error: '', count: 0 };
        const q = String(query || '').trim();
        let matches =
            api && typeof api.searchAdmin === 'function'
                ? api.searchAdmin(q)
                : api && typeof api.search === 'function'
                  ? api.search(q)
                  : [];
        matches = filterSongsByCategory(matches);

        list.replaceChildren();
        if (matches.length === 0) {
            const li = document.createElement('li');
            li.className = 'admin-results-empty';
            if (state.error) li.textContent = state.error;
            else if (!state.loaded) li.textContent = 'Loading song library…';
            else if (activeCategoryFilters.size > 0) li.textContent = 'No songs match your search and filters.';
            else li.textContent = q ? 'No songs match your search.' : 'No songs in library yet.';
            list.appendChild(li);
            if (note) {
                note.textContent = state.error || (!state.loaded ? 'Loading…' : `${state.count} songs in library`);
                note.hidden = false;
            }
            return;
        }

        if (note) {
            if (q && matches.length === (api?.LIMITS?.SEARCH ?? 10)) {
                note.textContent = `Showing top ${api?.LIMITS?.SEARCH ?? 10} matches · ${state.count} in library`;
            } else {
                note.textContent = `${matches.length} shown · ${state.count} in library`;
            }
            note.hidden = false;
        }

        matches.forEach((song) => {
            const li = document.createElement('li');
            li.className = 'admin-results-item';
            if (song.id === selectedSongId) li.classList.add('admin-results-item--selected');

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'admin-results-row';

            const topRow = document.createElement('span');
            topRow.className = 'block-source-result__top';

            const titleWrap = document.createElement('span');
            titleWrap.className = 'block-source-result__title-wrap';
            const titleSpan = document.createElement('span');
            titleSpan.className = 'block-source-result__title';
            titleSpan.textContent = getPopupSongTitleForRow(song);
            titleWrap.appendChild(titleSpan);

            const versionDisplay = getSongVersionDisplay(song.version);
            if (versionDisplay) {
                const versionSpan = document.createElement('span');
                versionSpan.className = 'block-source-result__version';
                versionSpan.textContent = versionDisplay;
                titleWrap.appendChild(versionSpan);
            }

            const adaptLabel = getSongAdaptationLabelForRow(song);
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
            metaSpan.textContent = truncateLyricsPreviewForRow(song.lyrics);

            btn.append(topRow, metaSpan);
            btn.addEventListener('click', () => {
                document.querySelectorAll('.admin-results-item').forEach((el) => {
                    el.classList.remove('admin-results-item--selected');
                });
                li.classList.add('admin-results-item--selected');
                populateFormFromSong(song);
                setFormMode('edit');
                setStatus('');
                $('admin-form-title')?.focus();
            });

            li.appendChild(btn);
            list.appendChild(li);
        });
    }

    function readFormData() {
        const categories = getSelectedFormCategories();
        const showHymn = categories.some((entry) => categoryToSlug(entry) === 'himnario');
        const showAdapt = categories.some((entry) => categoryToSlug(entry) === 'adaptation');
        return {
            title: $('admin-form-title')?.value || '',
            hymnNum: showHymn ? $('admin-form-hymn-num')?.value || '' : '',
            version: $('admin-form-version')?.value || '',
            adaptOf: showAdapt ? $('admin-form-adapt-of')?.value || '' : '',
            category: categories,
            lyrics: $('admin-form-lyrics')?.value || '',
        };
    }

    async function handleSave() {
        const api = getLibraryApi();
        if (!api) return;
        const data = readFormData();
        if (!String(data.title).trim()) {
            setStatus('Title is required.', true);
            $('admin-form-title')?.focus();
            return;
        }
        if (!String(data.lyrics).trim()) {
            setStatus('Lyrics text is required.', true);
            $('admin-form-lyrics')?.focus();
            return;
        }

        const saveBtn = $('admin-save-btn');
        if (saveBtn) saveBtn.disabled = true;
        setStatus('Saving…');

        try {
            if (formMode === 'edit' && selectedSongId) {
                await api.updateLyric(selectedSongId, data);
                setStatus('Lyrics updated.');
            } else {
                const newId = await api.createLyric(data);
                selectedSongId = newId;
                setFormMode('edit');
                setStatus('Lyrics added to library.');
            }
            renderSearchResults($('admin-search')?.value || '');
            const email = window.__eclyricsAuth?.user?.email || '';
            if (email && typeof api.formatLastModifiedTimestamp === 'function') {
                updateFormMeta({
                    lastModified: api.formatLastModifiedTimestamp(),
                    lastModifiedBy: email,
                });
            }
        } catch (e) {
            setStatus(e.message || 'Save failed.', true);
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    async function handleDelete() {
        if (formMode !== 'edit' || !selectedSongId) return;
        const title = $('admin-form-title')?.value?.trim() || 'this song';
        if (!window.confirm(`Delete "${title}" from the library? This cannot be undone.`)) return;

        const api = getLibraryApi();
        if (!api) return;

        const deleteBtn = $('admin-delete-btn');
        if (deleteBtn) deleteBtn.disabled = true;
        setStatus('Deleting…');

        try {
            await api.deleteLyric(selectedSongId);
            clearForm();
            setFormMode('create');
            setStatus('Lyrics deleted.');
            renderSearchResults($('admin-search')?.value || '');
        } catch (e) {
            setStatus(e.message || 'Delete failed.', true);
        } finally {
            if (deleteBtn) deleteBtn.disabled = false;
        }
    }

    function handleNew() {
        clearForm();
        setFormMode('create');
        setStatus('');
        $('admin-form-title')?.focus();
    }

    function handleCancel() {
        clearForm();
        setFormMode('create');
        setStatus('');
        $('admin-form-title')?.focus();
    }

    function bindEvents() {
        $('admin-add-btn')?.addEventListener('click', handleNew);
        $('admin-save-btn')?.addEventListener('click', () => void handleSave());
        $('admin-delete-btn')?.addEventListener('click', () => void handleDelete());
        $('admin-cancel-btn')?.addEventListener('click', handleCancel);

        const search = $('admin-search');
        if (search) {
            search.addEventListener('input', () => renderSearchResults(search.value));
        }
    }

    function ensureLibrarySubscription() {
        const api = getLibraryApi();
        if (!api) return;
        if (typeof unsubscribeLibrary === 'function') return;
        api.start?.();
        unsubscribeLibrary = api.onChange?.(() => {
            renderSearchResults($('admin-search')?.value || '');
        });
    }

    window.eclyricsLoadAdminPanel = function eclyricsLoadAdminPanel() {
        if (!window.__eclyricsAuth?.isAdmin) {
            setStatus('Not authorized.', true);
            return;
        }
        ensureLibrarySubscription();
        renderSearchFilters();
        if (!selectedSongId && formMode !== 'edit') {
            renderFormCategoryPills([]);
            syncConditionalFields();
        }
        renderSearchResults($('admin-search')?.value || '');
        setFormMode(formMode === 'edit' ? 'edit' : 'create');
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindEvents);
    } else {
        bindEvents();
    }
})();
