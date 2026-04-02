/**
 * Eclyrics desktop shell: main window loads the web app; prompter popups get
 * backgroundThrottling disabled so scroll animation keeps running when you
 * switch to another app or window (e.g. OBS / vMix capture).
 *
 * Run from repo root: npm run electron
 * Local dev: serve hosting on 5500 (e.g. firebase serve --only hosting -p 5500), then npm run electron:local
 *
 * On macOS you may still see harmless Chromium messages such as
 * "representedObject is not a WeakPtrToElectronMenuModelAsNSObject" or
 * task_policy_set in the terminal; they are not from app logic.
 */
const { app, BrowserWindow, powerSaveBlocker } = require('electron');

// Must run before app.ready. Without these, Chromium still throttles rAF/timers when
// the whole Electron app is in the background, even with per-window backgroundThrottling: false.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const APP_URL =
  process.env.ECLYRICS_APP_URL ||
  process.env.ECLYRICS_URL ||
  'https://eclyrics.web.app';

const LYRICS_PROMPTER = { width: 1920, height: 1080 };
const EVENT_PROMPTER_DISPLAY = { width: 900, height: 700 };

let powerSaveBlockerId = null;

function applyNoThrottling(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.setBackgroundThrottling(false);
  } catch (_) {
    /* ignore */
  }
}

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const u = details.url || '';
    const isLyricsPrompter = /\/prompter\.html(\?|$)/.test(u);
    const isEventPrompterDisplay = /\/event-prompter-display\.html(\?|$)/.test(u);

    if (isLyricsPrompter || isEventPrompterDisplay) {
      const size = isLyricsPrompter ? LYRICS_PROMPTER : EVENT_PROMPTER_DISPLAY;
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: size.width,
          height: size.height,
          backgroundColor: '#000000',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
          },
        },
      };
    }

    return { action: 'allow' };
  });

  mainWindow.webContents.on('did-create-window', (childWindow) => {
    applyNoThrottling(childWindow);
    childWindow.on('focus', () => applyNoThrottling(childWindow));
    childWindow.webContents.on('did-finish-load', () => applyNoThrottling(childWindow));
  });

  return mainWindow;
}

app.whenReady().then(() => {
  try {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } catch (_) {
    /* optional; helps reduce macOS App Nap suspending the process */
  }

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', () => {
  if (powerSaveBlockerId != null) {
    try {
      powerSaveBlocker.stop(powerSaveBlockerId);
    } catch (_) {
      /* ignore */
    }
    powerSaveBlockerId = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
