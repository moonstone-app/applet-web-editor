/* ================================================================
   search.js — Command Palette (Ctrl+K)
   API: search (with snippets), matchPages, getRecentChanges
   ================================================================ */
var Search = (function () {
  var ms, overlay, input, results;
  var replaceBox, replaceInput, btnReplaceAll, btnToggleReplace;
  var items = [], selectedIdx = -1;
  var searchTimer = null;
  var isReplaceMode = false;

  function init(_ms) {
    ms = _ms;
    overlay = document.getElementById('searchOverlay');
    input = document.getElementById('searchInput');
    results = document.getElementById('searchResults');
    
    replaceBox = document.getElementById('replaceBox');
    replaceInput = document.getElementById('replaceInput');
    btnReplaceAll = document.getElementById('btnReplaceAll');
    btnToggleReplace = document.getElementById('searchToggleReplace');

    input.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(doSearch, 200);
    });
    input.addEventListener('keydown', onKeyDown);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    
    if (btnToggleReplace) {
      btnToggleReplace.addEventListener('click', toggleReplaceMode);
    }
    if (btnReplaceAll) {
      btnReplaceAll.addEventListener('click', performReplaceAll);
    }
  }

  function toggleReplaceMode() {
    isReplaceMode = !isReplaceMode;
    if (replaceBox) replaceBox.style.display = isReplaceMode ? 'flex' : 'none';
    if (btnToggleReplace) btnToggleReplace.classList.toggle('ms-btn-primary', isReplaceMode);
    if (isReplaceMode) replaceInput.focus();
    else input.focus();
  }

  function open() {
    overlay.classList.add('open');
    input.value = '';
    if (replaceInput) replaceInput.value = '';
    
    isReplaceMode = false;
    if (replaceBox) replaceBox.style.display = 'none';
    if (btnToggleReplace) btnToggleReplace.classList.remove('ms-btn-primary');
    
    input.focus();
    selectedIdx = -1;
    showRecent();
  }

  function close() {
    overlay.classList.remove('open');
    results.innerHTML = '';
    items = [];
  }

  function isOpen() { return overlay.classList.contains('open'); }

  async function showRecent() {
    results.innerHTML = '';
    items = [];
    try {
      var recent = await ms.getRecentChanges(8);
      var pages = recent.pages || recent || [];
      pages.forEach(function (p) {
        var name = typeof p === 'string' ? p : (p.name || p.path || '');
        items.push(name);
      });
    } catch (_) {
      // Use state recent pages
      EditorState.recentPages.slice(0, 8).forEach(function (r) { items.push(r.name); });
    }
    renderResults('');
  }

  async function doSearch() {
    var q = input.value.trim();
    if (!q) { showRecent(); return; }
    items = [];
    selectedIdx = -1;
    // Run name match and content search in parallel
    var [nameRes, contentRes] = await Promise.allSettled([
      ms.matchPages(q, 10),
      ms.search(q)
    ]);
    // Name matches first
    if (nameRes.status === 'fulfilled') {
      var pages = nameRes.value.pages || nameRes.value || [];
      pages.forEach(function (p) {
        var name = typeof p === 'string' ? p : (p.name || '');
        if (name && items.indexOf(name) < 0) items.push(name);
      });
    }
    // Content matches
    if (contentRes.status === 'fulfilled') {
      var cPages = contentRes.value.results || contentRes.value.pages || contentRes.value || [];
      cPages.forEach(function (p) {
        var name = typeof p === 'string' ? p : (p.name || p.path || '');
        if (name && items.indexOf(name) < 0) items.push(name);
      });
    }
    renderResults(q);
  }

  function renderResults(query) {
    results.innerHTML = '';
    if (!items.length) {
      results.innerHTML = '<div style="padding:16px;color:var(--ms-text-muted);font-size:.82rem;text-align:center">' +
        (query ? 'No results' : 'No recent pages') + '</div>';
      return;
    }
    items.forEach(function (name, i) {
      var div = document.createElement('div');
      div.className = 'ed-search-item' + (i === selectedIdx ? ' selected' : '');
      var nameEl = document.createElement('div');
      nameEl.className = 'ed-search-item-name';
      nameEl.innerHTML = query ? highlightMatch(name, query) : esc(name);
      div.appendChild(nameEl);
      div.addEventListener('click', function () { selectItem(i); });
      results.appendChild(div);
    });
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
      renderResults(input.value.trim());
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      renderResults(input.value.trim());
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0 && selectedIdx < items.length) {
        selectItem(selectedIdx);
      } else if (items.length) {
        selectItem(0);
      }
    } else if (e.key === 'Escape') {
      close();
    }
  }

  function selectItem(idx) {
    if (idx < 0 || idx >= items.length) return;
    var name = items[idx];
    close();
    if (App.openPage) App.openPage(name);
  }

  function highlightMatch(text, query) {
    var html = esc(text);
    var terms = query.split(/\s+/).filter(Boolean);
    terms.forEach(function (term) {
      var re = new RegExp('(' + escRegex(term) + ')', 'gi');
      html = html.replace(re, '<mark>$1</mark>');
    });
    return html;
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  async function performReplaceAll() {
    var q = input.value;
    var r = replaceInput.value;
    if (!q) return;

    if (!confirm('Are you sure you want to replace all occurrences of "' + q + '" with "' + r + '" in the ' + items.length + ' matched files?')) {
      return;
    }

    btnReplaceAll.disabled = true;
    btnReplaceAll.textContent = 'Replacing...';

    try {
      var operations = items.map(function(m) {
        return {
          method: 'PATCH',
          path: '/api/page/' + ms._encodePath(m),
          body: {
            operations: [{ op: 'replace', search: q, replace: r }]
          }
        };
      });

      if (operations.length > 0) {
        await ms.batch(operations);
        if (typeof App !== 'undefined') App.toast('Replaced in ' + operations.length + ' files');
        
        if (items.indexOf(EditorState.currentPage) >= 0) {
          if (typeof App !== 'undefined') App.openPage(EditorState.currentPage);
        }
      } else {
        if (typeof App !== 'undefined') App.toast('No files to process');
      }
      close();
    } catch(e) {
      alert('Error during replace: ' + e.message);
    } finally {
      btnReplaceAll.disabled = false;
      btnReplaceAll.textContent = 'Replace All';
    }
  }

  return { init: init, open: open, close: close, isOpen: isOpen };
})();
