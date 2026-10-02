(function () {
    const panel = document.getElementById('panel-video');
    if (!panel) return;
    const get = suffix => document.getElementById(`video-lyrics-${suffix}`);
    const model = window.eclyricsVideoModel.create();
    function status(message, error = false) { get('status').textContent = message; get('status').classList.toggle('is-error', error); }
    function button(text, label, callback, className = 'video-lyrics-icon') {
        const element = document.createElement('button'); element.type = 'button'; element.className = className;
        element.textContent = text; element.setAttribute('aria-label', label); element.title = label; element.onclick = callback; return element;
    }
    let lineupPage = 0, pageSize = 4, previousPrepared = null, previousCues = null, previousCueKey = null;
    function render(state) {
        const focusedControl = panel.contains(document.activeElement) ? document.activeElement.dataset.videoFocus : null;
        const prepared = state.lineup.find(entry => entry.id === state.preparedId);
        get('count').textContent = state.lineup.length;
        get('lineup-empty').hidden = state.lineup.length > 0;
        lineupPage = Math.min(lineupPage, Math.max(0, Math.ceil(state.lineup.length / pageSize) - 1));
        get('lineup').replaceChildren(...state.lineup.slice(lineupPage * pageSize, (lineupPage + 1) * pageSize).map((entry, pageIndex) => {
            const index = lineupPage * pageSize + pageIndex;
            const item = document.createElement('li'); item.className = 'video-lyrics-lineup-entry' + (entry.id === state.preparedId ? ' is-prepared' : '');
            const tag = document.createElement('span'); tag.className = 'video-lyrics-lineup-tag'; tag.textContent = state.live?.entryId === entry.id ? 'ON OUTPUT' : String(index + 1).padStart(2, '0');
            const select = button(entry.title, `Prepare ${entry.title}`, () => model.prepare(entry.id), 'video-lyrics-lineup-select'); select.setAttribute('aria-current', String(entry.id === state.preparedId)); select.dataset.videoFocus = `prepare-${entry.id}`;
            const actions = document.createElement('div'); actions.className = 'video-lyrics-lineup-actions';
            const up = button('↑', `Move ${entry.title} earlier`, () => model.move(entry.id, -1)); up.disabled = index === 0;
            const down = button('↓', `Move ${entry.title} later`, () => model.move(entry.id, 1)); down.disabled = index === state.lineup.length - 1;
            up.dataset.videoFocus = `up-${entry.id}`; down.dataset.videoFocus = `down-${entry.id}`;
            const edit = button('', `Edit ${entry.title}`, () => openLyricsEditor(entry.id)); edit.innerHTML = '<i class="fa-solid fa-pencil" aria-hidden="true"></i>'; edit.dataset.videoFocus = `edit-${entry.id}`;
            actions.append(up, down, edit, button('×', `Remove ${entry.title}`, () => model.remove(entry.id))); item.append(tag, select, actions); return item;
        }));
        const pages = Math.ceil(state.lineup.length / pageSize);
        get('lineup-pages').hidden = pages <= 1;
        const earlier = button('↑', 'Previous lineup page', () => { lineupPage--; render(model.getState()); }); earlier.disabled = lineupPage === 0;
        const later = button('↓', 'Next lineup page', () => { lineupPage++; render(model.getState()); }); later.disabled = lineupPage >= pages - 1;
        const pageLabel = document.createElement('span'); pageLabel.textContent = `${lineupPage + 1} / ${Math.max(1, pages)}`;
        get('lineup-pages').replaceChildren(earlier, pageLabel, later);
        get('song-title').textContent = prepared?.title || 'Ready when you are';
        get('song-meta').textContent = prepared ? `${prepared.cues.length} cues · Click a line or use ↑ / ↓ to cue` : 'Search the library to build a lineup.';
        get('cue-empty').hidden = !!prepared?.cues.length;
        get('cues').hidden = !prepared?.cues.length;
        const cuesChanged = previousPrepared !== prepared?.id || previousCues !== prepared?.cues;
        if (cuesChanged) get('cues').replaceChildren(...(prepared?.cues || []).map((cue, index) => {
            const isLive = state.live?.entryId === prepared.id && state.live.index === index;
            const cueButton = button('', `${cue.isTitle ? 'Cue song title' : `Cue line ${index}`}: ${cue.text}`, () => model.cue(index), 'video-lyrics-cue');
            cueButton.classList.toggle('is-live', isLive); cueButton.classList.toggle('is-prepared', !isLive && index === state.preparedIndex);
            cueButton.classList.toggle('is-title', !!cue.isTitle);
            cueButton.classList.toggle('is-section', index > 0 && prepared.cues[index - 1].section !== cue.section);
            cueButton.setAttribute('aria-current', String(isLive)); cueButton.dataset.videoFocus = `cue-${prepared.id}-${index}`;
            const number = document.createElement('span'); number.className = 'video-lyrics-cue-number'; number.textContent = String(index + 1).padStart(2, '0');
            const text = document.createElement('span'); text.textContent = cue.text; cueButton.append(number, text); return cueButton;
        }));
        previousPrepared = prepared?.id; previousCues = prepared?.cues;
        Array.from(get('cues').children).forEach((element, index) => {
            const live = state.live?.entryId === prepared?.id && state.live.index === index;
            element.classList.toggle('is-live', live); element.classList.toggle('is-prepared', !live && index === state.preparedIndex);
            element.setAttribute('aria-current', String(live));
        });
        const cueKey = `${prepared?.id}:${state.preparedIndex}`;
        if (cueKey !== previousCueKey || cuesChanged) {
            previousCueKey = cueKey;
            const active = get('cues').children[state.preparedIndex];
            if (active) {
                const container = get('cues'), rect = active.getBoundingClientRect(), viewport = container.getBoundingClientRect();
                const top = container.scrollTop + rect.top - viewport.top - (container.clientHeight - rect.height) / 2;
                container.scrollTo({ top: Math.max(0, Math.min(container.scrollHeight - container.clientHeight, top)), behavior: 'instant' });
            } else if (cuesChanged) get('cues').scrollTop = 0;
        }
        get('prev').disabled = !prepared?.cues.length || state.preparedIndex <= 0;
        get('next').disabled = !prepared?.cues.length || state.preparedIndex >= prepared.cues.length - 1;
        const liveEntry = state.lineup.find(entry => entry.id === state.live?.entryId);
        get('live-label').textContent = state.live ? `ON OUTPUT · ${liveEntry?.title} · Cue ${state.live.index + 1}` : 'No lyric on output';
        const settings = state.settings;
        [['font', 'fontFamily'], ['weight', 'fontWeight'], ['size', 'fontSize'], ['color', 'color'], ['hex', 'color'], ['alignment', 'alignment'], ['fade', 'fadeMs'], ['dimming', 'dimming']].forEach(([id, key]) => { if (document.activeElement !== get(id)) get(id).value = settings[key]; });
        syncFontPicker(settings);
        if (focusedControl) panel.querySelector(`[data-video-focus="${focusedControl}"]`)?.focus({ preventScroll: true });
    }
    let editingId = null;
    let editorGeneration = 0;
    let editorReturnFocus = null;
    function fillPastedLyrics(raw) {
        const lines = String(raw).replace(/\r\n?/g, '\n').split('\n');
        get('editor-title').value = lines.shift()?.trim() || '';
        get('editor-body').value = lines.join('\n').replace(/^\n+/, '');
    }
    async function openLyricsEditor(id = null, raw, readClipboard = false) {
        const generation = ++editorGeneration;
        editingId = id;
        editorReturnFocus = document.activeElement;
        const entry = model.getState().lineup.find(item => item.id === id);
        get('editor-heading').textContent = entry ? 'Edit lyrics' : 'Add lyrics';
        get('editor-title').value = entry?.title || '';
        get('editor-body').value = entry?.lyrics ?? entry?.cues.filter(cue => !cue.isTitle).map(cue => cue.text).join('\n') ?? '';
        get('editor-message').textContent = '';
        get('editor').showModal();
        get('editor-title').focus({ preventScroll: true });
        if (raw !== undefined) fillPastedLyrics(raw);
        else if (readClipboard) {
            // Open the editable fallback before requesting clipboard permission.
            get('editor-message').textContent = 'Paste title, a blank line, then lyrics. You can also paste directly into these fields.';
            try {
                const text = await navigator.clipboard.readText();
                if (generation !== editorGeneration || !get('editor').open) return;
                if (text.trim() && !get('editor-title').value && !get('editor-body').value) { fillPastedLyrics(text); get('editor-message').textContent = 'Review the title and lyrics before saving.'; }
            } catch {
                if (generation === editorGeneration && get('editor').open) get('editor-message').textContent = 'Clipboard access is unavailable. Paste your title and lyrics into the fields using Ctrl+V or ⌘V.';
            }
        }
    }
    function closeLyricsEditor() { get('editor').close(); }
    get('editor-form').addEventListener('submit', event => {
        event.preventDefault();
        const title = get('editor-title').value.trim();
        if (!title) { get('editor-title').focus(); return; }
        const lyrics = get('editor-body').value;
        if (editingId === null) model.add({ title, lyrics, category: [] });
        else model.edit(editingId, { title, lyrics });
        status(`${title} ${editingId === null ? 'added to lineup' : 'updated for this lineup'}.`);
        closeLyricsEditor();
    });
    get('editor-close').onclick = closeLyricsEditor;
    get('editor-cancel').onclick = closeLyricsEditor;
    get('editor').addEventListener('click', event => {
        if (event.target !== get('editor')) return;
        const rect = get('editor').getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeLyricsEditor();
    });
    get('editor').addEventListener('close', () => {
        editorGeneration++;
        const restored = editingId !== null ? panel.querySelector(`[data-video-focus="edit-${editingId}"]`) : null;
        (restored || (editorReturnFocus?.isConnected ? editorReturnFocus : get('add')))?.focus({ preventScroll: true });
    });
    function openSearch() {
        const addButton = get('add');
        window.eclyricsEditorBlockSource?.openForSongSelection({
            title: 'Add songs to your lineup',
            showManualOptions: true,
            onManualType: () => openLyricsEditor(),
            onPasteLyrics: raw => openLyricsEditor(null, raw, true),
            onSelectSong(song) {
                model.add(song);
                status(`${window.eclyricsSongLibrary?.getPopupSongTitle(song) || song.title} added to lineup.`);
            },
            onClose() { requestAnimationFrame(() => { if (!get('editor').open) addButton.focus({ preventScroll: true }); }); },
        });
    }
    get('add').onclick = openSearch;
    get('prev').onclick = () => model.advance(-1); get('next').onclick = () => model.advance(1);
    [['font', 'fontFamily'], ['weight', 'fontWeight'], ['size', 'fontSize'], ['color', 'color'], ['alignment', 'alignment'], ['fade', 'fadeMs'], ['dimming', 'dimming']].forEach(([id, key]) => get(id).addEventListener('input', () => { if (get(id).value !== '') model.updateSettings({ [key]: get(id).value }); }));
    [['size', 'fontSize'], ['fade', 'fadeMs'], ['dimming', 'dimming']].forEach(([id, key]) => {
        const field = get(id);
        const syncClampedValue = () => { field.value = model.getState().settings[key]; };
        field.addEventListener('change', syncClampedValue);
        field.addEventListener('blur', syncClampedValue);
    });
    get('hex').addEventListener('input', () => { const valid = /^#[\da-f]{6}$/i.test(get('hex').value); get('hex').setAttribute('aria-invalid', String(!valid)); if (valid) model.updateSettings({ color: get('hex').value }); });
    get('hex').addEventListener('change', () => { get('hex').value = model.getState().settings.color; get('hex').setAttribute('aria-invalid', 'false'); });
    ['open', 'background'].forEach(action => get(action).addEventListener('click', () => panel.dispatchEvent(new CustomEvent(`video-lyrics-${action}`, { bubbles: true }))));
    document.addEventListener('keydown', event => {
        if (!panel.classList.contains('is-active') || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); model.advance(event.key === 'ArrowDown' ? 1 : -1);

    });
    const fontRegistry = window.eclyricsVideoFonts;
    const fontDialog = document.createElement('dialog'); fontDialog.className = 'video-font-dialog';
    fontDialog.setAttribute('aria-labelledby', 'video-font-heading');
    fontDialog.innerHTML = '<header class="video-lyrics-section-head"><h3 id="video-font-heading">Choose a font</h3><button type="button" class="video-lyrics-icon" aria-label="Close fonts">×</button></header><div class="video-font-toolbar"><input type="search" placeholder="Search fonts…" aria-label="Search fonts"><select aria-label="Font category"><option>All</option><option>Sans Serif</option><option>Serif</option><option>Cursive</option></select></div><div class="video-font-list"></div><button type="button" class="video-lyrics-button video-font-import">+ Add your own font</button><p class="video-lyrics-muted" role="status">TTF, OTF, WOFF or WOFF2 · Session only · Up to 10 MB</p>';
    panel.append(fontDialog);
    const fontSearch = fontDialog.querySelector('input'), fontCategory = fontDialog.querySelector('select'), fontList = fontDialog.querySelector('.video-font-list');
    const fontFile = document.createElement('input'); fontFile.type = 'file'; fontFile.accept = '.ttf,.otf,.woff,.woff2'; fontFile.hidden = true; panel.append(fontFile);
    function syncFontPicker(settings) {
        const metadata = fontRegistry.metadata().find(font => font.family === settings.fontFamily);
        if (!metadata) return;
        const trigger = get('font-trigger'); trigger.textContent = `${metadata.name} ⌄`; trigger.style.fontFamily = `"${metadata.family}"`;
        const weights = metadata.weights;
        if (get('weight').dataset.family !== metadata.family) {
            const names = {400:'Regular',500:'Medium',600:'Semibold',700:'Bold',800:'Extra bold',900:'Black'};
            get('weight').replaceChildren(...weights.map(weight => { const option = document.createElement('option'); option.value = weight; option.textContent = names[weight]; return option; }));
            get('weight').dataset.family = metadata.family;
        }
        get('weight').value = settings.fontWeight;
    }
    function selectFont(font) {
        model.updateSettings({ fontFamily: font.family, fontWeight: font.defaultWeight });
        fontDialog.close();
    }
    function renderFonts() {
        const selected = model.getState().settings.fontFamily;
        const matches = fontRegistry.metadata().filter(font => (fontCategory.value === 'All' || font.category === fontCategory.value) && font.name.toLowerCase().includes(fontSearch.value.toLowerCase()));
        fontList.replaceChildren(...matches.map(font => {
            const row = button('', `Use ${font.name}`, () => selectFont(font), 'video-font-option');
            row.style.fontFamily = `"${font.family}"`; row.style.fontWeight = font.defaultWeight; row.setAttribute('aria-pressed', String(font.family === selected));
            const name = document.createElement('span'); name.textContent = font.name;
            const category = document.createElement('small'); category.textContent = font.imported ? 'Session font' : font.category; row.append(name, category);
            void document.fonts.load(`${font.defaultWeight} 24px "${font.family}"`).catch(() => {});
            return row;
        }));
        if (!matches.length) fontList.textContent = 'No fonts match your search.';
    }
    fontSearch.oninput = renderFonts; fontCategory.onchange = renderFonts;
    get('font-trigger').onclick = () => { fontSearch.value = ''; fontCategory.value = 'All'; renderFonts(); fontDialog.showModal(); fontSearch.focus({ preventScroll: true }); };
    fontDialog.querySelector('header button').onclick = () => fontDialog.close();
    fontDialog.addEventListener('close', () => get('font-trigger').focus({ preventScroll: true }));
    fontDialog.addEventListener('click', event => { const rect = fontDialog.getBoundingClientRect(); if (event.target === fontDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) fontDialog.close(); });
    fontDialog.querySelector('.video-font-import').onclick = () => { fontFile.value = ''; fontFile.click(); };
    fontFile.onchange = async () => {
        const file = fontFile.files?.[0]; if (!file) return;
        const message = fontDialog.querySelector('[role=status]'); message.textContent = 'Checking font…';
        try { const font = await fontRegistry.importFile(file, fontCategory.value === 'All' ? 'Sans Serif' : fontCategory.value); message.textContent = 'Font added for this session.'; selectFont(font); status(`${font.name} added for this session.`); }
        catch (error) { message.textContent = error.message; }
    };
    const lineupResize = new ResizeObserver(() => {
        const lineup = get('lineup'), available = lineup.clientHeight;
        const gap = parseFloat(getComputedStyle(lineup).rowGap) || 0;
        const row = lineup.querySelector('.video-lyrics-lineup-entry');
        const rowHeight = row ? parseFloat(getComputedStyle(row).height) : (innerWidth <= 700 ? 116 : 96);
        const size = Math.max(1, Math.floor((available + gap) / (rowHeight + gap)));
        if (size !== pageSize) { pageSize = size; render(model.getState()); }
    });
    lineupResize.observe(get('lineup'));
    model.subscribe(render); render(model.getState());
    window.eclyricsVideoLyrics = { ...model, status, panel };
})();
