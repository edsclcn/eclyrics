(async function bootstrapApp() {
    const fragmentDefinitions = [
        { file: 'sign-in.html', mountId: 'auth-gate-mount', rootId: 'auth-gate' },
        { file: 'text-lyrics.html', panelId: 'panel-text' },
        { file: 'image-lyrics.html', panelId: 'panel-image' },
        { file: 'video-lyrics.html', panelId: 'panel-video' },
        { file: 'admin.html', panelId: 'panel-admin', overlayId: 'admin-delete-dialog' },
    ];

    const appScripts = [
        'https://www.gstatic.com/firebasejs/12.10.0/firebase-app-compat.js',
        'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth-compat.js',
        'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore-compat.js',
        'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/dist/umd/index.min.js',
        'js/core/firebase-config.js',
        'js/auth/auth.js',
        'js/auth/login.js',
        'js/features/editor/smart-quotes.js',
        'js/library/song-model.js',
        'js/library/song-search.js',
        'js/library/song-library.js',
        'js/features/admin/admin-panel.js',
        'js/features/prompter/prompter-shortcuts.js',
        'js/features/prompter/prompter-sync-guard.js',
        'js/features/editor/block-source.js',
        'js/features/editor/index.js',
        'js/features/editor/workspace-tour.js',
        'js/features/editor/port.js',
        'js/features/image-lyrics/index.js',
        'js/features/editor/textformatting.js',
    ];

    const moduleUrl = (file) => new URL(`modules/${file}`, document.baseURI);
    const panelHost = document.getElementById('workspace-panels');

    function showBootstrapError(error) {
        const message = document.createElement('p');
        message.className = 'workspace-load-error';
        message.setAttribute('role', 'alert');
        message.textContent = `The workspace could not load. ${error.message}`;
        panelHost.replaceChildren(message);
        const gateStatus = document.getElementById('auth-gate-status');
        if (gateStatus) gateStatus.textContent = message.textContent;
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = new URL(src, document.baseURI).href;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Could not load app script: ${src}`));
            document.head.append(script);
        });
    }

    try {
        if (!panelHost) throw new Error('Workspace mount point is missing.');

        const fragments = await Promise.all(fragmentDefinitions.map(async (definition) => {
            const response = await fetch(moduleUrl(definition.file));
            if (!response.ok) throw new Error(`Could not load ${definition.file} (${response.status}).`);
            return { definition, markup: await response.text() };
        }));

        const overlays = [];
        for (const { definition, markup } of fragments) {
            const template = document.createElement('template');
            template.innerHTML = markup;
            if (definition.mountId) {
                const mount = document.getElementById(definition.mountId);
                const content = template.content.querySelector(`#${definition.rootId}`);
                if (!mount || !content) throw new Error(`${definition.file} is missing its mount point or root element.`);
                mount.append(content);
                continue;
            }
            const panel = template.content.querySelector(`#${definition.panelId}`);
            if (!panel) throw new Error(`${definition.file} is missing its workspace panel.`);
            panelHost.append(panel);

            if (definition.overlayId) {
                const overlay = template.content.querySelector(`#${definition.overlayId}`);
                if (!overlay) throw new Error(`${definition.file} is missing its admin dialog.`);
                overlays.push(overlay);
            }
        }
        document.body.append(...overlays);

        for (const src of appScripts) await loadScript(src);
    } catch (error) {
        showBootstrapError(error);
        console.error('EC Lyrics startup failed:', error);
    }
})();
