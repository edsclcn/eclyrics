(function () {
    const controller = window.eclyricsVideoLyrics;
    if (!controller) return;
    const catalogue = [
        { id: 'white-stars', version: '1', name: 'Background 1', description: 'White Stars', url: 'assets/videos/white-stars.mp4' },
        { id: 'blue-weightless', version: '1', name: 'Background 2', description: 'Blue Weightless', url: 'assets/videos/blue-weightless.mp4' },
        { id: 'green-lense-glare', version: '1', name: 'Background 3', description: 'Green Lens', url: 'assets/videos/green-lense-glare.mp4' },
        { id: 'orange-hexagons', version: '1', name: 'Background 4', description: 'Orange Hexagons', url: 'assets/videos/orange-hexagons.mp4' },
        { id: 'pink-hearts', version: '1', name: 'Background 5', description: 'Pink Hearts', url: 'assets/videos/pink-hearts.mp4' },
        { id: 'purple-fiber', version: '1', name: 'Background 6', description: 'Purple Fiber', url: 'assets/videos/purple-fiber.mp4' },
        { id: 'purple-lense-glare', version: '1', name: 'Background 7', description: 'Purple Lens Glare', url: 'assets/videos/purple-lense-glare.mp4' }
    ];
    const media = window.eclyricsVideoLocalMedia.create(), panel = controller.panel;
    let generation = 0, personalId = 0, wasActive = false, returnFocus;
    const dialog = document.createElement('dialog'); dialog.className = 'video-lyrics-dialog video-background-dialog';
    dialog.setAttribute('aria-labelledby', 'video-background-title');
    dialog.innerHTML = '<header class="video-lyrics-section-head"><h3 id="video-background-title">Choose a background</h3><button type="button" class="video-lyrics-icon" aria-label="Close backgrounds">×</button></header><p class="video-lyrics-muted">Choose a video for the whole lineup.</p><div class="video-background-grid"></div><p class="video-lyrics-muted" role="status" aria-live="polite"></p>';
    panel.append(dialog);
    const grid = dialog.querySelector('.video-background-grid'), message = dialog.querySelector('[role=status]');
    const picker = document.createElement('input'); picker.type = 'file'; picker.accept = 'video/*'; picker.hidden = true; panel.append(picker);
    function status(text, error = false) { message.textContent = text; controller.status(text, error); }
    const previewVideos = [];
    function card(name, caption, entry) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'video-background-card';
        const visual = entry?.url ? document.createElement('video') : entry?.poster ? document.createElement('img') : document.createElement('span');
        if (entry?.url) {
            visual.dataset.src = entry.url;
            visual.muted = true;
            visual.autoplay = true;
            visual.loop = true;
            visual.playsInline = true;
            visual.preload = 'metadata';
            visual.className = 'video-background-preview';
            previewVideos.push(visual);
        } else if (entry?.poster) { visual.src = entry.poster; visual.alt = ''; visual.loading = 'lazy'; } else { visual.className = 'video-background-placeholder'; visual.textContent = entry ? '+' : '◇'; }
        const title = document.createElement('strong'), subtitle = document.createElement('span'); title.textContent = name; subtitle.textContent = caption;
        button.append(visual, title, subtitle); grid.append(button); return { button };
    }
    const cards = catalogue.map(entry => {
        const item = card(entry.name, entry.description, entry);
        item.button.onclick = () => select(entry); return { ...item, entry };
    });
    const upload = card('Add your own video', 'Choose a file · Session only', { custom: true });
    upload.button.classList.add('video-background-card--upload');
    upload.button.setAttribute('aria-label', 'Add your own video for this session');
    upload.button.onclick = () => { picker.value = ''; picker.click(); };
    upload.button.addEventListener('dragover', event => { event.preventDefault(); upload.button.classList.add('is-dragging'); });
    upload.button.addEventListener('dragleave', () => upload.button.classList.remove('is-dragging'));
    upload.button.addEventListener('drop', event => { event.preventDefault(); upload.button.classList.remove('is-dragging'); const file = event.dataTransfer.files?.[0]; if (file) void importVideo(file); });
    function refresh() {
        cards.forEach(item => {
            item.button.setAttribute('aria-pressed', String(controller.getState().background?.id === item.entry.id));
        });
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
            void media.save(entry).catch(() => {
                if (selection === generation) status(`${entry.name} is playing but could not be saved on this browser.`, true);
            });
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
    dialog.addEventListener('close', () => {
        previewVideos.forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); });
        returnFocus?.focus({ preventScroll: true });
    });
    dialog.addEventListener('click', event => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); });
    panel.addEventListener('video-lyrics-background', () => {
        returnFocus = document.activeElement;
        refresh();
        previewVideos.forEach(video => {
            video.src = video.dataset.src;
            const playback = video.play();
            if (playback) playback.catch(() => {});
        });
        dialog.showModal();
    });
    window.eclyricsVideoBackgrounds = { catalogue, media, select };
    const activation = new MutationObserver(initialize);
    function initialize() {
        if (!panel.classList.contains('is-active')) { wasActive = false; return; }
        if (wasActive) return;
        wasActive = true;
        if (!controller.getState().background) select(catalogue[0], { close: false });
    }
    activation.observe(panel, { attributes: true, attributeFilter: ['class'] });
    initialize();
})();
