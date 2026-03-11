/* ================================================================
   state.js — Global state + KV store persistence
   ================================================================ */
var EditorState = (function () {
  var _listeners = {};
  var S = {
    ms: null,
    notebook: {},
    writeFormat: 'wiki',
    currentPage: null,
    currentContent: '',
    currentMtime: null,
    isDirty: false,
    treeVisible: true,
    sidebarVisible: false,
    editorMode: 'raw',
    settings: {
      auto_save: true,
      auto_save_delay: 800,
      editor_mode: 'raw',
      font_size: 15,
      inbox_page: 'Inbox',
      tree_width: 260
    },
    recentPages: [],
    favorites: [],
    isInWorkspace: window.parent !== window,

    async init(ms) {
      S.ms = ms;
      try {
        var nb = await ms.getNotebook();
        S.notebook = nb;
        if (nb.profile && nb.profile.default_format) {
          S.writeFormat = nb.profile.default_format;
        }
      } catch (e) { console.warn('Failed to load notebook info:', e); }
      try {
        var saved = await ms.storeGet('web-editor', 'settings');
        var sv = saved && saved.value != null ? saved.value : saved;
        if (sv && typeof sv === 'object' && !Array.isArray(sv)) Object.assign(S.settings, sv);
      } catch (_) {}
      try {
        var r = await ms.storeGet('web-editor', 'recent-pages');
        var rv = r && r.value != null ? r.value : r;
        if (Array.isArray(rv)) S.recentPages = rv.slice(0, 30);
      } catch (_) {}
      try {
        var f = await ms.storeGet('web-editor', 'favorites');
        var fv = f && f.value != null ? f.value : f;
        if (Array.isArray(fv)) S.favorites = fv;
      } catch (_) {}
      S.editorMode = S.settings.editor_mode || 'raw';
      document.documentElement.style.setProperty('--ed-font-size', S.settings.font_size + 'px');
      document.documentElement.style.setProperty('--ed-tree-width', S.settings.tree_width + 'px');
    },

    async saveSettings() {
      try { await S.ms.storePut('web-editor', 'settings', S.settings); } catch (_) {}
    },

    async addRecent(page) {
      S.recentPages = S.recentPages.filter(function (p) { return p.name !== page.name; });
      S.recentPages.unshift(page);
      if (S.recentPages.length > 30) S.recentPages.length = 30;
      try { await S.ms.storePut('web-editor', 'recent-pages', S.recentPages); } catch (_) {}
    },

    async toggleFavorite(name) {
      var idx = S.favorites.findIndex(function (f) { return f.name === name; });
      if (idx >= 0) S.favorites.splice(idx, 1);
      else S.favorites.push({ name: name, timestamp: Date.now() });
      try { await S.ms.storePut('web-editor', 'favorites', S.favorites); } catch (_) {}
      S.emit('favorites-changed');
    },

    isFavorite(name) {
      return S.favorites.some(function (f) { return f.name === name; });
    },

    setDirty(v) {
      if (S.isDirty !== v) { S.isDirty = v; S.emit('dirty-changed', v); }
    },

    on(ev, fn) {
      if (!_listeners[ev]) _listeners[ev] = [];
      _listeners[ev].push(fn);
    },

    emit(ev, data) {
      (_listeners[ev] || []).forEach(function (fn) { fn(data); });
    }
  };
  return S;
})();
