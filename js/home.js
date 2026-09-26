/* 主页：排行榜 + 管理员面板（数据源是 common.js 的玩家注册表，
   MQTT retained 条目聚合；面板结构见 index.html） */
(function () {
  'use strict';

  var lbList = document.getElementById('lbList');
  var adminRows = document.getElementById('adminRows');
  var adminGate = document.getElementById('adminGate');
  var adminBody = document.getElementById('adminBody');
  var adminKeyInput = document.getElementById('adminKeyInput');
  var adminKeyBtn = document.getElementById('adminKeyBtn');

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  function sortedUsers() {
    var users = Casino.registryUsers();
    return Object.keys(users).map(function (n) { return users[n]; })
      .sort(function (a, b) { return (b.balance | 0) - (a.balance | 0); })
      .slice(0, 30);
  }

  function renderLeaderboard() {
    var rows = sortedUsers();
    if (!rows.length) { lbList.innerHTML = '<p class="room-empty">还没有玩家数据</p>'; return; }
    var myName = Casino.getName();
    lbList.innerHTML = rows.map(function (e, i) {
      var online = Date.now() - (e.ts | 0) < 60000;
      var me = e.name === myName;
      return '<div class="lb-row' + (me ? ' is-me' : '') + '">' +
        '<b class="lb-rank">' + (i + 1) + '</b>' +
        '<span class="lb-name">' + esc(e.name) + (me ? '（我）' : '') + '</span>' +
        '<i class="dot' + (online ? ' is-ok' : '') + '"></i>' +
        '<b class="lb-balance">' + (e.balance | 0).toLocaleString('zh-CN') + '</b></div>';
    }).join('');
  }

  function renderAdmin() {
    if (!unlocked()) { adminGate.hidden = false; adminBody.hidden = true; return; }
    adminGate.hidden = true;
    adminBody.hidden = false;
    var rows = sortedUsers();
    adminRows.innerHTML = rows.map(function (e) {
      var online = Date.now() - (e.ts | 0) < 60000;
      return '<div class="lb-row">' +
        '<span class="lb-name">' + esc(e.name) + (online ? '' : '（离线）') + '</span>' +
        '<input class="ddz-code-input admin-amt" data-name="' + esc(e.name) + '" value="' + (e.balance | 0) + '" inputmode="numeric">' +
        '<button class="btn btn--sm" data-admin="' + esc(e.name) + '" type="button">设置</button></div>';
    }).join('') || '<p class="room-empty">还没有玩家数据</p>';
  }

  function unlocked() {
    try { return sessionStorage.getItem('casinoAdmin') === '1'; } catch (e) { return false; }
  }

  adminKeyBtn.addEventListener('click', function () {
    if (adminKeyInput.value === Casino.ADMIN_KEY) {
      try { sessionStorage.setItem('casinoAdmin', '1'); } catch (e) { /* ignore */ }
      Casino.toast('管理员面板已解锁', 'win');
      renderAdmin();
    } else {
      Casino.toast('口令不对', 'lose');
    }
  });

  adminRows.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-admin]') : null;
    if (!btn) return;
    var name = btn.getAttribute('data-admin');
    var input = adminRows.querySelector('.admin-amt[data-name="' + name.replace(/"/g, '\\"') + '"]');
    var v = Math.max(0, Math.round(Number(input && input.value) || 0));
    var users = Casino.registryUsers();
    var cur = users[name] || { rev: 0 };
    var entry = { t: 'u', name: name, balance: v, ts: Date.now(), rev: (cur.rev | 0) + 1, uid: 'admin' };
    // retained 条目让排行榜立刻更新；点对点命令让在线玩家即时采纳
    var conn = null;
    // 借用注册表的连接发（common.js 未暴露原始连接，走两条 retained/命令主题）
    Casino.adminPublish(name, entry, v);
    Casino.toast('已把 ' + name + ' 的余额设为 ' + v, 'win');
  });

  Casino.onRegistry(function () { renderLeaderboard(); renderAdmin(); });
  Casino.onName(function () { renderLeaderboard(); });
  renderLeaderboard();
  renderAdmin();
})();
