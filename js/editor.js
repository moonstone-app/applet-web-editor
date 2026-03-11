/* ================================================================
   editor.js — Core editor (textarea + toolbar + auto-save)
   API: getPage, savePage, patchPage, createPage, matchPages,
        uploadAttachment, listAttachments, suggestLink
   ================================================================ */
var Editor = (function () {
  var ms, textarea, preview, editorArea, formatBar, modeToggle;
  var autocompleteEl;
  var saveTimer = null;
  var acItems = [], acIndex = -1, acActive = false;

  /* ── Format wrappers per write format ────────────────── */
  var FORMATS = {
    wiki: {
      bold: ['**', '**'], italic: ['//', '//'], strikethrough: ['~~', '~~'],
      code: ["''", "''"], heading: ['== ', ' =='], link: ['[[', ']]'],
      list: ['* ', ''], checkbox: ['[ ] ', ''], image: ['{{./', '}}']
    },
    markdown: {
      bold: ['**', '**'], italic: ['*', '*'], strikethrough: ['~~', '~~'],
      code: ['`', '`'], heading: ['## ', ''], link: ['[', '](url)'],
      list: ['- ', ''], checkbox: ['- [ ] ', ''], image: ['![](', ')']
    }
  };

  function init(_ms) {
    ms = _ms;
    textarea = document.getElementById('editorTextarea');
    preview = document.getElementById('editorPreview');
    editorArea = document.getElementById('editorArea');
    formatBar = document.getElementById('formatBar');
    modeToggle = document.getElementById('modeToggle');
    autocompleteEl = document.getElementById('autocomplete');

    // Format bar actions
    formatBar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (btn) { applyFormat(btn.dataset.action); return; }
      var mode = e.target.closest('[data-mode]');
      if (mode) setMode(mode.dataset.mode);
    });

    // Typing → dirty + auto-save
    textarea.addEventListener('input', onInput);
    textarea.addEventListener('keydown', onKeyDown);
    textarea.addEventListener('click', updateCursorStatus);
    textarea.addEventListener('keyup', updateCursorStatus);

    // Drag-and-drop images
    textarea.addEventListener('dragover', function (e) { e.preventDefault(); });
    textarea.addEventListener('drop', onDrop);

    // Paste images
    textarea.addEventListener('paste', onPaste);

    // Preview: click links → navigate
    preview.addEventListener('click', onPreviewClick);

    // Listen for dirty state
    EditorState.on('dirty-changed', function (dirty) {
      var dot = document.getElementById('saveDot');
      dot.classList.toggle('dirty', dirty);
      dot.classList.toggle('saved', !dirty);
      document.getElementById('statusSave').textContent = dirty ? 'Modified' : 'Saved';
    });
  }

  function setContent(content, format) {
    textarea.value = content || '';
    EditorState.currentContent = content || '';
    EditorState.setDirty(false);
    document.getElementById('statusFormat').textContent = format || EditorState.writeFormat;
    updateWordCount();
    updateCursorStatus();
    applyMode();
  }

  function getContent() { return textarea.value; }

  /* ── Mode switching ─────────────────────────────────── */
  function setMode(mode) {
    EditorState.editorMode = mode;
    modeToggle.querySelectorAll('[data-mode]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    applyMode();
  }

  async function applyMode() {
    var mode = EditorState.editorMode;
    editorArea.classList.remove('split');
    if (mode === 'raw') {
      textarea.style.display = ''; preview.style.display = 'none';
      textarea.focus();
    } else if (mode === 'preview') {
      textarea.style.display = 'none'; preview.style.display = '';
      await renderPreview();
    } else if (mode === 'split') {
      editorArea.classList.add('split');
      textarea.style.display = ''; preview.style.display = '';
      await renderPreview();
    }
  }

  async function renderPreview() {
    if (!EditorState.currentPage) { preview.innerHTML = ''; return; }
    
    // Force save if dirty so the server renders the latest content
    if (EditorState.isDirty) {
      await save();
    }
    
    try {
      var res = await ms.getPage(EditorState.currentPage, 'html');
      var html = res.content || res.html || '';
      
      // Polyfill for Dataview and other raw code blocks in Preview
      html = html.replace(/<code>\$=\s*(.*?)<\/code>/g, function(m, code) {
         return '<span class="ed-dataview-pill" title="' + code.replace(/"/g, '"') + '">\uD83D\uDCCA dv.inline</span>';
      });
      html = html.replace(/<pre><code class="language-dataview">([\s\S]*?)<\/code><\/pre>/g, function(m, code) {
         return '<div class="ed-dataview-block">\uD83D\uDCCA <strong>Dataview Query</strong><br><span style="opacity:0.6;font-size:0.85em">' + code.replace(/\n/g, '<br>') + '</span></div>';
      });
      
      preview.innerHTML = html;
    } catch (e) {
      preview.innerHTML = '<p style="color:var(--ms-text-muted)">Preview unavailable</p>';
    }
  }

  /* ── Input handling ─────────────────────────────────── */
  function onInput() {
    if (window.Collab && Collab._suppressLocal) return;

    EditorState.setDirty(true);
    updateWordCount();
    // Wiki-link autocomplete trigger
    checkAutocomplete();
    
    // Broadcast collab edit
    if (window.Collab) Collab.broadcastEdit(textarea.value);

    // Auto-save
    if (EditorState.settings.auto_save) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { save(); }, EditorState.settings.auto_save_delay);
    }
    // Update split preview
    if (EditorState.editorMode === 'split') {
      clearTimeout(Editor._previewTimer);
      Editor._previewTimer = setTimeout(renderPreview, 600);
    }
  }

  function applyRemoteEdit(content) {
    var oldStart = textarea.selectionStart;
    var oldEnd = textarea.selectionEnd;
    var oldLen = textarea.value.length;

    if (window.Collab) Collab._suppressLocal = true;
    textarea.value = content;
    EditorState.currentContent = content;
    if (window.Collab) Collab._suppressLocal = false;

    var newLen = textarea.value.length;
    var delta = newLen - oldLen;
    textarea.selectionStart = Math.min(oldStart + (oldStart > oldLen / 2 ? delta : 0), newLen);
    textarea.selectionEnd = Math.min(oldEnd + (oldEnd > oldLen / 2 ? delta : 0), newLen);

    EditorState.setDirty(true);
    updateWordCount();
    updateCursorStatus();

    if (EditorState.editorMode === 'split') {
      clearTimeout(Editor._previewTimer);
      Editor._previewTimer = setTimeout(renderPreview, 600);
    }
  }

  function onKeyDown(e) {
    // Handle autocomplete navigation
    if (acActive) {
      if (e.key === 'ArrowDown') { e.preventDefault(); acNavigate(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); acNavigate(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); acSelect(); return; }
      if (e.key === 'Escape') { e.preventDefault(); acHide(); return; }
    }
    // Tab → indent
    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCursor(e.shiftKey ? '' : '  ');
      return;
    }
    // Alt+ArrowUp/Down — move line
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveLine(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
  }

  /* ── Format actions ─────────────────────────────────── */
  function applyFormat(action) {
    var fmt = FORMATS[EditorState.writeFormat] || FORMATS.wiki;
    var wrap = fmt[action];
    if (!wrap) return;
    var start = textarea.selectionStart, end = textarea.selectionEnd;
    var selected = textarea.value.substring(start, end) || (action === 'heading' ? 'Heading' : 'text');
    var before = wrap[0], after = wrap[1];
    // For list/checkbox — apply at line start
    if (action === 'list' || action === 'checkbox') {
      var lineStart = textarea.value.lastIndexOf('\n', start - 1) + 1;
      textarea.setSelectionRange(lineStart, lineStart);
      insertAtCursor(before);
      return;
    }
    var replacement = before + selected + after;
    textarea.setRangeText(replacement, start, end, 'end');
    textarea.focus();
    onInput();
  }

  function insertAtCursor(text) {
    var start = textarea.selectionStart;
    textarea.setRangeText(text, start, textarea.selectionEnd, 'end');
    textarea.focus();
    onInput();
  }

  function moveLine(dir) {
    var val = textarea.value;
    var pos = textarea.selectionStart;
    var lines = val.split('\n');
    var lineIdx = val.substring(0, pos).split('\n').length - 1;
    var target = lineIdx + dir;
    if (target < 0 || target >= lines.length) return;
    var tmp = lines[lineIdx];
    lines[lineIdx] = lines[target];
    lines[target] = tmp;
    textarea.value = lines.join('\n');
    // Restore cursor roughly
    var newPos = lines.slice(0, target).join('\n').length + 1;
    textarea.setSelectionRange(newPos, newPos);
    onInput();
  }

  /* ── Autocomplete ([[wiki links) ────────────────────── */
  function checkAutocomplete() {
    var pos = textarea.selectionStart;
    var before = textarea.value.substring(Math.max(0, pos - 50), pos);
    var match = before.match(/\[\[([^\]]{0,40})$/);
    if (!match) { acHide(); return; }
    var query = match[1];
    if (query.length < 1) { acHide(); return; }
    ms.matchPages(query, 8).then(function (res) {
      var pages = res.pages || res || [];
      if (!pages.length) { acHide(); return; }
      acItems = pages.map(function (p) { return typeof p === 'string' ? p : (p.name || ''); });
      acIndex = 0;
      acRender();
      acActive = true;
    }).catch(function () { acHide(); });
  }

  function acRender() {
    autocompleteEl.innerHTML = '';
    acItems.forEach(function (name, i) {
      var item = document.createElement('div');
      item.className = 'ed-autocomplete-item' + (i === acIndex ? ' selected' : '');
      item.textContent = name;
      item.addEventListener('mousedown', function (e) { e.preventDefault(); acIndex = i; acSelect(); });
      autocompleteEl.appendChild(item);
    });
    // Position near cursor
    var rect = textarea.getBoundingClientRect();
    autocompleteEl.style.left = (rect.left + 40) + 'px';
    autocompleteEl.style.top = (rect.top + 30) + 'px';
    autocompleteEl.style.display = 'block';
  }

  function acNavigate(dir) {
    acIndex = (acIndex + dir + acItems.length) % acItems.length;
    acRender();
  }

  function acSelect() {
    if (acIndex < 0 || acIndex >= acItems.length) { acHide(); return; }
    var pos = textarea.selectionStart;
    var before = textarea.value.substring(0, pos);
    var after = textarea.value.substring(pos);
    var bracketPos = before.lastIndexOf('[[');
    if (bracketPos < 0) { acHide(); return; }
    var pageName = acItems[acIndex];
    textarea.value = before.substring(0, bracketPos) + '[[' + pageName + ']]' + after;
    var newPos = bracketPos + pageName.length + 4;
    textarea.setSelectionRange(newPos, newPos);
    textarea.focus();
    acHide();
    onInput();
  }

  function acHide() {
    acActive = false;
    autocompleteEl.style.display = 'none';
    autocompleteEl.innerHTML = '';
    acItems = [];
  }

  /* ── Save ───────────────────────────────────────────── */
  async function save() {
    clearTimeout(saveTimer);
    if (!EditorState.currentPage || !EditorState.isDirty) return;
    var status = document.getElementById('statusSave');
    status.textContent = 'Saving\u2026';
    try {
      var result = await ms.savePage(
        EditorState.currentPage,
        textarea.value,
        EditorState.writeFormat,
        EditorState.currentMtime
      );
      EditorState.currentMtime = result.mtime || result.new_mtime || null;
      EditorState.currentContent = textarea.value;
      EditorState.setDirty(false);
      EditorState.lastSaveTime = Date.now();
      status.textContent = 'Saved \u2713';
    } catch (e) {
      if (e.status === 409) {
        status.textContent = 'Conflict \u26A0';
        if (confirm('Page was modified externally. Reload? (Cancel to overwrite)')) {
          var page = await ms.getPage(EditorState.currentPage, EditorState.writeFormat);
          setContent(page.content, page.format);
          EditorState.currentMtime = page.mtime;
        } else {
          // Force save without mtime check
          try {
            await ms.savePage(EditorState.currentPage, textarea.value, EditorState.writeFormat);
            EditorState.setDirty(false);
            status.textContent = 'Saved (forced) \u2713';
          } catch (e2) { status.textContent = 'Error'; }
        }
      } else {
        status.textContent = 'Error';
        console.error('Save failed:', e);
      }
    }
  }

  /* ── Drag & Drop / Paste images ─────────────────────── */
  async function onDrop(e) {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    for (var i = 0; i < e.dataTransfer.files.length; i++) {
      var file = e.dataTransfer.files[i];
      if (file.type.startsWith('image/')) await uploadAndInsert(file);
    }
  }

  async function onPaste(e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        var blob = items[i].getAsFile();
        var name = 'pasted-' + Date.now() + '.' + (blob.type.split('/')[1] || 'png');
        await uploadAndInsert(new File([blob], name, { type: blob.type }));
        return;
      }
    }
  }

  async function uploadAndInsert(file) {
    if (!EditorState.currentPage) return;
    try {
      await ms.uploadAttachment(EditorState.currentPage, file.name, file);
      var fmt = EditorState.writeFormat === 'markdown'
        ? '![](./' + file.name + ')'
        : '{{./' + file.name + '}}';
      insertAtCursor(fmt);
      App.toast('Uploaded ' + file.name);
    } catch (e) {
      App.toast('Upload failed: ' + (e.message || e));
    }
  }

  /* ── Preview clicks ─────────────────────────────────── */
  function onPreviewClick(e) {
    var a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    var href = a.getAttribute('href') || '';
    // External URLs
    if (href.startsWith('http://') || href.startsWith('https://')) {
      window.open(href, '_blank');
      return;
    }
    // Internal wiki links
    // Get current page as source context
    var sourcePage = EditorState.currentPage;
    if (!sourcePage) {
      // Fallback: try to interpret as page name directly
      var pageName = href.replace(/\.html$/, '').replace(/\//g, ':').replace(/^:/, '');
      if (pageName) App.openPage(pageName);
      return;
    }
    // Extract link text from href (href may be like 'Page Name' or 'Page%20Name')
    var linkText = decodeURIComponent(href).replace(/\.html$/, '').replace(/\//g, ':');
    // Use resolveLink API to properly resolve floating links
    ms.resolveLink(sourcePage, linkText).then(function (result) {
      var resolved = result.resolved || result;
      if (resolved) App.openPage(resolved);
    }).catch(function (err) {
      // If resolve fails, fall back to direct interpretation
      var pageName = linkText.replace(/^:/, '');
      if (pageName) App.openPage(pageName);
    });
  }

  /* ── Status helpers ─────────────────────────────────── */
  function updateWordCount() {
    var text = textarea.value.trim();
    var words = text ? text.split(/\s+/).length : 0;
    document.getElementById('statusWords').textContent = words + ' word' + (words !== 1 ? 's' : '');
  }

  function updateCursorStatus() {
    var pos = textarea.selectionStart;
    var lines = textarea.value.substring(0, pos).split('\n');
    var ln = lines.length;
    var col = lines[lines.length - 1].length + 1;
    document.getElementById('statusCursor').textContent = 'Ln ' + ln + ', Col ' + col;
    
    if (window.Collab && !Collab._suppressLocal) {
      Collab.broadcastCursor(textarea.selectionStart, textarea.selectionEnd);
    }
  }

  return {
    init: init,
    setContent: setContent,
    getContent: getContent,
    applyRemoteEdit: applyRemoteEdit,
    save: save,
    setMode: setMode,
    applyFormat: applyFormat,
    insertAtCursor: insertAtCursor,
    _previewTimer: null
  };
})();
