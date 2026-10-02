(function () {
    const MAX_BYTES = 10 * 1024 * 1024;
    const categories = {
        'Sans Serif': ['Satoshi', 'Inter', 'Poppins', 'DynaPuff', 'Atma'],
        Serif: ['Garamond', 'Times New Roman', 'Lora', 'Merriweather', 'IBM Plex Serif', 'Zen Antique'],
        Cursive: ['Rouge Script', 'Birthstone', 'Story Script', 'Parisienne', 'Great Vibes', 'Lobster Two']
    };
    const builtins = Object.entries(categories).flatMap(([category, names]) => names.map(family => ({ family, name: family, category, imported: false }))).sort((a, b) => a.name.localeCompare(b.name));
    builtins.forEach(font => {
        font.weights = ['Birthstone', 'Great Vibes', 'Parisienne', 'Rouge Script', 'Story Script', 'Zen Antique'].includes(font.family) ? [400] : ['Lobster Two', 'Times New Roman'].includes(font.family) ? [400, 700] : ['Garamond', 'Lora', 'IBM Plex Serif', 'Atma', 'DynaPuff'].includes(font.family) ? [400, 500, 600, 700] : [400, 500, 600, 700, 800, 900];
        font.defaultWeight = font.category === 'Cursive' || font.weights.length === 1 ? 400 : 700;
    });
    const imported = new Map(), pending = new Map();
    function validDescriptor(value) {
        return !!value && /^ECVideoFont_[a-f0-9]{32}$/.test(value.family) && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 100 && Object.hasOwn(categories, value.category) && value.blob instanceof Blob && value.blob.size > 0 && value.blob.size <= MAX_BYTES;
    }
    async function register(descriptor) {
        if (!validDescriptor(descriptor)) throw new Error('The custom font is invalid.');
        if (imported.has(descriptor.family)) return imported.get(descriptor.family);
        if (pending.has(descriptor.family)) return pending.get(descriptor.family);
        const task = (async () => {
            const bytes = await descriptor.blob.arrayBuffer();
            if (bytes.byteLength < 4) throw new Error('The custom font is invalid.');
            const signature = new DataView(bytes).getUint32(0);
            if (![0x00010000, 0x4f54544f, 0x774f4646, 0x774f4632].includes(signature)) throw new Error('Choose a valid TTF, OTF, WOFF or WOFF2 font.');
            const face = new FontFace(descriptor.family, bytes, { weight: '400', style: 'normal' });
            await face.load(); document.fonts.add(face);
            const value = { family: descriptor.family, name: descriptor.name, category: descriptor.category, blob: descriptor.blob, imported: true, weights: [400], defaultWeight: 400 };
            imported.set(value.family, value); return value;
        })();
        pending.set(descriptor.family, task);
        try { return await task; } finally { pending.delete(descriptor.family); }
    }
    async function importFile(file, category = 'Sans Serif') {
        if (!file || !/\.(ttf|otf|woff2?)$/i.test(file.name || '') || file.size > MAX_BYTES || file.size < 4) throw new Error('Choose a TTF, OTF, WOFF or WOFF2 font up to 10 MB.');
        const family = `ECVideoFont_${crypto.randomUUID().replaceAll('-', '')}`;
        return register({ family, name: file.name.replace(/\.(ttf|otf|woff2?)$/i, '').slice(0, 100) || 'Custom font', category, blob: file });
    }
    const metadata = () => [...builtins, ...imported.values()].sort((a, b) => a.name.localeCompare(b.name));
    window.eclyricsVideoFonts = { get allowedFamilies() { return metadata().map(font => font.family); }, metadata, register, importFile, validDescriptor, ensure: async family => { if (pending.has(family)) await pending.get(family); return metadata().some(font => font.family === family); }, descriptor: family => imported.get(family) || null, MAX_BYTES };
})();
