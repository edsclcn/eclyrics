(function () {
    const renderer = window.eclyricsVideoStage, start = document.getElementById('video-prompter-start');
    function send(message) { if (window.opener && !window.opener.closed) window.opener.postMessage({ channel: renderer.CHANNEL, ...message }, location.origin); }
    const stage = renderer.create(document.getElementById('video-prompter-stage'), (message, needsPlay = false) => { start.hidden = !needsPlay; send({ type: 'error', message }); });
    let revision = -1, background = null;
    const pendingFonts = new Map(), pendingBackgrounds = new Map();
    function validEnvelope(payload) {
        if (!payload || payload.revision <= revision || typeof payload.settings?.fontFamily !== 'string') return false;
        // Validate every non-font field before decoding a new session font.
        if (!renderer.validate({ ...payload, settings: { ...payload.settings, fontFamily: 'Satoshi' } })) return false;
        const fonts = window.eclyricsVideoFonts, family = payload.settings.fontFamily;
        if (payload.font != null && (!fonts.validDescriptor(payload.font) || payload.font.family !== family)) return false;
        if (!fonts.allowedFamilies.includes(family) && payload.font == null && !pendingFonts.has(family)) return false;
        const descriptor = payload.background;
        if (descriptor != null && !(descriptor.blob instanceof Blob)) {
            try {
                const url = new URL(descriptor.url, location.href);
                if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return false;
            } catch { return false; }
        }
        return true;
    }
    window.addEventListener('message', async event => {
        if (event.origin !== location.origin || event.source !== window.opener || event.data?.channel !== renderer.CHANNEL || event.data.type !== 'state') return;
        const payload = event.data.payload;
        if (!validEnvelope(payload)) return;
        const fonts = window.eclyricsVideoFonts, family = payload.settings.fontFamily;
        if (payload.font != null && !pendingFonts.has(family)) {
            const loading = fonts.register(payload.font);
            pendingFonts.set(family, loading);
            loading.finally(() => { if (pendingFonts.get(family) === loading) pendingFonts.delete(family); }).catch(() => {});
        }
        const validation = (async () => {
            try {
                if (pendingFonts.has(family)) await pendingFonts.get(family);
                else await fonts.ensure(family);
                return renderer.validate(payload);
            } catch {
                send({ type: 'error', message: 'The custom font could not load.' });
                return null;
            }
        })();
        if (Object.hasOwn(payload, 'background')) pendingBackgrounds.set(payload.revision, { value: payload.background, validation });
        const state = await validation;
        if (!state || state.revision <= revision) { pendingBackgrounds.delete(payload.revision); return; }
        let nextBackground = background;
        // A cue without a media Blob can overtake initialization while its font decodes.
        const candidates = [...pendingBackgrounds].filter(([number]) => number <= state.revision).sort(([a], [b]) => b - a);
        for (const [, candidate] of candidates) {
            if (await candidate.validation) { nextBackground = candidate.value; break; }
        }
        if (state.revision <= revision) return;
        revision = state.revision; background = nextBackground;
        for (const number of pendingBackgrounds.keys()) if (number <= revision) pendingBackgrounds.delete(number);
        stage.invalidate();
        const applied = await stage.update({ ...state, background });
        if (applied && state.revision === revision) send({ type: 'ack', revision: state.revision });
    });
    start.onclick = async () => { try { await stage.play(); start.hidden = true; } catch { send({ type: 'error', message: 'Video playback could not start. Choose another background.' }); } };
    document.addEventListener('keydown', event => {
        if (event.code === 'Escape' && !event.repeat && document.fullscreenElement) {
            event.preventDefault();
            document.exitFullscreen()?.catch(() => {});
            return;
        }
        if (event.code === 'KeyF' && !event.repeat && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            const action = document.fullscreenElement
                ? document.exitFullscreen()
                : document.documentElement.requestFullscreen();
            action?.catch(() => {});
            return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || event.repeat) return;
        event.preventDefault();
        send({ type: 'advance', delta: event.key === 'ArrowDown' ? 1 : -1 });
    });
    window.addEventListener('pagehide', stage.destroy);
    send({ type: 'ready' });
})();
