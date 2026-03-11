/* ================================================================
   sidebar.js — Right panel (Backlinks, TOC, Info, Tags)
   API: getLinks, getPageTags, addTag, removeTag,
        getIntersectingTags, page TOC, page analytics
   ================================================================ */
var Sidebar = (function () {
  var ms, body, tabsEl;
  var currentTab = 'backlinks';

  function init(_ms) {
    ms = _ms;
    body = document.getElementById('sidebarBody');
    tabsEl = document.getElementById('sidebarTabs');
    tabsEl.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-tab]');
      if (!tab) return;
      currentTab = tab.dataset.tab;
      tabsEl.querySelectorAll('.ed-sidebar-tab').forEach(function (t) {
        t.classList.toggle('active', t.dataset.tab === currentTab);
      });
      refresh();
    });
  }

  async function refresh(pageName) {
    if (!pageName) pageName = EditorState.currentPage;
    if (!pageName) { body.innerHTML = '<div style="padding:16px;color:var(--ms-text-muted);font-size:.82rem">No page selected</div>'; return; }
    body.innerHTML = '<div style="padding:16px;color:var(--ms-text-muted);font-size:.82rem">Loading\u2026</div>';
    try {
      switch (currentTab) {
        case 'backlinks': await renderBacklinks(pageName); break;
        case 'toc': await renderTOC(pageName); break;
        case 'info': await renderInfo(pageName); break;
        case 'tags': await renderTags(pageName); break;
      }
    } catch (e) {
      body.innerHTML = '<div style="padding:16px;color:var(--ms-text-muted);font-size:.82rem">Failed to load</div>';
      console.warn('Sidebar error:', e);
    }
  }

  /* ── Backlinks tab ──────────────────────────────────── */
  async function renderBacklinks(page) {
    var html = '';
    // Backward links (who links to this page)
    try {
      var back = await ms.getLinks(page, 'backward');
      var backlinks = back.links || back || [];
      html += '<div class="ed-sidebar-section">';
      html += '<div class="ed-sidebar-section-title">\u21A9 Backlinks <span class="ms-badge">' + backlinks.length + '</span></div>';
      if (backlinks.length) {
        backlinks.forEach(function (l) {
          var name = typeof l === 'string' ? l : (l.source || l.name || l.href || '');
          html += '<div class="ed-backlink-item" data-page="' + esc(name) + '">';
          html += '<div class="ed-backlink-name">' + esc(name) + '</div>';
          html += '</div>';
        });
      } else {
        html += '<div style="font-size:.78rem;color:var(--ms-text-muted)">No backlinks</div>';
      }
      html += '</div>';
    } catch (_) {
      html += '<div class="ed-sidebar-section"><div style="font-size:.78rem;color:var(--ms-text-muted)">Backlinks unavailable</div></div>';
    }
    // Forward links
    try {
      var fwd = await ms.getLinks(page, 'forward');
      var forwardLinks = fwd.links || fwd || [];
      html += '<div class="ed-sidebar-section">';
      html += '<div class="ed-sidebar-section-title">\u2192 Outgoing <span class="ms-badge">' + forwardLinks.length + '</span></div>';
      forwardLinks.forEach(function (l) {
        var name = typeof l === 'string' ? l : (l.target || l.name || l.href || '');
        html += '<div class="ed-backlink-item" data-page="' + esc(name) + '">';
        html += '<div class="ed-backlink-name">' + esc(name) + '</div>';
        html += '</div>';
      });
      html += '</div>';
    } catch (_) {}
    body.innerHTML = html;
    body.querySelectorAll('[data-page]').forEach(function (el) {
      el.addEventListener('click', function () { App.openPage(el.dataset.page); });
    });
  }

  /* ── TOC tab ────────────────────────────────────────── */
  async function renderTOC(page) {
    try {
      var enc = encodeURIComponent(page).replace(/%3A/g, '/');
      var toc = await ms._get('/api/page/' + enc + '/toc');
      var headings = toc.headings || toc || [];
      if (!headings.length) {
        body.innerHTML = '<div style="padding:16px;color:var(--ms-text-muted);font-size:.82rem">No headings</div>';
        return;
      }
      var html = '<div class="ed-sidebar-section">';
      headings.forEach(function (h, i) {
        var level = h.level || 2;
        var indent = Math.max(0, level - 2) * 16;
        html += '<div class="ed-toc-item" data-index="' + i + '" style="padding-left:' + (8 + indent) + 'px">';
        html += esc(h.text || h.title || '');
        html += '</div>';
      });
      html += '</div>';
      body.innerHTML = html;
    } catch (e) {
      // Fallback: parse headings from raw content
      var lines = (EditorState.currentContent || '').split('\n');
      var html = '<div class="ed-sidebar-section">';
      lines.forEach(function (line, i) {
        var m = line.match(/^(={2,6})\s+(.+?)\s+={2,6}/);
        if (!m) m = line.match(/^(#{1,6})\s+(.+)/);
        if (m) {
          var level = m[1].length;
          var indent = Math.max(0, (level <= 6 ? level : 2) - 2) * 16;
          html += '<div class="ed-toc-item" data-line="' + i + '" style="padding-left:' + (8 + indent) + 'px">' + esc(m[2]) + '</div>';
        }
      });
      html += '</div>';
      body.innerHTML = html;
    }
  }

  /* ── Info tab ───────────────────────────────────────── */
  async function renderInfo(page) {
    var text = EditorState.currentContent || '';
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    var chars = text.length;
    var lines = text.split('\n').length;
    var readTime = (words / 200).toFixed(1);

    var html = '<div class="ed-info-grid">';
    html += infoCard('Words', words.toLocaleString());
    html += infoCard('Characters', chars.toLocaleString());
    html += infoCard('Lines', lines.toLocaleString());
    html += infoCard('Read time', readTime + ' min');

    // Try to get analytics from API
    try {
      var enc = encodeURIComponent(page).replace(/%3A/g, '/');
      var analytics = await ms._get('/api/page/' + enc + '/analytics');
      if (analytics.links_count !== undefined) html += infoCard('Links', analytics.links_count);
      if (analytics.backlinks_count !== undefined) html += infoCard('Backlinks', analytics.backlinks_count);
      if (analytics.tags_count !== undefined) html += infoCard('Tags', analytics.tags_count);
      if (analytics.images_count !== undefined) html += infoCard('Images', analytics.images_count);
    } catch (_) {}

    html += '</div>';
    body.innerHTML = html;
  }

  function infoCard(label, value) {
    return '<div class="ed-info-item"><div class="ed-info-label">' + esc(label) + '</div><div class="ed-info-value">' + esc(String(value)) + '</div></div>';
  }

  /* ── Tags tab ───────────────────────────────────────── */
  async function renderTags(page) {
    var html = '<div class="ed-sidebar-section">';
    try {
      var res = await ms.getPageTags(page);
      var tags = res.tags || res || [];
      html += '<div class="ed-sidebar-section-title" style="display:flex;align-items:center;">\u{1F3F7}\uFE0F Tags <button class="ms-btn ms-btn-sm ms-btn-ghost" id="btnManageTags" style="margin-left:auto;font-size:0.7rem;padding:2px 6px">\u2699\uFE0F Manage All</button></div>';
      html += '<div style="margin-bottom:8px">';
      tags.forEach(function (t) {
        var name = typeof t === 'string' ? t : (t.name || '');
        html += '<span class="ed-tag-item" data-tag="' + esc(name) + '">' + esc(name) +
          ' <button class="ed-tag-remove" data-remove-tag="' + esc(name) + '">\u2715</button></span>';
      });
      if (!tags.length) html += '<span style="font-size:.78rem;color:var(--ms-text-muted)">No tags</span>';
      html += '</div>';
      html += '<div style="display:flex;gap:4px">';
      html += '<input type="text" class="ms-input ms-input-sm" id="addTagInput" placeholder="Add tag\u2026" style="flex:1">';
      html += '<button class="ms-btn ms-btn-sm ms-btn-primary" id="addTagBtn">Add</button>';
      html += '</div>';
    } catch (_) {
      html += '<div style="font-size:.78rem;color:var(--ms-text-muted)">Tags unavailable</div>';
    }
    html += '</div>';
    body.innerHTML = html;

    // Add tag handler
    var addBtn = document.getElementById('addTagBtn');
    var addInput = document.getElementById('addTagInput');
    if (addBtn) {
      var doAdd = async function () {
        var tag = addInput.value.trim();
        if (!tag) return;
        try {
          await ms._post('/api/page/' + encodeURIComponent(page).replace(/%3A/g, '/') + '/tags', { tag: tag });
          App.toast('Tag added');
          renderTags(page);
        } catch (e) { App.toast('Error: ' + (e.message || e)); }
      };
      addBtn.addEventListener('click', doAdd);
      addInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') doAdd(); });
    }
    // Remove tag handlers
    body.querySelectorAll('[data-remove-tag]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var tag = btn.dataset.removeTag;
        try {
          await ms._delete('/api/page/' + encodeURIComponent(page).replace(/%3A/g, '/') + '/tags/' + encodeURIComponent(tag));
          App.toast('Tag removed');
          renderTags(page);
        } catch (e) { App.toast('Error: ' + (e.message || e)); }
      });
    });

    var manageBtn = document.getElementById('btnManageTags');
    if (manageBtn) {
      manageBtn.addEventListener('click', openTagWrangler);
    }
  }

  /* ── Tag Wrangler ───────────────────────────────────── */
  async function openTagWrangler() {
    var overlay = document.getElementById('tagWranglerOverlay');
    var tbody = document.getElementById('tagWranglerBody');
    if (!overlay || !tbody) return;
    
    overlay.style.display = 'flex';
    tbody.innerHTML = '<tr><td colspan="3" style="padding:16px;text-align:center;color:var(--ms-text-muted);">Loading tags...</td></tr>';
    
    document.getElementById('tagWranglerClose').onclick = function() { overlay.style.display = 'none'; };
    overlay.onclick = function(e) { if (e.target === overlay) overlay.style.display = 'none'; };

    try {
      var res = await ms.listTags();
      var tags = res.tags || [];
      if (!tags.length) {
         tbody.innerHTML = '<tr><td colspan="3" style="padding:16px;text-align:center;color:var(--ms-text-muted);">No tags in vault</td></tr>';
         return;
      }
      
      tbody.innerHTML = '';
      tags.forEach(function(t) {
         var tr = document.createElement('tr');
         tr.style.borderBottom = '1px solid var(--ms-border)';
         
         var tdName = document.createElement('td');
         tdName.style.padding = '8px 12px';
         tdName.innerHTML = '<span class="ed-tag-item">#' + esc(t.name) + '</span>';
         
         var tdCount = document.createElement('td');
         tdCount.style.padding = '8px 12px';
         tdCount.textContent = t.count;
         
         var tdActs = document.createElement('td');
         tdActs.style.padding = '8px 12px';
         tdActs.style.display = 'flex';
         tdActs.style.gap = '4px';
         
         var btnRen = document.createElement('button');
         btnRen.className = 'ms-btn ms-btn-sm';
         btnRen.textContent = 'Rename';
         btnRen.onclick = function() { renameGlobalTag(t.name); };
         
         var btnDel = document.createElement('button');
         btnDel.className = 'ms-btn ms-btn-sm ms-btn-ghost';
         btnDel.style.color = 'var(--ms-danger)';
         btnDel.textContent = 'Delete';
         btnDel.onclick = function() { deleteGlobalTag(t.name); };
         
         tdActs.appendChild(btnRen);
         tdActs.appendChild(btnDel);
         
         tr.appendChild(tdName);
         tr.appendChild(tdCount);
         tr.appendChild(tdActs);
         tbody.appendChild(tr);
      });
    } catch(e) {
      tbody.innerHTML = '<tr><td colspan="3" style="padding:16px;text-align:center;color:var(--ms-danger);">Failed to load tags</td></tr>';
    }
  }

  async function renameGlobalTag(oldTag) {
    var newTag = prompt('Rename tag #' + oldTag + ' to:', oldTag);
    if (!newTag || newTag === oldTag) return;
    
    newTag = newTag.replace(/^#/, '').trim();
    if (!newTag) return;
    
    try {
      var res = await ms.getTagPages(oldTag);
      var pages = res.pages || [];
      if (!pages.length) return;
      
      if (!confirm('Rename #' + oldTag + ' to #' + newTag + ' in ' + pages.length + ' pages?')) return;
      
      var operations = pages.map(function(p) {
         var pagePath = typeof p === 'string' ? p : p.name;
         return [
           { method: 'DELETE', path: '/api/page/' + ms._encodePath(pagePath) + '/tags/' + encodeURIComponent(oldTag) },
           { method: 'POST', path: '/api/page/' + ms._encodePath(pagePath) + '/tags', body: { tag: newTag } }
         ];
      }).flat();
      
      await ms.batch(operations);
      App.toast('Renamed tag in ' + pages.length + ' pages');
      openTagWrangler(); 
      if (EditorState.currentPage) refresh(EditorState.currentPage); 
    } catch(e) {
      App.toast('Error renaming: ' + e.message);
    }
  }

  async function deleteGlobalTag(tag) {
    if (!confirm('DELETE tag #' + tag + ' from ALL pages?')) return;
    try {
      var res = await ms.getTagPages(tag);
      var pages = res.pages || [];
      if (!pages.length) return;
      
      var operations = pages.map(function(p) {
         var pagePath = typeof p === 'string' ? p : p.name;
         return { method: 'DELETE', path: '/api/page/' + ms._encodePath(pagePath) + '/tags/' + encodeURIComponent(tag) };
      });
      
      await ms.batch(operations);
      App.toast('Deleted tag from ' + pages.length + ' pages');
      openTagWrangler();
      if (EditorState.currentPage) refresh(EditorState.currentPage);
    } catch(e) {
      App.toast('Error deleting: ' + e.message);
    }
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  return { init: init, refresh: refresh };
})();
