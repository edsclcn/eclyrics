(() => {
    'use strict';

    const STAGE_WIDTH = 1920;
    const STAGE_HEIGHT = 1080;
    const TOP_SPEED = 6.5;
    const MIN_SPEED = 0.1;
    const DEFAULT_SPEED = 0.5;
    const MANUAL_SCROLL_PX = 100;
    const MESSAGE = {
        init: 'eclyrics-image-prompter-init',
        ready: 'eclyrics-image-prompter-ready',
        control: 'eclyrics-image-prompter-control',
        state: 'eclyrics-image-prompter-state',
    };

    const stage = document.getElementById('image-prompter-stage');
    const content = document.getElementById('image-prompter-content');
    let lineup = [];
    let currentIndex = 0;
    let scrollTop = 0;
    let speed = DEFAULT_SPEED;
    let paused = true;
    let animationFrame = 0;
    let currentObjectUrl = null;
    let lastFrameTime = 0;
    let pendingScrollTop = null;
    let renderGeneration = 0;
    let pendingNavigationArrow = '';
    let pendingNavigationArrowAt = 0;

    function matchNavigationArrow(code, repeat = false) {
        if (repeat) return false;
        if (code !== 'ArrowLeft' && code !== 'ArrowRight') {
            pendingNavigationArrow = '';
            pendingNavigationArrowAt = 0;
            return false;
        }
        const now = Date.now();
        const matched = pendingNavigationArrow === code && now - pendingNavigationArrowAt <= 400;
        pendingNavigationArrow = matched ? '' : code;
        pendingNavigationArrowAt = matched ? 0 : now;
        return matched;
    }

    function resetNavigationArrow() {
        pendingNavigationArrow = '';
        pendingNavigationArrowAt = 0;
    }

    function sendToOpener(message) {
        if (window.opener && !window.opener.closed) {
            const targetOrigin = window.location.origin === 'null' ? '*' : window.location.origin;
            window.opener.postMessage(message, targetOrigin);
        }
    }

    function isOpenerMessage(event) {
        if (!window.opener || event.source !== window.opener) return false;
        return event.origin === window.location.origin
            || (window.location.protocol === 'file:' && (event.origin === 'file://' || event.origin === 'null'));
    }

    function setSpeed(nextSpeed) {
        const value = Number(nextSpeed);
        if (!Number.isFinite(value)) return;
        speed = Math.round(Math.min(TOP_SPEED, Math.max(MIN_SPEED, value)) * 10) / 10;
        notifyState();
    }

    function nudgeSpeed(delta) {
        const amount = Number(delta);
        if (!Number.isFinite(amount) || amount === 0) return;
        if (amount < 0 && speed <= MIN_SPEED) {
            setPaused(true);
            return;
        }
        setSpeed(speed + amount);
        if (amount > 0 && paused) setPaused(false);
    }

    function notifyState() {
        sendToOpener({
            type: MESSAGE.state,
            currentIndex,
            scrollTop,
            paused,
            speed,
        });
    }

    function fitStage() {
        const scale = Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT);
        stage.style.transform = `scale(${scale || 1})`;
    }

    function maxScrollTop() {
        return Math.max(0, content.scrollHeight - STAGE_HEIGHT);
    }

    function renderScroll() {
        scrollTop = Math.min(maxScrollTop(), Math.max(0, scrollTop));
        content.style.transform = `translateY(${-scrollTop}px)`;
    }

    function showMessage(text) {
        renderGeneration++;
        pendingScrollTop = null;
        content.replaceChildren();
        const message = document.createElement('div');
        message.className = 'image-prompter-message';
        message.textContent = text;
        content.append(message);
        renderScroll();
    }

    function renderCurrentImage() {
        const generation = ++renderGeneration;
        if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
            currentObjectUrl = null;
        }

        const item = lineup[currentIndex];
        if (!item || !(item.blob instanceof Blob)) {
            showMessage('No image in this block.');
            return;
        }

        currentObjectUrl = URL.createObjectURL(item.blob);
        const image = document.createElement('img');
        image.alt = item.name || `Image ${currentIndex + 1}`;
        image.draggable = false;
        image.addEventListener('load', () => {
            if (generation !== renderGeneration || content.querySelector('img') !== image) return;
            if (pendingScrollTop !== null) {
                scrollTop = pendingScrollTop;
                pendingScrollTop = null;
            }
            renderScroll();
            notifyState();
        }, { once: true });
        image.addEventListener('error', () => {
            if (generation !== renderGeneration || content.querySelector('img') !== image) return;
            showMessage('This image could not be displayed.');
            notifyState();
        }, { once: true });
        image.src = currentObjectUrl;
        content.replaceChildren(image);
        scrollTop = 0;
        renderScroll();
    }

    function setCurrentIndex(index) {
        if (!lineup.length) {
            currentIndex = 0;
            renderCurrentImage();
            notifyState();
            return;
        }
        const next = Math.min(lineup.length - 1, Math.max(0, Number(index) || 0));
        if (next === currentIndex) return;
        currentIndex = next;
        scrollTop = 0;
        pendingScrollTop = null;
        renderCurrentImage();
        notifyState();
    }

    function setPaused(nextPaused) {
        paused = Boolean(nextPaused);
        if (paused) {
            cancelAnimationFrame(animationFrame);
            animationFrame = 0;
            lastFrameTime = 0;
        } else if (!animationFrame) {
            lastFrameTime = 0;
            animationFrame = requestAnimationFrame(tick);
        }
        notifyState();
    }

    function tick(timestamp) {
        animationFrame = 0;
        if (paused) return;
        const image = content.querySelector('img');
        if (image && !image.complete) {
            lastFrameTime = timestamp;
            animationFrame = requestAnimationFrame(tick);
            notifyState();
            return;
        }
        if (lastFrameTime) scrollTop += speed * ((timestamp - lastFrameTime) / (1000 / 60));
        lastFrameTime = timestamp;
        renderScroll();
        if (scrollTop >= maxScrollTop()) {
            setPaused(true);
        } else {
            animationFrame = requestAnimationFrame(tick);
        }
        notifyState();
    }

    function applyControl(message) {
        switch (message.action) {
            case 'playPause':
                setPaused(!paused);
                break;
            case 'pause':
                setPaused(true);
                break;
            case 'previous':
                setCurrentIndex(currentIndex - 1);
                break;
            case 'next':
                setCurrentIndex(currentIndex + 1);
                break;
            case 'select':
                setCurrentIndex(message.index);
                break;
            case 'scrollBy':
                setPaused(true);
                scrollTop -= Number(message.delta) || 0;
                renderScroll();
                notifyState();
                break;
            case 'top':
                setPaused(true);
                scrollTop = 0;
                renderScroll();
                notifyState();
                break;
            case 'speed': {
                setSpeed(message.speed);
                break;
            }
            case 'speedNudge':
                nudgeSpeed(message.delta);
                break;
            default:
                break;
        }
    }

    function initialize(message) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        const shouldPause = typeof message.paused === 'boolean' ? message.paused : true;
        const requestedScrollTop = Number.isFinite(message.scrollTop) ? Math.max(0, message.scrollTop) : 0;
        lineup = Array.isArray(message.lineup) ? message.lineup : [];
        currentIndex = lineup.length
            ? Math.min(lineup.length - 1, Math.max(0, Number(message.currentIndex) || 0))
            : 0;
        const initialSpeed = Number(message.speed);
        speed = Number.isFinite(initialSpeed)
            ? Math.min(TOP_SPEED, Math.max(MIN_SPEED, initialSpeed))
            : DEFAULT_SPEED;
        scrollTop = 0;
        paused = shouldPause;
        lastFrameTime = 0;
        pendingScrollTop = requestedScrollTop;
        renderCurrentImage();
        if (!paused) animationFrame = requestAnimationFrame(tick);
        notifyState();
    }

    window.addEventListener('message', (event) => {
        if (!isOpenerMessage(event)) return;
        const message = event.data;
        if (!message || typeof message !== 'object') return;
        if (message.type === MESSAGE.init) initialize(message);
        else if (message.type === MESSAGE.control) applyControl(message);
    });

    window.addEventListener('resize', fitStage);
    stage.addEventListener('wheel', (event) => {
        if (event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        setPaused(true);
        scrollTop = Math.max(0, Math.min(maxScrollTop(), scrollTop + event.deltaY));
        renderScroll();
        notifyState();
    }, { passive: false });
    window.addEventListener('beforeunload', () => {
        cancelAnimationFrame(animationFrame);
        if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    });

    window.addEventListener('keydown', (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) { resetNavigationArrow(); return; }
        if (event.repeat && event.code !== 'ArrowUp' && event.code !== 'ArrowDown') { resetNavigationArrow(); return; }
        if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') resetNavigationArrow();
        switch (event.code) {
            case 'Space':
                event.preventDefault();
                setPaused(!paused);
                break;
            case 'ArrowLeft':
                event.preventDefault();
                if (matchNavigationArrow(event.code, event.repeat)) setCurrentIndex(currentIndex - 1);
                break;
            case 'ArrowRight':
                event.preventDefault();
                if (matchNavigationArrow(event.code, event.repeat)) setCurrentIndex(currentIndex + 1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                setPaused(true);
                scrollTop = Math.max(0, scrollTop - MANUAL_SCROLL_PX);
                renderScroll();
                notifyState();
                break;
            case 'ArrowDown':
                event.preventDefault();
                setPaused(true);
                scrollTop += MANUAL_SCROLL_PX;
                renderScroll();
                notifyState();
                break;
            case 'KeyT':
                event.preventDefault();
                setPaused(true);
                scrollTop = 0;
                renderScroll();
                notifyState();
                break;
            case 'Digit0':
                event.preventDefault();
                setPaused(true);
                break;
            case 'NumpadAdd':
                event.preventDefault();
                nudgeSpeed(0.1);
                break;
            case 'NumpadSubtract':
                event.preventDefault();
                nudgeSpeed(-0.1);
                break;
            default:
                if (/^Digit[0-9]$/.test(event.code)) {
                    event.preventDefault();
                    const digit = Number(event.code.slice(-1));
                    setSpeed(digit * 0.5);
                }
                break;
        }
    });

    fitStage();
    showMessage('Waiting for Image Lyrics…');
    sendToOpener({ type: MESSAGE.ready });
})();
