/*!
 * page-layout.js — 3カラムレイアウト（左: ページ一覧 / 中央: 本文 / 右: 目次）
 *
 * 使い方（各ページ）
 *   1. <body class="layout-3col"> にする
 *   2. <head> に <script src="page-layout.js" defer></script> を入れる
 *   3. 本文を <main id="content"> で囲み、左右に <nav id="site-nav"> / <nav id="page-toc"> を置く
 *   4. 標準（下の A/B）のページは、左右の開閉状態を復元する短い <script> を <head> に入れる
 *      （ちらつき防止。ml_for_structured_data.html の <head> のものと同じ。ドロワー型には不要）
 *
 * 4つの型（詳しくは page-common.css 冒頭）
 *                 目次あり                  目次なし
 *   標準          A: layout-3col            B: layout-3col（#page-toc と #btn-right を置かない）
 *   ドロワー型    C: layout-3col l3-drawer  D: layout-3col l3-drawer（#page-toc と #btn-right を置かない）
 *
 *   ・標準: 広い画面では左右を常設し、閉じても本文の幅と位置は変わらない。狭い画面ではドロワー。
 *   ・ドロワー型: 画面幅に関係なく、左右カラムは閉じた状態から、ボタンで本文に重ねて開く（オーバーレイ）。
 *   ・l3-2col は l3-drawer の旧名（移行用の別名）。
 *
 * 上部バー中央(#topbar-title)の表示
 *   ・目次あり(A/C): いま読んでいる章の名前を出す。
 *   ・目次なし(B/D): 本文の h1 が上部バーの下に隠れたときだけ、ページ名を出す。
 *     対象は「#topbar-title と #content #header h1 の両方があるページ」。どちらかがなければ何もしない
 *     （markdown_converter は #topbar-title を置かないので対象外）。
 *     バーに出す文字を変えたいときは <h1 data-topbar-title="短い名前"> にする（なければ h1 の文字を使う）。
 *
 * ページを追加したとき: 下の SITE_NAV に1行足すだけでよい。
 */
(function () {
  'use strict';

  /* ===================== 設定 ===================== */

  // 一覧のパスは「トップページ基準」で書く（pages/xxx.html）。
  // このスクリプトを使うページは pages/ 配下にあるため、先頭に LINK_BASE を付けて解決する。
  // （トップページ側で使う場合は '' にする）
  var LINK_BASE = '../';

  var HOME = ['🏠 Home', ''];

  var SITE_NAV = [
    {
      group: 'Articles',
      items: [
        ['📘 AI 70年', 'pages/ai-70-years.html'],
        ['🤖 機械学習の歴史', 'pages/ml-history.html'],
        ['🤖 機械学習の手法', 'pages/ml-for-structured-data.html'],
        ['🤖 機械学習の評価指標', 'pages/ml-evaluation.html'],
        ['🤖 機械学習モデルの解釈', 'pages/ml-interpretation.html'],
        ['🎯 アップリフトモデリング（基礎）', 'pages/uplift-basic.html'],
        ['🎯 アップリフトモデリング（実践）', 'pages/uplift-advanced.html']
      ]
    },
    {
      group: 'Tools',
      items: [
        ['💬 Dify', 'pages/dify.html'],
        ['🦊 Bayesian Comparison of Means', 'pages/bayesian-means.html'],
        ['🦁 Bayesian Comparison of Proportions', 'pages/bayesian-props.html'],
        ['🐶 Markdown Converter', 'pages/markdown-converter.html'],
        ['🐯 Diff Viewer', 'pages/diff-viewer.html'],
        ['🦄 Color Comparison', 'pages/color-comparison.html'],
        ['🐹 Amazon Clean', 'pages/amazon-clean.html'],
        ['🐼 QR Code Creator', 'pages/qr-code-creator.html']
      ]
    }
  ];

  var TOC_SELECTOR = 'h1, h2, h3';              // 目次に出す見出し
  var ACTIVE_OFFSET = 80;                   // この位置(px)より上に来た最後の見出しを「現在地」とする
  var STORAGE_KEY = 'layout3col.v1';        // <head> の早期スクリプトと同じキーにする
  var WIDE_QUERY = '(min-width: 1150px)';   // CSS のブレークポイントと揃える

  /* ===================== 共通 ===================== */

  var root = document.documentElement;
  var mq = window.matchMedia(WIDE_QUERY);
  var state = loadState();

  // ドロワー型(body.l3-drawer。旧名 l3-2col)かどうか。画面幅に関係なく、ドロワー(オーバーレイ)として動かす。
  function isDrawerType() {
    var c = document.body.classList;
    return c.contains('l3-drawer') || c.contains('l3-2col');
  }

  // 広い画面で左右を並べる（常設する）動作かどうか。標準(A/B)の広い画面だけ true。
  function isWide() {
    return mq.matches && !isDrawerType();
  }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* 保存できなくても動作には影響しない */ }
  }

  /* ===================== 左: ページ一覧 ===================== */

  function normalizePath(p) {
    return p.replace(/\/index\.html$/, '/');
  }

  function makeLink(label, path, here) {
    var a = el('a', {}, label);
    if (/^https?:\/\//.test(path)) {
      a.href = path;
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'external';
    } else {
      a.href = LINK_BASE + path;
      if (normalizePath(new URL(a.href).pathname) === here) {
        a.className = 'current';
        a.setAttribute('aria-current', 'page');
      }
    }
    return a;
  }

  function renderSiteNav() {
    var box = document.getElementById('site-nav');
    if (!box) return;
    var here = normalizePath(location.pathname);
    var frag = document.createDocumentFragment();

    var top = el('div', { 'class': 'site-nav-group' });
    top.appendChild(makeLink(HOME[0], HOME[1], here));
    frag.appendChild(top);

    SITE_NAV.forEach(function (g) {
      var sec = el('div', { 'class': 'site-nav-group' });
      sec.appendChild(el('div', { 'class': 'side-title' }, g.group));
      g.items.forEach(function (it) { sec.appendChild(makeLink(it[0], it[1], here)); });
      frag.appendChild(sec);
    });

    box.textContent = '';
    box.appendChild(frag);
  }

  /* ===================== 右: 目次 ===================== */

  function slugify(s) {
    return s.trim().toLowerCase()
      .replace(/[\s\u3000]+/g, '-')
      .replace(/[^\p{L}\p{N}_-]/gu, '')
      .replace(/^-+|-+$/g, '');
  }

  // id がない見出しにだけ id を自動付与する（既存の id は変更しない）
  function ensureIds(heads) {
    var used = {};
    Array.prototype.forEach.call(document.querySelectorAll('[id]'), function (e) { used[e.id] = true; });
    heads.forEach(function (h, i) {
      if (h.id) return;
      var base = slugify(h.textContent) || ('section-' + (i + 1));
      var id = base, n = 2;
      while (used[id]) id = base + '-' + (n++);
      h.id = id;
      used[id] = true;
    });
  }

  function buildToc() {
    var box = document.getElementById('page-toc');
    var content = document.getElementById('content');
    if (!box || !content) return [];

    var heads = Array.prototype.slice.call(content.querySelectorAll(TOC_SELECTOR));
    ensureIds(heads);

    var list = el('ul', { 'class': 'page-toc-list' });
    var items = heads.map(function (h) {
      var li = el('li', { 'class': 'lv' + h.tagName.charAt(1) });
      var a = el('a', { href: '#' + h.id }, h.textContent.trim());
      li.appendChild(a);
      list.appendChild(li);
      return { heading: h, link: a };
    });

    box.textContent = '';
    box.appendChild(el('div', { 'class': 'side-title' }, 'Contents'));
    box.appendChild(list);

    // 狭い画面では、目次をタップしたら閉じる
    list.addEventListener('click', function (e) {
      if (e.target.closest('a') && !isWide()) closeDrawers();
    });
    return items;
  }

  function keepVisible(box, link) {
    if (!box.getClientRects().length) return;
    var b = box.getBoundingClientRect();
    var l = link.getBoundingClientRect();
    if (l.top < b.top + 8) box.scrollTop -= (b.top + 8 - l.top);
    else if (l.bottom > b.bottom - 8) box.scrollTop += (l.bottom - (b.bottom - 8));
  }

  function setupScrollSpy(items) {
    if (!items.length) return;
    var box = document.getElementById('page-toc');
    var title = document.getElementById('topbar-title');
    var current = -2;
    var ticking = false;

    function update() {
      ticking = false;
      var idx = -1;
      for (var i = 0; i < items.length; i++) {
        if (items[i].heading.getBoundingClientRect().top <= ACTIVE_OFFSET) idx = i;
        else break;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        idx = items.length - 1;
      }
      if (idx === current) return;
      current = idx;

      items.forEach(function (it, i) {
        var on = (i === idx);
        it.link.classList.toggle('active', on);
        if (on) it.link.setAttribute('aria-current', 'location');
        else it.link.removeAttribute('aria-current');
      });

      // 上部バーには、いま読んでいる章（h2）の名前を出す
      var h2 = '';
      for (var j = idx; j >= 0; j--) {
        if (items[j].heading.tagName === 'H2') { h2 = items[j].heading.textContent.trim(); break; }
      }
      if (title) title.textContent = h2;

      if (idx >= 0 && box) keepVisible(box, items[idx].link);
    }

    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  /* ===================== 左右の開閉 ===================== */
  // 広い画面: 閉じた状態を localStorage に保存（html に left-closed / right-closed）
  // 狭い画面（と2カラム版）: ドロワーとして開く（html に left-open / right-open）。保存しない。

  var buttons = {
    left: document.getElementById('btn-left'),
    right: document.getElementById('btn-right')
  };

  function isOpen(side) {
    return isWide()
      ? !root.classList.contains(side + '-closed')
      : root.classList.contains(side + '-open');
  }

  function updateAria() {
    ['left', 'right'].forEach(function (side) {
      if (buttons[side]) buttons[side].setAttribute('aria-expanded', String(isOpen(side)));
    });
  }

  function closeDrawers() {
    root.classList.remove('left-open', 'right-open');
    updateAria();
  }

  // 左右を開閉すると中央の幅が変わり、本文の折り返しが変わる。
  // 画面上部あたりにある要素の位置を覚えておき、開閉後に同じ位置へ戻す。
  function keepReadingPosition(change) {
    var content = document.getElementById('content');
    var anchor = null;
    var before = 0;
    if (content) {
      var r = content.getBoundingClientRect();
      anchor = document.elementFromPoint(r.left + r.width / 2, 80);
      if (anchor && !content.contains(anchor)) anchor = null;
      if (anchor) before = anchor.getBoundingClientRect().top;
    }
    change();
    if (anchor) {
      var diff = anchor.getBoundingClientRect().top - before;
      // behavior:'instant' … CSS の scroll-behavior:smooth を無視して即座に移動する
      if (Math.abs(diff) > 1) window.scrollTo({ top: window.scrollY + diff, left: 0, behavior: 'instant' });
    }
  }

  function toggle(side) {
    if (isWide()) {
      keepReadingPosition(function () {
        state[side] = root.classList.toggle(side + '-closed');
      });
      saveState();
    } else {
      var cls = side + '-open';
      var willOpen = !root.classList.contains(cls);
      root.classList.remove('left-open', 'right-open');
      if (willOpen) root.classList.add(cls);
    }
    updateAria();
  }

  // ボタンの見た目: 左 = ハンバーガー、右 = 行頭に点の付いたリスト
  var SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">';
  var ICONS = {
    left: SVG_OPEN + '<path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    right: SVG_OPEN + '<path d="M10 6h10M10 12h10M10 18h10"/>' +
      '<circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/>' +
      '<circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/>' +
      '<circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/></svg>'
  };
  var LABELS = { left: 'Toggle Primary Sidebar', right: 'Toggle Secondary Sidebar' };

  function decorateButtons() {
    ['left', 'right'].forEach(function (side) {
      var b = buttons[side];
      if (!b) return;
      b.innerHTML = ICONS[side];
      b.setAttribute('aria-label', LABELS[side]);
      b.setAttribute('data-tooltip', LABELS[side]);   // ツールチップは CSS(::after)で表示
    });
  }

  function setupToggles() {
    decorateButtons();
    ['left', 'right'].forEach(function (side) {
      if (buttons[side]) buttons[side].addEventListener('click', function () { toggle(side); });
    });
    var backdrop = document.getElementById('side-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeDrawers);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !isWide()) closeDrawers();
    });
    var onChange = function () { closeDrawers(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
    updateAria();
  }

  /* ===================== 表の横スクロール ===================== */

  function wrapTables() {
    var content = document.getElementById('content');
    if (!content) return;
    Array.prototype.forEach.call(content.querySelectorAll('table'), function (t) {
      if (t.parentElement.classList.contains('table-scroll')) return;
      var w = el('div', { 'class': 'table-scroll' });
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
    });
  }

  /* ===================== 目次なしページ: 上部バーのページ名 ===================== */
  // 本文の h1 が上部バーの下に隠れたら #topbar-title にページ名を出し、見えたら消す。
  // 目次があるページ（章名を #topbar-title に出す）とは干渉しないよう、目次がないページ(B/D)だけで動かす。
  // 表示・非表示の切り替えは page-common.css（:has(#page-toc) で判定）。

  function setupPageTitle() {
    var box = document.getElementById('topbar-title');
    var h1 = document.querySelector('#content #header h1');
    var bar = document.querySelector('.topbar');
    if (!box || !h1 || !bar || !('IntersectionObserver' in window)) return;
    if (document.getElementById('page-toc')) return;   // 目次があるなら章名の更新と衝突するので何もしない

    var text = (h1.getAttribute('data-topbar-title') || h1.textContent).replace(/\s+/g, ' ').trim();
    if (!text) return;
    box.textContent = text;
    box.setAttribute('aria-hidden', 'true');   // 本文に同じ h1 があるので、読み上げ対象にしない

    // rootMargin には CSS 変数が使えないので、バーの実測値(px)で、バーの下端を監視の上端にする
    var barH = Math.round(bar.getBoundingClientRect().height);
    new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      var r = e.boundingClientRect;
      // 「バーの上に隠れた」ときだけ表示する（画面の下に外れたときや、高さ0のときは表示しない）
      var gone = !e.isIntersecting && r.height > 0 && !!e.rootBounds && r.top < e.rootBounds.top;
      box.classList.toggle('is-visible', gone);
    }, { rootMargin: '-' + barH + 'px 0px 0px 0px', threshold: 0 }).observe(h1);
  }

  /* ===================== 初期化 ===================== */

  function init() {
    renderSiteNav();
    var items = buildToc();
    wrapTables();
    setupToggles();
    setupScrollSpy(items);
    setupPageTitle();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
