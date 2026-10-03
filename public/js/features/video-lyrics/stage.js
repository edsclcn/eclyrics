(function () {
    const CHANNEL = 'eclyrics-video-v1';
    function validate(payload) {
        if (!payload || !Number.isSafeInteger(payload.revision) || payload.revision < 0 || typeof payload.text !== 'string' || payload.text.length > 20000) return null;
        const value = payload.settings;
        const fonts = window.eclyricsVideoFonts?.allowedFamilies || ['Satoshi'];
        if (!value || !fonts.includes(value.fontFamily) || ![400, 500, 600, 700, 800, 900].includes(value.fontWeight) || !/^#[\da-f]{6}$/i.test(value.color) || !['left', 'center', 'right'].includes(value.alignment)) return null;
        if (![['fontSize', 24, 160], ['fadeMs', 0, 2000]].every(([key, min, max]) => Number.isFinite(value[key]) && value[key] >= min && value[key] <= max)) return null;
        if (payload.effectiveFontSize !== undefined && (!Number.isFinite(payload.effectiveFontSize) || payload.effectiveFontSize < .01 || payload.effectiveFontSize > value.fontSize)) return null;
        if (value.dimming !== undefined && (!Number.isFinite(value.dimming) || value.dimming < 0 || value.dimming > .9)) return null;
        if (payload.background != null && (typeof payload.background !== 'object' || typeof payload.background.id !== 'string' || (!(payload.background.blob instanceof Blob) && typeof payload.background.url !== 'string'))) return null;
        return payload;
    }
    function fittedFontSize(line, canvas, text, settings) {
        const requested = settings.fontSize;
        const computedLine = getComputedStyle(line);
        const probe = document.createElement('div');
        const probeLine = line.cloneNode(false);
        probe.className = 'video-stage-lyric';
        probe.setAttribute('aria-hidden', 'true');
        Object.assign(probe.style, {
            position: 'absolute', inset: 'auto', top: '0', left: '-10000px', display: 'block', height: 'auto', visibility: 'hidden', pointerEvents: 'none',
            width: computedLine.width, fontFamily: `"${settings.fontFamily}"`,
            fontWeight: String(settings.fontWeight), textAlign: settings.alignment
        });
        probeLine.textContent = text;
        Object.assign(probeLine.style, { display: 'block', maxHeight: 'none', height: 'auto', overflow: 'visible', paddingTop: computedLine.paddingTop, paddingBottom: computedLine.paddingBottom, width: '100%' });
        probeLine.style.setProperty('-webkit-line-clamp', 'unset', 'important');
        probeLine.style.setProperty('line-clamp', 'unset', 'important');
        probe.append(probeLine);
        canvas.append(probe);

        function fits(size) {
            probe.style.fontSize = `${size}px`;
            const lineStyle = getComputedStyle(probeLine);
            const rawLineHeight = lineStyle.lineHeight;
            const parsedLineHeight = parseFloat(rawLineHeight);
            const lineHeight = Number.isFinite(parsedLineHeight) && parsedLineHeight > 0
                ? (rawLineHeight.endsWith('px') ? parsedLineHeight : parsedLineHeight * size)
                : size * 1.2;
            const paddingTop = parseFloat(lineStyle.paddingTop) || 0;
            const paddingBottom = parseFloat(lineStyle.paddingBottom) || 0;
            return probeLine.scrollHeight - paddingTop - paddingBottom <= lineHeight * 2 + 1;
        }

        let result = requested;
        if (!fits(requested)) {
            let low = 0.01, high = requested;
            for (let i = 0; i < 14; i++) {
                const middle = (low + high) / 2;
                if (fits(middle)) low = middle;
                else high = middle;
            }
            result = Math.max(0.01, Math.floor(low * 10) / 10);
        }
        probe.remove();
        return result;
    }
    function create(host, onError = () => {}) {
        host.replaceChildren();
        const canvas = document.createElement('div'); canvas.className = 'video-stage-canvas';
        const lyric = document.createElement('div'); lyric.className = 'video-stage-lyric';
        const line = document.createElement('span'); line.className = 'video-stage-line';
        const scrim = document.createElement('div'); scrim.className = 'video-stage-scrim';
        lyric.append(line); canvas.append(scrim, lyric); host.append(canvas); host.classList.add('video-stage-host');
        const resize = new ResizeObserver(() => { const scale = Math.min(host.clientWidth / 1920, host.clientHeight / 1080); canvas.style.transform = `translate(-50%, -50%) scale(${scale})`; }); resize.observe(host);
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
            const textChanged = state.text !== lastText;
            if (textChanged) {
                animation?.cancel(); outgoingAnimation?.cancel(); outgoing?.remove();
                animation = outgoingAnimation = outgoing = null;
                const previous = line.textContent;
                const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : state.settings.fadeMs;
                if (previous && duration) {
                    outgoing = lyric.cloneNode(true); canvas.insertBefore(outgoing, lyric);
                    const fading = outgoing;
                    outgoingAnimation = fading.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out' });
                    outgoingAnimation.onfinish = () => { fading.remove(); if (outgoing === fading) outgoing = outgoingAnimation = null; };
                }
                line.textContent = state.text;
                lastText = state.text;
            }
            Object.assign(lyric.style, { fontFamily: `"${state.settings.fontFamily}"`, fontWeight: state.settings.fontWeight, textAlign: state.settings.alignment, color: state.settings.color });
            lyric.style.fontSize = `${state.text ? (state.effectiveFontSize ?? fittedFontSize(line, canvas, state.text, state.settings)) : state.settings.fontSize}px`;
            if (!textChanged) return true;
            const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : state.settings.fadeMs;
            if (state.text && duration) animation = lyric.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-out' });
            return true;
        }
        return { update, invalidate() { ++cueGeneration; }, play() { return currentVideo?.play(); }, destroy() { ++mediaGeneration; ++cueGeneration; resize.disconnect(); animation?.cancel(); outgoingAnimation?.cancel(); releasePending(); currentVideo?.pause(); if (currentUrl) URL.revokeObjectURL(currentUrl); host.replaceChildren(); } };
    }
    window.eclyricsVideoStage = { create, validate, CHANNEL };
})();
