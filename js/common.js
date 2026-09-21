/* ============================================================
   🥒黄瓜赌场🥒 · 共享逻辑
   余额 / 记账 / 顶栏 / 提示条 / 音效
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'casino.balance';
  var STAT_KEY = 'casino.stats';
  var SFX_KEY = 'casino.sfx';
  var START = 1000;
  var MIN_BET = 10;

  function clampInt(n) {
    n = Math.floor(Number(n));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function readBalance() {
    try {
      var v = parseInt(localStorage.getItem(KEY), 10);
      return Number.isFinite(v) && v >= 0 ? v : START;
    } catch (e) {
      return START;
    }
  }

  function readStats() {
    var base = { rounds: 0, wins: 0, losses: 0, pushes: 0, wagered: 0, net: 0 };
    try {
      var raw = JSON.parse(localStorage.getItem(STAT_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        for (var k in base) if (Number.isFinite(raw[k])) base[k] = raw[k];
      }
    } catch (e) { /* 读不到就用默认值 */ }
    return base;
  }

  var balance = readBalance();
  var stats = readStats();
  var subscribers = [];

  /* ---------- 顶栏 ---------- */

  var NAV = [
    ['index', '主页', 'index.html'],
    ['dice', '骰子猜大小', 'dice.html'],
    ['versus', '骰子比大小', 'versus.html'],
    ['blackjack', '21点', 'blackjack.html'],
    ['pachinko', '弹珠机', 'pachinko.html']
  ];

  var topbarEl = null;
  var balanceValueEl = null;
  var balanceChipEl = null;
  var refillBtn = null;
  var sfxBtn = null;

  function buildTopbar(active) {
    var links = NAV.map(function (item) {
      var cls = 'nav__link' + (item[0] === active ? ' is-active' : '');
      return '<a class="' + cls + '" href="' + item[2] + '">' + item[1] + '</a>';
    }).join('');

    return '' +
      '<div class="topbar__inner">' +
        '<a class="brand" href="index.html">' +
          '<span class="brand__name">🥒黄瓜赌场🥒</span>' +
        '</a>' +
        '<nav class="nav">' + links + '</nav>' +
        '<div class="topbar__right">' +
          '<button class="btn btn--ghost btn--sm" id="sfxBtn" type="button" aria-pressed="false">音效 关</button>' +
          '<div class="balance-chip" id="balanceChip">' +
            '<span class="balance-chip__glyph"></span>' +
            '<span class="balance-chip__label">余额</span>' +
            '<span class="balance-chip__value" id="balanceValue">0</span>' +
          '</div>' +
          '<button class="btn btn--sm" id="refillBtn" type="button" hidden>领取救济金</button>' +
        '</div>' +
      '</div>';
  }

  function mountHeader(active) {
    topbarEl = document.getElementById('topbar-root');
    if (!topbarEl) return;
    topbarEl.className = 'topbar';
    topbarEl.innerHTML = buildTopbar(active);

    balanceValueEl = document.getElementById('balanceValue');
    balanceChipEl = document.getElementById('balanceChip');
    refillBtn = document.getElementById('refillBtn');
    sfxBtn = document.getElementById('sfxBtn');

    refillBtn.addEventListener('click', function () {
      Casino.reset();
    });

    sfxBtn.addEventListener('click', function () {
      Casino.sfx.toggle();
      syncSfxButton();
    });

    syncSfxButton();
    paint(false);
  }

  function syncSfxButton() {
    if (!sfxBtn) return;
    var on = Casino.sfx.enabled;
    sfxBtn.textContent = on ? '音效 开' : '音效 关';
    sfxBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function paint(pulse) {
    if (balanceValueEl) balanceValueEl.textContent = balance.toLocaleString('zh-CN');
    if (refillBtn) refillBtn.hidden = balance >= MIN_BET;
    if (pulse && balanceChipEl) {
      balanceChipEl.classList.remove('is-bump');
      void balanceChipEl.offsetWidth; // 强制重排，让动画能重复触发
      balanceChipEl.classList.add('is-bump');
    }
  }

  function notify() {
    subscribers.forEach(function (fn) {
      try { fn(balance); } catch (e) { /* 单个订阅者出错不影响其它 */ }
    });
  }

  function write(next, pulse) {
    balance = Math.max(0, clampInt(next));
    try { localStorage.setItem(KEY, String(balance)); } catch (e) { /* 隐私模式下忽略 */ }
    paint(pulse !== false);
    notify();
  }

  function saveStats() {
    try { localStorage.setItem(STAT_KEY, JSON.stringify(stats)); } catch (e) { /* ignore */ }
  }

  /* ---------- 提示条 ---------- */

  var toastHost = null;

  function toast(msg, kind, ms) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'toast-host';
      document.body.appendChild(toastHost);
    }
    var el = document.createElement('div');
    el.className = 'toast';
    if (kind) el.dataset.kind = kind;
    el.textContent = msg;
    toastHost.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 320);
    }, ms || 1800);
  }

  /* ---------- 音效（可选，默认关闭，允许浏览器拦截） ---------- */

  var sfx = {
    enabled: false,
    ctx: null,
    init: function () {
      if (this.enabled) return;
      this.enabled = true;
      try { localStorage.setItem(SFX_KEY, '1'); } catch (e) { /* ignore */ }
    },
    toggle: function () {
      this.enabled = !this.enabled;
      try { localStorage.setItem(SFX_KEY, this.enabled ? '1' : '0'); } catch (e) { /* ignore */ }
      if (this.enabled) this.tone(660, 0.07, 'triangle', 0.05);
    },
    audio: function () {
      if (!this.enabled) return null;
      try {
        if (!this.ctx) {
          var Ctor = global.AudioContext || global.webkitAudioContext;
          if (!Ctor) return null;
          this.ctx = new Ctor();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      } catch (e) {
        return null;
      }
    },
    tone: function (freq, dur, type, gain, delay) {
      var ctx = this.audio();
      if (!ctx) return;
      try {
        var t0 = ctx.currentTime + (delay || 0);
        var osc = ctx.createOscillator();
        var amp = ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        amp.gain.setValueAtTime(0, t0);
        amp.gain.linearRampToValueAtTime(gain || 0.05, t0 + 0.012);
        amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(amp).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      } catch (e) { /* 播放失败不影响游戏 */ }
    },
    click: function () { this.tone(300, 0.05, 'square', 0.035); },
    roll: function () { this.tone(180, 0.05, 'sawtooth', 0.03); },
    win: function () {
      var self = this;
      [523, 659, 784, 1047].forEach(function (f, i) { self.tone(f, 0.22, 'triangle', 0.05, i * 0.075); });
    },
    lose: function () {
      var self = this;
      [330, 247].forEach(function (f, i) { self.tone(f, 0.26, 'sawtooth', 0.04, i * 0.11); });
    }
  };

  try { sfx.enabled = localStorage.getItem(SFX_KEY) === '1'; } catch (e) { sfx.enabled = false; }

  /* ---------- 对外接口 ---------- */

  var Casino = {
    START: START,
    MIN_BET: MIN_BET,
    sfx: sfx,
    mountHeader: mountHeader,

    getBalance: function () { return balance; },
    getStats: function () { return Object.assign({}, stats); },

    canBet: function (n) { return n >= MIN_BET && n <= balance; },

    /** 扣下注金；余额不足返回 false 并提示 */
    bet: function (n) {
      if (!this.canBet(n)) {
        toast(balance < MIN_BET ? '余额不足，请领取救济金' : '余额不足 ' + n + ' 筹码', 'lose');
        sfx.lose();
        return false;
      }
      write(balance - n, true);
      return true;
    },

    /** 返还本金（平局用） */
    refund: function (n) { if (n > 0) write(balance + n, true); },

    /** 派彩（含本金）；net 为净收益，用于记账 */
    payout: function (n, net) {
      if (n > 0) write(balance + n, true);
      this.record(net || 0);
    },

    /** 只记账不动余额（比如输掉已扣的本金）；余额没变但统计变了，同样要通知界面刷新 */
    record: function (net, kind) {
      stats.rounds++;
      stats.net += Math.round(net);
      if ((kind || '') === 'push') stats.pushes++;
      else if (net > 0) stats.wins++;
      else if (net < 0) stats.losses++;
      saveStats();
      notify();
    },

    addWager: function (n) {
      stats.wagered += Math.round(n);
      saveStats();
    },

    reset: function () {
      write(START, true);
      toast('已补满 ' + START + ' 筹码', 'win');
      sfx.win();
    },

    clearStats: function () {
      stats = { rounds: 0, wins: 0, losses: 0, pushes: 0, wagered: 0, net: 0 };
      saveStats();
    },

    onChange: function (fn) { if (typeof fn === 'function') subscribers.push(fn); },
    toast: toast
  };

  // 多标签页之间同步余额
  global.addEventListener('storage', function (e) {
    if (e.key !== KEY && e.key !== STAT_KEY) return;
    if (e.key === KEY) { balance = readBalance(); paint(true); }
    else { stats = readStats(); }
    notify();
  });

  global.Casino = Casino;
})(window);
