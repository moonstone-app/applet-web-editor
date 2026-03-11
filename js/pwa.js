/* ================================================================
   pwa.js — PWA helpers: Service Worker, install prompt, offline
   ================================================================ */
var PWA = (function () {
  var deferredPrompt = null;

  function init() {
    // Don't register SW inside workspace iframe
    if (EditorState.isInWorkspace) return;

    // Register Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        console.log('[PWA] SW registered, scope:', reg.scope);
      }).catch(function (e) {
        console.warn('[PWA] SW registration failed:', e);
      });
    }

    // Capture install prompt
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
    });

    // Online/offline detection
    window.addEventListener('online', function () {
      document.getElementById('statusSave').textContent = 'Online';
      App.toast('Back online');
    });
    window.addEventListener('offline', function () {
      document.getElementById('statusSave').textContent = 'Offline';
      App.toast('Offline — changes will sync when connected');
    });
  }

  function canInstall() { return !!deferredPrompt; }

  async function promptInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    var result = await deferredPrompt.userChoice;
    deferredPrompt = null;
    return result.outcome;
  }

  return { init: init, canInstall: canInstall, promptInstall: promptInstall };
})();
