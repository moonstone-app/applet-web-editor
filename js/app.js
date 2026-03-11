/* ================================================================
   app.js — Entry point: boot, routing, global shortcuts, SSE
   ================================================================ */
var App = (function () {
  var ms;
  var backdrop, treePanel, sidebarPanel;
  var isMobile = false;

  async function boot() {
    ms = new MoonstoneBridge();

    // Init state
    await EditorState.init(ms);

    // Cache DOM refs
    backdrop = document.getElementById('backdrop');
    treePanel = document.getElementById('treePanel');
    sidebarPanel = document.getElementById('sidebarPanel');

    // Hide toolbar in workspace mode
    if (EditorState.isInWorkspace) {
      document.getElementById('toolbar').style.display = 'none';
    }

    // Init modules
    FileTree.init(ms);
    Editor.init(ms);
    Sidebar.init(ms);
    Search.init(ms);
    Capture.init(ms);
    if (window.Collab) Collab.init(ms);
    if (window.GraphView) GraphView.init(ms);
    PWA.init();

    // Wire up toolbar buttons
    document.getElementById('btnMenu').addEventListener('click', toggleTree);
    document.getElementById('btnSearch').addEventListener('click', function () { Search.open(); });
    document.getElementById('btnCapture').addEventListener('click', function () { Capture.open(); });
    document.getElementById('btnSidebar').addEventListener('click', toggleSidebar);
    document.getElementById('btnTheme').addEventListener('click', toggleTheme);
    document.getElementById('btnNewPage').addEventListener('click', showNewPageDialog);
    backdrop.addEventListener('click', closePanels);

    // New Page dialog
    var npOverlay = document.getElementById('newPageOverlay');
    document.getElementById('newPageCancel').addEventListener('click', function () { npOverlay.classList.remove('open'); });
    document.getElementById('newPageCreate').addEventListener('click', createNewPage);
    document.getElementById('newPageName').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') createNewPage();
      if (e.key === 'Escape') npOverlay.classList.remove('open');
    });
    npOverlay.addEventListener('click', function (e) { if (e.target === npOverlay) npOverlay.classList.remove('open'); });

    // Resize handles
    initResize('treeResizer', treePanel, 'width', '--ed-tree-width', false);
    initResize('sidebarResizer', sidebarPanel, 'width', '--ed-sidebar-width', true);

    // Global keyboard shortcuts
    document.addEventListener('keydown', handleShortcuts);

    // Responsive
    window.addEventListener('resize', handleResize);
    handleResize();

    // SSE events
    setupSSE();

    // Open page from URL hash or home
    var hash = window.location.hash;
    if (hash.startsWith('#page=')) {
      await openPage(decodeURIComponent(hash.slice(6)));
    } else {
      // Try to restore last page
      try {
        var last = await ms.storeGet('web-editor', 'last-page');
        var lastVal = last && last.value != null ? last.value : last;
        if (lastVal && typeof lastVal === 'string') { await openPage(lastVal); return; }
      } catch (_) {}
      await openPage(EditorState.notebook.home || 'Home');
    }
  }

  /* ── Map writeFormat to API-supported read format ──── */
  function readFormat() {
    // API supports: wiki, html, plain, markdown
    var wf = EditorState.writeFormat;
    if (wf === 'markdown' || wf === 'wiki' || wf === 'html' || wf === 'plain') return wf;
    return 'wiki';
  }

  /* ── openPage ───────────────────────────────────────── */
  async function openPage(pagePath) {
    if (!pagePath) return;
    // Ensure pagePath is a string
    if (typeof pagePath !== 'string') {
      pagePath = pagePath.name || pagePath.value || String(pagePath);
    }
    // Save current dirty content first
    if (EditorState.isDirty && EditorState.currentPage) {
      await Editor.save();
    }
    try {
      var page = await ms.getPage(pagePath, readFormat());
      EditorState.currentPage = page.name || pagePath;
      EditorState.currentContent = page.content || '';
      EditorState.currentMtime = page.mtime || null;
      Editor.setContent(page.content, page.format || EditorState.writeFormat);
      
      if (window.Collab) Collab.switchPage(EditorState.currentPage);
      
      Sidebar.refresh(EditorState.currentPage);
      FileTree.selectNode(EditorState.currentPage);
      // Update title
      var title = page.title || page.basename || pagePath.split(':').pop();
      document.getElementById('pageTitle').textContent = title;
      document.title = title + ' — Moonstone Editor';
      // Update URL
      window.location.hash = '#page=' + encodeURIComponent(EditorState.currentPage);
      // Add to recent
      EditorState.addRecent({ name: EditorState.currentPage, title: title, timestamp: Date.now() });
      // Save last page
      try { await ms.storePut('web-editor', 'last-page', EditorState.currentPage); } catch (_) {}
      // Close mobile panels
      if (isMobile) closePanels();
    } catch (e) {
      if (e.status === 404) {
        if (confirm('Page "' + pagePath + '" not found. Create it?')) {
          try {
            await ms.createPage(pagePath, '', EditorState.writeFormat);
            await openPage(pagePath);
            FileTree.loadTree();
          } catch (e2) { toast('Error: ' + (e2.message || e2)); }
        }
      } else {
        toast('Error loading page: ' + (e.message || e));
      }
    }
  }

  /* ── Tree / Sidebar toggles ─────────────────────────── */
  function toggleTree() {
    if (isMobile) {
      treePanel.classList.toggle('open');
      sidebarPanel.classList.remove('open');
      backdrop.classList.toggle('active', treePanel.classList.contains('open'));
    } else {
      EditorState.treeVisible = !EditorState.treeVisible;
      treePanel.style.display = EditorState.treeVisible ? '' : 'none';
      document.getElementById('treeResizer').style.display = EditorState.treeVisible ? '' : 'none';
    }
  }

  function toggleSidebar() {
    if (isMobile) {
      sidebarPanel.classList.toggle('open');
      treePanel.classList.remove('open');
      backdrop.classList.toggle('active', sidebarPanel.classList.contains('open'));
    } else {
      EditorState.sidebarVisible = !EditorState.sidebarVisible;
      sidebarPanel.classList.toggle('open', EditorState.sidebarVisible);
      document.getElementById('sidebarResizer').style.display = EditorState.sidebarVisible ? '' : 'none';
    }
    if (sidebarPanel.classList.contains('open')) Sidebar.refresh();
  }

  function closePanels() {
    treePanel.classList.remove('open');
    sidebarPanel.classList.remove('open');
    backdrop.classList.remove('active');
  }

  /* ── Theme toggle ───────────────────────────────────── */
  function toggleTheme() {
    var html = document.documentElement;
    var current = html.getAttribute('data-theme') || 'dark';
    var next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('ms-editor-theme', next);
  }

  /* ── New page dialog ────────────────────────────────── */
  function showNewPageDialog() {
    var overlay = document.getElementById('newPageOverlay');
    overlay.classList.add('open');
    var input = document.getElementById('newPageName');
    input.value = '';
    input.focus();
  }

  async function createNewPage() {
    var input = document.getElementById('newPageName');
    var name = input.value.trim();
    if (!name) return;
    document.getElementById('newPageOverlay').classList.remove('open');
    try {
      await ms.createPage(name, '', EditorState.writeFormat);
      toast('Page created');
      FileTree.loadTree();
      await openPage(name);
    } catch (e) {
      toast('Error: ' + (e.message || e));
    }
  }

  /* ── Keyboard shortcuts ─────────────────────────────── */
  function handleShortcuts(e) {
    var ctrl = e.ctrlKey || e.metaKey;
    // Escape → close overlays
    if (e.key === 'Escape') {
      if (Search.isOpen()) { Search.close(); e.preventDefault(); return; }
      if (Capture.isOpen()) { Capture.close(); e.preventDefault(); return; }
      var np = document.getElementById('newPageOverlay');
      if (np.classList.contains('open')) { np.classList.remove('open'); e.preventDefault(); return; }
      closePanels();
      return;
    }
    if (!ctrl) return;
    switch (e.key.toLowerCase()) {
      case 's':
        e.preventDefault(); Editor.save(); break;
      case 'k':
        e.preventDefault(); Search.open(); break;
      case 'f':
        if (e.shiftKey) { e.preventDefault(); Search.open(true); }
        break;
      case 'n':
        e.preventDefault(); Capture.open(); break;
      case '/':
        e.preventDefault(); toggleSidebar(); break;
      case '\\':
        e.preventDefault(); toggleTree(); break;
      case 'b':
        if (document.activeElement === document.getElementById('editorTextarea')) {
          e.preventDefault(); Editor.applyFormat('bold');
        } else {
          e.preventDefault(); toggleTree();
        }
        break;
      case 'g':
        e.preventDefault();
        if (window.GraphView) {
          if (GraphView.isOpen()) GraphView.close();
          else GraphView.open();
        }
        break;
      case 'i':
        if (document.activeElement === document.getElementById('editorTextarea')) {
          e.preventDefault(); Editor.applyFormat('italic');
        }
        break;
      case 'l':
        if (document.activeElement === document.getElementById('editorTextarea')) {
          e.preventDefault(); Editor.applyFormat('link');
        }
        break;
      case 'p':
        if (e.shiftKey) {
          e.preventDefault();
          var modes = ['raw', 'preview', 'split'];
          var cur = modes.indexOf(EditorState.editorMode);
          Editor.setMode(modes[(cur + 1) % modes.length]);
        }
        break;
    }
  }

  /* ── Responsive ─────────────────────────────────────── */
  function handleResize() {
    isMobile = window.innerWidth < 769;
    if (isMobile) {
      treePanel.style.display = '';
      document.getElementById('treeResizer').style.display = 'none';
      document.getElementById('sidebarResizer').style.display = 'none';
    } else {
      treePanel.classList.remove('open');
      backdrop.classList.remove('active');
      
      treePanel.style.display = EditorState.treeVisible ? '' : 'none';
      document.getElementById('treeResizer').style.display = EditorState.treeVisible ? '' : 'none';
      
      // Preserve sidebar state using EditorState
      sidebarPanel.classList.toggle('open', !!EditorState.sidebarVisible);
      document.getElementById('sidebarResizer').style.display = EditorState.sidebarVisible ? '' : 'none';
    }
  }

  /* ── SSE ─────────────────────────────────────────────── */
  function setupSSE() {
    try {
      ms.on('page-saved', function (data) {
        var page = data.page || data.name || '';
        if (page === EditorState.currentPage) {
          // Check if this is likely an echo of our own save (since backend might not send data.mtime)
          var isOwnSave = false;
          if (data.mtime && data.mtime === EditorState.currentMtime) isOwnSave = true;
          if (EditorState.lastSaveTime && (Date.now() - EditorState.lastSaveTime < 2000)) isOwnSave = true;

          if (isOwnSave) {
            // Do nothing, so the cursor doesn't jump
          } 
          else if (window.Collab && Collab.isCollaborating()) {
            // If actively collaborating, text is synced via WS, just accept new mtime
            EditorState.currentMtime = data.mtime;
          } 
          else if (!EditorState.isDirty) {
            // External save and we are NOT collaborating/dirty -> reload text
            ms.getPage(page, readFormat()).then(function (p) {
              Editor.setContent(p.content, p.format);
              EditorState.currentMtime = p.mtime;
            }).catch(function () {});
          }
        }
        
        if (page) {
          // Only refresh the tree if the page doesn't exist in it (i.e. newly created)
          try {
            var exists = document.querySelector('.ed-tree-node[data-page="' + CSS.escape(page) + '"]');
            if (!exists) FileTree.refresh();
          } catch(e) {
            FileTree.refresh();
          }
        } else {
          FileTree.refresh();
        }
      });
      ms.on('page-deleted', function (data) {
        var page = data.page || data.name || '';
        if (page === EditorState.currentPage) {
          openPage(EditorState.notebook.home || 'Home');
        }
        FileTree.refresh();
      });
      ms.on('page-moved', function () { FileTree.refresh(); });
    } catch (e) {
      console.warn('[App] SSE setup failed:', e);
    }
  }

  /* ── Resize handles ─────────────────────────────────── */
  function initResize(handleId, panel, prop, cssVar, fromRight) {
    var handle = document.getElementById(handleId);
    if (!handle) return;
    var startX, startW;
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      startX = e.clientX;
      startW = panel.getBoundingClientRect().width;
      handle.classList.add('dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    function onMove(e) {
      var dx = e.clientX - startX;
      var newW = fromRight ? startW - dx : startW + dx;
      newW = Math.max(180, Math.min(newW, 500));
      panel.style.width = newW + 'px';
      document.documentElement.style.setProperty(cssVar, newW + 'px');
    }
    function onUp() {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
  }

  /* ── Toast ──────────────────────────────────────────── */
  function toast(msg) {
    var container = document.getElementById('toastContainer');
    var t = document.createElement('div');
    t.className = 'ms-toast';
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(function () { t.remove(); }, 2500);
  }

  // Boot on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return { openPage: openPage, toast: toast };
})();
