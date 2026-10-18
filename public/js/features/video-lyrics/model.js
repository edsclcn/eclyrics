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
            sync: { enabled: false, status: 'Off by default', lineupKey: null, activeLineupKey: null, activeBlockIndex: null, projection: [], songs: [], latestPosition: null },
            settings: { fontFamily: 'Satoshi', fontWeight: 700, fontSize: 120, color: '#ffffff', positionUnit: 'stage-px-v1', y: 540, fadeMs: 400, playbackRate: 1, dimming: 0.3 } };
        const listeners = new Set();
        const prepared = () => state.lineup.find(entry => entry.id === state.preparedId);
        const notify = () => listeners.forEach(listener => listener(state));
        const findTextSong = lineupKey => state.sync.songs.find(song => song.lineupKey === lineupKey);
        function isValidTextPosition(position) {
            const song = findTextSong(position?.lineupKey);
            const block = song?.blocks.find(entry => entry.blockIndex === position?.blockIndex);
            return Boolean(block && (position.sourceLineIndex === null || block.lines.some(line => line.sourceLineIndex === position.sourceLineIndex)));
        }
        function setCue(index) {
            const entry = prepared();
            if (!entry?.cues[index]) return false;
            state.preparedIndex = index;
            state.live = { entryId: entry.id, index, text: entry.cues[index].text };
            return true;
        }
        function applyTextPosition(position) {
            const song = findTextSong(position.lineupKey);
            const block = song?.blocks.find(entry => entry.blockIndex === position.blockIndex);
            const line = block?.lines.find(entry => entry.sourceLineIndex === position.sourceLineIndex);
            if (!Number.isInteger(position.sourceLineIndex) || !line) {
                state.sync.status = 'Sync on · Waiting for a lyric at the text marker.';
                notify();
                return;
            }
            const text = line.text || position.lineText.trim();
            if (!text) {
                state.sync.status = 'Sync on · Waiting for a lyric at the text marker.';
                notify();
                return;
            }
            state.live = { entryId: 'text-sync', lineupKey: song.lineupKey, songTitle: song.title, blockIndex: position.blockIndex, index: position.sourceLineIndex, text };
            state.sync.status = `Following ${song.title} · Line ${position.sourceLineIndex + 1}.`;
            notify();
        }
        function applyLatestPositionWhenEnabled() {
            if (state.sync.enabled && state.sync.latestPosition) applyTextPosition(state.sync.latestPosition);
            else notify();
        }
        function prepare(id) { if (!state.lineup.some(entry => entry.id === id)) return; state.preparedId = id; state.preparedIndex = state.live?.entryId === id ? state.live.index : -1; if (state.sync.enabled && state.sync.latestPosition) applyLatestPositionWhenEnabled(); else notify(); }
        function cue(index) {
            if (state.sync.enabled) return false;
            const entry = prepared();
            if (!entry?.cues[index]) return false;
            setCue(index); notify();
            return true;
        }
        function setSyncEnabled(enabled) {
            const syncEnabled = Boolean(enabled);
            state.sync.enabled = syncEnabled;
            if (!state.sync.enabled) {
                state.sync.status = 'Sync off.';
                notify();
                return;
            }
            state.sync.status = 'Sync on · Waiting for a text prompter position.';
            if (state.sync.latestPosition) applyTextPosition(state.sync.latestPosition);
            else notify();
        }
        function setTextLineup(source) {
            if (!source) {
                state.sync.lineupKey = null;
                state.sync.activeLineupKey = null;
                state.sync.activeBlockIndex = null;
                state.sync.projection = [];
                state.sync.songs = [];
                state.sync.latestPosition = null;
                if (state.live?.entryId === 'text-sync') state.live = null;
                if (state.sync.enabled) state.sync.status = 'Sync on · Waiting for a text prompter position.';
                notify();
                return true;
            }
            const sourceSongs = Array.isArray(source.songs)
                ? source.songs
                : typeof source.lineupKey === 'string' && Array.isArray(source.blocks)
                    ? [{ lineupKey: source.lineupKey, title: source.title || source.lineupKey, blocks: source.blocks }]
                    : null;
            if (!sourceSongs) return false;
            const songs = sourceSongs.filter(song => typeof song?.lineupKey === 'string' && Array.isArray(song.blocks)).map((song, songIndex) => ({
                id: `text-song-${song.lineupKey}`,
                lineupKey: song.lineupKey,
                title: String(song.title || `Song ${songIndex + 1}`),
                blocks: song.blocks.filter(block => Number.isInteger(block?.blockIndex) && block.blockIndex >= 0).map(block => ({
                    id: `text-${song.lineupKey}-${block.blockIndex}`,
                    blockIndex: block.blockIndex,
                    title: String(block.title || `Block ${block.blockIndex + 1}`),
                    lines: Array.isArray(block.lines) ? block.lines.filter(line => Number.isInteger(line?.sourceLineIndex) && line.sourceLineIndex >= 0 && typeof line.text === 'string' && line.text.trim()).map(line => ({
                        sourceLineIndex: line.sourceLineIndex,
                        text: line.text.trim(),
                    })) : [],
                })),
            }));
            const activeLineupKey = typeof source.activeLineupKey === 'string'
                ? source.activeLineupKey
                : typeof source.lineupKey === 'string' ? source.lineupKey : null;
            const activeSong = songs.find(song => song.lineupKey === activeLineupKey);
            state.sync.activeLineupKey = activeSong?.lineupKey || null;
            state.sync.lineupKey = state.sync.activeLineupKey;
            state.sync.activeBlockIndex = Number.isInteger(source.activeBlockIndex) && source.activeBlockIndex >= 0
                ? source.activeBlockIndex
                : null;
            state.sync.projection = activeSong?.blocks || [];
            state.sync.songs = songs;
            if (state.sync.latestPosition && !isValidTextPosition(state.sync.latestPosition)) {
                state.sync.latestPosition = null;
                if (state.live?.entryId === 'text-sync') state.live = null;
                if (state.sync.enabled) state.sync.status = 'Sync on · Waiting for a text prompter position.';
            }
            if (state.live?.entryId === 'text-sync' && !isValidTextPosition({
                lineupKey: state.live.lineupKey,
                blockIndex: state.live.blockIndex,
                sourceLineIndex: state.live.index,
            })) state.live = null;
            if (state.sync.enabled && state.sync.latestPosition) applyTextPosition(state.sync.latestPosition);
            else notify();
            return true;
        }
        function updateTextPosition(position) {
            if (!position || typeof position !== 'object' || !Number.isInteger(position.blockIndex) || position.blockIndex < 0) return;
            if (position.sourceLineIndex !== null && (!Number.isInteger(position.sourceLineIndex) || position.sourceLineIndex < 0)) return;
            if (typeof position.lineText !== 'string') return;
            if (typeof position.lineupKey !== 'string' || !isValidTextPosition(position)) return;
            const latestPosition = {
                lineupKey: position.lineupKey,
                blockIndex: position.blockIndex,
                sourceLineIndex: position.sourceLineIndex,
                lineText: position.lineText,
            };
            state.sync.latestPosition = latestPosition;
            if (state.sync.enabled) applyTextPosition(latestPosition);
        }
        function updateSettings(patch) {
            const settings = state.settings;
            if ((window.eclyricsVideoFonts?.allowedFamilies || ['Satoshi']).includes(patch.fontFamily)) settings.fontFamily = patch.fontFamily;
            if ([400, 500, 600, 700, 800, 900].includes(Number(patch.fontWeight))) settings.fontWeight = Number(patch.fontWeight);
            [['fontSize', 24, 160], ['fadeMs', 0, 2000], ['dimming', 0, .9], ['y', 0, 1080], ['playbackRate', .5, 2]].forEach(([key, min, max]) => {
                if (patch[key] !== undefined && Number.isFinite(Number(patch[key]))) settings[key] = Math.max(min, Math.min(max, Number(patch[key])));
            });
            if (patch.fadeMs !== undefined && Number.isFinite(Number(patch.fadeMs))) settings.fadeMs = Math.round(settings.fadeMs / 100) * 100;
            if (patch.y !== undefined && Number.isFinite(Number(patch.y))) settings.y = Math.round(settings.y / 10) * 10;
            if (patch.playbackRate !== undefined && Number.isFinite(Number(patch.playbackRate))) settings.playbackRate = Math.round(settings.playbackRate * 10) / 10;
            if (/^#[\da-f]{6}$/i.test(patch.color || '')) settings.color = patch.color.toLowerCase();
            notify();
        }
        return { getState: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, prepare, cue, updateSettings,
            add(song) { const title = window.eclyricsSongLibrary?.getPopupSongTitle(song) || song.title || 'Untitled'; const entry = { id: ++nextId, songId: song.id, title, category: [...(song.category || [])], lyrics: String(song.lyrics || ''), cues: buildCues(title, song.lyrics) }; state.lineup.push(entry); if (!state.preparedId) { state.preparedId = entry.id; state.preparedIndex = -1; } if (state.preparedId === entry.id) applyLatestPositionWhenEnabled(); else notify(); return entry.id; },
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
                if (state.preparedId === id) applyLatestPositionWhenEnabled();
                else notify();
            },
            remove(id) { const index = state.lineup.findIndex(entry => entry.id === id); if (index < 0) return; state.lineup.splice(index, 1); if (state.live?.entryId === id) state.live = null; if (state.preparedId === id) { state.preparedId = state.lineup[Math.min(index, state.lineup.length - 1)]?.id ?? null; state.preparedIndex = -1; } if (state.sync.enabled && state.sync.latestPosition) applyLatestPositionWhenEnabled(); else notify(); },
            move(id, delta) { const index = state.lineup.findIndex(entry => entry.id === id), target = index + delta; if (index < 0 || target < 0 || target >= state.lineup.length) return; const [entry] = state.lineup.splice(index, 1); state.lineup.splice(target, 0, entry); notify(); },
            advance(delta) { if (state.sync.enabled) return false; const entry = prepared(); if (!entry?.cues.length) return false; setCue(Math.max(0, Math.min(entry.cues.length - 1, state.preparedIndex + delta))); notify(); return true; },
            setSyncEnabled, setTextLineup, updateTextPosition,
            blankOutput() { if (!state.live) return; state.live = null; notify(); },
            setBackground(background) { state.background = background; notify(); },
        };
    }
    window.eclyricsVideoModel = { create, parseCues };
})();
