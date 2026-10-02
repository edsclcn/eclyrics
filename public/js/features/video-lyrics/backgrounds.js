(function () {
    const controller = window.eclyricsVideoLyrics;
    if (!controller) return;
    const catalogue = [{ id: 'ambient-worship', version: '1', name: 'Background 1', url: 'assets/videos/ambient-worship.mp4', poster: 'assets/images/video-backgrounds/ambient-worship.jpg' }];
    const media = window.eclyricsVideoLocalMedia.create(), panel = controller.panel;
    let generation = 0, personalId = 0, wasActive = false, returnFocus;
    const dialog = document.createElement('dialog'); dialog.className = 'video-lyrics-dialog video-background-dialog';
    dialog.setAttribute('aria-labelledby', 'video-background-title');
    dialog.innerHTML = '<header class="video-lyrics-section-head"><h3 id="video-background-title">Choose a background</h3><button type="button" class="video-lyrics-icon" aria-label="Close backgrounds">×</button></header><p class="video-lyrics-muted">Choose a video for the whole lineup.</p><div class="video-background-grid"></div><p class="video-lyrics-muted" role="status" aria-live="polite"></p>';
    panel.append(dialog);
    const grid = dialog.querySelector('.video-background-grid'), message = dialog.querySelector('[role=status]');
    const picker = document.createElement('input'); picker.type = 'file'; picker.accept = 'video/*'; picker.hidden = true; panel.append(picker);
    function status(text, error = false) { message.textContent = text; controller.status(text, error); }
    function card(name, caption, entry) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'video-background-card';
        const visual = entry?.poster ? document.createElement('img') : document.createElement('span');
        if (entry?.poster) { visual.src = entry.poster; visual.alt = ''; visual.loading = 'lazy'; } else { visual.className = 'video-background-placeholder'; visual.textContent = entry ? '+' : '◇'; }
        const title = document.createElement('strong'), subtitle = document.createElement('span'); title.textContent = name; subtitle.textContent = caption;
        button.append(visual, title, subtitle); grid.append(button); return { button, subtitle };
    }
    const cards = catalogue.map(entry => {
        const item = card(entry.name, 'Video background', entry);
        item.button.onclick = () => select(entry); return { ...item, entry };
    });
    ['Background 2', 'Background 3', 'Background 4'].forEach(name => { card(name, 'Coming soon').button.disabled = true; });
    const upload = document.createElement('div'); upload.className = 'video-background-upload';
    upload.innerHTML = '<strong>Add your own video</strong><span class="video-lyrics-muted">Drop a video here, or choose a file. Session only.</span><button type="button" class="video-lyrics-button">Choose video</button>';
    grid.after(upload);
    upload.querySelector('button').onclick = () => { picker.value = ''; picker.click(); };
    upload.addEventListener('dragover', event => { event.preventDefault(); upload.classList.add('is-dragging'); });
    upload.addEventListener('dragleave', () => upload.classList.remove('is-dragging'));
    upload.addEventListener('drop', event => { event.preventDefault(); upload.classList.remove('is-dragging'); const file = event.dataTransfer.files?.[0]; if (file) void importVideo(file); });
    async function refresh() {
        await Promise.all(cards.map(async item => {
            item.subtitle.textContent = await media.isSaved(item.entry) ? 'Ready on this browser' : 'Downloading when available';
            item.button.setAttribute('aria-pressed', String(controller.getState().background?.id === item.entry.id));
        }));
    }
    async function select(entry, { close = true } = {}) {
        const selection = ++generation;
        status(`Loading ${entry.name}…`);
        try {
            const blob = await media.load(entry);
            await window.eclyricsVideoLocalMedia.probe(blob);
            if (selection !== generation) return;
            controller.setBackground({ id: entry.id, version: entry.version, name: entry.name, blob });
            status(`${entry.name} selected.`); if (close && dialog.open) dialog.close(); refresh();
        } catch (error) { if (selection === generation) status(error instanceof TypeError ? 'This background is unavailable offline. Connect and try again, or choose a personal video.' : error.message, true); }
    }
    async function importVideo(file) {
        if (!file) return;
        const selection = ++generation; status(`Checking ${file.name}…`);
        try {
            if (!file.size) throw new Error('Choose a video file that is not empty.');
            await window.eclyricsVideoLocalMedia.probe(file);
            if (selection !== generation) return;
            controller.setBackground({ id: `session-${++personalId}`, version: '1', name: file.name, blob: file });
            status(`${file.name} selected for this session. Nothing was uploaded.`); dialog.close(); refresh();
        } catch (error) { if (selection === generation) status(error.message, true); }
    }
    picker.onchange = () => { const file = picker.files?.[0]; picker.value = ''; void importVideo(file); };
    dialog.querySelector('button').onclick = () => dialog.close();
    dialog.addEventListener('close', () => returnFocus?.focus({ preventScroll: true }));
    dialog.addEventListener('click', event => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); });
    panel.addEventListener('video-lyrics-background', () => { returnFocus = document.activeElement; refresh(); dialog.showModal(); });
    async function cacheCatalogue() {
        let failed = false;
        for (const entry of catalogue) {
            try { await media.save(entry); } catch { failed = true; }
        }
        await refresh();
        if (failed) status('A background could not be saved locally. Playback remains available for this session.', true);
    }
    window.eclyricsVideoBackgrounds = { catalogue, media, select };
    // Download curated videos on first Video activation; later visits check IndexedDB before fetching.
    const activation = new MutationObserver(initialize);
    function initialize() {
        if (!panel.classList.contains('is-active')) { wasActive = false; return; }
        if (wasActive) return;
        wasActive = true;
        void cacheCatalogue();
        if (!controller.getState().background) select(catalogue[0], { close: false });
    }
    activation.observe(panel, { attributes: true, attributeFilter: ['class'] });
    initialize();
})();
