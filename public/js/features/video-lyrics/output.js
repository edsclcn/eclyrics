(function () {
    const api = window.eclyricsVideoLyrics, renderer = window.eclyricsVideoStage;
    if (!api || !renderer) return;
    const stage = renderer.create(document.getElementById('video-lyrics-preview-stage'), message => api.status(message, true));
    let popup = null, ready = false, revision = 0, sentBackground = undefined, lastAcknowledged = -1, sentFont = undefined;
    function payload(includeBackground) {
        const state = api.getState();
        const value = { revision: ++revision, text: state.live?.text || '', settings: { ...state.settings } };
        if (includeBackground) value.background = state.background;
        return value;
    }
    function sync() {
        const preview = payload(true); stage.update(preview);
        if (!popup || popup.closed || !ready) return;
        const state = api.getState(), includeBackground = sentBackground !== state.background;
        const output = { ...preview };
        if (sentFont !== state.settings.fontFamily) output.font = window.eclyricsVideoFonts?.descriptor(state.settings.fontFamily);
        sentFont = state.settings.fontFamily;
        if (!includeBackground) delete output.background;
        popup.postMessage({ channel: renderer.CHANNEL, type: 'state', payload: output }, location.origin);
        sentBackground = state.background;
    }
    api.subscribe(sync); sync();
    api.panel.addEventListener('video-lyrics-open', () => {
        if (popup && !popup.closed) { popup.focus(); sync(); return; }
        ready = false; sentFont = undefined; sentBackground = undefined; lastAcknowledged = -1;
        popup = window.open('video-prompter.html?v=20261003-video-actions-fade', 'eclyricsVideoPrompter', 'popup,width=1280,height=720');
        api.status(popup ? 'Opening video prompter…' : 'Allow popups to open the video prompter.', !popup);
    });
    window.addEventListener('message', event => {
        if (event.origin !== location.origin || event.source !== popup || event.data?.channel !== renderer.CHANNEL) return;
        const message = event.data;
        if (message.type === 'ready') { ready = true; sentFont = undefined; sentBackground = undefined; api.status('Video prompter connected.'); sync(); }
        else if (message.type === 'ack' && Number.isSafeInteger(message.revision) && message.revision > lastAcknowledged && message.revision <= revision) lastAcknowledged = message.revision;
        else if (message.type === 'error' && typeof message.message === 'string') api.status(message.message.slice(0, 300), true);
        else if (message.type === 'advance' && [1, -1].includes(message.delta)) api.advance(message.delta);
    });
    const closedCheck = setInterval(() => { if (popup?.closed) { popup = null; ready = false; api.status('Video prompter closed.'); } }, 1000);
    window.addEventListener('pagehide', () => { clearInterval(closedCheck); stage.destroy(); });
})();
