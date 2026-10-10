/* @ds-bundle: {"format":4,"namespace":"Sheetbase","components":[{"name":"Button"},{"name":"Status"},{"name":"Dot"},{"name":"Chip"},{"name":"Tag"},{"name":"Kbd"},{"name":"Banner"},{"name":"Notice"},{"name":"EmptyState"},{"name":"Skeleton"},{"name":"Stepper"},{"name":"Toast"},{"name":"Menu"},{"name":"MenuItem"},{"name":"MenuSep"},{"name":"MenuLabel"},{"name":"Tooltip"},{"name":"Avatar"},{"name":"Segmented"},{"name":"Icon"},{"name":"Source"},{"name":"Diff"},{"name":"Choice"},{"name":"Tree"},{"name":"TreeItem"},{"name":"Secret"}]} */
(function () {
  var S = (window.Sheetbase = window.Sheetbase || {});
  function h() { return window.React.createElement.apply(null, arguments); }
  function cx() { var o = []; for (var i = 0; i < arguments.length; i++) if (arguments[i]) o.push(arguments[i]); return o.join(' '); }
  function sx(v) {
    if (!v) return undefined;
    if (typeof v === 'object') return v;
    var o = {};
    String(v).split(';').forEach(function (d) {
      var i = d.indexOf(':'); if (i < 0) return;
      var k = d.slice(0, i).trim(), val = d.slice(i + 1).trim(); if (!k) return;
      if (k.indexOf('--') !== 0) k = k.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
      o[k] = val;
    });
    return o;
  }
  function pass(p, a) {
    for (var k in p) if (k.indexOf('aria-') === 0 || k.indexOf('data-') === 0) a[k] = p[k];
    if (p.ariaLabel && !a['aria-label']) a['aria-label'] = p.ariaLabel;
    if (p.ariaExpanded != null && a['aria-expanded'] == null) a['aria-expanded'] = String(p.ariaExpanded);
    return a;
  }
  function kls(p) { return p.className || p['class']; }
  function yes(v) { return v === true || v === 'true' || v === '' || v === 'disabled' || v === 'yes'; }

  /* ---------- Icons: 16px stroke, 1.4px, current colour ---------- */
  var P = {
    home: '<path d="M2.5 7L8 2.5 13.5 7v6.5h-11z"/>',
    inbox: '<path d="M2 9h3.5l1 2h3l1-2H14M2 9l2-5.5h8L14 9v4.5H2z"/>',
    calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3"/>',
    folder: '<path d="M2 4.5h4.5l1.5 1.5h6v7.5H2z"/>',
    flask: '<path d="M6 2v4.5L2.5 13.5h11L10 6.5V2M5 2h6"/>',
    protocol: '<path d="M4 2h5.5L12 4.5V14H4z"/><path d="M6 7.5h4M6 10h4"/>',
    tube: '<rect x="4" y="2" width="8" height="12" rx="2"/><path d="M4 9h8"/>',
    box: '<path d="M2.5 5L8 2.5 13.5 5v6L8 13.5 2.5 11z"/><path d="M2.5 5L8 7.5 13.5 5M8 7.5v6"/>',
    table: '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M2 10h12M6 2.5v11"/>',
    chart: '<path d="M2 13.5h12M4 11l3-4 2.5 2L13 4"/>',
    schema: '<path d="M3 3.5h10M3 8h10M3 12.5h6"/>',
    settings: '<circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    check: '<path d="M3 8.5l3 3 7-7"/>',
    x: '<path d="M4 4l8 8M12 4l-8 8"/>',
    chevronDown: '<path d="M4.5 6.5L8 10l3.5-3.5"/>',
    chevronRight: '<path d="M6.5 4.5L10 8l-3.5 3.5"/>',
    arrowLeft: '<path d="M13 8H3M7 4L3 8l4 4"/>',
    bell: '<path d="M4 11V7a4 4 0 018 0v4l1 1.5H3L4 11zM6.5 14h3"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
    sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
    moon: '<path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z"/>',
    monitor: '<rect x="2" y="3" width="12" height="8" rx="1.5"/><path d="M6 14h4M8 11v3"/>',
    more: '<circle cx="3.5" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="12.5" cy="8" r=".8"/>',
    copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M11 5V3.5A1 1 0 0010 2.5H3.5a1 1 0 00-1 1V10a1 1 0 001 1H5"/>',
    link: '<path d="M7 9a3 3 0 004.2 0l2-2a3 3 0 00-4.2-4.2l-.8.8M9 7a3 3 0 00-4.2 0l-2 2a3 3 0 004.2 4.2l.8-.8"/>',
    download: '<path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M2.5 13.5h11"/>',
    upload: '<path d="M8 10.5v-8M4.5 6L8 2.5 11.5 6M2.5 13.5h11"/>',
    lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>',
    filter: '<path d="M2.5 3.5h11L9.5 8.5v4l-3 1.5v-5.5z"/>',
    clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
    scan: '<path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3M5 8h6"/>',
    user: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.7-2.3 2.7-3.5 5-3.5s4.3 1.2 5 3.5"/>',
    signOut: '<path d="M9.5 3H3v10h6.5M7 8h7M11.5 5.5L14 8l-2.5 2.5"/>',
    edit: '<path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z"/>',
    comment: '<path d="M3 3h10v7H7l-3 3v-3H3z"/>',
    warn: '<path d="M8 2.5l6 10.5H2z"/><path d="M8 6.5v3M8 11.2v.3"/>',
    info: '<circle cx="8" cy="8" r="5.5"/><path d="M8 7.2v3.6M8 5.2v.3"/>',
    pipeline: '<circle cx="3.5" cy="4" r="1.6"/><circle cx="12.5" cy="12" r="1.6"/><path d="M5.1 4H8a2 2 0 012 2v4a2 2 0 002 2"/><path d="M3.5 5.6V12h7.4"/>',
    play: '<path d="M5 3.5l7 4.5-7 4.5z"/>',
    code: '<path d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5"/>',
    webhook: '<circle cx="8" cy="4" r="1.8"/><circle cx="3.8" cy="11.5" r="1.8"/><circle cx="12.2" cy="11.5" r="1.8"/><path d="M7 5.6L4.8 9.8M9 5.6l2.2 4.2M5.6 11.5h4.8"/>',
    database: '<ellipse cx="8" cy="4" rx="5" ry="1.8"/><path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8"/>',
    pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
    template: '<path d="M3.5 2h6L12.5 5v9h-9z"/><path d="M9.5 2v3h3M5.5 8h5M5.5 10.5h3"/>',
    key: '<circle cx="5.5" cy="10.5" r="2.5"/><path d="M7.3 8.7L13 3M11 5l1.5 1.5M9.5 6.5L11 8"/>',
    plug: '<path d="M5.5 2v3M10.5 2v3M3.5 5h9v2.5a4.5 4.5 0 01-9 0zM8 12v2.5"/>',
    move: '<path d="M2 4.5h4.5l1.5 1.5h6v7.5H2z"/><path d="M6 9.5h4.5M9 8l1.5 1.5L9 11"/>',
    archive: '<rect x="2" y="3" width="12" height="3" rx="1"/><path d="M3 6v7.5h10V6M6.5 9h3"/>'
  };
  S.icons = Object.keys(P);
  S.Icon = function (p) {
    var n = p.name || 'info', size = +(p.size || 16);
    return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: p.strokeWidth || 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: kls(p), style: sx(p.sx), dangerouslySetInnerHTML: { __html: P[n] || P.info } });
  };

  /* ---------- Actions ---------- */
  var VAR = { primary: 'btn-p', secondary: '', quiet: 'btn-q', danger: 'btn-danger', 'danger-fill': 'btn-danger-fill' };
  S.Button = function (p) {
    var cls = cx('btn', VAR[p.variant || 'secondary'], p.size === 'sm' && 'btn-s', p.size === 'lg' && 'btn-l', yes(p.iconOnly) && 'ib', kls(p));
    var kids = [];
    if (p.icon) kids.push(h(S.Icon, { key: 'i', name: p.icon, size: p.size === 'sm' ? 12 : 14 }));
    if (p.children != null) kids.push(p.children);
    var a = pass(p, { className: cls, style: sx(p.sx), title: p.title, onClick: p.onClick, id: p.id });
    if (p.href) { a.href = p.href; if (yes(p.disabled)) a['aria-disabled'] = 'true'; return h('a', a, kids); }
    a.type = p.type || 'button'; a.disabled = yes(p.disabled);
    return h('button', a, kids);
  };

  /* ---------- Status ---------- */
  var TONE = { progress: 'st-progress', review: 'st-review', ok: 'st-ok', warn: 'st-warn', bad: 'st-bad', draft: 'st-draft', stored: 'st-stored', none: 'st-none', analysis: 'st-analysis' };
  S.Dot = function (p) { return h('span', { className: cx('dot', TONE[p.tone] || 'st-draft', kls(p)), style: sx(p.sx), 'aria-hidden': 'true' }); };
  S.Status = function (p) {
    return h('span', pass(p, { className: cx('status', kls(p)), style: sx(p.sx) }), h(S.Dot, { tone: p.tone }), p.children);
  };
  S.Chip = function (p) {
    return h('span', { className: cx('chip', kls(p)), style: sx(p.sx) }, p.children,
      h('button', { type: 'button', className: 'btn ib', 'aria-label': p.removeLabel || 'Remove', style: { width: 18, height: 18 }, onClick: p.onRemove }, h(S.Icon, { name: 'x', size: 10 })));
  };
  S.Tag = function (p) { return h('span', { className: cx('tag', p.kind || 'chg', kls(p)), style: sx(p.sx) }, p.children); };
  S.Kbd = function (p) { return h('kbd', { className: kls(p), style: sx(p.sx) }, p.children); };
  S.Avatar = function (p) {
    var bg = { accent: 'var(--selection)', review: 'var(--review-wash)', ok: 'var(--success-wash)', warn: 'var(--warning-wash)' }[p.tone || 'accent'];
    return h('span', { className: cx('avatar', p.size === 'sm' && 'sm', kls(p)), style: Object.assign({ background: bg }, sx(p.sx)), title: p.name, 'aria-label': p.name, role: p.name ? 'img' : undefined }, p.initials);
  };

  /* ---------- Feedback ---------- */
  S.Banner = function (p) { return h('div', pass(p, { className: cx('banner', p.tone, kls(p)), style: sx(p.sx), role: p.tone === 'bad' ? 'alert' : 'status' }), p.children); };
  S.Notice = function (p) {
    return h('div', pass(p, { className: cx('notice', p.tone || 'info', kls(p)), style: sx(p.sx) }),
      p.title ? h('div', { style: { fontWeight: 600, color: p.tone === 'bad' ? 'var(--danger-text)' : p.tone === 'warn' ? 'var(--warning-text)' : 'var(--text)', marginBottom: 2 } }, p.title) : null, p.children);
  };
  S.EmptyState = function (p) {
    return h('div', pass(p, { className: cx('empty', kls(p)), style: sx(p.sx) }),
      p.icon ? h('span', { style: { color: 'var(--text-muted)' } }, h(S.Icon, { name: p.icon, size: 20 })) : null,
      h('h2', null, p.title), p.body ? h('p', null, p.body) : null,
      p.children ? h('div', { className: 'empty-actions' }, p.children) : null);
  };
  S.Skeleton = function (p) {
    return h('div', { className: cx('sk', kls(p)), 'aria-hidden': 'true', style: Object.assign({ width: p.w || '100%', height: p.h || 12, borderRadius: p.r }, sx(p.sx)) });
  };
  S.Stepper = function (p) {
    var steps = Array.isArray(p.steps) ? p.steps : String(p.steps || '').split('|');
    var cur = +(p.current || 1);
    return h('ol', { className: cx('stepper', kls(p)), style: sx(p.sx), 'aria-label': p.ariaLabel || 'Steps' },
      steps.map(function (s, i) {
        var n = i + 1, st = n < cur ? 'done' : n === cur ? (yes(p.failed) ? 'bad' : 'now') : '';
        return h('li', { key: i, className: st, 'aria-current': n === cur ? 'step' : undefined },
          h('span', { className: 'n' }, n < cur ? h(S.Icon, { name: 'check', size: 10, strokeWidth: 2 }) : (st === 'bad' ? '!' : n)), s);
      }));
  };
  S.Toast = function (p) {
    return h('div', { className: cx('toast', p.tone, kls(p)), style: sx(p.sx), role: 'status', 'aria-live': 'polite' },
      h('span', { className: 't-dot', 'aria-hidden': 'true' }), h('span', null, p.children),
      p.action ? h('button', { type: 'button', onClick: p.onAction }, p.action) : null,
      p.onClose ? h('button', { type: 'button', 'aria-label': 'Dismiss', onClick: p.onClose }, h(S.Icon, { name: 'x', size: 12 })) : null);
  };
  S.Tooltip = function (p) { return h('div', { className: cx('tooltip', kls(p)), role: 'tooltip', style: sx(p.sx) }, p.children); };

  /* ---------- Menus ---------- */
  S.Menu = function (p) { return h('div', pass(p, { className: cx('menu', kls(p)), role: 'menu', 'aria-label': p.ariaLabel, style: sx(p.sx) }), p.children); };
  S.MenuItem = function (p) {
    var kids = [p.icon ? h(S.Icon, { key: 'i', name: p.icon, size: 14 }) : null, h('span', { key: 't' }, p.children), p.hint ? h('span', { key: 'h', className: 'hint' }, p.hint) : null];
    var a = pass(p, { role: 'menuitem', className: cx('menu-item', yes(p.danger) && 'danger', yes(p.highlighted) && 'hl', kls(p)), style: sx(p.sx), onClick: p.onClick });
    if (yes(p.disabled)) a['aria-disabled'] = 'true';
    if (p.href) { a.href = p.href; return h('a', a, kids); }
    a.type = 'button'; return h('button', a, kids);
  };
  S.MenuSep = function () { return h('div', { className: 'menu-sep', role: 'separator' }); };
  S.MenuLabel = function (p) { return h('div', { className: 'menu-label' }, p.children); };
  S.Segmented = function (p) {
    var opts = Array.isArray(p.options) ? p.options : String(p.options || '').split('|');
    var icons = p.icons ? String(p.icons).split('|') : [];
    return h('div', { className: cx('seg', kls(p)), role: 'radiogroup', 'aria-label': p.ariaLabel, style: sx(p.sx) }, opts.map(function (o, i) {
      var on = String(p.value).toLowerCase() === o.toLowerCase();
      return h('button', { key: o, type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', className: on ? 'on' : '', onClick: function () { p.onChange && p.onChange(o.toLowerCase()); } },
        icons[i] ? h(S.Icon, { name: icons[i], size: 12 }) : null, o);
    }));
  };

  /* ---------- Records: where a value comes from, what changed, choices, folders, secrets ---------- */
  var SRC = { dataset: 'database', record: 'link', calc: 'code', local: 'edit' };
  S.Source = function (p) {
    var k = p.kind || 'dataset';
    return h('span', pass(p, { className: cx('src', k, kls(p)), style: sx(p.sx), title: p.title }), h(S.Icon, { name: SRC[k] || 'info', size: 10 }), p.children);
  };
  S.Diff = function (p) {
    return h('span', { className: cx('diff', kls(p)), style: sx(p.sx) }, p.before != null && p.before !== '' ? h('del', null, p.before) : null, p.before != null && p.before !== '' && p.after != null ? ' ' : null, p.after != null ? h('ins', null, p.after) : null);
  };
  S.Choice = function (p) {
    var on = yes(p.checked);
    return h('label', { className: cx('choice', on && 'on', yes(p.disabled) && 'off', kls(p)), style: sx(p.sx) },
      h('input', { type: p.type || 'radio', name: p.name, defaultChecked: on, disabled: yes(p.disabled), onChange: p.onChange }),
      h('span', null, h('b', null, p.title), p.children != null ? h('span', { className: 'd' }, p.children) : null));
  };
  S.Tree = function (p) { return h('nav', pass(p, { className: cx('tree', kls(p)), style: sx(p.sx), 'aria-label': p.ariaLabel || 'Folders' }), p.children); };
  S.TreeItem = function (p) {
    var a = pass(p, { className: cx('tree-item', kls(p)), style: Object.assign({ paddingLeft: 8 + 16 * (+(p.depth || 0)) }, sx(p.sx)), href: p.href, onClick: p.onClick });
    if (yes(p.current)) a['aria-current'] = 'page';
    return h(p.href ? 'a' : 'button', p.href ? a : Object.assign(a, { type: 'button' }), h(S.Icon, { name: p.icon || 'folder', size: 14 }), h('span', { className: 'n' }, p.children), p.count != null ? h('span', { className: 'ct' }, p.count) : null);
  };
  S.Secret = function (p) {
    return h('div', pass(p, { className: cx('secret', kls(p)), style: sx(p.sx) }), h('code', null, p.value),
      h(S.Button, { size: 'sm', icon: 'copy', onClick: p.onCopy }, p.copyLabel || 'Copy'));
  };

  /* ---------- Theme: one appearance setting shared by every open screen ----------
     pref: 'system' | 'light' | 'dark'. Stored in localStorage when the frame allows it, and
     broadcast to every other frame on the page, so a switch in one screen updates them all. */
  var KEY = 'sheetbase.theme', pref = null, host = null, subs = [];
  try { var v = window.localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') pref = v; } catch (e) {}
  function emit() { subs.slice().forEach(function (f) { try { f(); } catch (e) {} }); }
  function frames(w, out, d) {
    if (d > 4) return out;
    try { for (var i = 0; i < w.frames.length; i++) { out.push(w.frames[i]); frames(w.frames[i], out, d + 1); } } catch (e) {}
    return out;
  }
  function broadcast(msg) {
    var top; try { top = window.top; } catch (e) { top = window; }
    frames(top, [top], 0).forEach(function (f) { if (f !== window) { try { f.postMessage(msg, '*'); } catch (e) {} } });
  }
  function store(v) { try { window.localStorage.setItem(KEY, v); } catch (e) {} }
  window.addEventListener('message', function (e) {
    var d = e.data; if (!d || typeof d !== 'object') return;
    if (d.type === 'sheetbase-theme' && (d.value === 'light' || d.value === 'dark' || d.value === 'system')) {
      if (d.value !== pref) { pref = d.value; store(pref); emit(); }
    } else if (d.type === 'sheetbase-theme?' && pref && e.source) {
      try { e.source.postMessage({ type: 'sheetbase-theme', value: pref }, '*'); } catch (err) {}
    } else if (d.type === '__dc_theme' && (d.theme === 'light' || d.theme === 'dark')) {
      host = d.theme; emit();
    }
  });
  window.addEventListener('storage', function (e) { if (e.key === KEY && e.newValue && e.newValue !== pref) { pref = e.newValue; emit(); } });
  var mq = null; try { mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', emit); } catch (e) {}
  if (!pref) broadcast({ type: 'sheetbase-theme?' });
  function canvasHint() {
    if (host) return host;
    try { var q = new URLSearchParams(location.search).get('theme'); if (q === 'light' || q === 'dark') return q; } catch (e) {}
    return null;
  }
  S.theme = {
    get: function () { return pref || 'light'; },
    set: function (v) { if (v !== 'light' && v !== 'dark' && v !== 'system') return; pref = v; store(v); broadcast({ type: 'sheetbase-theme', value: v }); emit(); },
    resolved: function (override) {
      if (override === 'light' || override === 'dark') return override;
      var p = pref || 'light';
      if (p !== 'system') return p;
      return canvasHint() || (mq && mq.matches ? 'dark' : 'light');
    },
    subscribe: function (f) { subs.push(f); return function () { subs = subs.filter(function (x) { return x !== f; }); }; }
  };
})();
