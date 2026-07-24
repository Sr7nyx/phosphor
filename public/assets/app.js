/* ==========================================================
   PHOSPHOR — portfolio runtime
   No dependencies. No network calls. No storage.
   ========================================================== */
(function () {
  'use strict';

  var REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var COARSE = matchMedia('(pointer: coarse)').matches;

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
      'uniform vec2 uRes; uniform float uT;',
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }',
      'void main(){',
      '  vec2 p = (gl_FragCoord.xy - 0.5*uRes) / uRes.y;',
      '  float horizon = 0.10;',
      '  float I = 0.0;',
      '  float scroll = uT * 0.55;',
      '  float sweepZ = scroll + mod(uT * 7.0, 62.0) + 1.5;',
      '  if(p.y < horizon){',
      '    float d = 1.0 / (horizon - p.y);',
      '    vec2  g = vec2(p.x * d * 0.9, d + scroll);',
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
      'uniform sampler2D uTex; uniform vec2 uRes; uniform float uT;',
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
      '  float r = samp(curve(v, 1.02));',
      '  float g = samp(curve(v, 1.00));',
      '  float b = samp(curve(v, 0.98));',
      '  vec3  c = vec3(r, g, b);',
      '  vec2 uv = curve(v, 1.0);',
      '  vec2 px = 2.5 / uRes;',
      '  float bl = 0.0;',
      '  bl += samp(uv + vec2( px.x, 0.0));',
      '  bl += samp(uv + vec2(-px.x, 0.0));',
      '  bl += samp(uv + vec2( 0.0, px.y));',
      '  bl += samp(uv + vec2( 0.0,-px.y));',
      '  bl += samp(uv + px * 3.0);',
      '  bl += samp(uv - px * 3.0);',
      '  c += bl * 0.11;',
      '  vec3 col = c * vec3(1.0, 0.615, 0.10);',
      '  col += pow(max(c.g - 0.75, 0.0), 2.0) * vec3(0.6, 0.55, 0.42);',
      '  col *= 0.80 + 0.20 * sin(gl_FragCoord.x * 2.09);',
      '  col *= 0.86 + 0.14 * sin(gl_FragCoord.y * 3.14159);',
      '  col += (hash(gl_FragCoord.xy + fract(uT) * 91.7) - 0.5) * 0.030;',
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
      persS:    gl.getUniformLocation(pPers, 'uScene'),
      persP:    gl.getUniformLocation(pPers, 'uPrev'),
      persD:    gl.getUniformLocation(pPers, 'uDecay'),
      presTex:  gl.getUniformLocation(pPres, 'uTex'),
      presRes:  gl.getUniformLocation(pPres, 'uRes'),
      presT:    gl.getUniformLocation(pPres, 'uT')
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

      gl.bindVertexArray(vao);
      gl.viewport(0, 0, W, H);

      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.f);
      draw(pScene, function () {
        gl.uniform2f(U.sceneRes, W, H);
        gl.uniform1f(U.sceneT, t);
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
      });

      tick();
    }

    function tick() { if (!queued && running) { queued = true; requestAnimationFrame(frame); } }
    tick();
    setTimeout(function () { cv.classList.add('lit'); }, 120);

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

  function linkRow(links) {
    if (!links || !links.length) return '';
    return '<div class="f-links">' + links.map(function (k) {
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
        '<div class="f-row" tabindex="0" role="button" aria-expanded="false" aria-controls="b' + i + '">' +
          '<div class="sev" data-s="' + f.s + '" aria-label="severity ' + f.s + ' of 4">' + BLOCK[f.s - 1].repeat(3) + '</div>' +
          '<div class="f-id">' + f.id + '</div>' +
          '<div class="f-title">' + f.title + '</div>' +
          '<div class="f-status">' + f.status + '</div>' +
        '</div>' +
        '<div class="f-body" id="b' + i + '">' +
          '<div>' + f.body + '</div>' +
          '<div class="f-meta">' + f.meta.map(function (m) { return '<span>' + m + '</span>'; }).join('') + '</div>' +
          linkRow(f.links) +
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
