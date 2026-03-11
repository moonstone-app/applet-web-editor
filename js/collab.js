/* ================================================================
   collab.js — Real-time collaborative editing via WebSocket
   ================================================================ */
var Collab = (function () {
  var ms, ws;
  var channel = null;
  var version = 0;
  var remoteUsers = {}; // uid -> {name, color, start, end, lastSeen}
  var COLORS = ['#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#cba6f7', '#fab387', '#94e2d5', '#f2cdcd', '#74c7ec', '#eba0ac'];
  var NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Hank', 'Ivy', 'Jack'];

  var userId = 'u_' + Math.random().toString(36).slice(2, 8);
  var userColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  var userName = NAMES[Math.floor(Math.random() * NAMES.length)] + '#' + Math.floor(Math.random() * 100);

  var editTimer = null;
  var cursorTimer = null;

  var $cursorOverlay;

  async function init(_ms) {
    ms = _ms;
    $cursorOverlay = document.getElementById('cursorOverlay');

    if (!$cursorOverlay) {
       $cursorOverlay = document.createElement('div');
       $cursorOverlay.id = 'cursorOverlay';
       $cursorOverlay.className = 'ed-cursor-overlay';
       var ea = document.getElementById('editorArea');
       if (ea) ea.appendChild($cursorOverlay);
    }

    try {
      ws = await ms.connectWS();
      ws.on('connected', function() {
        if (channel) subscribe();
      });
      ws.on('broadcast', handleMessage);
      ws.on('close', function() {
        remoteUsers = {};
        renderCursors();
        updateUsersBar();
      });
      
      setInterval(function() {
         var now = Date.now();
         var changed = false;
         for (var uid in remoteUsers) {
           if (now - remoteUsers[uid].lastSeen > 5000) {
             delete remoteUsers[uid];
             changed = true;
           }
         }
         if (changed) { renderCursors(); updateUsersBar(); }
      }, 2000);

      window.addEventListener('beforeunload', function() {
        if (ws && ws.connected && channel) {
          ws.broadcast(channel, { type: 'leave', from: userId });
        }
      });
    } catch (e) {
      console.warn('WebSocket not available for collab:', e);
    }
  }

  function subscribe() {
    if (!ws || !ws.connected || !channel) return;
    ws.subscribe(channel).then(function() {
      ws.broadcast(channel, { type: 'join', from: userId, name: userName, color: userColor });
      ws.broadcast(channel, { type: 'request_sync', from: userId });
    });
  }

  function switchPage(pageName) {
    if (channel && ws && ws.connected) {
      ws.broadcast(channel, { type: 'leave', from: userId });
      ws.unsubscribe(channel);
    }
    remoteUsers = {};
    version = 0;
    renderCursors();
    updateUsersBar();

    if (!pageName) {
      channel = null;
      return;
    }
    // Prefix to avoid conflicts with other apps
    channel = 'webeditor:' + pageName;
    if (ws && ws.connected) subscribe();
  }

  function broadcastEdit(content) {
    if (!ws || !ws.connected || !channel) return;
    version++;
    clearTimeout(editTimer);
    editTimer = setTimeout(function() {
      ws.broadcast(channel, {
        type: 'edit',
        content: content,
        version: version,
        from: userId,
        name: userName
      });
    }, 150);
  }

  function broadcastCursor(start, end) {
    if (!ws || !ws.connected || !channel) return;
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(function() {
      ws.broadcast(channel, {
        type: 'cursor',
        start: start,
        end: end,
        from: userId,
        name: userName,
        color: userColor
      });
    }, 50);
  }

  function handleMessage(msg) {
    var data = msg.data;
    if (!data || data.from === userId || msg.channel !== channel) return;

    if (data.type === 'edit') {
      // Deterministic conflict resolution (Last Writer Wins with tie-breaker)
      if (data.version < version) return;
      if (data.version === version && userId > data.from) return;
      
      version = data.version;
      
      remoteUsers[data.from] = remoteUsers[data.from] || {};
      remoteUsers[data.from].name = data.name;
      remoteUsers[data.from].lastSeen = Date.now();
      
      if (window.Editor && Editor.applyRemoteEdit) {
        Editor.applyRemoteEdit(data.content);
      }
      updateUsersBar();
    }
    else if (data.type === 'cursor') {
      remoteUsers[data.from] = remoteUsers[data.from] || {};
      Object.assign(remoteUsers[data.from], {
        name: data.name,
        color: data.color,
        start: data.start,
        end: data.end,
        lastSeen: Date.now()
      });
      renderCursors();
      updateUsersBar();
    }
    else if (data.type === 'join') {
      remoteUsers[data.from] = { name: data.name, color: data.color, start: 0, end: 0, lastSeen: Date.now() };
      updateUsersBar();
      if (window.Editor && Editor.getContent) {
        setTimeout(function() {
          ws.broadcast(channel, { type: 'sync', content: Editor.getContent(), version: version, from: userId, name: userName });
        }, 500);
      }
    }
    else if (data.type === 'leave') {
      delete remoteUsers[data.from];
      renderCursors();
      updateUsersBar();
    }
    else if (data.type === 'request_sync') {
      if (window.Editor && Editor.getContent) {
        ws.broadcast(channel, { type: 'sync', content: Editor.getContent(), version: version, from: userId, name: userName });
      }
    }
    else if (data.type === 'sync') {
      if (data.version > version) {
        version = data.version;
        if (window.Editor && Editor.applyRemoteEdit) {
          Editor.applyRemoteEdit(data.content);
        }
      }
    }
  }

  function isCollaborating() {
    return Object.keys(remoteUsers).length > 0;
  }

  function getCaretCoordinates(textarea, position) {
    var mirror = document.getElementById('_caret_mirror');
    if (!mirror) {
      mirror = document.createElement('div');
      mirror.id = '_caret_mirror';
      mirror.style.cssText = 'position:absolute;top:-9999px;left:-9999px;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;';
      document.body.appendChild(mirror);
    }
    var style = getComputedStyle(textarea);
    var props = [
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 
      'lineHeight', 'textTransform', 'wordSpacing', 'textIndent', 
      'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 
      'borderWidth', 'boxSizing', 'width', 'tabSize'
    ];
    props.forEach(function(p) { mirror.style[p] = style[p]; });

    mirror.textContent = textarea.value.substring(0, position);
    var span = document.createElement('span');
    span.textContent = textarea.value.substring(position) || '.';
    mirror.appendChild(span);

    var top = span.offsetTop - textarea.scrollTop;
    var left = span.offsetLeft - textarea.scrollLeft;
    mirror.removeChild(span);
    return { top: top, left: left };
  }

  function renderCursors() {
    if (!$cursorOverlay) return;
    var textarea = document.getElementById('editorTextarea');
    if (!textarea) return;

    $cursorOverlay.innerHTML = '';
    var now = Date.now();
    for (var uid in remoteUsers) {
      var u = remoteUsers[uid];
      if (now - u.lastSeen > 5000) continue;

      try {
        var pos = getCaretCoordinates(textarea, Math.min(u.start, textarea.value.length));
        var cursor = document.createElement('div');
        cursor.className = 'ed-remote-cursor';
        cursor.style.backgroundColor = u.color;
        cursor.style.left = pos.left + 'px';
        cursor.style.top = pos.top + 'px';

        var label = document.createElement('div');
        label.className = 'ed-remote-cursor-label';
        label.style.backgroundColor = u.color;
        label.textContent = u.name;
        cursor.appendChild(label);

        $cursorOverlay.appendChild(cursor);

        if (u.start !== u.end) {
          var startPos = getCaretCoordinates(textarea, Math.min(u.start, textarea.value.length));
          var endPos = getCaretCoordinates(textarea, Math.min(u.end, textarea.value.length));
          if (startPos.top === endPos.top) {
            var sel = document.createElement('div');
            sel.className = 'ed-remote-selection';
            sel.style.backgroundColor = u.color;
            sel.style.left = Math.min(startPos.left, endPos.left) + 'px';
            sel.style.top = startPos.top + 'px';
            sel.style.width = Math.abs(endPos.left - startPos.left) + 'px';
            $cursorOverlay.appendChild(sel);
          }
        }
      } catch (e) {}
    }
  }

  function updateUsersBar() {
    var container = document.getElementById('collabUsers');
    if (!container) return;
    var count = Object.keys(remoteUsers).length;
    if (count === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }
    container.style.display = 'flex';
    var html = '<span style="margin-right:8px" title="Collaborators online">\uD83D\uDC65</span>';
    html += '<span class="ed-user-badge me" style="background:' + userColor + '" title="' + userName + ' (You)">Me</span>';
    for (var uid in remoteUsers) {
      var u = remoteUsers[uid];
      html += '<span class="ed-user-badge" style="background:' + u.color + '" title="' + u.name + '">' + u.name.split('#')[0] + '</span>';
    }
    container.innerHTML = html;
  }

  return {
    init: init,
    switchPage: switchPage,
    broadcastEdit: broadcastEdit,
    broadcastCursor: broadcastCursor,
    isCollaborating: isCollaborating,
    _suppressLocal: false
  };
})();
