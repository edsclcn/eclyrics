const DOUBLE_CLICK_INTERVAL = 500;
const TOP_SPEED = 6.5;
const SPEED_CONTROL = 0.1;

const prompterContainer = document.getElementById("bgPrompter");
const prompterContent = document.getElementById("prompter-content");
const title = getUrlParameter('title');
let data = JSON.parse(localStorage.getItem(title));
let currentIndex = getUrlParameter('current');
let lastPressed = [0, 0];

function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === "null" ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

window.onload = function () {
    var title = getUrlParameter('title');
    if (title) document.title = title;
};

//Font size
let fontSize = sessionStorage.getItem('fontSize');
if (fontSize) prompterContent.style.fontSize = fontSize + 'px';
else prompterContent.style.fontSize = '138px';

//Prompter width
let prompterWidth = sessionStorage.getItem('prompterWidth');
if (prompterWidth) prompterContent.style.width = prompterWidth + "px";

//Scrolling
prompterContent.style.top = "0px";
let scrollingNow = false;
let animationLoop;
let scrollPosition = 0;
let scrollSpeed = 0.5;

function scrollScript() {
    scrollPosition -= scrollSpeed;
    prompterContent.style.top = scrollPosition + "px";
    animationLoop = requestAnimationFrame(scrollScript);
}

function playPauseScroll() {
    if (scrollingNow) pauseScroll();
    else playScroll();
}

function playScroll() {
    scrollingNow = true;
    scrollScript();
}

function pauseScroll() {
    cancelAnimationFrame(animationLoop);
    scrollingNow = false;
}

setText(currentIndex);

function setText(index) {
    if (scrollingNow) pauseScroll();
    scrollPosition = 0;
    prompterContent.style.top = "0px";
    prompterContent.innerHTML = data ? data[index] : '\nNo content. Close the window.';
}

//Initial theme
if (sessionStorage.getItem('prompterType') === 'LYRICS_PROMPTER') {
    prompterContainer.classList.add('lyricsPrompter');
    prompterContainer.classList.remove('blackwhite');
} else {
    prompterContainer.classList.remove('lyricsPrompter');
    prompterContainer.classList.add('blackwhite');
}

//Full Screen
function toggleFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullscreenElement) exitFullscreen();
    else requestFullscreen();
}

function requestFullscreen() {
    const body = document.documentElement;
    if (body.requestFullscreen) body.requestFullscreen();
    else if (body.webkitRequestFullscreen) body.webkitRequestFullscreen();
    else if (body.mozRequestFullscreen) body.mozRequestFullscreen();
}

function exitFullscreen() {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    else if (document.mozCancelFullscreen) document.mozCancelFullscreen();
}

//Keyboard Shortcuts
var keydownListener = function (event) {
    switch (event.code) {
        case 'Space':
            event.preventDefault();
            playPauseScroll();
            break;
        case 'Digit1':
            event.preventDefault();
            scrollSpeed = 0.5;
            break;
        case 'Digit2':
            event.preventDefault();
            scrollSpeed = 1;
            break;
        case 'Digit3':
            event.preventDefault();
            scrollSpeed = 1.5;
            break;
        case 'Digit4':
            event.preventDefault();
            scrollSpeed = 2;
            break;
        case 'Digit5':
            event.preventDefault();
            scrollSpeed = 2.5;
            break;
        case 'Digit6':
            event.preventDefault();
            scrollSpeed = 3;
            break;
        case 'Digit7':
            event.preventDefault();
            scrollSpeed = 3.5;
            break;
        case 'Digit8':
            event.preventDefault();
            scrollSpeed = 4;
            break;
        case 'Digit9':
            event.preventDefault();
            scrollSpeed = 4.5;
            break;
        case 'Digit0':
            event.preventDefault();
            pauseScroll();
            break;
        case 'KeyP':
            event.preventDefault();
            if (sessionStorage.getItem('prompterType') === 'LYRICS_PROMPTER') sessionStorage.setItem('prompterType', 'BLACK_AND_WHITE');
            else sessionStorage.setItem('prompterType', 'LYRICS_PROMPTER');
            prompterContainer.classList.toggle('lyricsPrompter');
            prompterContainer.classList.toggle('blackwhite');
            break;
        case 'ArrowUp':
            event.preventDefault();
            pauseScroll();
            scrollPosition = prompterContent.offsetTop > -50 ? 0 : scrollPosition + 50;
            prompterContent.style.top = scrollPosition + "px";
            break;
        case 'ArrowDown':
            event.preventDefault();
            pauseScroll();
            scrollPosition -= 50;
            prompterContent.style.top = scrollPosition + "px";
            break;
        case 'F11': case 'KeyF':
            event.preventDefault();
            toggleFullscreen();
            break;
        case 'Escape':
            event.preventDefault();
            exitFullscreen();
            break;
        case 'BracketLeft': case 'F8':
            event.preventDefault();
            var newSize = parseInt(window.getComputedStyle(prompterContent).fontSize) - 2;
            prompterContent.style.fontSize = newSize + 'px';
            sessionStorage.setItem('fontSize', newSize);
            break;
        case 'BracketRight': case 'F9':
            event.preventDefault();
            var newSize = parseInt(window.getComputedStyle(prompterContent).fontSize) + 2;
            prompterContent.style.fontSize = newSize + 'px';
            sessionStorage.setItem('fontSize', newSize);
            break;
        case 'Minus':
            event.preventDefault();
            var currentWidth = parseInt(window.getComputedStyle(prompterContent).width, 10) - 50;
            if (currentWidth >= screen.availWidth / 3) {
                prompterContent.style.width = currentWidth + "px";
                sessionStorage.setItem('prompterWidth', currentWidth);
            }
            break;
        case 'Equal':
            event.preventDefault();
            var currentWidth = parseInt(window.getComputedStyle(prompterContent).width, 10) + 50;
            if (currentWidth <= screen.availWidth) {
                prompterContent.style.width = currentWidth + "px";
                sessionStorage.setItem('prompterWidth', currentWidth);
            }
            break;
        case 'KeyT':
            event.preventDefault();
            if (scrollingNow) break;
            scrollPosition = 0;
            prompterContent.style.top = "0px";
            break;
        case 'NumpadSubtract':
            event.preventDefault();
            if (scrollSpeed - SPEED_CONTROL > 0) scrollSpeed -= SPEED_CONTROL;
            else pauseScroll();
            break;
        case 'NumpadAdd':
            event.preventDefault();
            if (scrollSpeed + SPEED_CONTROL <= TOP_SPEED) scrollSpeed += SPEED_CONTROL;
            if (!scrollingNow) playScroll();
            break;
        case 'ArrowLeft':
            if (isDoubleClick(0) && currentIndex > 0) setText(--currentIndex);
            break;
        case 'ArrowRight':
            if (isDoubleClick(1) && currentIndex < data.length - 1) setText(++currentIndex);
            break;
        case 'Numpad0':
            if (prompterContent.getElementsByClassName('lyricTitle').length > 0) break;
            let text = prompterContent.innerHTML.split('\n');
            text[1] = `<span class='lyricTitle'>${text[1]}</span>`;
            prompterContent.innerHTML = text.join('\n');
            data[currentIndex] = prompterContent.innerHTML;
            localStorage.setItem(title, JSON.stringify(data));
            break;
    }
};

var helpCard = document.getElementById("helpCard");
window.addEventListener('keydown', function (event) {
    if (event.key === 'Tab') {
        helpCard.style.display = "block";
        event.preventDefault();
    } else if (event.key === 'Pause') {
        if (prompterContent.contentEditable === "true") {
            prompterContent.contentEditable = "false";
            data[currentIndex] = prompterContent.innerHTML;
            localStorage.setItem(title, JSON.stringify(data));
            notEditable();
        } else {
            prompterContent.contentEditable = "true";
            Editable();
        }
        prompterContent.focus();
        event.preventDefault();
    } else if (event.key === 'PageUp' && prompterContent.contentEditable === "true") {
        showColorPicker();
        event.preventDefault();
    } else if (event.key === 'PageDown' && prompterContent.contentEditable === "true") {
        showColorPresets();
        event.preventDefault();
    }
});

window.addEventListener('keyup', function (event) {
    if (event.key === 'Tab') {
        helpCard.style.display = "none";
    }
});

//Scroll Wheel
var wheelListener = function (event) {
    if (event.ctrlKey) {
        if (event.deltaY < 0) {
            var newSize = parseInt(window.getComputedStyle(prompterContent).fontSize) + 2;
            prompterContent.style.fontSize = newSize + 'px';
            sessionStorage.setItem('fontSize', newSize);
        } else {
            var newSize = parseInt(window.getComputedStyle(prompterContent).fontSize) - 2;
            prompterContent.style.fontSize = newSize + 'px';
            sessionStorage.setItem('fontSize', newSize);
        }
    } else { //Unsure whether to enable when non editable, also the amount
        pauseScroll();
        if (event.deltaY < 0) scrollPosition = prompterContent.offsetTop > -100 ? 0 : scrollPosition + 100;
        else scrollPosition -= 100;
        prompterContent.style.top = scrollPosition + "px";
    }
};
document.addEventListener('wheel', wheelListener);

//Double click function
function isDoubleClick(type) {
    let currentTime = Date.now();
    if (currentTime - lastPressed[type] < DOUBLE_CLICK_INTERVAL) {
        lastPressed[type] = 0;
        return true;
    }

    lastPressed[type] = currentTime
    return false;
}

//Text edit states
function notEditable() {
    document.addEventListener('keydown', keydownListener);
}

function Editable() {
    document.getElementById('search-modal');
    document.removeEventListener('keydown', keydownListener);
}
notEditable();

//Colors
function showColorPicker() {
    var colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.addEventListener('change', function () { setColor(colorPicker.value); });
    colorPicker.click();
}

function showColorPresets() {
    if (document.getElementById("colorPickerPopup")) return;

    const colorPickerPopup = document.createElement("div");
    colorPickerPopup.id = "colorPickerPopup";

    //Add your colors here
    const colors = ["#ffffff", "#000000", "#ffff00", "#ff00ff", "#ff0000", "#0000FF", "#9D00FF"];
    colors.forEach(color => {
        const colorButton = document.createElement("button");
        colorButton.style.backgroundColor = color;
        colorButton.classList.add("colorButton");
        colorButton.onclick = () => {
            setColor(color);
            closeColorPresets();
        };
        colorPickerPopup.appendChild(colorButton);
    });

    document.body.appendChild(colorPickerPopup);

    document.addEventListener("click", function handleOutsideClick(event) {
        if (!colorPickerPopup.contains(event.target)) {
            closeColorPresets();
            document.removeEventListener("click", handleOutsideClick);
        }
    });
}

function closeColorPresets() {
    const colorPickerPopup = document.getElementById("colorPickerPopup");
    if (colorPickerPopup) document.body.removeChild(colorPickerPopup);
}

function setColor(color) {
    //Deprecated methods, check
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('foreColor', false, color);
    if (window.getSelection) window.getSelection().removeAllRanges();
    else if (document.selection) document.selection.empty();
}

document.addEventListener('contextmenu', event => event.preventDefault());