/* ================================================================
   graph.js — Classic High-Performance Force-Directed Graph
   ================================================================ */
var GraphView = (function() {
  var ms;
  var overlay, canvas, ctx;
  var width, height;
  var isVisible = false;
  var animationFrame;

  // Graph Data
  var nodes = [];
  var edges = [];
  var nodeMap = {};

  // View transform
  var transform = { x: 0, y: 0, scale: 1 };
  var targetTransform = { x: 0, y: 0, scale: 1 };

  // Interaction state
  var hoverNode = null;
  var dragNode = null;
  var isDraggingSpace = false;
  var lastMouse = { x: 0, y: 0 };
  var dragStartPos = { x: 0, y: 0 };
  var hasDraggedNode = false;

  // Physics config
  var REPULSION = 80000;
  var LINK_STRENGTH = 0.04;
  var SPRING_LENGTH = 80;
  var FRICTION = 0.7;
  var MAX_VELOCITY = 30;
  var GRAVITY = 0.002;

  // Simulated Annealing
  var alpha = 1.0;
  var ALPHA_MIN = 0.01;
  var ALPHA_DECAY = 0.98;

  // Palette
  var PALETTE = [
    '#88c8c0', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', 
    '#cba6f7', '#fab387', '#94e2d5', '#f2cdcd', '#74c7ec'
  ];
  var namespaceColors = {};

  function djb2(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return hash >>> 0;
  }

  function getColorForNamespace(ns) {
    if (!ns) return 'var(--ms-text-muted)';
    if (!namespaceColors[ns]) {
      var c = PALETTE[Object.keys(namespaceColors).length % PALETTE.length];
      namespaceColors[ns] = c;
    }
    return namespaceColors[ns];
  }

  function init(_ms) {
    ms = _ms;
    
    // Create UI overlay
    overlay = document.createElement('div');
    overlay.className = 'ms-overlay ed-graph-overlay';
    overlay.style.display = 'none';
    overlay.style.background = 'var(--ms-bg)';
    overlay.style.zIndex = '500';
    
    var closeBtn = document.createElement('button');
    closeBtn.className = 'ms-btn ms-btn-ghost';
    closeBtn.innerHTML = '\u2715 Close';
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '16px';
    closeBtn.style.right = '16px';
    closeBtn.style.zIndex = '10';
    closeBtn.style.background = 'var(--ms-surface)';
    closeBtn.onclick = close;
    
    var hint = document.createElement('div');
    hint.className = 'ed-graph-hint';
    hint.innerHTML = '\uD83D\uDCA1 Drag node to another to link. Drag to void to create new.';
    hint.style.position = 'absolute';
    hint.style.bottom = '16px';
    hint.style.left = '50%';
    hint.style.transform = 'translateX(-50%)';
    hint.style.color = 'var(--ms-text-muted)';
    hint.style.fontSize = '0.85rem';
    hint.style.zIndex = '10';
    hint.style.pointerEvents = 'none';
    hint.style.background = 'var(--ms-surface)';
    hint.style.border = '1px solid var(--ms-border)';
    hint.style.padding = '6px 16px';
    hint.style.borderRadius = 'var(--ms-radius-full)';
    hint.style.boxShadow = 'var(--ms-shadow-md)';
    
    // Mode toggle
    var toggleBox = document.createElement('div');
    toggleBox.style.position = 'absolute';
    toggleBox.style.top = '16px';
    toggleBox.style.left = '16px';
    toggleBox.style.zIndex = '10';
    
    var btnLocal = document.createElement('button');
    btnLocal.className = 'ms-btn ms-btn-sm';
    btnLocal.innerHTML = 'Local Graph';
    btnLocal.style.borderRight = 'none';
    btnLocal.style.borderTopRightRadius = '0';
    btnLocal.style.borderBottomRightRadius = '0';
    
    var btnGlobal = document.createElement('button');
    btnGlobal.className = 'ms-btn ms-btn-sm ms-btn-ghost';
    btnGlobal.innerHTML = 'Global';
    btnGlobal.style.borderTopLeftRadius = '0';
    btnGlobal.style.borderBottomLeftRadius = '0';

    var isLocalMode = true;
    btnLocal.onclick = function() {
       if (isLocalMode) return;
       isLocalMode = true;
       btnLocal.classList.remove('ms-btn-ghost');
       btnGlobal.classList.add('ms-btn-ghost');
       loadGraphData();
    };
    btnGlobal.onclick = function() {
       if (!isLocalMode) return;
       isLocalMode = false;
       btnGlobal.classList.remove('ms-btn-ghost');
       btnLocal.classList.add('ms-btn-ghost');
       loadGraphData();
    };
    
    toggleBox.appendChild(btnLocal);
    toggleBox.appendChild(btnGlobal);

    canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx = canvas.getContext('2d', { alpha: false });
    
    overlay.appendChild(canvas);
    overlay.appendChild(closeBtn);
    overlay.appendChild(hint);
    overlay.appendChild(toggleBox);
    document.body.appendChild(overlay);
    
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, {passive: false});
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
    
    var tbGroup = document.querySelector('.ed-toolbar-group');
    if (tbGroup) {
      var btn = document.createElement('button');
      btn.className = 'ed-toolbar-btn';
      btn.id = 'btnGraph';
      btn.title = 'Graph View (Ctrl+G)';
      btn.innerHTML = '\uD83D\uDD78\uFE0F';
      btn.onclick = open;
      tbGroup.insertBefore(btn, document.getElementById('btnSearch'));
    }

    GraphView._loadData = loadGraphData; // expose for toggle
    GraphView._isLocalMode = function() { return isLocalMode; };
  }

  async function open() {
    if (isVisible) return;
    isVisible = true;
    overlay.style.display = 'block';
    onResize();
    loadGraphData();
  }

  async function loadGraphData() {
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--ms-bg') || '#080c14';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    ctx.font = '16px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Mapping the web...', width/2, height/2);
    
    try {
      var data = await ms._get('/api/graph');
      buildGraph(data, GraphView._isLocalMode() ? EditorState.currentPage : null);
      
      transform.scale = 0.8;
      targetTransform.scale = 1;
      transform.x = width/2;
      transform.y = height/2;
      targetTransform.x = width/2;
      targetTransform.y = height/2;
      
      cancelAnimationFrame(animationFrame);
      runPhysicsLoop();
    } catch(e) {
      if (typeof App !== 'undefined') App.toast('Error loading graph: ' + e.message);
      close();
    }
  }

  function close() {
    isVisible = false;
    overlay.style.display = 'none';
    cancelAnimationFrame(animationFrame);
  }

  function buildGraph(data, centerPageId) {
    nodes = [];
    edges = [];
    nodeMap = {};
    alpha = 1.0;
    
    if (!data || !data.nodes) return;

    var adj = {};
    data.nodes.forEach(n => { adj[n.id] = []; });
    data.edges.forEach(e => {
        if (adj[e.source] && adj[e.target]) {
            adj[e.source].push(e.target);
            adj[e.target].push(e.source);
        }
    });

    var includedNodes = new Set();
    if (centerPageId && adj[centerPageId]) {
        var queue = [{id: centerPageId, depth: 0}];
        while(queue.length > 0) {
            var curr = queue.shift();
            if (!includedNodes.has(curr.id)) {
                includedNodes.add(curr.id);
                if (curr.depth < 2) {
                    adj[curr.id].forEach(n => queue.push({id: n, depth: curr.depth + 1}));
                }
            }
        }
    } else {
        data.nodes.forEach(n => includedNodes.add(n.id));
    }

    data.nodes.forEach(function(n) {
      if (!includedNodes.has(n.id)) return;

      var parts = n.id.split(':');
      var ns = parts.length > 1 ? parts[0] : '';
      
      // Deterministic spawn position
      var h = djb2(n.id);
      var angle = (h % 360) * (Math.PI / 180);
      var dist = 50 + (h % 300);
      
      var node = {
        id: n.id,
        label: n.label,
        ns: ns,
        color: getColorForNamespace(ns),
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        vx: 0, vy: 0,
        fx: null, fy: null, // For pinning during drag
        degree: 0,
        neighbors: new Set()
      };
      
      if (n.id === centerPageId) {
          node.x = 0; node.y = 0;
          node.isCenter = true;
      }
      
      nodes.push(node);
      nodeMap[n.id] = node;
    });
    
    if (data.edges) {
      data.edges.forEach(function(e) {
        var s = nodeMap[e.source];
        var t = nodeMap[e.target];
        if (s && t) {
          var existing = edges.find(function(ed) {
             return (ed.source === s && ed.target === t) || (ed.source === t && ed.target === s);
          });
          if (existing) {
             existing.bidir = true;
          } else {
             edges.push({ source: s, target: t, bidir: false });
             s.degree++;
             t.degree++;
             s.neighbors.add(t);
             t.neighbors.add(s);
          }
        }
      });
    }
    
    nodes.forEach(function(n) {
      n.radius = 3 + Math.sqrt(n.degree) * 1.5;
      if (n.isCenter) n.radius += 2;
    });
  }

  function runPhysicsLoop() {
    if (!isVisible) return;
    
    // Smooth transform
    transform.x += (targetTransform.x - transform.x) * 0.2;
    transform.y += (targetTransform.y - transform.y) * 0.2;
    transform.scale += (targetTransform.scale - transform.scale) * 0.2;
    
    if (alpha > ALPHA_MIN) {
      var i, j, u, v, e, dx, dy, distSq, dist, f;
      
      // 1. Repulsion
      for (i=0; i<nodes.length; i++) {
        u = nodes[i];
        for (j=i+1; j<nodes.length; j++) {
          v = nodes[j];
          var isDragging = (u === dragNode || v === dragNode);
          
          dx = v.x - u.x;
          dy = v.y - u.y;
          distSq = dx*dx + dy*dy;
          if (distSq === 0) { dx = (Math.random()-0.5); dy = (Math.random()-0.5); distSq = dx*dx+dy*dy; }
          
          if (distSq < 150000) { 
            dist = Math.sqrt(distSq);
            // Coulomb with softening
            f = (REPULSION / (distSq + 200)) * alpha;
            
            if (isDragging) {
               f = 0; // Don't repel while dragging so we can drop it on another node
            } else if (u.ns && u.ns === v.ns) {
               // Strong cluster attraction for same namespace!
               f -= (dist * 0.01) * alpha; 
            }
            
            var fx = (dx / dist) * f;
            var fy = (dy / dist) * f;
            if (u.fx === null) { u.vx -= fx; u.vy -= fy; }
            if (v.fx === null) { v.vx += fx; v.vy += fy; }
          }
        }
        
        // 2. Gravity (pull to center)
        if (u.fx === null && !u.isCenter) {
            u.vx += (0 - u.x) * GRAVITY * alpha;
            u.vy += (0 - u.y) * GRAVITY * alpha;
        }
      }
      
      // 3. Attraction (Springs)
      for (i=0; i<edges.length; i++) {
        e = edges[i];
        dx = e.target.x - e.source.x;
        dy = e.target.y - e.source.y;
        dist = Math.sqrt(dx*dx + dy*dy) || 1;
        
        f = (dist - SPRING_LENGTH) * LINK_STRENGTH * alpha;
        var fx = (dx / dist) * f;
        var fy = (dy / dist) * f;
        
        if (e.source.fx === null) { e.source.vx += fx; e.source.vy += fy; }
        if (e.target.fx === null) { e.target.vx -= fx; e.target.vy -= fy; }
      }
      
      // 4. Integration with Velocity Clamping
      for (i=0; i<nodes.length; i++) {
        u = nodes[i];
        if (u.fx !== null) {
            u.x = u.fx;
            u.y = u.fy;
            u.vx = 0;
            u.vy = 0;
            continue;
        }
        
        u.vx *= FRICTION;
        u.vy *= FRICTION;
        
        var speed = Math.sqrt(u.vx*u.vx + u.vy*u.vy);
        if (speed > MAX_VELOCITY) {
           u.vx = (u.vx / speed) * MAX_VELOCITY;
           u.vy = (u.vy / speed) * MAX_VELOCITY;
        }
        
        u.x += u.vx;
        u.y += u.vy;
      }
      
      alpha *= ALPHA_DECAY; // cool down
    }
    
    draw();
    animationFrame = requestAnimationFrame(runPhysicsLoop);
  }

  var bgCol = '#080c14';
  var txtCol = '#cdd6f4';
  var accentCol = '#88c8c0';

  function draw() {
    ctx.fillStyle = bgCol;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);
    
    var time = Date.now() / 1000;
    
    // Draw drag creation link
    if (dragNode && hasDraggedNode && dragNode !== hoverNode) {
      ctx.beginPath();
      ctx.moveTo(dragNode.x, dragNode.y);
      if (hoverNode) {
         ctx.lineTo(hoverNode.x, hoverNode.y);
         ctx.strokeStyle = accentCol;
         ctx.globalAlpha = 0.9;
      } else {
         var m = getGraphPos(lastMouse.x, lastMouse.y);
         ctx.lineTo(m.x, m.y);
         ctx.strokeStyle = txtCol;
         ctx.globalAlpha = 0.4;
      }
      ctx.lineWidth = 2 / transform.scale;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;
    }
    
    // Draw edges
    ctx.lineWidth = 1 / transform.scale;
    for (var i=0; i<edges.length; i++) {
      var e = edges[i];
      var isHighlight = hoverNode && (e.source === hoverNode || e.target === hoverNode);
      var isDimmed = hoverNode && !isHighlight;
      
      ctx.beginPath();
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);
      ctx.strokeStyle = isHighlight ? accentCol : txtCol;
      ctx.globalAlpha = isHighlight ? 0.8 : (isDimmed ? 0.05 : 0.15);
      ctx.stroke();
      
      // Data Particles
      if (isHighlight || (!hoverNode && transform.scale > 0.4)) {
         var phase;
         if (e.bidir) {
            phase = (Math.sin(time * 1.5 + i) + 1) / 2;
         } else {
            phase = (time * 0.4 + i * 0.3) % 1; 
         }
         var px = e.source.x + (e.target.x - e.source.x) * phase;
         var py = e.source.y + (e.target.y - e.source.y) * phase;
         ctx.beginPath();
         ctx.arc(px, py, isHighlight ? 2 : 1.2, 0, Math.PI*2);
         ctx.fillStyle = isHighlight ? txtCol : accentCol;
         ctx.globalAlpha = isHighlight ? 1.0 : 0.6;
         ctx.fill();
      }
    }
    ctx.globalAlpha = 1.0;
    
    // Draw nodes
    for (var i=0; i<nodes.length; i++) {
      var n = nodes[i];
      var isHover = n === hoverNode;
      var isNeighbor = hoverNode && hoverNode.neighbors.has(n);
      var isActive = isHover || isNeighbor;
      var isDimmed = hoverNode && !isActive;
      
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius + (isHover ? 2/transform.scale : 0), 0, Math.PI*2);
      
      ctx.fillStyle = n.color.startsWith('var') ? txtCol : n.color;
      ctx.globalAlpha = isDimmed ? 0.15 : 1.0;
      
      if (isActive) {
         ctx.shadowColor = ctx.fillStyle;
         ctx.shadowBlur = 15;
      } else {
         ctx.shadowBlur = 0;
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Draw Labels Smartly (Fixed screen size via inverse scaling)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowBlur = 0;

    for (var i=0; i<nodes.length; i++) {
      var n = nodes[i];
      var isHover = n === hoverNode;
      var isNeighbor = hoverNode && hoverNode.neighbors.has(n);
      var isHub = n.degree >= 4 || n.isCenter;
      var isActive = isHover || isNeighbor;
      var isDimmed = hoverNode && !isActive;
      
      var textAlpha = 0;
      if (isActive) textAlpha = 1.0;
      else if (!isDimmed) {
         if (isHub) textAlpha = 0.8;
         else if (transform.scale > 0.8) {
            textAlpha = (transform.scale - 0.8) / 0.7; // fade in from zoom 0.8 to 1.5
            if (textAlpha > 0.6) textAlpha = 0.6;
         }
      }
      
      if (textAlpha > 0.05) {
         ctx.save();
         var invScale = 1 / transform.scale;
         ctx.translate(n.x, n.y + n.radius + (4 * invScale)); 
         ctx.scale(invScale, invScale);
         
         ctx.font = (isHover ? 'bold ' : '') + '12px "Inter", "Segoe UI", sans-serif';
         ctx.globalAlpha = textAlpha;
         
         // Stroke creates an outline in the background color so text is always readable over edges
         ctx.lineWidth = 3;
         ctx.strokeStyle = bgCol;
         ctx.lineJoin = 'round';
         ctx.strokeText(n.label, 0, 0);
         
         ctx.fillStyle = txtCol;
         ctx.fillText(n.label, 0, 0);
         
         ctx.restore();
      }
    }
    
    ctx.restore();
  }
  
  function getMousePos(e) { return { x: e.clientX, y: e.clientY }; }
  function getGraphPos(mx, my) {
    return {
      x: (mx - transform.x) / transform.scale,
      y: (my - transform.y) / transform.scale
    };
  }
  
  function onMouseDown(e) {
    if (!isVisible) return;
    if (e.target.closest('.ms-btn')) return; 
    var m = getMousePos(e);
    lastMouse = m;
    dragStartPos = m;
    hasDraggedNode = false;
    
    dragNode = hoverNode;
    if (!dragNode) {
      isDraggingSpace = true;
    } else {
      // Pin the node to exactly follow mouse
      var g = getGraphPos(m.x, m.y);
      dragNode.fx = g.x;
      dragNode.fy = g.y;
      dragNode.vx = 0; dragNode.vy = 0;
    }
  }
  
  function onMouseMove(e) {
    if (!isVisible) return;
    var m = getMousePos(e);
    var g = getGraphPos(m.x, m.y);
    var dx = m.x - lastMouse.x;
    var dy = m.y - lastMouse.y;
    
    if (dragNode) {
       // Node strictly follows mouse without physics interference
       dragNode.fx = g.x;
       dragNode.fy = g.y;
       alpha = Math.max(alpha, 0.2); // warm physics so edges adjust
       
       if (Math.abs(m.x - dragStartPos.x) > 5 || Math.abs(m.y - dragStartPos.y) > 5) {
         hasDraggedNode = true;
       }
       
       // Check if dragging over another node
       var found = null;
       for (var i=nodes.length-1; i>=0; i--) {
          var n = nodes[i];
          if (n === dragNode) continue;
          var ndx = n.x - g.x;
          var ndy = n.y - g.y;
          var hitRadius = n.radius + 15 / transform.scale; 
          if (ndx*ndx + ndy*ndy <= hitRadius*hitRadius) {
             found = n;
             break;
          }
       }
       hoverNode = found; // if null, means dragging in void
    } else if (isDraggingSpace) {
       targetTransform.x += dx;
       targetTransform.y += dy;
       transform.x += dx;
       transform.y += dy;
    } else {
       var found = null;
       for (var i=nodes.length-1; i>=0; i--) {
          var n = nodes[i];
          var ndx = n.x - g.x;
          var ndy = n.y - g.y;
          var hitRadius = n.radius + 8 / transform.scale; 
          if (ndx*ndx + ndy*ndy <= hitRadius*hitRadius) {
             found = n;
             break;
          }
       }
       hoverNode = found;
       canvas.style.cursor = found ? 'pointer' : 'grab';
    }
    
    lastMouse = m;
  }
  
  async function onMouseUp(e) {
    if (!isVisible) return;
    
    if (dragNode) {
       alpha = Math.max(alpha, 0.5); // reheat to settle back
       dragNode.fx = null; // release pin
       dragNode.fy = null;
       
       if (!hasDraggedNode) {
          // Click to open
          if (typeof App !== 'undefined' && App.openPage) App.openPage(dragNode.id);
          close();
       } 
       else if (hoverNode && hoverNode !== dragNode) {
          // Drag-to-Link (existing)
          var s = dragNode.id;
          var t = hoverNode.id;
          if (!dragNode.neighbors.has(hoverNode)) {
            try {
              if (typeof App !== 'undefined') App.toast('Linking ' + dragNode.label + ' \u2192 ' + hoverNode.label + '...');
              var res = await ms.createLink(s, t);
              
              var hrefStr = res.href || t;
              var fmt = (typeof EditorState !== 'undefined' && EditorState.writeFormat) ? EditorState.writeFormat : 'wiki';
              var linkText = (fmt === 'markdown') ? '\n\n[' + hoverNode.label + '](' + hrefStr + ')' : '\n\n[[' + hrefStr + ']]';
              
              await ms.appendToPage(s, linkText, fmt);
              if (typeof App !== 'undefined') App.toast('Linked: ' + dragNode.label + ' \u2192 ' + hoverNode.label);
              
              edges.push({ source: dragNode, target: hoverNode, bidir: false });
              dragNode.neighbors.add(hoverNode);
              hoverNode.neighbors.add(dragNode);
              dragNode.degree++; hoverNode.degree++;
              alpha = 1.0; // strong reheat to layout new edge
            } catch(err) {
              if (typeof App !== 'undefined') App.toast('Link failed: ' + (err.message || err));
            }
          }
       }
       else if (hasDraggedNode && !hoverNode) {
          // Drag to Void -> Create new note
          var newName = prompt('Create new connected note named:', '');
          if (newName && newName.trim()) {
             try {
                if (typeof App !== 'undefined') App.toast('Creating note...');
                
                // Add namespace if needed
                var parts = dragNode.id.split(':');
                var ns = parts.length > 1 ? parts[0] + ':' : '';
                var finalName = newName.includes(':') ? newName : (ns + newName);
                
                // create page
                var fmt = (typeof EditorState !== 'undefined' && EditorState.writeFormat) ? EditorState.writeFormat : 'wiki';
                await ms.createPage(finalName, '', fmt);
                
                // link it
                var res = await ms.createLink(dragNode.id, finalName);
                var hrefStr = res.href || finalName;
                var linkText = (fmt === 'markdown') ? '\n\n[' + finalName.split(':').pop() + '](' + hrefStr + ')' : '\n\n[[' + hrefStr + ']]';
                
                await ms.appendToPage(dragNode.id, linkText, fmt);
                
                if (typeof App !== 'undefined') App.toast('Created & Linked!');
                
                // Just reload graph data to reflect changes
                setTimeout(loadGraphData, 300);
             } catch(err) {
                if (typeof App !== 'undefined') App.toast('Error: ' + (err.message || err));
             }
          }
       }
    }
    
    dragNode = null;
    isDraggingSpace = false;
    canvas.style.cursor = hoverNode ? 'pointer' : 'grab';
  }
  
  function onWheel(e) {
    if (!isVisible) return;
    e.preventDefault();
    var m = getMousePos(e);
    var g = getGraphPos(m.x, m.y);
    
    var zoom = e.deltaY > 0 ? 0.85 : 1.15;
    targetTransform.scale *= zoom;
    targetTransform.scale = Math.max(0.05, Math.min(targetTransform.scale, 4));
    
    targetTransform.x = m.x - g.x * targetTransform.scale;
    targetTransform.y = m.y - g.y * targetTransform.scale;
  }
  
  function onKeyDown(e) {
    if (!isVisible) return;
    if (e.key === '=' || e.key === '+') {
      zoomBy(1.2);
    } else if (e.key === '-' || e.key === '_') {
      zoomBy(0.8);
    }
  }

  function zoomBy(factor) {
    var cx = width / 2;
    var cy = height / 2;
    var gx = (cx - targetTransform.x) / targetTransform.scale;
    var gy = (cy - targetTransform.y) / targetTransform.scale;

    targetTransform.scale *= factor;
    targetTransform.scale = Math.max(0.05, Math.min(targetTransform.scale, 4));

    targetTransform.x = cx - gx * targetTransform.scale;
    targetTransform.y = cy - gy * targetTransform.scale;
  }
  
  function onResize() {
    if (!isVisible) return;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    var style = getComputedStyle(document.body);
    bgCol = style.getPropertyValue('--ms-bg').trim() || '#080c14';
    txtCol = style.getPropertyValue('--ms-text').trim() || '#cdd6f4';
    accentCol = style.getPropertyValue('--ms-accent').trim() || '#88c8c0';
  }

  function isOpen() { return isVisible; }

  return { init: init, open: open, close: close, isOpen: isOpen };
})();
