(function () {
    const OUTRO_CUE = 'To God be the Glory';
    function parseCues(lyrics) {
        let section = 0;
        return String(lyrics || '').split(/\r?\n/).reduce((cues, line) => {
            const text = line.trim();
            if (!text) { if (cues.length) section++; return cues; }
            cues.push({ text, section });
            return cues;
        }, []);
    }
    function buildCues(title, lyrics) {
        const lyricCues = parseCues(lyrics);
        const lastText = lyricCues.at(-1)?.text.toLocaleLowerCase().replace(/[.!?]+$/, '');
        if (lastText === OUTRO_CUE.toLocaleLowerCase()) {
            lyricCues.at(-1).isOutro = true;
        } else {
            lyricCues.push({ text: OUTRO_CUE, section: lyricCues.at(-1)?.section ?? 0, isOutro: true });
        }
        return [{ text: title, section: -1, isTitle: true }, ...lyricCues];
    }
    function create() {
        let nextId = 0;
        const state = { lineup: [], preparedId: null, preparedIndex: -1, live: null, background: null,
            settings: { fontFamily: 'Satoshi', fontWeight: 700, fontSize: 120, color: '#ffffff', alignment: 'center', fadeMs: 400, dimming: 0 } };
        const listeners = new Set();
        const prepared = () => state.lineup.find(entry => entry.id === state.preparedId);
        const notify = () => listeners.forEach(listener => listener(state));
        function prepare(id) { if (!state.lineup.some(entry => entry.id === id)) return; state.preparedId = id; state.preparedIndex = state.live?.entryId === id ? state.live.index : -1; notify(); }
        function cue(index) {
            const entry = prepared();
            if (!entry?.cues[index]) return;
            state.preparedIndex = index; state.live = { entryId: entry.id, index, text: entry.cues[index].text }; notify();
        }
        function updateSettings(patch) {
            const settings = state.settings;
            if ((window.eclyricsVideoFonts?.allowedFamilies || ['Satoshi']).includes(patch.fontFamily)) settings.fontFamily = patch.fontFamily;
            if ([400, 500, 600, 700, 800, 900].includes(Number(patch.fontWeight))) settings.fontWeight = Number(patch.fontWeight);
            [['fontSize', 24, 160], ['fadeMs', 0, 2000], ['dimming', 0, .9]].forEach(([key, min, max]) => {
                if (patch[key] !== undefined && Number.isFinite(Number(patch[key]))) settings[key] = Math.max(min, Math.min(max, Number(patch[key])));
            });
            if (/^#[\da-f]{6}$/i.test(patch.color || '')) settings.color = patch.color.toLowerCase();
            if (['left', 'center', 'right'].includes(patch.alignment)) settings.alignment = patch.alignment;
            notify();
        }
        return { getState: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, prepare, cue, updateSettings,
            add(song) { const title = window.eclyricsSongLibrary?.getPopupSongTitle(song) || song.title || 'Untitled'; const entry = { id: ++nextId, songId: song.id, title, category: [...(song.category || [])], lyrics: String(song.lyrics || ''), cues: buildCues(title, song.lyrics) }; state.lineup.push(entry); if (!state.preparedId) { state.preparedId = entry.id; state.preparedIndex = -1; } notify(); return entry.id; },
            edit(id, { title, lyrics }) {
                const entry = state.lineup.find(item => item.id === id);
                if (!entry) return;
                entry.title = String(title || '').trim() || 'Untitled';
                entry.lyrics = String(lyrics || '');
                const wasPreparedOutro = state.preparedId === id && entry.cues[state.preparedIndex]?.isOutro;
                const wasLiveOutro = state.live?.entryId === id && entry.cues[state.live.index]?.isOutro;
                entry.cues = buildCues(entry.title, entry.lyrics);
                if (state.preparedId === id) state.preparedIndex = wasPreparedOutro ? entry.cues.length - 1 : Math.min(state.preparedIndex, entry.cues.length - 2);
                if (state.live?.entryId === id) {
                    state.live.index = wasLiveOutro ? entry.cues.length - 1 : Math.min(state.live.index, entry.cues.length - 2);
                    state.live.text = entry.cues[state.live.index].text;
                    if (state.preparedId === id) state.preparedIndex = state.live.index;
                }
                notify();
            },
            remove(id) { const index = state.lineup.findIndex(entry => entry.id === id); if (index < 0) return; state.lineup.splice(index, 1); if (state.live?.entryId === id) state.live = null; if (state.preparedId === id) { state.preparedId = state.lineup[Math.min(index, state.lineup.length - 1)]?.id ?? null; state.preparedIndex = -1; } notify(); },
            move(id, delta) { const index = state.lineup.findIndex(entry => entry.id === id), target = index + delta; if (index < 0 || target < 0 || target >= state.lineup.length) return; const [entry] = state.lineup.splice(index, 1); state.lineup.splice(target, 0, entry); notify(); },
            advance(delta) { const entry = prepared(); if (!entry?.cues.length) return; cue(Math.max(0, Math.min(entry.cues.length - 1, state.preparedIndex + delta))); },
            blankOutput() { if (!state.live) return; state.live = null; notify(); },
            setBackground(background) { state.background = background; notify(); },
        };
    }
    window.eclyricsVideoModel = { create, parseCues };
})();
