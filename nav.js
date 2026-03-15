(function () {
  var path = window.location.pathname.replace(/\/$/, '') || '/';

  function active(href) {
    var h = href.replace(/\/$/, '') || '/';
    if (h === '/') return path === '/';
    return path === h || path.startsWith(h + '/');
  }

  var GROUPS = [
    {
      label: 'Linux',
      items: [
        { href: '/',               label: 'chmod' },
        { href: '/cron',           label: 'cron' },
        { href: '/file-size',      label: 'file size' },
        { href: '/linux-commands', label: 'commands' },
      ]
    },
    {
      label: 'Text',
      items: [
        { href: '/json',     label: 'json' },
        { href: '/regex',    label: 'regex' },
        { href: '/diff',     label: 'diff' },
        { href: '/password', label: 'password' },
      ]
    },
    {
      label: 'Encode',
      items: [
        { href: '/base64',     label: 'base64' },
        { href: '/url-encode', label: 'url encode' },
        { href: '/uuid',       label: 'uuid' },
        { href: '/jwt',        label: 'jwt' },
      ]
    },
    {
      label: 'Web',
      items: [
        { href: '/http-status', label: 'http status' },
        { href: '/timestamp',   label: 'timestamp' },
        { href: '/dns',         label: 'dns & whois' },
      ]
    },
  ];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var html = '<nav class="topnav"><div class="nav-inner">';

  // Brand
  html += '<a href="/" class="nav-brand"><span class="nav-brand-icon">⚙</span>SysUtil</a>';
  html += '<div class="nav-sep"></div>';
  html += '<div class="nav-links">';

  // Groups with dropdowns
  GROUPS.forEach(function (g) {
    var groupActive = g.items.some(function (i) { return active(i.href); });
    html += '<div class="nav-group' + (groupActive ? ' nav-group-active' : '') + '">';
    html += '<button class="nav-group-btn" aria-expanded="false">' + esc(g.label) + '<span class="nav-caret">▾</span></button>';
    html += '<div class="nav-dropdown" role="menu">';
    g.items.forEach(function (item) {
      html += '<a href="' + esc(item.href) + '" role="menuitem"' + (active(item.href) ? ' class="active"' : '') + '>' + esc(item.label) + '</a>';
    });
    html += '</div></div>';
  });

  // Direct links
  html += '<div class="nav-sep-v"></div>';
  html += '<a href="/ai" class="nav-ai-link' + (active('/ai') ? ' active' : '') + '">✦ AI</a>';
  html += '<a href="/blog"' + (active('/blog') ? ' class="active"' : '') + '>guides</a>';

  html += '</div></div></nav>';

  // Inject nav before the script tag
  var script = document.currentScript;
  var nav = document.createElement('div');
  nav.innerHTML = html;
  script.parentNode.insertBefore(nav.firstChild, script);

  // Dropdown open/close logic
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.nav-group-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = btn.getAttribute('aria-expanded') === 'true';
        // Close all
        document.querySelectorAll('.nav-group-btn').forEach(function (b) {
          b.setAttribute('aria-expanded', 'false');
          b.closest('.nav-group').classList.remove('open');
        });
        // Toggle this one
        if (!isOpen) {
          btn.setAttribute('aria-expanded', 'true');
          btn.closest('.nav-group').classList.add('open');
        }
      });
    });

    // Close on outside click
    document.addEventListener('click', function () {
      document.querySelectorAll('.nav-group-btn').forEach(function (b) {
        b.setAttribute('aria-expanded', 'false');
        b.closest('.nav-group').classList.remove('open');
      });
    });
  });
})();
