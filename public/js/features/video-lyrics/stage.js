(function () {
    const CHANNEL = 'eclyrics-video-v1';
    function validate(payload) {
        if (!payload || !Number.isSafeInteger(payload.revision) || payload.revision < 0 || typeof payload.text !== 'string' || payload.text.length > 20000) return null;
        const value = payload.settings;
        const fonts = window.eclyricsVideoFonts?.allowedFamilies || ['Satoshi'];
        if (!value || !fonts.includes(value.fontFamily) || ![400, 500, 600, 700, 800, 900].includes(value.fontWeight) || !/^#[\da-f]{6}$/i.test(value.color) || !['left', 'center', 'right'].includes(value.alignment)) return null;
        if (![['fontSize', 24, 160], ['fadeMs', 0, 2000]].every(([key, min, max]) => Number.isFinite(value[key]) && value[key] >= min && value[key] <= max)) return null;
        if (value.dimming !== undefined && (!Number.isFinite(value.dimming) || value.dimming < 0 || value.dimming > .9)) return null;
        if (payload.background != null && (typeof payload.background !== 'object' || typeof payload.background.id !== 'string' || (!(payload.background.blob instanceof Blob) && typeof payload.background.url !== 'string'))) return null;
        return payload;
    }
    function create(host, onError = () => {}) {
        host.replaceChildren();
        const canvas = document.createElement('div'); canvas.className = 'video-stage-canvas';
        const lyric = document.createElement('div'); lyric.className = 'video-stage-lyric';
        const scrim = document.createElement('div'); scrim.className = 'video-stage-scrim';
        canvas.append(scrim, lyric); host.append(canvas); host.classList.add('video-stage-host');
        let maximumFontSize = 64;
        function fitLine(element = lyric) {
            element.style.fontSize = `${maximumFontSize}px`;
            if (!element.textContent) return;
            const range = document.createRange(); range.selectNodeContents(element);
            const available = element.getBoundingClientRect().width;
            const width = range.getBoundingClientRect().width;
            if (available > 0 && width > available) element.style.fontSize = `${maximumFontSize * available / width * .99}px`;
        }
        const resize = new ResizeObserver(() => { const scale = Math.min(host.clientWidth / 1920, host.clientHeight / 1080); canvas.style.transform = `translate(-50%, -50%) scale(${scale})`; fitLine(); if (outgoing) fitLine(outgoing); }); resize.observe(host);
        let currentVideo = null, currentUrl = null, pendingVideo = null, pendingUrl = null, backgroundKey = null, mediaGeneration = 0, cueGeneration = 0, animation = null, outgoing = null, outgoingAnimation = null, lastText = null;
        function releasePending() { if (pendingVideo) { pendingVideo.pause(); pendingVideo.removeAttribute('src'); pendingVideo.load(); pendingVideo.remove(); } if (pendingUrl) URL.revokeObjectURL(pendingUrl); pendingVideo = pendingUrl = null; }
        function background(descriptor) {
            const key = descriptor ? `${descriptor.id}:${descriptor.version || ''}` : null;
            if (key === backgroundKey) return;
            backgroundKey = key; const generation = ++mediaGeneration; releasePending();
            if (!descriptor) { currentVideo?.pause(); currentVideo?.remove(); if (currentUrl) URL.revokeObjectURL(currentUrl); currentVideo = currentUrl = null; return; }
            let source = descriptor.url;
            if (descriptor.blob instanceof Blob) { source = URL.createObjectURL(descriptor.blob); pendingUrl = source; }
            else { try { const url = new URL(source, location.href); if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) throw new Error(); source = url.href; } catch { backgroundKey = null; onError('The video background source is invalid.'); return; } }
            const video = document.createElement('video'); pendingVideo = video;
            video.className = 'video-stage-video'; video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto'; video.style.visibility = 'hidden'; canvas.prepend(video);
            video.addEventListener('error', () => { if (generation !== mediaGeneration) return; backgroundKey = null; releasePending(); onError('This video could not play. Choose another background.'); });
            video.addEventListener('loadeddata', () => {
                if (generation !== mediaGeneration) return;
                currentVideo?.pause(); currentVideo?.remove(); if (currentUrl) URL.revokeObjectURL(currentUrl);
                currentVideo = video; currentUrl = pendingUrl; pendingVideo = pendingUrl = null; video.style.visibility = '';
                video.play().catch(() => onError('Video playback needs a click. Click the prompter to start the background.', true));
            }, { once: true });
            video.src = source;
        }
        async function update(payload) {
            const state = validate(payload); if (!state) return false;
            if (Object.hasOwn(state, 'background')) background(state.background);
            scrim.style.opacity = state.settings.dimming ?? .3;
            const generation = ++cueGeneration;
            try { await document.fonts.load(`${state.settings.fontWeight} ${state.settings.fontSize}px "${state.settings.fontFamily}"`); } catch { onError('The selected font could not load.'); }
            if (generation !== cueGeneration) return false;
            Object.assign(lyric.style, { fontFamily: `"${state.settings.fontFamily}"`, fontWeight: state.settings.fontWeight, fontSize: `${state.settings.fontSize}px`, textAlign: state.settings.alignment, color: state.settings.color });
            maximumFontSize = state.settings.fontSize;
            fitLine();
            if (state.text === lastText) return true;
            animation?.cancel(); outgoingAnimation?.cancel(); outgoing?.remove();
            outgoing = null;
            const previous = lyric.textContent;
            lastText = state.text;
            const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : state.settings.fadeMs;
            if (previous && state.text && duration) {
                outgoing = lyric.cloneNode(true); canvas.insertBefore(outgoing, lyric);
                const fading = outgoing;
                outgoingAnimation = fading.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out' });
                outgoingAnimation.onfinish = () => fading.remove();
            }
            lyric.textContent = state.text;
            fitLine();
            if (state.text && duration) animation = lyric.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-out' });
            return true;
        }
        return { update, invalidate() { ++cueGeneration; }, play() { return currentVideo?.play(); }, destroy() { ++mediaGeneration; ++cueGeneration; resize.disconnect(); animation?.cancel(); outgoingAnimation?.cancel(); releasePending(); currentVideo?.pause(); if (currentUrl) URL.revokeObjectURL(currentUrl); host.replaceChildren(); } };
    }
    window.eclyricsVideoStage = { create, validate, CHANNEL };
})();
