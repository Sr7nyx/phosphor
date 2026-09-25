/* ==========================================================
   PHOSPHOR — portfolio runtime
   No dependencies. No network calls. No storage.
   ========================================================== */
(function () {
  'use strict';

  // Honour the visitor's motion preference unless <html data-motion="force">
  // is set, in which case everyone sees the same thing. Single switch, in
  // index.html - see the comment on the <html> tag.
  var FORCE_MOTION = document.documentElement.getAttribute('data-motion') === 'force';
  var REDUCE = !FORCE_MOTION && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var COARSE = matchMedia('(pointer: coarse)').matches;


  /* ========================================================
     0. THEME
        amber | green | ice. Rotates on each visit; click a
        name to override for this session. No storage (strict
        CSP), so 'each visit' is exactly what you get.
     ======================================================== */
  (function theme() {
    var mount = document.getElementById('theme');
    var THEMES = [
      { id: 'amber', label: 'amber',  tint: [1.0, 0.615, 0.10] },
      { id: 'green', label: 'green',  tint: [0.23, 0.91, 0.42] },
      { id: 'ice',   label: 'ice',    tint: [0.23, 0.85, 1.0]  }
    ];

    function apply(id) {
      var t = THEMES.filter(function (x) { return x.id === id; })[0] || THEMES[0];
      if (t.id === 'amber') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', t.id);
      if (window.__setFieldTint) window.__setFieldTint(t.tint[0], t.tint[1], t.tint[2]);
      if (mount) [].forEach.call(mount.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.id === t.id));
      });
    }

    // rotate per visit: step an index kept only in the URL hash-free way -
    // derive from a lightweight rotating value so consecutive loads differ.
    var order = ['amber', 'green', 'ice'];
    var pick = order[Math.floor(Math.random() * order.length)];
    window.__reapplyTheme = function () { apply(pick); };

    if (mount) {
      THEMES.forEach(function (t, i) {
        if (i) { var s = document.createElement('span'); s.className = 'sep'; s.textContent = '/'; mount.appendChild(s); }
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = t.label; b.dataset.id = t.id;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function () { apply(t.id); });
        mount.appendChild(b);
      });
    }
    apply(pick);
  })();

  /* ========================================================
     1. SCAN FIELD — WebGL2, three passes
        A scene   : perspective lattice + travelling scan sweep
        B persist : accum = max(scene, prev * decay)  [phosphor]
        C present : barrel curve, halation, grille, noise
     ======================================================== */
  (function scanField() {
    var cv = document.getElementById('field');
    if (!cv) return;

    var gl = cv.getContext('webgl2', {
      antialias: false, alpha: true, premultipliedAlpha: false,
      depth: false, stencil: false, powerPreference: 'low-power',
      failIfMajorPerformanceCaveat: false
    });
    if (!gl) return;                     // CSS glass layer still carries the look

    var VERT = ['#version 300 es',
      'in vec2 a; out vec2 v;',
      'void main(){ v = a*0.5+0.5; gl_Position = vec4(a,0.,1.); }'].join('\n');

    var SCENE = ['#version 300 es',
      'precision highp float;',
      'in vec2 v; out vec4 o;',
      'uniform vec2 uRes; uniform float uT; uniform float uVel; uniform float uFx;',
      'uniform float uDense; uniform float uSweep; uniform float uHoriz;',
      'uniform vec4 uSeg[30]; uniform float uSegN; uniform float uWire;',
      'float segDist(vec2 p, vec2 a, vec2 b){',
      '  vec2 pa = p - a, ba = b - a;',
      '  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);',
      '  return length(pa - ba * h);',
      '}',
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }',
      'void main(){',
      '  vec2 p = (gl_FragCoord.xy - 0.5*uRes) / uRes.y;',
      '  float horizon = uHoriz;',
      '  float I = 0.0;',
      '  float scroll = uT * 0.55;',
      '  float beamRate = (7.0 + (uFx > 1.5 && uFx < 2.5 ? uVel * 26.0 : 0.0)) * uSweep;',
      '  float sweepZ = scroll + mod(uT * beamRate, 62.0) + 1.5;',
      '  if(p.y < horizon){',
      '    float d = 1.0 / (horizon - p.y);',
      '    vec2  g = vec2(p.x * d * 0.9, d + scroll) * uDense;',
      '    float fade = exp(-d * 0.055) * 0.95;',
      '    vec2  fr = abs(fract(g) - 0.5);',
      '    float lw = 0.014 + d * 0.0016;',
      '    float grid = max(smoothstep(lw, 0.0, fr.x), smoothstep(lw, 0.0, fr.y));',
      '    I += grid * fade * 0.42;',
      '    vec2  cell = floor(g);',
      '    vec2  lp   = fract(g) - 0.5;',
      '    float h    = hash(cell);',
      '    if(h > 0.855){',
      '      float node = smoothstep(0.085, 0.005, length(lp));',
      '      float idle = 0.45 + 0.35 * sin(uT * 2.2 + h * 40.0);',
      '      float dz   = cell.y + 0.5 - sweepZ;',
      '      float lit  = exp(-dz * dz * 0.7);',
      '      I += node * fade * (idle + lit * 4.2);',
      '    }',
      '    float dzb = g.y - sweepZ;',
      '    I += exp(-dzb * dzb * 1.1)  * fade * 0.85;',
      '    I += exp(-dzb * dzb * 0.06) * fade * 0.10;',
      '  }',
      '  I += exp(-abs(p.y - horizon) * 26.0) * 0.30;',
      '  for(int i = 0; i < 7; i++){',
      '    float fi = float(i);',
      '    vec2 mp = vec2(',
      '      fract(hash(vec2(fi, 7.0)) + uT * (0.006 + fi * 0.0015)) * 2.0 - 1.0,',
      '      horizon + 0.04 + hash(vec2(fi, 19.0)) * 0.34);',
      '    mp.x *= uRes.x / uRes.y * 0.5;',
      '    I += smoothstep(0.006, 0.0, length(p - mp)) * 0.5;',
      '  }',
      '  if(uWire > 0.01){',
      '    float w = 0.0;',
      '    for(int i = 0; i < 30; i++){',
      '      if(float(i) >= uSegN) break;',
      '      vec4 sg = uSeg[i];',
      '      float d = segDist(p, sg.xy, sg.zw);',
      '      w += smoothstep(0.0055, 0.0, d) * 0.85;',
      '      w += smoothstep(0.030, 0.0, d) * 0.10;',
      '    }',
      '    I += w * uWire;',
      '  }',
      '  o = vec4(vec3(I), 1.0);',
      '}'].join('\n');

    var PERSIST = ['#version 300 es',
      'precision highp float;',
      'in vec2 v; out vec4 o;',
      'uniform sampler2D uScene, uPrev; uniform float uDecay;',
      'void main(){',
      '  float s = texture(uScene, v).r;',
      '  float p = texture(uPrev , v).r * uDecay;',
      '  o = vec4(vec3(max(s, p)), 1.0);',
      '}'].join('\n');

    var PRESENT = ['#version 300 es',
      'precision highp float;',
      'in vec2 v; out vec4 o;',
      'uniform sampler2D uTex; uniform vec2 uRes; uniform float uT; uniform float uVel; uniform float uFx;',
      'uniform vec3 uTint;',
      'vec2 curve(vec2 uv, float k){',
      '  uv = uv * 2.0 - 1.0;',
      '  vec2 off = abs(uv.yx) / vec2(7.0, 5.5);',
      '  uv += uv * off * off * k;',
      '  return uv * 0.5 + 0.5;',
      '}',
      'float samp(vec2 uv){',
      '  if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;',
      '  return texture(uTex, uv).r;',
      '}',
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.99, 78.23))) * 43758.5453); }',
      'void main(){',
      '  vec2 vv = v;',
      '  if(uFx > 2.5){',                                   // sync-tear
      '    float band = step(0.5, fract(vv.y * 3.0 - uT * 1.3));',
      '    float tear = uVel * uVel * 0.18 * band;',
      '    vv.x = fract(vv.x + tear);',
      '  }',
      '  float r = samp(curve(vv, 1.02));',
      '  float g = samp(curve(vv, 1.00));',
      '  float b = samp(curve(vv, 0.98));',
      '  vec3  c = vec3(r, g, b);',
      '  vec2 uv = curve(vv, 1.0);',
      '  vec2 px = 2.5 / uRes;',
      '  float bl = 0.0;',
      '  bl += samp(uv + vec2( px.x, 0.0));',
      '  bl += samp(uv + vec2(-px.x, 0.0));',
      '  bl += samp(uv + vec2( 0.0, px.y));',
      '  bl += samp(uv + vec2( 0.0,-px.y));',
      '  bl += samp(uv + px * 3.0);',
      '  bl += samp(uv - px * 3.0);',
      '  c += bl * 0.11;',
      '  float vb = (uFx > 0.5 && uFx < 1.5) ? uVel : 0.0;',
      '  vec3 col = c * uTint * (1.0 + vb * 0.55);',
      '  col += pow(max(c.g - 0.75, 0.0), 2.0) * vec3(0.6, 0.55, 0.42);',
      '  col *= 0.80 + 0.20 * sin(gl_FragCoord.x * 2.09);',
      '  col *= 0.86 + 0.14 * sin(gl_FragCoord.y * 3.14159);',
      '  col += (hash(gl_FragCoord.xy + fract(uT) * 91.7) - 0.5) * (0.030 + vb * 0.05);',
      '  col *= 1.0 - vb * 0.10 * sin(gl_FragCoord.y * 0.7 + uT * 40.0);',
      '  float vg = pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.22);',
      '  col *= clamp(vg, 0.0, 1.0);',
      '  o = vec4(max(col, 0.0), 1.0);',
      '}'].join('\n');

    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(s));
      return s;
    }
    function prog(frag) {
      var p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.warn(gl.getProgramInfoLog(p));
      return p;
    }

    var pScene = prog(SCENE), pPers = prog(PERSIST), pPres = prog(PRESENT);
    var U = {
      sceneRes: gl.getUniformLocation(pScene, 'uRes'),
      sceneT:   gl.getUniformLocation(pScene, 'uT'),
      sceneVel: gl.getUniformLocation(pScene, 'uVel'),
      sceneFx:  gl.getUniformLocation(pScene, 'uFx'),
      sceneDen: gl.getUniformLocation(pScene, 'uDense'),
      sceneSwp: gl.getUniformLocation(pScene, 'uSweep'),
      sceneHor: gl.getUniformLocation(pScene, 'uHoriz'),
      sceneSeg: gl.getUniformLocation(pScene, 'uSeg'),
      sceneSgN: gl.getUniformLocation(pScene, 'uSegN'),
      sceneWir: gl.getUniformLocation(pScene, 'uWire'),
      persS:    gl.getUniformLocation(pPers, 'uScene'),
      persP:    gl.getUniformLocation(pPers, 'uPrev'),
      persD:    gl.getUniformLocation(pPers, 'uDecay'),
      presTex:  gl.getUniformLocation(pPres, 'uTex'),
      presRes:  gl.getUniformLocation(pPres, 'uRes'),
      presT:    gl.getUniformLocation(pPres, 'uT'),
      presTint: gl.getUniformLocation(pPres, 'uTint'),
      presVel:  gl.getUniformLocation(pPres, 'uVel'),
      presFx:   gl.getUniformLocation(pPres, 'uFx')
    };

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    function target(w, h) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { t: t, f: f };
    }
    function drop(x) { if (!x) return; gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); }

    /* Adaptive quality. Phones throttle hard; measure and back off
       rather than shipping one fixed resolution to every device. */
    // section-aware field: the tube behaves differently per section
    var MODE  = { dense: 1.0, sweep: 1.0, horiz: 0.10 };   // live, lerped
    var TARGET= { dense: 1.0, sweep: 1.0, horiz: 0.10 };
    var SECTIONS = {
      'hero':         { dense: 1.00, sweep: 1.00, horiz: 0.10 },
      'findings-sec': { dense: 1.55, sweep: 0.70, horiz: 0.07 },
      'skills-sec':   { dense: 1.25, sweep: 1.20, horiz: 0.12 },
      'trace-sec':    { dense: 0.80, sweep: 0.42, horiz: 0.03 },
      'replay-sec':   { dense: 2.00, sweep: 1.60, horiz: 0.05 }
    };
    (function watchSections(){
      var ids = Object.keys(SECTIONS);
      function pickSection(){
        var vh = innerHeight || 800, best = null, bestArea = 0;
        ids.forEach(function(id){
          var el = document.getElementById(id); if (!el) return;
          var r = el.getBoundingClientRect();
          var vis = Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top));
          if (vis > bestArea) { bestArea = vis; best = id; }
        });
        if (best) TARGET = SECTIONS[best];
      }
      addEventListener('scroll', pickSection, { passive: true });
      addEventListener('resize', pickSection, { passive: true });
      pickSection();
    })();

    /* Vector solid: an icosahedron stroked as line segments and drawn
       INTO the scene pass, so it decays and blooms through the same
       phosphor pipeline as everything else. Tektronix, not Three.js. */
    var PHI = (1 + Math.sqrt(5)) / 2;
    var VERTS = [], EDGES = [];
    (function buildIco(){
      var raw = [];
      [-1,1].forEach(function(a){ [-PHI,PHI].forEach(function(b){
        raw.push([0,a,b]); raw.push([a,b,0]); raw.push([b,0,a]);
      });});
      // dedupe + normalise
      var seen = {};
      raw.forEach(function(v){
        var k = v.map(function(n){ return n.toFixed(4); }).join(',');
        if (seen[k]) return; seen[k] = 1;
        var L = Math.hypot(v[0], v[1], v[2]);
        VERTS.push([v[0]/L, v[1]/L, v[2]/L]);
      });
      // shortest pairwise distance defines an edge
      var min = Infinity, D = [];
      for (var i = 0; i < VERTS.length; i++) for (var j = i+1; j < VERTS.length; j++) {
        var d = Math.hypot(VERTS[i][0]-VERTS[j][0], VERTS[i][1]-VERTS[j][1], VERTS[i][2]-VERTS[j][2]);
        D.push([i,j,d]); if (d < min) min = d;
      }
      D.forEach(function(e){ if (e[2] < min * 1.05) EDGES.push([e[0], e[1]]); });
    })();
    var SEG = new Float32Array(30 * 4);
    var WIRE_ON = 1;

    function projectWire(t) {
      var cy = Math.cos(t * 0.23), sy = Math.sin(t * 0.23);
      var cx = Math.cos(t * 0.17), sx = Math.sin(t * 0.17);
      var asp = W / Math.max(H, 1);
      var cxp = asp * 0.30, cyp = 0.26;               // sits upper-right of centre
      var R = 0.115 + Math.sin(t * 0.7) * 0.004;      // slight breathe
      var n = Math.min(EDGES.length, 30);
      for (var i = 0; i < n; i++) {
        for (var k = 0; k < 2; k++) {
          var v = VERTS[EDGES[i][k]];
          var x = v[0]*cy + v[2]*sy, z = -v[0]*sy + v[2]*cy;
          var y = v[1]*cx - z*sx;   z = v[1]*sx + z*cx;
          var pz = 1 / (2.6 - z);                     // weak perspective
          SEG[i*4 + k*2]     = cxp + x * R * pz * 2.4;
          SEG[i*4 + k*2 + 1] = cyp + y * R * pz * 2.4;
        }
      }
      return n;
    }

    var VEL = 0;                 // smoothed scroll velocity, 0..1
    var VEL_RAW = 0;             // last frame's target
    var FX = 1;                  // 1 velocity-bloom | 2 beam-rate | 3 sync-tear | 0 off
    window.__setFieldFx = function (n) { FX = n | 0; };
    (function scrollVel(){
      var lastY = window.pageYOffset || 0, lastT = performance.now();
      addEventListener('scroll', function(){
        var y = window.pageYOffset || 0, now = performance.now();
        var dt = Math.max(16, now - lastT);
        var v = Math.abs(y - lastY) / dt;            // px per ms
        VEL_RAW = Math.min(1, v / 2.2);              // normalise; ~2.2px/ms saturates
        lastY = y; lastT = now;
      }, { passive: true });
    })();
        var TINT = new Float32Array([1.0, 0.615, 0.10]);   // amber default
    window.__setFieldTint = function (r, g, b) { TINT[0] = r; TINT[1] = g; TINT[2] = b; };
    // pull whatever theme CSS is already applied, so the very first frame
    // is the right colour instead of the amber default flashing through.
    (function seedTint() {
      var v = getComputedStyle(document.documentElement).getPropertyValue('--field-tint').trim();
      if (!v) return;
      var p = v.split(',').map(parseFloat);
      if (p.length === 3 && p.every(function (n) { return !isNaN(n); })) {
        TINT[0] = p[0]; TINT[1] = p[1]; TINT[2] = p[2];
      }
    })();

    var scale    = COARSE ? 0.70 : 1.0;
    var MIN      = 0.45;
    var maxDpr   = COARSE ? 1.5 : 2;

    var W = 0, H = 0, lastCssW = 0, lastCssH = 0;
    var scene = null, acc = [null, null], cur = 0;

    function build() {
      var dpr = Math.min(window.devicePixelRatio || 1, maxDpr) * scale;
      var w = Math.max(2, Math.floor(window.innerWidth * dpr));
      var h = Math.max(2, Math.floor(window.innerHeight * dpr));
      W = w; H = h; cv.width = W; cv.height = H;
      drop(scene); drop(acc[0]); drop(acc[1]);
      scene = target(W, H); acc = [target(W, H), target(W, H)]; cur = 0;
      lastCssW = window.innerWidth; lastCssH = window.innerHeight;
    }

    /* Mobile browsers fire resize every time the URL bar slides.
       Rebuilding three framebuffers on each of those stutters badly,
       so only react to a real change. */
    var rzTimer = null;
    function onResize() {
      clearTimeout(rzTimer);
      rzTimer = setTimeout(function () {
        var dw = window.innerWidth !== lastCssW;
        var dh = Math.abs(window.innerHeight - lastCssH) > 140;
        if (dw || dh) build();
      }, 160);
    }
    addEventListener('resize', onResize, { passive: true });
    addEventListener('orientationchange', onResize, { passive: true });
    build();

    var t0 = performance.now();
    var running = true, queued = false, lost = false;


    cv.addEventListener('webglcontextlost', function (e) {
      e.preventDefault(); lost = true; running = false;
    }, false);
    cv.addEventListener('webglcontextrestored', function () {
      lost = false; running = !document.hidden; build(); tick();
    }, false);

    document.addEventListener('visibilitychange', function () {
      running = !document.hidden && !lost;
      if (running) tick();
    });

    function draw(p, setup) { gl.useProgram(p); setup(); gl.drawArrays(gl.TRIANGLES, 0, 3); }

    function frame(now) {
      queued = false;
      if (!running) return;

      var t = (now - t0) / 1000 * (REDUCE ? 0.25 : 1);
      VEL += (VEL_RAW - VEL) * 0.18;          // attack toward target
      VEL_RAW *= 0.90;                        // target bleeds off when not scrolling
      if (VEL < 0.001) VEL = 0;
      MODE.dense += (TARGET.dense - MODE.dense) * 0.035;
      MODE.sweep += (TARGET.sweep - MODE.sweep) * 0.035;
      MODE.horiz += (TARGET.horiz - MODE.horiz) * 0.035;

      gl.bindVertexArray(vao);
      gl.viewport(0, 0, W, H);

      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.f);
      draw(pScene, function () {
        gl.uniform2f(U.sceneRes, W, H);
        gl.uniform1f(U.sceneT, t);
        gl.uniform1f(U.sceneVel, VEL);
        gl.uniform1f(U.sceneFx, FX);
        gl.uniform1f(U.sceneDen, MODE.dense);
        gl.uniform1f(U.sceneSwp, MODE.sweep);
        gl.uniform1f(U.sceneHor, MODE.horiz);
        var segN = projectWire(t);
        gl.uniform4fv(U.sceneSeg, SEG);
        gl.uniform1f(U.sceneSgN, segN);
        gl.uniform1f(U.sceneWir, WIRE_ON);
      });

      var prev = acc[cur], next = acc[1 - cur]; cur = 1 - cur;
      gl.bindFramebuffer(gl.FRAMEBUFFER, next.f);
      draw(pPers, function () {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene.t);
        gl.uniform1i(U.persS, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev.t);
        gl.uniform1i(U.persP, 1);
        gl.uniform1f(U.persD, 0.955);
      });

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      draw(pPres, function () {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, next.t);
        gl.uniform1i(U.presTex, 0);
        gl.uniform2f(U.presRes, W, H);
        gl.uniform1f(U.presT, t);
        gl.uniform3fv(U.presTint, TINT);
        gl.uniform1f(U.presVel, VEL);
        gl.uniform1f(U.presFx, FX);
      });

      tick();
    }

    function tick() { if (!queued && running) { queued = true; requestAnimationFrame(frame); } }
    tick();
    setTimeout(function () { cv.classList.add('lit'); }, 120);
    // shader is live now; make sure the active theme's tint is in effect
    if (window.__reapplyTheme) window.__reapplyTheme();

    /* Simple, honest frame-budget watchdog: sample real intervals for
       two seconds after load and drop the render scale once if needed. */
    var probeStart = performance.now(), probeFrames = 0, probeDone = false;
    (function probe() {
      if (probeDone) return;
      probeFrames++;
      var elapsed = performance.now() - probeStart;
      if (elapsed > 2000) {
        probeDone = true;
        var fps = probeFrames / (elapsed / 1000);
        if (fps < 45 && scale > MIN) { scale = Math.max(MIN, scale * 0.7); build(); }
        return;
      }
      requestAnimationFrame(probe);
    })();
  })();


  /* ========================================================
     2. FINDINGS REGISTER
        Projects modelled as findings. Edit this array; the
        markup builds itself.
     ======================================================== */
  var DATA = window.PHOSPHOR || {};
  var FINDINGS = DATA.findings || [];
  var DEMOS = DATA.demos || [];

  var BLOCK = ['\u2591', '\u2592', '\u2593', '\u2588'];

  function linkRow(links, id) {
    var hasCase = !!(id && DATA.cases && DATA.cases[id]);
    if ((!links || !links.length) && !hasCase) return '';
    links = links || [];
    var caseBtn = hasCase
      ? '<button type="button" class="case-go" data-case="' + id + '">case study<i aria-hidden="true">\u25B8</i></button>'
      : '';
    return '<div class="f-links">' + caseBtn + links.map(function (k) {
      return '<a href="' + k.u + '" target="_blank" rel="noopener noreferrer">' +
             k.l + '<i aria-hidden="true">\u2197</i></a>';
    }).join('') + '</div>';
  }

  (function buildFindings() {
    var list = document.getElementById('findings');
    if (!list) return;
    FINDINGS.forEach(function (f, i) {
      var li = document.createElement('li');
      li.innerHTML =
        '<div class="f-row"' + (DATA.cases && DATA.cases[f.id] ? ' data-case="1"' : '') + ' tabindex="0" role="button" aria-expanded="false" aria-controls="b' + i + '">' +
          '<div class="sev" data-s="' + f.s + '" aria-label="severity ' + f.s + ' of 4">' + BLOCK[f.s - 1].repeat(3) + '</div>' +
          '<div class="f-id">' + f.id + '</div>' +
          '<div class="f-title">' + f.title + '</div>' +
          '<div class="f-status" data-st="' + f.status.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '">' + f.status + '</div>' +
        '</div>' +
        '<div class="f-body" id="b' + i + '">' +
          (f.lead ? '<div class="f-lead">' + f.lead + '</div>' : '') +
          '<div>' + f.body + '</div>' +
          '<div class="f-meta">' + f.meta.map(function (m) { return '<span>' + m + '</span>'; }).join('') + '</div>' +
          linkRow(f.links, f.id) +
        '</div>';
      var row = li.querySelector('.f-row'), body = li.querySelector('.f-body');
      function toggle() {
        var open = body.classList.toggle('open');
        row.setAttribute('aria-expanded', String(open));
      }
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      list.appendChild(li);
    });
  })();


  (function buildSkills() {
    var host = document.getElementById('skills');
    var sect = document.getElementById('skills-sec');
    var groups = DATA.skills || [];
    if (!host) return;
    if (!groups.length) { if (sect) sect.style.display = 'none'; return; }
    host.innerHTML = groups.map(function (grp) {
      return '<div class="sk-row">' +
        '<div class="sk-g">' + grp.g + '</div>' +
        '<div class="sk-items">' +
          grp.items.map(function (it) { return '<span>' + it + '</span>'; }).join('') +
        '</div></div>';
    }).join('');
  })();

  (function buildTrace() {
    var host = document.getElementById('trace');
    var sect = document.getElementById('trace-sec');
    var rows = DATA.timeline || [];
    if (!host) return;
    if (!rows.length) { if (sect) sect.style.display = 'none'; return; }
    host.innerHTML = rows.map(function (r) {
      return '<li class="tr-row" data-state="' + (r.state || 'up') + '">' +
        '<span class="tr-t">' + r.t + '</span>' +
        '<span class="tr-main">' +
          '<span class="tr-what">' + r.what + '</span>' +
          '<span class="tr-where">' + r.where + '</span>' +
          (r.note ? '<span class="tr-note">' + r.note + '</span>' : '') +
        '</span>' +
        '<span class="tr-when">' + r.when + '</span>' +
      '</li>';
    }).join('');

    if (REDUCE) { host.style.setProperty('--fill', '100%'); return; }

    var items = [].slice.call(host.querySelectorAll('.tr-row'));
    var ticking = false;

    function update() {
      ticking = false;
      var box = host.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      // 0 when the trace top hits mid-viewport, 1 when its bottom does
      var anchor = vh * 0.62;
      var span = box.height;
      var travelled = anchor - box.top;
      var frac = span > 0 ? Math.max(0, Math.min(1, travelled / span)) : 0;
      host.style.setProperty('--fill', (frac * 100).toFixed(2) + '%');

      // light each dot once the beam has reached its centre
      var beamY = box.top + span * frac;
      items.forEach(function (li) {
        var r = li.getBoundingClientRect();
        var dotY = r.top + Math.min(r.height, 48) * 0.5;
        li.classList.toggle('lit', dotY <= beamY + 2);
      });
    }

    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll, { passive: true });
    update();
  })();

  /* ========================================================
     3. HERO TYPE-ON
     ======================================================== */
  function startTyping() {
    var el = document.getElementById('typed');
    if (!el) return;
    var SEQ = (DATA.hero && DATA.hero.typed) || [];
    if (REDUCE) {
      el.innerHTML = SEQ.map(function (l) {
        return '<div class="' + (l.charAt(0) === '$' ? 'p' : '') + '">' + l + '</div>';
      }).join('');
      return;
    }
    el.innerHTML = '';
    var li = 0;
    (function line() {
      if (li >= SEQ.length) {
        el.insertAdjacentHTML('beforeend', '<span class="caret"></span>');
        return;
      }
      var src = SEQ[li++];
      var d = document.createElement('div');
      if (src.charAt(0) === '$') d.className = 'p';
      el.appendChild(d);
      var ci = 0;
      (function ch() {
        if (ci >= src.length) { setTimeout(line, 260); return; }
        d.textContent += src.charAt(ci++);
        setTimeout(ch, src.charAt(0) === '$' ? 34 : 14);
      })();
    })();
  }


  /* ========================================================
     4. BOOT SEQUENCE — the one orchestrated moment
     ======================================================== */
  (function boot() {
    var el = document.getElementById('boot');
    var skip = document.getElementById('skip');
    if (!el) { startTyping(); return; }

    var LINES = [
      ['DEC VT220 TERMINAL  \u2014  P3 AMBER PHOSPHOR', 'dimline'],
      ['SELF TEST .................. <span class="ok">PASS</span>', ''],
      ['CHARACTER ROM .............. <span class="ok">OK</span>', ''],
      ['SERIAL LINE 9600 8N1 ....... <span class="ok">UP</span>', ''],
      ['', ''],
      ['LOADING OPERATOR PROFILE', 'dimline'],
      ['  handle ....... SUNTERRESAA', ''],
      ['  role ......... senior penetration tester', ''],
      ['  clearance .... authorised engagements only', ''],
      ['', ''],
      ['<span class="ok">READY</span>', '']
    ];

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      el.classList.add('gone');
      if (skip && skip.parentNode) skip.parentNode.removeChild(skip);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 600);
      startTyping();
    }
    if (skip) skip.addEventListener('click', finish);
    addEventListener('keydown', function (e) { if (e.key === 'Escape') finish(); });
    el.addEventListener('click', finish);

    if (REDUCE) { finish(); return; }

    var i = 0;
    (function next() {
      if (i >= LINES.length) { setTimeout(finish, 420); return; }
      var pair = LINES[i++];
      var d = document.createElement('div');
      if (pair[1]) d.className = pair[1];
      d.innerHTML = pair[0] || '&nbsp;';
      el.appendChild(d);
      setTimeout(next, 90 + Math.random() * 130);
    })();
  })();


  /* ========================================================
     5. CONSOLE
     ======================================================== */
  (function console_() {
    var log = document.getElementById('log');
    var cmd = document.getElementById('cmd');
    if (!log || !cmd) return;

    function say(t, c) {
      var d = document.createElement('div');
      if (c) d.className = c;
      d.innerHTML = t;
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    }

    var CMDS = {
      help: function () {
        say('available: <span class="hot">' + Object.keys(CMDS).sort().join('  ') + '</span>');
      },
      findings: function () {
        FINDINGS.forEach(function (f) {
          say(BLOCK[f.s - 1].repeat(3) + '  ' + f.id + '  ' + f.title + '  <span class="hot">' + f.status + '</span>');
        });
      },
      contact: function () {
        say('email, linkedin, github and resume are below.');
        var l = document.querySelector('.links');
        if (l) l.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth' });
      },
      scan: function () {
        say('scanning 10.0.0.0/24 ...');
        var hosts = ['12', '41', '88', '203'], ports = ['22/tcp', '443/tcp', '8080/tcp', '3389/tcp'];
        var n = 0;
        var iv = setInterval(function () {
          if (n >= hosts.length) {
            clearInterval(iv);
            say('4 hosts up. this is a portfolio, not a scanner.', 'hot');
            return;
          }
          say('  10.0.0.' + hosts[n] + '  up  <span class="hot">' + ports[n] + '</span>');
          n++;
        }, 260);
      },
      clear: function () { log.innerHTML = ''; }
    };

    // project-specific commands live in content.js, not here
    var EXTRA = DATA.commands || {};
    Object.keys(EXTRA).forEach(function (k) {
      CMDS[k] = function () { EXTRA[k].forEach(function (line) { say(line); }); };
    });

    say('console ready. type <span class="hot">help</span> for commands.');

    cmd.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var raw = cmd.value.trim().toLowerCase();
      cmd.value = '';
      if (!raw) return;
      var safe = raw.replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
      say('&gt; ' + safe, 'echo');
      if (Object.prototype.hasOwnProperty.call(CMDS, raw)) CMDS[raw]();
      else say(safe + ': not found. try <span class="hot">help</span>.');
    });
  })();



  /* ========================================================
     6. REPLAY PLAYER
        Renders whatever is in PHOSPHOR.demos. Tabs appear
        at two or more. Adding a demo needs no change here.
     ======================================================== */
  (function player() {
    var wrap  = document.getElementById('replay');
    var tabs  = document.getElementById('rp-tabs');
    var head  = document.getElementById('rp-title');
    var blurb = document.getElementById('rp-blurb');
    var bar   = document.getElementById('rp-bar');
    var log   = document.getElementById('rp-log');
    var out   = document.getElementById('rp-out');
    var sum   = document.getElementById('rp-sum');
    var btn   = document.getElementById('rp-run');
    var link  = document.getElementById('rp-link');
    var sect  = document.getElementById('replay-sec');
    if (!wrap || !DEMOS.length) { if (sect) sect.style.display = 'none'; return; }

    var timers = [], stageEls = [], active = -1;

    function stop() { timers.forEach(clearTimeout); timers = []; }

    function clearBoard() {
      stop();
      log.innerHTML = ''; out.innerHTML = ''; sum.innerHTML = '';
      stageEls.forEach(function (el) { el.className = 'rp-stage'; });
    }

    function emit(step) {
      if (step.t === 'stage') {
        stageEls.forEach(function (el, i) {
          el.className = 'rp-stage' + (i < step.i ? ' done' : i === step.i ? ' on' : '');
        });
        return;
      }
      if (step.t === 'sum') { sum.innerHTML = step.x; return; }
      if (step.t === 'row') {
        var li = document.createElement('li');
        li.innerHTML =
          '<div class="sev" data-s="' + step.s + '">' + BLOCK[step.s - 1].repeat(3) + '</div>' +
          '<div><span class="rp-name">' + step.n + '</span>' +
          '<span class="rp-why">' + step.w + '</span></div>' +
          '<div class="rp-v" data-v="' + step.k + '">' + step.v + '</div>';
        out.appendChild(li);
        return;
      }
      var d = document.createElement('div');
      d.className = step.t;
      if (step.t === 'gap') d.innerHTML = '&nbsp;';
      else d.textContent = step.x;
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    }

    function play(instant) {
      var demo = DEMOS[active];
      clearBoard();
      btn.disabled = true;
      btn.textContent = instant ? 'replay' : 'running';
      var at = 0;
      demo.script.forEach(function (step) {
        if (instant) { emit(step); return; }
        at += step.d;
        timers.push(setTimeout(function () { emit(step); }, at));
      });
      var finish = function () {
        stageEls.forEach(function (el) { el.className = 'rp-stage done'; });
        btn.disabled = false; btn.textContent = 'replay';
      };
      if (instant) finish();
      else timers.push(setTimeout(finish, at + 400));
    }

    function select(i, autoplay) {
      if (i === active) return;
      active = i;
      var demo = DEMOS[i];

      [].forEach.call(tabs.children, function (t, n) {
        var on = n === i;
        t.className = 'rp-tab' + (on ? ' on' : '');
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });

      head.textContent = demo.title;
      blurb.innerHTML = demo.blurb;

      bar.innerHTML = '';
      stageEls = demo.stages.map(function (name) {
        var el = document.createElement('span');
        el.className = 'rp-stage';
        el.textContent = name;
        bar.appendChild(el);
        return el;
      });

      if (demo.link) {
        link.href = demo.link.u;
        link.textContent = demo.link.l + ' \u2197';
        link.hidden = false;
      } else { link.hidden = true; }

      clearBoard();
      btn.textContent = 'run';
      if (autoplay) play(REDUCE);
    }

    if (DEMOS.length > 1) {
      DEMOS.forEach(function (demo, i) {
        var t = document.createElement('button');
        t.type = 'button'; t.className = 'rp-tab';
        t.setAttribute('role', 'tab'); t.textContent = demo.tab;
        t.addEventListener('click', function () { select(i, true); });
        t.addEventListener('keydown', function (e) {
          var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
          if (n < 0 || n >= DEMOS.length) return;
          e.preventDefault(); select(n, false); tabs.children[n].focus();
        });
        tabs.appendChild(t);
      });
    } else { tabs.hidden = true; }

    select(0, false);
    btn.addEventListener('click', function () { play(REDUCE); });

    if (REDUCE) { play(true); return; }
    if ('IntersectionObserver' in window) {
      var fired = false;
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting && !fired) { fired = true; io.disconnect(); play(false); }
        });
      }, { threshold: 0.3 });
      io.observe(wrap);
    }
  })();


  /* ========================================================
     0b. EFFECT PICKER + SCROLL CUE
     ======================================================== */
  (function fxPicker() {
    var mount = document.getElementById('fx');
    var MODES = [
      { id: 1, label: 'bloom' },
      { id: 2, label: 'beam' },
      { id: 3, label: 'tear' }
    ];
    var active = 1;
    function apply(id) {
      active = id;
      if (window.__setFieldFx) window.__setFieldFx(id);
      if (mount) [].forEach.call(mount.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', String(+b.dataset.id === id));
      });
    }
    if (mount) {
      MODES.forEach(function (m, i) {
        if (i) { var s = document.createElement('span'); s.className = 'sep'; s.textContent = '/'; mount.appendChild(s); }
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = m.label; b.dataset.id = m.id;
        b.setAttribute('aria-pressed', String(m.id === active));
        b.addEventListener('click', function () { apply(m.id); });
        mount.appendChild(b);
      });
    }
    apply(active);
  })();

  (function scrollCue() {
    var cue = document.getElementById('scrollcue');
    if (!cue) return;
    var gone = false;
    function hide() {
      if (gone) return; gone = true;
      cue.classList.add('gone');
      removeEventListener('scroll', onScroll);
    }
    function onScroll() { if ((window.pageYOffset || 0) > 40) hide(); }
    addEventListener('scroll', onScroll, { passive: true });
    setTimeout(function () { if (!gone) cue.classList.add('idle'); }, 6000);
  })();

  /* ========================================================
     8. DECODE ON SCROLL
        Text resolves out of glyph noise as it enters view -
        the tube redrawing a line, left to right. Only ever
        touches elements whose content is plain text, so no
        markup is destroyed.
     ======================================================== */
  (function decode() {
    if (REDUCE || !('IntersectionObserver' in window)) return;

    var SEL = ['.eyebrow', '.f-title', '.tr-what', '.rp-title', '.sk-g', '.callsign'];
    var GLYPHS = '01<>[]{}/\\|=+*#%$&@?!:;~^ABCDEF0123456789';

    function pick() { return GLYPHS.charAt((Math.random() * GLYPHS.length) | 0); }

    function run(el) {
      var final = el.textContent;
      if (!final.trim()) return;
      var n = final.length;
      // resolve left-to-right: each char locks after its own threshold
      var lock = [];
      for (var i = 0; i < n; i++) lock.push(i * 0.55 + Math.random() * 6);
      var maxLock = Math.max.apply(null, lock) + 3;
      var frame = 0;

      el.setAttribute('aria-label', final);   // screen readers get the real text
      (function step() {
        var out = '';
        for (var i = 0; i < n; i++) {
          var c = final.charAt(i);
          if (c === ' ' || c === '\n') { out += c; continue; }
          out += (frame >= lock[i]) ? c : pick();
        }
        el.textContent = out;
        frame += 1;
        if (frame <= maxLock) requestAnimationFrame(step);
        else el.textContent = final;
      })();
    }

    var targets = [];
    SEL.forEach(function (sel) {
      [].forEach.call(document.querySelectorAll(sel), function (el) {
        // plain-text only: skip anything containing markup
        if (el.children.length === 0 && el.textContent.trim()) targets.push(el);
      });
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        run(e.target);
      });
    }, { threshold: 0.55, rootMargin: '0px 0px -8% 0px' });

    targets.forEach(function (el) { io.observe(el); });

    // findings and trace rows are built after this module runs;
    // expose a hook so those renderers can register their own text.
    window.__decodeWatch = function (root) {
      SEL.forEach(function (sel) {
        [].forEach.call((root || document).querySelectorAll(sel), function (el) {
          if (el.children.length === 0 && el.textContent.trim() && !el.__dec) {
            el.__dec = 1; io.observe(el);
          }
        });
      });
    };
  })();

  /* ========================================================
     9. SOFTKEYS
        A VT220 function-key row, not a navbar. F1-F6 work as
        real keys; the active key lights with scroll position;
        a hairline tracks total page progress. Also handles
        deep links (#REG-002 opens that finding expanded).
     ======================================================== */
  (function softkeys() {
    var nav  = document.getElementById('softkeys');
    var list = document.getElementById('sk-list');
    var fill = document.getElementById('sk-fill');
    var panel = document.getElementById('sk-panel');
    var glow  = document.getElementById('sk-glow');
    if (!nav || !list) return;

    // digits are the real shortcuts; shown as the key hint so the bar
    // documents itself honestly rather than promising F-keys that
    // browsers reserve.
    var KEYS = [
      { k: '1', id: 'findings-sec', label: 'register' },
      { k: '2', id: 'skills-sec',   label: 'caps'     },
      { k: '3', id: 'trace-sec',    label: 'trace'    },
      { k: '4', id: 'recon-sec',    label: 'recon'    },
      { k: '5', id: 'replay-sec',   label: 'replay'   },
      { k: '6', id: 'contact-sec',  label: 'contact'  },
      { k: '7', id: 'hero',         label: 'top'      }
    ].filter(function (x) { return document.getElementById(x.id); });

    function goto(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', block: 'start' });
      // move focus for keyboard + screen-reader users without a visible jump
      el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    }

    list.innerHTML = KEYS.map(function (x) {
      return '<li><button type="button" data-id="' + x.id + '">' +
             '<b>' + x.k + '</b> <span>' + x.label + '</span></button></li>';
    }).join('');

    [].forEach.call(list.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { goto(b.dataset.id); });
    });

    addEventListener('keydown', function (e) {
      // don't steal keys while typing in the console
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.documentElement.classList.contains('case-open')) return;

      // Number keys 1-6 are the real bindings. F5 is reload and F1 is help
      // in most browsers - hijacking those is hostile, so the F-labels are
      // the terminal fiction while the digits do the work.
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= KEYS.length) { e.preventDefault(); goto(KEYS[n - 1].id); return; }

    });

    /* active key + progress, throttled through rAF */
    var buttons = [].slice.call(list.querySelectorAll('button'));
    var ticking = false;
    function update() {
      ticking = false;
      var vh = innerHeight || 800, best = -1, bestVis = 0;
      KEYS.forEach(function (x, i) {
        var r = document.getElementById(x.id).getBoundingClientRect();
        var vis = Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top));
        if (vis > bestVis) { bestVis = vis; best = i; }
      });
      buttons.forEach(function (b, i) {
        b.classList.toggle('on', i === best);
        b.setAttribute('aria-current', i === best ? 'true' : 'false');
      });
      // the lit key spills light onto the surface under the panel
      if (glow) {
        if (best >= 0) {
          var lb = buttons[best];
          glow.style.left  = lb.offsetLeft + 'px';
          glow.style.width = lb.offsetWidth + 'px';
          glow.classList.add('lit');
        } else { glow.classList.remove('lit'); }
      }
      var doc = document.documentElement;
      var max = doc.scrollHeight - vh;
      if (fill) fill.style.width = max > 0 ? ((doc.scrollTop / max) * 100).toFixed(2) + '%' : '0%';

      // The module is small and centred now, so it no longer needs to get
      // out of the way on every scroll. It only hides while the hero is
      // filling the screen, where it would compete with the callsign.
      var heroEl = document.getElementById('hero');
      if (heroEl) {
        var hr = heroEl.getBoundingClientRect();
        var heroDominant = hr.bottom > vh * 0.72;
        nav.classList.toggle('tuck', heroDominant);
      }
      lastY = doc.scrollTop;
    }
    var lastY = 0;
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll, { passive: true });
    update();


    /* The panel sits in the tube as an object. Tilt it toward the cursor
       so it reads as physical rather than as a rectangle with a border.
       Fine pointers only - on touch there is no cursor to track. */
    if (panel && !REDUCE && matchMedia('(pointer: fine)').matches) {
      var raf = false, mx = 0, my = 0;
      addEventListener('mousemove', function (e) {
        mx = e.clientX; my = e.clientY;
        if (raf) return;
        raf = true;
        requestAnimationFrame(function () {
          raf = false;
          var r = panel.getBoundingClientRect();
          var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          // normalise distance, clamp so it never becomes a novelty
          var dx = Math.max(-1, Math.min(1, (mx - cx) / (innerWidth * 0.5)));
          var dy = Math.max(-1, Math.min(1, (my - cy) / (innerHeight * 0.5)));
          panel.style.setProperty('--tiltY', (dx * 5).toFixed(2) + 'deg');
          panel.style.setProperty('--tiltX', (7 - dy * 4).toFixed(2) + 'deg');
        });
      }, { passive: true });
      addEventListener('mouseleave', function () {
        panel.style.setProperty('--tiltY', '0deg');
        panel.style.setProperty('--tiltX', '7deg');
      });
    }

    /* deep links: #REG-002 opens that finding expanded */
    function openHash() {
      var h = (location.hash || '').replace('#', '');
      if (!/^REG-\d+$/i.test(h)) return;
      var rows = document.querySelectorAll('#findings .f-row');
      [].forEach.call(rows, function (row) {
        var idEl = row.querySelector('.f-id');
        if (!idEl || idEl.textContent.trim().toUpperCase() !== h.toUpperCase()) return;
        var body = document.getElementById(row.getAttribute('aria-controls'));
        if (body && !body.classList.contains('open')) {
          body.classList.add('open');
          row.setAttribute('aria-expanded', 'true');
        }
        setTimeout(function () {
          row.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', block: 'center' });
        }, 60);
      });
    }
    addEventListener('hashchange', openHash);
    openHash();
  })();

  /* ========================================================
     10. LAMP
         A single moving light source in the tube. Every
         raised surface on the page is lit by this, which is
         what makes the depth read as one physical system
         rather than as unrelated hover effects.
     ======================================================== */
  (function lamp() {
    var el = document.getElementById('lamp');
    if (!el || REDUCE || !matchMedia('(pointer: fine)').matches) return;

    var x = innerWidth * 0.5, y = innerHeight * 0.35;
    var tx = x, ty = y, queued = false;

    addEventListener('mousemove', function (e) {
      tx = e.clientX; ty = e.clientY;
      if (!queued) { queued = true; requestAnimationFrame(step); }
    }, { passive: true });

    function step() {
      queued = false;
      // lag the light behind the cursor so it feels like mass, not a pointer
      x += (tx - x) * 0.12;
      y += (ty - y) * 0.12;
      el.style.transform = 'translate3d(' + (x - 300) + 'px,' + (y - 300) + 'px,0)';
      document.documentElement.style.setProperty('--lampx', x.toFixed(0) + 'px');
      document.documentElement.style.setProperty('--lampy', y.toFixed(0) + 'px');
      if (Math.abs(tx - x) > 0.5 || Math.abs(ty - y) > 0.5) {
        queued = true; requestAnimationFrame(step);
      }
    }
    el.classList.add('on');
    step();
  })();

  /* ========================================================
     11. DEPTH PARALLAX
         Section headers sit slightly further back than their
         content and drift at a different rate. Small numbers
         on purpose - the effect should be felt as space, not
         noticed as movement.
     ======================================================== */
  (function parallax() {
    if (REDUCE) return;
    var eyebrows = [].slice.call(document.querySelectorAll('.pane > .eyebrow'));
    var heroEl   = document.getElementById('hero');
    var callsign = document.querySelector('.callsign');
    var typed    = document.getElementById('typed');
    if (!eyebrows.length && !heroEl) return;

    var ticking = false;
    function update() {
      ticking = false;
      var vh = innerHeight || 800;

      // headers drift up slightly slower than the page
      eyebrows.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.bottom < -80 || r.top > vh + 80) return;
        var mid = (r.top + r.height / 2 - vh / 2) / vh;   // -0.5 .. 0.5
        el.style.transform = 'translateY(' + (mid * 14).toFixed(1) + 'px)';
      });

      // hero recedes as you leave it: drops back and dims, rather than fading
      if (heroEl && callsign) {
        var hr = heroEl.getBoundingClientRect();
        var out = Math.max(0, Math.min(1, -hr.top / (vh * 0.85)));
        callsign.style.transform =
          'translateY(' + (out * 46).toFixed(1) + 'px) scale(' + (1 - out * 0.06).toFixed(4) + ')';
        callsign.style.opacity = (1 - out * 0.72).toFixed(3);
        if (typed) {
          typed.style.transform = 'translateY(' + (out * 74).toFixed(1) + 'px)';
          typed.style.opacity = (1 - out * 0.9).toFixed(3);
        }
      }
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll, { passive: true });
    update();
  })();

  /* ========================================================
     12. PASSIVE RECON
         Reads what any site can read about a visitor, shows
         it to them, and stores none of it. The point is the
         last column: every row says NO. It demonstrates the
         privacy claim instead of asserting it - which is the
         same argument the rest of this site makes about
         evidence.
     ======================================================== */
  (function recon() {
    var list = document.getElementById('rc-list');
    var foot = document.getElementById('rc-foot');
    var sect = document.getElementById('recon-sec');
    if (!list) return;

    function safe(fn, fallback) {
      try { var v = fn(); return (v === undefined || v === null || v === '') ? fallback : v; }
      catch (e) { return fallback; }
    }

    function gpu() {
      try {
        var c = document.createElement('canvas');
        var g = c.getContext('webgl') || c.getContext('experimental-webgl');
        if (!g) return 'unavailable';
        var dbg = g.getExtension('WEBGL_debug_renderer_info');
        if (!dbg) return g.getParameter(g.RENDERER) || 'masked';
        return g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || 'masked';
      } catch (e) { return 'blocked'; }
    }

    function net() {
      var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!c) return 'not exposed';
      return [c.effectiveType, c.downlink ? c.downlink + ' Mbps' : null]
        .filter(Boolean).join(' \u00b7 ') || 'not exposed';
    }

    var ROWS = [
      ['screen',      safe(function(){ return screen.width + '\u00d7' + screen.height + ' @ ' + (devicePixelRatio||1) + 'x'; }, 'unknown')],
      ['viewport',    safe(function(){ return innerWidth + '\u00d7' + innerHeight; }, 'unknown')],
      ['timezone',    safe(function(){ return Intl.DateTimeFormat().resolvedOptions().timeZone; }, 'unknown')],
      ['locale',      safe(function(){ return (navigator.languages || [navigator.language]).slice(0,3).join(', '); }, 'unknown')],
      ['platform',    safe(function(){ return (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform; }, 'unknown')],
      ['gpu',         gpu()],
      ['cpu threads', safe(function(){ return navigator.hardwareConcurrency + ' logical'; }, 'not exposed')],
      ['memory',      safe(function(){ return navigator.deviceMemory + ' GB (approx)'; }, 'not exposed')],
      ['touch',       safe(function(){ return (navigator.maxTouchPoints||0) > 0 ? navigator.maxTouchPoints + ' points' : 'none'; }, 'unknown')],
      ['network',     net()],
      ['do not track',safe(function(){ return navigator.doNotTrack === '1' ? 'enabled' : 'not set'; }, 'not set')],
      ['referrer',    safe(function(){ return document.referrer ? new URL(document.referrer).hostname : 'none \u2014 typed or bookmarked'; }, 'none')]
    ];

    list.innerHTML = ROWS.map(function (r) {
      return '<li class="rc-row">' +
               '<span class="rc-k">' + r[0] + '</span>' +
               '<span class="rc-v">' + String(r[1]) + '</span>' +
               '<span class="rc-s">no</span>' +
             '</li>';
    }).join('');

    /* self-audit: measure this page's own footprint, live */
    function audit() {
      var thirdParty = 0, total = 0;
      try {
        var here = location.host;
        var res = performance.getEntriesByType('resource') || [];
        total = res.length;
        res.forEach(function (e) {
          try { if (new URL(e.name).host !== here) thirdParty++; } catch (x) {}
        });
      } catch (e) {}
      var cookies = document.cookie ? document.cookie.split(';').length : 0;
      var stored = 0;
      try { stored = localStorage.length + sessionStorage.length; } catch (e) {}

      if (foot) {
        foot.innerHTML =
          '<b>This page, audited live:</b> ' +
          total + ' request' + (total === 1 ? '' : 's') + ' \u00b7 ' +
          '<span class="' + (thirdParty ? 'bad' : 'ok') + '">' + thirdParty + ' third-party</span> \u00b7 ' +
          '<span class="' + (cookies ? 'bad' : 'ok') + '">' + cookies + ' cookies</span> \u00b7 ' +
          '<span class="' + (stored ? 'bad' : 'ok') + '">' + stored + ' storage entries</span>';
      }
    }
    if (document.readyState === 'complete') audit();
    else addEventListener('load', function () { setTimeout(audit, 300); });
  })();

  /* ========================================================
     14. CASE STUDIES
         A finding row opens into a full case panel. The panel
         grows out of the row it was opened from, holds its own
         tabs (digits switch them), and returns focus and scroll
         to exactly where the reader was.
     ======================================================== */
  (function cases() {
    var CASES = DATA.cases || {};
    var root  = document.getElementById('case');
    var panel = document.getElementById('case-panel');
    var tabs  = document.getElementById('case-tabs');
    var body  = document.getElementById('case-body');
    var foot  = document.getElementById('case-foot');
    if (!root || !panel) return;

    var opener = null, current = null, tabIx = 0, scrollY = 0;

    function esc(t) {
      return String(t).replace(/[&<>"']/g, function (c) {
        return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
      });
    }

    var R = {
      overview: function (t) {
        return '<blockquote class="cs-quote">' + esc(t.quote) + '</blockquote>' +
          (t.paras || []).map(function (x) { return '<p class="cs-p">' + x + '</p>'; }).join('') +
          '<dl class="cs-facts">' + (t.facts || []).map(function (f) {
            return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>';
          }).join('') + '</dl>';
      },
      pipeline: function (t) {
        return '<p class="cs-intro">' + esc(t.intro) + '</p><ol class="cs-pipe">' +
          t.stages.map(function (st, i) {
            return '<li><span class="cs-n">' + String(i + 1).padStart(2, '0') + '</span>' +
                   '<b>' + esc(st[0]) + '</b><span>' + esc(st[1]) + '</span></li>';
          }).join('') + '</ol>' +
          (t.replay ? '<button type="button" class="cs-cta" data-replay="1">' + esc(t.replay) + ' \u2192</button>' : '');
      },
      decisions: function (t) {
        return '<p class="cs-intro">' + esc(t.intro) + '</p><ol class="cs-dec">' +
          t.items.map(function (d, i) {
            return '<li><span class="cs-n">' + String(i + 1).padStart(2, '0') + '</span><div>' +
                   '<q>' + esc(d[0]) + '</q><small>' + esc(d[1]) + '</small>' +
                   '<p>' + esc(d[2]) + '</p></div></li>';
          }).join('') + '</ol>';
      },
      screens: function (t) {
        return '<div class="cs-screens-bar"><p class="cs-intro">' + esc(t.intro) + '</p>' +
          '<button type="button" class="cs-tc" aria-pressed="' + tinted + '">tube tint</button></div>' +
          '<div class="browser">' +
            '<div class="br-bar">' +
              '<span class="br-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
              '<a class="br-url" href="' + esc(t.live) + '" target="_blank" rel="noopener noreferrer" title="Open the live console">' +
                '<span class="br-sch">https://</span>' + esc(t.host) + '<span class="br-path" id="br-path"></span></a>' +
              '<span class="br-live">demo</span>' +
            '</div>' +
            '<div class="br-tabs" role="tablist">' + t.shots.map(function (sh, i) {
              return '<button type="button" class="br-tab" data-shot="' + i + '"><b>' + (i + 1) + '</b>' + esc(sh.title) + '</button>';
            }).join('') + '</div>' +
            '<div class="br-view" id="br-view" title="Click to read full size"></div>' +
          '</div>' +
          '<div class="br-meta"><p class="br-cap" id="br-cap"></p>' +
            '<span class="br-nav"><button type="button" class="br-step" data-step="-1" aria-label="Previous screen">\u2190</button>' +
            '<span id="br-count"></span>' +
            '<button type="button" class="br-step" data-step="1" aria-label="Next screen">\u2192</button></span></div>' +
          '<ol class="cs-notes" id="br-notes"></ol>';
      }
    };

    var tinted = false, shotIx = 0, shotTab = null;

    function showShot(k) {
      if (!shotTab) return;
      var list = shotTab.shots;
      shotIx = (k + list.length) % list.length;
      var sh = list[shotIx];
      var view = document.getElementById('br-view');
      if (!view) return;
      view.classList.remove('swap'); void view.offsetWidth; view.classList.add('swap');
      view.innerHTML =
        '<img src="' + esc(sh.src1) + '" srcset="' + esc(sh.src1) + ' 1280w, ' + esc(sh.src) + ' 2400w" ' +
        'sizes="(max-width: 1160px) 100vw, 1060px" alt="vapt.console ' + esc(sh.title) + ' screen" decoding="async">' +
        sh.spots.map(function (sp, n) {
          return '<button type="button" class="spot" data-s="' + n + '" data-x="' + sp[0] + '" data-y="' + sp[1] + '" aria-label="Note ' + (n + 1) + '">' + (n + 1) + '</button>';
        }).join('');
      [].forEach.call(view.querySelectorAll('.spot'), function (b) {       // CSP: CSSOM, not style=""
        b.style.left = b.getAttribute('data-x') + '%';
        b.style.top  = b.getAttribute('data-y') + '%';
      });
      document.getElementById('br-notes').innerHTML = sh.spots.map(function (sp, n) {
        return '<li data-s="' + n + '"><span>' + (n + 1) + '</span>' + esc(sp[2]) + '</li>';
      }).join('');
      document.getElementById('br-cap').innerHTML = '<b>' + esc(sh.title) + '</b> ' + esc(sh.caption);
      document.getElementById('br-path').textContent = shotIx === 0 ? '' : ' \u00b7 ' + sh.title;
      document.getElementById('br-count').textContent = (shotIx + 1) + ' / ' + list.length;
      [].forEach.call(body.querySelectorAll('.br-tab'), function (b, n) {
        b.classList.toggle('on', n === shotIx);
        b.setAttribute('aria-selected', String(n === shotIx));
      });
      // warm the next screen so switching is instant
      var nx = list[(shotIx + 1) % list.length]; if (nx) { var pre = new Image(); pre.src = nx.src1; }
    }

    var lb = null;
    function openLightbox() {
      if (!shotTab) return;
      var sh = shotTab.shots[shotIx];
      lb = document.createElement('div');
      lb.className = 'lb';
      lb.innerHTML = '<div class="lb-bar"><b>' + esc(sh.title) + '</b> full size \u00b7 scroll to pan' +
                     '<button type="button" class="lb-x" aria-label="Close full size view">esc \u00d7</button></div>' +
                     '<div class="lb-scroll"><img src="' + esc(sh.src) + '" alt="vapt.console ' + esc(sh.title) + ' screen, full size"></div>';
      var el = lb;
      root.appendChild(el);
      requestAnimationFrame(function () { if (el.parentNode) el.classList.add('in'); });
      var x = lb.querySelector('.lb-x'); if (x) x.focus({ preventScroll: true });
    }
    function closeLightbox() {
      if (!lb) return false;
      var el = lb; lb = null; el.classList.remove('in');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 180);
      return true;
    }

    function showTab(i) {
      if (!current) return;
      var list = current.tabs;
      tabIx = Math.max(0, Math.min(list.length - 1, i));
      [].forEach.call(tabs.children, function (b, n) {
        b.classList.toggle('on', n === tabIx);
        b.setAttribute('aria-selected', String(n === tabIx));
        b.tabIndex = n === tabIx ? 0 : -1;
      });
      var t = list[tabIx];
      body.innerHTML = '<div class="cs-pane cs-' + t.type + '">' + (R[t.type] ? R[t.type](t) : '') + '</div>';
      body.scrollTop = 0;
      shotTab = (t.type === 'screens') ? t : null;
      if (shotTab) showShot(0);
    }

    function open(id, from) {
      var c = CASES[id]; if (!c) return;
      current = c; opener = from || document.activeElement;
      scrollY = window.pageYOffset || 0;

      document.getElementById('case-id').textContent = id;
      document.getElementById('case-kicker').textContent = c.kicker || '';
      document.getElementById('case-title').textContent = c.title;
      tabs.innerHTML = c.tabs.map(function (t, i) {
        return '<button type="button" role="tab" class="case-tab"><b>' + (i + 1) + '</b>' + esc(t.label) + '</button>';
      }).join('');
      [].forEach.call(tabs.children, function (b, i) { b.addEventListener('click', function () { showTab(i); }); });
      foot.innerHTML = (c.links || []).map(function (l) {
        return '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(l[0]) + ' \u2197</a>';
      }).join('');

      // grow out of the row it was opened from
      var oy = 50;
      var row = from && from.closest ? (from.closest('li') || from) : null;
      if (row) {
        var r = row.getBoundingClientRect();
        oy = Math.max(0, Math.min(100, ((r.top + r.height / 2) / (innerHeight || 1)) * 100));
      }
      panel.style.setProperty('--oy', oy.toFixed(1) + '%');

      root.hidden = false;
      document.documentElement.classList.add('case-open');
      void panel.offsetWidth;
      root.classList.add('in');
      showTab(0);
      try { history.replaceState(null, '', '#case-' + id); } catch (e) {}
      setTimeout(function () { var x = root.querySelector('.case-x'); if (x) x.focus({ preventScroll: true }); }, 30);
    }

    function close() {
      if (root.hidden) return;
      root.classList.remove('in');
      document.documentElement.classList.remove('case-open');
      setTimeout(function () {
        root.hidden = true; body.innerHTML = ''; current = null; shotTab = null; closeLightbox();
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
        try { window.scrollTo(0, scrollY); } catch (e) {}
        if (opener && opener.focus) { try { opener.focus({ preventScroll: true }); } catch (e) {} }
      }, REDUCE ? 0 : 220);
    }

    /* delegated clicks: open, close, replay jump, spots, true colour */
    document.addEventListener('click', function (e) {
      var go = e.target.closest && e.target.closest('.case-go');
      if (go) { e.preventDefault(); e.stopPropagation(); open(go.getAttribute('data-case'), go); return; }
      if (!current) return;
      if (e.target.closest('[data-close]')) { close(); return; }
      if (e.target.closest('[data-replay]')) {
        close();
        setTimeout(function () {
          var sec = document.getElementById('replay-sec');
          if (sec) sec.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', block: 'start' });
          var first = document.querySelector('.rp-tab'); if (first) first.click();
        }, REDUCE ? 20 : 260);
        return;
      }
      var tc = e.target.closest('.cs-tc');
      if (tc) {
        tinted = !tinted;
        root.classList.toggle('tinted', tinted);
        tc.setAttribute('aria-pressed', String(tinted));
        return;
      }
      if (e.target.closest('.lb-x') || (lb && e.target === lb.querySelector('.lb-scroll'))) { closeLightbox(); return; }
      var bt = e.target.closest('.br-tab');
      if (bt) { showShot(+bt.getAttribute('data-shot')); return; }
      var st = e.target.closest('.br-step');
      if (st) { showShot(shotIx + (+st.getAttribute('data-step'))); return; }
      if (e.target.closest('.br-view') && !e.target.closest('.spot')) { openLightbox(); return; }
      var sp = e.target.closest('[data-s]');
      if (sp) {
        var key = sp.getAttribute('data-s');
        [].forEach.call(body.querySelectorAll('[data-s]'), function (n) {
          n.classList.toggle('lit', n.getAttribute('data-s') === key);
        });
      }
    }, true);

    /* keys: esc closes, digits and arrows switch tabs, tab stays inside */
    document.addEventListener('keydown', function (e) {
      if (!current) return;
      if (e.key === 'Escape') { e.preventDefault(); if (!closeLightbox()) close(); return; }
      if (lb) return;
      if (shotTab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') &&
          !(e.target && e.target.classList && e.target.classList.contains('case-tab'))) {
        e.preventDefault(); showShot(shotIx + (e.key === 'ArrowRight' ? 1 : -1)); return;
      }
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= current.tabs.length && !(e.target && e.target.tagName === 'INPUT')) {
        e.preventDefault(); showTab(n - 1); return;
      }
      if (e.key === 'ArrowRight' && e.target && e.target.classList.contains('case-tab')) { showTab(tabIx + 1); tabs.children[tabIx].focus(); }
      if (e.key === 'ArrowLeft'  && e.target && e.target.classList.contains('case-tab')) { showTab(tabIx - 1); tabs.children[tabIx].focus(); }
      if (e.key === 'Tab') {
        var f = [].slice.call(panel.querySelectorAll('button, a[href], [tabindex="0"]'))
                  .filter(function (x) { return x.offsetParent !== null; });
        if (!f.length) return;
        var a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    }, true);

    /* deep link: #case-REG-001 */
    function fromHash() {
      var m = /^#case-(REG-\d+)$/i.exec(location.hash || '');
      if (m && CASES[m[1].toUpperCase()]) {
        var btn = document.querySelector('.case-go[data-case="' + m[1].toUpperCase() + '"]');
        open(m[1].toUpperCase(), btn);
      }
    }
    addEventListener('hashchange', fromHash);
    setTimeout(fromHash, 60);
    window.__openCase = open;
  })();

  /* ========================================================
     7. UPTIME
     ======================================================== */
  (function uptime() {
    var el = document.getElementById('up');
    if (!el) return;
    var t0 = Date.now();
    setInterval(function () {
      var s = Math.floor((Date.now() - t0) / 1000);
      el.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
        .map(function (n) { return String(n).length < 2 ? '0' + n : String(n); }).join(':');
    }, 1000);
  })();

})();
