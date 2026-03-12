/* ================================================================
   tree.js — File tree (left panel)
   API: getPageTree, listPages, matchPages, createPage,
        movePage, trashPage, deletePage, listTags, getTagPages
   ================================================================ */
var FileTree = (function () {
  var ms, body, filterInput, contextMenu;
  var expandedNodes = {};
  var treeCache = {};
  var contextTarget = null;
  var _loadId = 0;

  function init(_ms) {
    ms = _ms;
    body = document.getElementById('treeBody');
    filterInput = document.getElementById('treeFilter');
    contextMenu = document.getElementById('contextMenu');

    filterInput.addEventListener('input', debounce(onFilter, 200));
    body.addEventListener('click', onNodeClick);
    body.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('click', function () { hideContextMenu(); });

    contextMenu.addEventListener('click', function (e) {
      var action = e.target.closest('[data-action]');
      if (action) handleContextAction(action.dataset.action);
    });

    loadTree();
  }

  async function loadTree() {
    var currentId = ++_loadId;
    var treeData, pagesData, isFallback = false, isError = false;

    try {
      treeData = await ms.getPageTree(null, 2);
    } catch (e) {
      isFallback = true;
      try {
        pagesData = await ms.listPages();
      } catch (e2) {
        isError = true;
      }
    }

    // Prevent async race duplications
    if (currentId !== _loadId) return;
    
    body.innerHTML = '';

    if (isError) {
      body.innerHTML = '<div style="padding:16px;color:var(--ms-text-muted);font-size:.82rem">Could not load pages</div>';
    } else if (!isFallback) {
      var section = el('div', 'ed-tree-section');
      section.appendChild(el('div', 'ed-tree-section-header', '\u{1F4C1} Pages'));
      var container = el('div', '', '', 'treeNodes');
      renderNodes(treeData.tree || treeData.children || [], container, 0);
      section.appendChild(container);
      body.appendChild(section);
    } else {
      var section = el('div', 'ed-tree-section');
      section.appendChild(el('div', 'ed-tree-section-header', '\u{1F4C1} Pages'));
      var container = el('div');
      (pagesData.pages || pagesData || []).forEach(function (p) {
        var name = typeof p === 'string' ? p : (p.name || p.path || '');
        container.appendChild(makeNode(name, 0, false));
      });
      section.appendChild(container);
      body.appendChild(section);
    }

    // Favorites section
    if (EditorState.favorites.length) {
      var fav = el('div', 'ed-tree-section');
      fav.appendChild(el('div', 'ed-tree-section-header', '\u2B50 Favorites'));
      var fc = el('div');
      EditorState.favorites.forEach(function (f) { fc.appendChild(makeNode(f.name, 0, false)); });
      fav.appendChild(fc);
      body.appendChild(fav);
    }
    // Recent section
    if (EditorState.recentPages.length) {
      var rec = el('div', 'ed-tree-section');
      rec.appendChild(el('div', 'ed-tree-section-header', '\u{1F554} Recent'));
      var rc = el('div');
      EditorState.recentPages.slice(0, 10).forEach(function (r) { rc.appendChild(makeNode(r.name, 0, false)); });
      rec.appendChild(rc);
      body.appendChild(rec);
    }
    highlightActive();
  }

  function renderNodes(nodes, container, depth) {
    if (!Array.isArray(nodes)) return;
    nodes.forEach(function (n) {
      var name = n.name || n.path || '';
      var children = n.children || treeCache[name];
      var hasKids = !!(n.haschildren || (children && children.length > 0));
      container.appendChild(makeNode(name, depth, hasKids));
      if (hasKids && expandedNodes[name] && children && children.length) {
        renderNodes(children, container, depth + 1);
      }
    });
  }

  function makeNode(name, depth, hasChildren) {
    var node = el('div', 'ed-tree-node');
    node.dataset.page = name;
    node.style.paddingLeft = (8 + depth * 16) + 'px';
    var arrow = el('span', 'ed-tree-arrow');
    if (hasChildren) {
      arrow.textContent = '\u25B8';
      if (expandedNodes[name]) arrow.classList.add('expanded');
      node.dataset.hasChildren = '1';
    }
    node.appendChild(arrow);
    node.appendChild(el('span', 'ed-tree-icon', hasChildren ? '\u{1F4C1}' : '\u{1F4C4}'));
    var basename = name.indexOf(':') >= 0 ? name.split(':').pop() : name;
    node.appendChild(el('span', 'ed-tree-label', basename));
    return node;
  }

  function onNodeClick(e) {
    var node = e.target.closest('.ed-tree-node');
    if (!node) return;
    var page = node.dataset.page;
    if (node.dataset.hasChildren && e.target.closest('.ed-tree-arrow')) {
      toggleExpand(page);
      return;
    }
    if (typeof App !== 'undefined' && App.openPage) App.openPage(page);
  }

  async function toggleExpand(name) {
    if (expandedNodes[name]) {
      delete expandedNodes[name];
    } else {
      expandedNodes[name] = true;
      // Lazy load children if needed
      if (!treeCache[name]) {
        try { 
          var res = await ms.getPageTree(name, 1); 
          treeCache[name] = res.tree || res.children || [];
        } catch (_) {}
      }
    }
    loadTree();
  }

  function onFilter(e) {
    var q = filterInput.value.trim();
    if (!q) { loadTree(); return; }
    ms.matchPages(q, 20).then(function (res) {
      var matches = res.pages || res || [];
      body.innerHTML = '';
      var container = el('div');
      matches.forEach(function (p) {
        var name = typeof p === 'string' ? p : (p.name || '');
        container.appendChild(makeNode(name, 0, false));
      });
      body.appendChild(container);
    }).catch(function () {});
  }

  function onContextMenu(e) {
    var node = e.target.closest('.ed-tree-node');
    if (!node) return;
    e.preventDefault();
    contextTarget = node.dataset.page;
    contextMenu.style.display = 'block';
    contextMenu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
    contextMenu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
  }

  function hideContextMenu() { contextMenu.style.display = 'none'; }

  async function handleContextAction(action) {
    hideContextMenu();
    if (!contextTarget) return;
    switch (action) {
      case 'open':
        if (App.openPage) App.openPage(contextTarget);
        break;
      case 'new-subpage':
        var sub = prompt('Subpage name:');
        if (sub) {
          try {
            await ms.createPage(contextTarget + ':' + sub, '', EditorState.writeFormat);
            App.openPage(contextTarget + ':' + sub);
            await loadTree();
            App.toast('Page created');
          } catch (e) { App.toast('Error: ' + (e.message || e)); }
        }
        break;
      case 'rename':
        var newName = prompt('New name:', contextTarget);
        if (newName && newName !== contextTarget) {
          try {
            await ms.movePage(contextTarget, newName);
            await loadTree();
            App.toast('Page renamed');
          } catch (e) { App.toast('Error: ' + (e.message || e)); }
        }
        break;
      case 'delete':
        if (confirm('Delete "' + contextTarget + '"?')) {
          try {
            await ms.trashPage(contextTarget);
          } catch (_) {
            try { await ms.deletePage(contextTarget); } catch (e) { App.toast('Error: ' + (e.message || e)); return; }
          }
          await loadTree();
          if (EditorState.currentPage === contextTarget) {
            App.openPage(EditorState.notebook.home || 'Home');
          }
          App.toast('Page deleted');
        }
        break;
    }
  }

  function selectNode(name) {
    EditorState.currentPage = name;
    highlightActive();
  }

  function highlightActive() {
    body.querySelectorAll('.ed-tree-node').forEach(function (n) {
      n.classList.toggle('active', n.dataset.page === EditorState.currentPage);
    });
  }

  var refresh = debounce(function() {
    loadTree();
  }, 1000);

  // Helpers
  function el(tag, cls, text, id) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    if (id) e.id = id;
    return e;
  }
  function debounce(fn, ms) {
    var t; return function () {
      var a = arguments, self = this;
      clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  }

  return { init: init, refresh: refresh, selectNode: selectNode, loadTree: loadTree };
})();
