/* ================================================================
   capture.js — Quick Capture (Ctrl+N)
   API: appendToPage, createPage
   ================================================================ */
var Capture = (function () {
  var ms, overlay, textEl;

  function init(_ms) {
    ms = _ms;
    overlay = document.getElementById('captureOverlay');
    textEl = document.getElementById('captureText');
    document.getElementById('captureCancel').addEventListener('click', close);
    document.getElementById('captureSave').addEventListener('click', save);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    textEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    });
  }

  function open() {
    overlay.classList.add('open');
    textEl.value = '';
    textEl.focus();
  }

  function close() {
    overlay.classList.remove('open');
    textEl.value = '';
  }

  function isOpen() { return overlay.classList.contains('open'); }

  async function save() {
    var text = textEl.value.trim();
    if (!text) { close(); return; }
    var inbox = EditorState.settings.inbox_page || 'Inbox';
    var fmt = EditorState.writeFormat;
    var sep = fmt === 'markdown' ? '\n---\n' : '\n----\n';
    var now = new Date();
    var ts = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
      ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    var entry = sep + '**' + ts + '** \u2014 ' + text + '\n';
    try {
      await ms.appendToPage(inbox, entry, fmt);
      App.toast('Saved to ' + inbox);
    } catch (e) {
      // Page might not exist, create it
      try {
        await ms.createPage(inbox, entry, fmt);
        App.toast('Created ' + inbox + ' and saved');
      } catch (e2) {
        App.toast('Error: ' + (e2.message || e2));
      }
    }
    close();
    FileTree.refresh();
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  return { init: init, open: open, close: close, isOpen: isOpen };
})();
