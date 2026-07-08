// PWA install-prompt capture. The browser fires `beforeinstallprompt` once, on
// load — usually long before the Settings screen mounts — so a listener added
// inside Settings misses it and the Install button never appears. We register
// the listener at module load (imported early from main.jsx), stash the event
// app-wide, and let any component subscribe.

let deferred = null;   // the saved beforeinstallprompt event, if the browser gave us one
let installed = false; // flipped once the app is installed this session
const subs = new Set();
const notify = () => subs.forEach((fn) => { try { fn(); } catch { /* ignore */ } });

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();   // stop Chrome's mini-infobar; we drive it from Settings
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

// Already running as an installed app (Android/desktop standalone, or iOS).
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export function canInstall() { return !!deferred; }
export function wasInstalled() { return installed; }
export function subscribeInstall(fn) { subs.add(fn); return () => subs.delete(fn); }

// iOS Safari never fires beforeinstallprompt — installing is manual there.
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
}

export async function promptInstall() {
  if (!deferred) return null;
  deferred.prompt();
  const choice = await deferred.userChoice.catch(() => null);
  if (choice?.outcome === 'accepted') { installed = true; }
  deferred = null; // a prompt can only be used once
  notify();
  return choice?.outcome || null;
}
