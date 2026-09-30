// 注入到被预览页面 <head> 最前面的探针脚本（纯 ES5 风格，兼容任意页面）。
// 捕获：console.*、运行时异常、未处理的 Promise 拒绝、资源加载失败、CSP 违规、fetch / XHR；
// 回传：POST /__wb/log（同源，不受 CORS 影响）；与父窗口（工作台）通过 postMessage 交换导航/性能/求值指令。
export const BRIDGE_JS = String.raw`(function () {
  if (window.__wbBridge) return;
  var SID = "__SID__";
  var W = window, q = [], timer = null, perfOn = false;
  W.__wbBridge = { sid: SID, version: 1 };
  var oFetch = W.fetch;
  function ser(v, d) {
    d = d || 0;
    try {
      if (v === undefined) return 'undefined';
      if (v === null) return 'null';
      var t = typeof v;
      if (t === 'string') return d ? JSON.stringify(v) : v;
      if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
      if (t === 'symbol') return v.toString();
      if (t === 'function') return 'ƒ ' + (v.name || 'anonymous') + '()';
      if (v instanceof Error) return (v.name || 'Error') + ': ' + v.message + (v.stack && d === 0 ? '\n' + String(v.stack).split('\n').slice(1, 8).join('\n') : '');
      if (typeof Element !== 'undefined' && v instanceof Element) {
        return '<' + v.tagName.toLowerCase() + (v.id ? '#' + v.id : '') + (v.className && typeof v.className === 'string' ? '.' + v.className.trim().split(/\s+/).join('.') : '') + '>';
      }
      if (d > 2) return Array.isArray(v) ? '[…]' : '{…}';
      if (Array.isArray(v)) {
        var a = [];
        for (var i = 0; i < Math.min(v.length, 50); i++) a.push(ser(v[i], d + 1));
        return '[' + a.join(', ') + (v.length > 50 ? ', …(' + v.length + ')' : '') + ']';
      }
      var keys = Object.keys(v), parts = [];
      for (var j = 0; j < Math.min(keys.length, 30); j++) parts.push(keys[j] + ': ' + ser(v[keys[j]], d + 1));
      var name = v.constructor && v.constructor.name && v.constructor.name !== 'Object' ? v.constructor.name + ' ' : '';
      return name + '{' + parts.join(', ') + (keys.length > 30 ? ', …' : '') + '}';
    } catch (e) { return '[不可序列化]'; }
  }
  function flush() {
    timer = null;
    if (!q.length) return;
    var body = JSON.stringify(q); q = [];
    try { oFetch.call(W, '/__wb/log', { method: 'POST', body: body, keepalive: body.length < 60000, headers: { 'content-type': 'text/plain' } })['catch'](function () {}); } catch (e) {}
  }
  function send(e) {
    e.ts = Date.now(); if (!e.src) e.src = 'page';
    q.push(e);
    if (q.length > 200) flush(); else if (!timer) timer = setTimeout(flush, 160);
  }
  function post(m) { try { if (W.parent && W.parent !== W) { m.__wb = 'evt'; m.sid = SID; W.parent.postMessage(m, '*'); } } catch (e) {} }
  function where() {
    try {
      var s = String(new Error().stack || '').split('\n');
      for (var i = 2; i < s.length; i++) if (s[i].indexOf('/__wb/bridge.js') < 0) { var m = /\(?((?:https?|file):\/\/[^\s)]+?):(\d+):(\d+)\)?\s*$/.exec(s[i]); if (m) return { url: m[1], line: +m[2], col: +m[3] }; }
    } catch (e) {}
    return {};
  }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (lv) {
    var o = console[lv];
    console[lv] = function () {
      try {
        var args = Array.prototype.slice.call(arguments), txt;
        if (typeof args[0] === 'string' && /%[sdifoOc]/.test(args[0])) {
          var fmt = args.shift();
          txt = fmt.replace(/%[sdifoOc]/g, function (m) { if (m === '%c') { args.shift(); return ''; } return args.length ? ser(args.shift()) : m; });
          if (args.length) txt += ' ' + args.map(function (a) { return ser(a); }).join(' ');
        } else txt = args.map(function (a) { return ser(a); }).join(' ');
        var w = where(), e = { level: lv, text: txt, url: w.url, line: w.line, col: w.col };
        if (lv === 'error') { for (var k = 0; k < args.length; k++) if (args[k] instanceof Error) { e.stack = args[k].stack; break; } }
        send(e);
      } catch (x) {}
      return o && o.apply(console, arguments);
    };
  });
  var oAssert = console.assert;
  console.assert = function (c) { if (!c) send({ level: 'error', text: 'Assertion failed: ' + Array.prototype.slice.call(arguments, 1).map(function (a) { return ser(a); }).join(' ') }); return oAssert && oAssert.apply(console, arguments); };
  W.addEventListener('error', function (ev) {
    var t = ev.target;
    if (t && t !== W && t.tagName) {
      var u = t.currentSrc || t.src || t.href || '';
      send({ level: 'resource', text: '资源加载失败 <' + t.tagName.toLowerCase() + '> ' + u, url: u });
    } else {
      send({ level: 'error', text: 'Uncaught ' + (ev.error ? ser(ev.error, 1) : ev.message), url: ev.filename, line: ev.lineno, col: ev.colno, stack: ev.error && ev.error.stack });
    }
  }, true);
  W.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    send({ level: 'error', text: 'Uncaught (in promise) ' + ser(r, 1), stack: r && r.stack });
  });
  document.addEventListener('securitypolicyviolation', function (ev) {
    send({ level: 'warn', text: 'CSP 拦截：' + ev.violatedDirective + ' ' + (ev.blockedURI || ''), url: ev.sourceFile, line: ev.lineNumber });
  });
  if (oFetch) {
    W.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (url.indexOf('/__wb/') >= 0) return oFetch.apply(this, arguments);
      var method = (init && init.method) || (input && input.method) || 'GET', t0 = Date.now();
      return oFetch.apply(this, arguments).then(function (r) {
        send({ level: 'network', method: method.toUpperCase(), url: r.url || url, status: r.status, ms: Date.now() - t0, text: 'fetch ' + method.toUpperCase() + ' ' + (r.url || url) + ' → ' + r.status });
        return r;
      }, function (err) {
        send({ level: 'network', method: method.toUpperCase(), url: url, status: 0, ms: Date.now() - t0, text: 'fetch ' + method.toUpperCase() + ' ' + url + ' 失败：' + ser(err) });
        throw err;
      });
    };
  }
  var XO = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
  if (XO) {
    var oOpen = XO.open, oSend = XO.send;
    XO.open = function (m, u) { this.__wbm = m; this.__wbu = u; return oOpen.apply(this, arguments); };
    XO.send = function () {
      var x = this, t0 = Date.now();
      try { x.addEventListener('loadend', function () { send({ level: 'network', method: String(x.__wbm || 'GET').toUpperCase(), url: x.responseURL || String(x.__wbu), status: x.status, ms: Date.now() - t0, text: 'xhr ' + String(x.__wbm || 'GET').toUpperCase() + ' ' + (x.responseURL || x.__wbu) + ' → ' + (x.status || '失败') }); }); } catch (e) {}
      return oSend.apply(this, arguments);
    };
  }
  function nav() { post({ type: 'nav', url: location.href, title: document.title }); }
  ['pushState', 'replaceState'].forEach(function (k) {
    var o = history[k];
    if (o) history[k] = function () { var r = o.apply(this, arguments); setTimeout(nav, 0); return r; };
  });
  W.addEventListener('popstate', nav); W.addEventListener('hashchange', nav);
  W.addEventListener('load', function () {
    nav();
    try {
      var n = performance.getEntriesByType('navigation')[0];
      if (n) send({ level: 'system', text: '页面加载完成 · DOMContentLoaded ' + Math.round(n.domContentLoadedEventEnd) + 'ms · load ' + Math.round(n.loadEventEnd || performance.now()) + 'ms' });
    } catch (e) {}
    flush();
  });
  W.addEventListener('pagehide', flush);
  send({ level: 'system', text: '导航到 ' + location.href });
  // 性能：帧率 + JS 堆
  var frames = 0, last = 0;
  function tick(t) {
    if (!perfOn) return;
    frames++;
    if (!last) last = t;
    if (t - last >= 1000) {
      var mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
      post({ type: 'perf', fps: Math.round(frames * 1000 / (t - last)), mem: mem, nodes: document.getElementsByTagName('*').length });
      frames = 0; last = t;
    }
    requestAnimationFrame(tick);
  }
  W.addEventListener('message', function (ev) {
    if (ev.source !== W.parent) return;
    var d = ev.data;
    if (!d || d.__wb !== 'cmd') return;
    if (d.type === 'eval') {
      send({ level: 'log', src: 'eval', text: '› ' + d.code });
      try {
        var r = (0, eval)(d.code);
        Promise.resolve(r).then(function (v) { send({ level: 'result', src: 'eval', text: ser(v) }); flush(); }, function (e) { send({ level: 'error', src: 'eval', text: ser(e) }); flush(); });
      } catch (e) { send({ level: 'error', src: 'eval', text: ser(e) }); flush(); }
    } else if (d.type === 'back') history.back();
    else if (d.type === 'forward') history.forward();
    else if (d.type === 'reload') location.reload();
    else if (d.type === 'perf') { perfOn = !!d.on; frames = 0; last = 0; if (perfOn) requestAnimationFrame(tick); }
    else if (d.type === 'ping') { nav(); post({ type: 'info', w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ua: navigator.userAgent }); }
  });
  nav();
})();`;
