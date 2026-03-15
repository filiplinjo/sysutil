(function () {
  var path = window.location.pathname.replace(/\/$/, '') || '/';

  function active(href) {
    var h = href.replace(/\/$/, '') || '/';
    if (h === '/') return path === '/';
    return path === h || path.startsWith(h + '/');
  }

  function link(href, label) {
    var cls = active(href) ? ' class="active"' : '';
    return '<a href="' + href + '"' + cls + '>' + label + '</a>';
  }

  // Show Tools button as active if current page is a tool
  var toolPaths = ['/', '/cron', '/file-size', '/linux-commands',
                   '/json', '/regex', '/diff', '/password',
                   '/base64', '/url-encode', '/uuid', '/jwt',
                   '/http-status', '/timestamp', '/dns'];
  var toolActive = toolPaths.some(function (p) {
    var h = p.replace(/\/$/, '') || '/';
    if (h === '/') return path === '/';
    return path === h || path.startsWith(h + '/');
  });

  var nav =
    '<nav class="topnav"><div class="nav-inner">' +
      '<a href="/" class="nav-brand"><span class="nav-brand-icon">⚙</span>SysUtil</a>' +
      '<div class="nav-links">' +

        // ── Tools dropdown ──────────────────────────────────────
        '<div class="nav-dropdown">' +
          '<button class="nav-tools-btn' + (toolActive ? ' active' : '') + '">' +
            'Tools <span class="nav-tools-arrow">▾</span>' +
          '</button>' +
          '<div class="nav-dropdown-panel">' +
            '<div class="nav-dropdown-grid">' +

              '<div class="nav-cat">' +
                '<div class="nav-cat-label">Linux</div>' +
                link('/', 'chmod') +
                link('/cron', 'cron') +
                link('/file-size', 'file size') +
                link('/linux-commands', 'commands') +
              '</div>' +

              '<div class="nav-cat">' +
                '<div class="nav-cat-label">Text / Code</div>' +
                link('/json', 'json') +
                link('/regex', 'regex') +
                link('/diff', 'diff') +
                link('/password', 'password') +
              '</div>' +

              '<div class="nav-cat">' +
                '<div class="nav-cat-label">Encode</div>' +
                link('/base64', 'base64') +
                link('/url-encode', 'url encode') +
                link('/uuid', 'uuid') +
                link('/jwt', 'jwt') +
              '</div>' +

              '<div class="nav-cat">' +
                '<div class="nav-cat-label">Web / Network</div>' +
                link('/http-status', 'http status') +
                link('/timestamp', 'timestamp') +
                link('/dns', 'dns') +
              '</div>' +

            '</div>' +
          '</div>' +
        '</div>' +
        // ────────────────────────────────────────────────────────

        '<a href="/blog"' + (active('/blog') ? ' class="active"' : '') + '>Guides</a>' +
        '<a href="/ai" class="nav-ai-link' + (active('/ai') ? ' active' : '') + '">✦ AI</a>' +

      '</div>' +
    '</div></nav>';

  // ── Tool strip ──────────────────────────────────────────────
  function tsLink(href, label) {
    var cls = active(href) ? ' active' : '';
    return '<a href="' + href + '" class="ts-link' + cls + '">' + label + '</a>';
  }

  var strip =
    '<div class="tool-strip"><div class="tool-strip-inner">' +
      tsLink('/', 'chmod') +
      tsLink('/cron', 'cron') +
      tsLink('/file-size', 'file size') +
      tsLink('/linux-commands', 'commands') +
      '<span class="ts-sep"></span>' +
      tsLink('/json', 'json') +
      tsLink('/regex', 'regex') +
      tsLink('/diff', 'diff') +
      tsLink('/password', 'password') +
      '<span class="ts-sep"></span>' +
      tsLink('/base64', 'base64') +
      tsLink('/url-encode', 'url encode') +
      tsLink('/uuid', 'uuid') +
      tsLink('/jwt', 'jwt') +
      '<span class="ts-sep"></span>' +
      tsLink('/http-status', 'http status') +
      tsLink('/timestamp', 'timestamp') +
      tsLink('/dns', 'dns') +
    '</div></div>';

  var script = document.currentScript;
  var tmp    = document.createElement('div');
  tmp.innerHTML = nav + strip;
  var navEl   = tmp.children[0];
  var stripEl = tmp.children[1];
  script.parentNode.insertBefore(stripEl, script);
  script.parentNode.insertBefore(navEl, stripEl);

  // ── Dropdown behaviour ──────────────────────────────────────
  var btn   = navEl.querySelector('.nav-tools-btn');
  var panel = navEl.querySelector('.nav-dropdown-panel');

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = panel.classList.toggle('open');
    btn.classList.toggle('open', open);
  });

  // Close on outside click
  document.addEventListener('click', function () {
    panel.classList.remove('open');
    btn.classList.remove('open');
  });

  // Don't close when clicking inside the panel
  panel.addEventListener('click', function (e) { e.stopPropagation(); });

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      panel.classList.remove('open');
      btn.classList.remove('open');
    }
  });
})();
