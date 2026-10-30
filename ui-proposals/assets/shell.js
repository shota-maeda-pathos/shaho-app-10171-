// 共通の枠（試作バー・サイドバー・上部バー）を差し込む。各ページは <body data-nav="..." data-crumbs="a|b|c"> を書くだけ。
(function () {
  var PAGES = [
    ['index.html', '考え方'],
    ['home.html', 'ホーム'],
    ['procedures.html', '手続き一覧'],
    ['bonus.html', '賞与（多人数）'],
    ['onboarding.html', '入社（一覧）'],
    ['onboarding-person.html', '入社（1人）'],
    ['approvals.html', '承認'],
    ['filings.html', '届出'],
    ['employee.html', '従業員'],
    ['decide-why.html', '比較：説明'],
    ['decide-person-list.html', '比較：1人ずつ'],
    ['decide-detail.html', '比較：内訳']
  ];
  var THEMES = [['slate', '#53749B'], ['teal', '#257F7A'], ['iris', '#7162C5'], ['graphite', '#53565D']];
  var ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    proc: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    approve: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    filing: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'
  };
  var NAV = [
    ['home', 'home.html', 'ホーム', ''],
    ['proc', 'procedures.html', '手続き', '<span class="badge">5</span>'],
    ['approve', 'approvals.html', '承認', '<span class="badge soft">2</span>'],
    ['filing', 'filings.html', '届出', ''],
    ['people', 'employee.html', '従業員', '']
  ];

  function icon(k) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + ICON[k] + '</svg>';
  }
  // ロゴの3本線。右端をそろえ、下ほど長い
  window.ordiaMark = function (size) {
    var s = size || 26;
    return '<svg width="' + s + '" height="' + s * 0.8 + '" viewBox="0 0 34 27" aria-hidden="true"><g fill="var(--brand)" transform="skewX(-22) translate(10 0)">' +
      '<rect x="9" y="0" width="17" height="7" rx="3.2"/><rect x="4.5" y="10" width="21.5" height="7" rx="3.2"/><rect x="0" y="20" width="26" height="7" rx="3.2"/></g></svg>';
  };

  var theme = 'slate';
  try { theme = localStorage.getItem('ordia-theme') || 'slate'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', theme);

  document.addEventListener('DOMContentLoaded', function () {
    var body = document.body;
    var here = location.pathname.split('/').pop() || 'index.html';
    var navKey = body.getAttribute('data-nav');
    var crumbs = (body.getAttribute('data-crumbs') || '').split('|').filter(Boolean);
    var page = document.querySelector('[data-page]');

    var proto = '<div class="proto"><strong>Ordia UI提案</strong>' +
      PAGES.map(function (p) { return '<a href="' + p[0] + '"' + (p[0] === here ? ' class="on"' : '') + '>' + p[1] + '</a>'; }).join('') +
      '<span class="themes"><span>配色</span>' +
      THEMES.map(function (t) { return '<button type="button" title="' + t[0] + '" data-theme="' + t[0] + '" style="background:' + t[1] + '"' + (t[0] === theme ? ' class="on"' : '') + '></button>'; }).join('') +
      '</span></div>';

    var side = '<aside class="side"><div class="logo">' + window.ordiaMark(30) + '<span class="word">Ordia</span></div>' +
      '<div class="office-switch">東京本社 <span>▾</span></div><nav class="nav">' +
      NAV.map(function (n) { return '<a href="' + n[1] + '"' + (n[0] === navKey ? ' class="on"' : '') + '>' + icon(n[0]) + n[2] + n[3] + '</a>'; }).join('') +
      '<div class="nav-label">管理</div><a href="#">' + icon('settings') + '事業所・設定</a></nav>' +
      '<div class="side-foot"><span class="avatar">山</span><div>山本 彩<br><span class="small">担当者・サンプル株式会社</span></div></div></aside>';

    var top = '<header class="topbar"><div class="crumbs">' +
      crumbs.map(function (c, i) { return i === crumbs.length - 1 ? '<b>' + c + '</b>' : c + ' / '; }).join('') +
      '</div><div class="search">⌕ 従業員・手続きを探す　Ctrl+K</div></header>';

    var wrap = document.createElement('div');
    wrap.innerHTML = proto + '<div class="app">' + side + '<div class="main">' + top + '</div></div>';
    var main = wrap.querySelector('.main');
    if (page) main.appendChild(page);
    var frag = document.createDocumentFragment();
    while (wrap.firstChild) frag.appendChild(wrap.firstChild);
    body.insertBefore(frag, body.firstChild);

    document.querySelectorAll('.proto .themes button').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = b.getAttribute('data-theme');
        document.documentElement.setAttribute('data-theme', t);
        try { localStorage.setItem('ordia-theme', t); } catch (e) {}
        document.querySelectorAll('.proto .themes button').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
    document.querySelectorAll('[data-mark]').forEach(function (el) { el.innerHTML = window.ordiaMark(+el.getAttribute('data-mark')); });
  });

  // タブ・チップの切り替え（見た目だけ）
  document.addEventListener('click', function (e) {
    var t = e.target.closest('.tabs button, .chips .chip');
    if (!t) return;
    t.parentElement.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b === t); });
    var f = t.getAttribute('data-filter');
    var table = t.closest('.card') && t.closest('.card').querySelector('tbody[data-filterable]');
    if (table && f !== null) {
      table.querySelectorAll('tr').forEach(function (tr) {
        tr.style.display = !f || (tr.getAttribute('data-tags') || '').split(' ').indexOf(f) >= 0 ? '' : 'none';
      });
    }
  });
})();
