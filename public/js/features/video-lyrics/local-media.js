(function () {
    const databaseName = 'eclyrics-video-backgrounds';
    function createStore() {
        let opening;
        function open() {
            if (!opening) {
                const attempt = new Promise((resolve, reject) => {
                    if (!window.indexedDB) return reject(new Error('Browser storage is unavailable.'));
                    const request = indexedDB.open(databaseName, 1);
                    request.onupgradeneeded = () => request.result.createObjectStore('videos');
                    request.onsuccess = () => { const database = request.result; database.onversionchange = () => database.close(); resolve(database); };
                    request.onerror = () => reject(request.error);
                    request.onblocked = () => reject(new Error('Close other EC Lyrics tabs to enable background storage.'));
                });
                const retryable = attempt.catch(error => {
                    if (opening === retryable) opening = undefined;
                    throw error;
                });
                opening = retryable;
            }
            return opening;
        }
        async function transaction(mode, key, blob) {
            const database = await open();
            return new Promise((resolve, reject) => {
                const operation = database.transaction('videos', mode), store = operation.objectStore('videos');
                const request = mode === 'readonly' ? store.get(key) : store.put(blob, key);
                operation.oncomplete = () => resolve(request.result);
                operation.onerror = () => reject(operation.error);
                operation.onabort = () => reject(operation.error || new Error('Video storage was interrupted.'));
            });
        }
        return { get: key => transaction('readonly', key), put: (key, blob) => transaction('readwrite', key, blob) };
    }
    function create({ store = createStore(), fetchMedia = (...args) => fetch(...args) } = {}) {
        const session = new Map(), pending = new Map();
        const keyFor = entry => `${entry.id}:${entry.version}`;
        async function read(entry) {
            const key = keyFor(entry);
            if (session.has(key)) return { blob: session.get(key), saved: false };
            try { const blob = await store.get(key); if (blob instanceof Blob && blob.size) { session.set(key, blob); return { blob, saved: true }; } } catch { /* Session playback remains available without persistent storage. */ }
            return null;
        }
        async function load(entry) {
            const key = keyFor(entry);
            if (pending.has(key)) return pending.get(key);
            const promise = (async () => {
                const cached = await read(entry); if (cached) return cached.blob;
                const response = await fetchMedia(entry.url);
                if (!response.ok) throw new Error('The background could not download. Connect to the internet and try again.');
                const blob = await response.blob();
                if (!blob.size) throw new Error('The downloaded video is empty.');
                session.set(key, blob); return blob;
            })();
            pending.set(key, promise);
            try { return await promise; } finally { pending.delete(key); }
        }
        async function isSaved(entry) {
            try { const blob = await store.get(keyFor(entry)); return blob instanceof Blob && blob.size > 0; } catch { return false; }
        }
        async function save(entry) {
            if (await isSaved(entry)) return false;
            const blob = await load(entry);
            await store.put(keyFor(entry), blob); return true;
        }
        return { load, save, isSaved, keyFor };
    }
    function probe(blob) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video'), url = URL.createObjectURL(blob);
            let finished = false;
            const timer = setTimeout(() => finish(new Error('The video could not be decoded. Try an MP4 with H.264 video.')), 15000);
            function finish(error) { if (finished) return; finished = true; clearTimeout(timer); video.onloadeddata = video.onerror = null; video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); error ? reject(error) : resolve(); }
            video.muted = true; video.playsInline = true; video.preload = 'auto';
            video.onloadeddata = () => { video.onloadeddata = video.onerror = null; finish(video.videoWidth && video.videoHeight ? null : new Error('Choose a file containing playable video.')); };
            video.onerror = () => { video.onloadeddata = video.onerror = null; finish(new Error('This video format could not play. Try an MP4 with H.264 video.')); };
            video.src = url;
        });
    }
    window.eclyricsVideoLocalMedia = { create, createStore, probe };
})();
