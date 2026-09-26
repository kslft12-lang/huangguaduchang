/* ============================================================
   🥒黄瓜赌场🥒 · 共享逻辑
   余额 / 记账 / 顶栏 / 提示条 / 音效
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'casino.balance';
  var STAT_KEY = 'casino.stats';
  var SFX_KEY = 'casino.sfx';
  var NAME_KEY = 'casino.name';
  var UID_KEY = 'casino.uid';
  var START = 1000;
  var MIN_BET = 10;

  /** 浏览器稳定身份（排行榜/昵称认领用；同浏览器所有页面共享） */
  function getUid() {
    try {
      var u = localStorage.getItem(UID_KEY);
      if (!u) {
        u = Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
        localStorage.setItem(UID_KEY, u);
      }
      return u;
    } catch (e) { return 'anon'; }
  }

  function getName() {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  }

  function setName(n) {
    try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* ignore */ }
    paint(false);
  }

  /** 昵称门槛：没设过昵称就弹全屏输入框，设好才放行（cb 收到昵称）。
      reason 用于重名等场景的再次弹出；promptName 强制弹出（改名/占用） */
  function requireName(reason, cb) {
    var existing = getName();
    if (existing) { cb(existing); return; }
    showNameGate(reason || '', cb);
  }

  function promptName(reason, prefill, cb) {
    showNameGate(reason || '', cb, prefill || '');
  }

  function showNameGate(reason, cb, prefill) {
    var gate = document.getElementById('nameGate');
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'nameGate';
      gate.className = 'name-gate';
      gate.innerHTML =
        '<div class="name-gate__box">' +
          '<h2 class="name-gate__title">🥒 进入黄瓜赌场 🥒</h2>' +
          '<p class="name-gate__msg" id="nameGateMsg"></p>' +
          '<input id="nameGateInput" class="name-gate__input" maxlength="12" placeholder="给自己起个昵称（1-12 字）" autocomplete="off">' +
          '<button class="btn btn--lg" id="nameGateBtn" type="button">进场</button>' +
        '</div>';
      document.body.appendChild(gate);
      var confirm = function () {
        var input = document.getElementById('nameGateInput');
        var n = (input.value || '').trim().slice(0, 12);
        if (!n) { input.focus(); return; }
        setName(n);
        gate.remove();
        cb(n);
      };
      document.getElementById('nameGateBtn').addEventListener('click', confirm);
      document.getElementById('nameGateInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') confirm();
      });
    }
    document.getElementById('nameGateMsg').textContent = reason;
    var inp = document.getElementById('nameGateInput');
    inp.value = prefill || '';
    setTimeout(function () { inp.focus(); }, 50);
  }

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
    ['pachinko', '弹珠机', 'pachinko.html'],
    ['tiger', '老虎机', 'tiger.html'],
    ['ddz', '斗地主', 'ddz.html'],
    ['scratch', '刮刮乐', 'scratch.html']
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
            '<span class="balance-chip__name" id="balanceName"></span>' +
            '<span class="balance-chip__glyph"></span>' +
            '<span class="balance-chip__label">小黄瓜</span>' +
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
    var nameEl = document.getElementById('balanceName');
    if (nameEl) nameEl.textContent = getName() ? getName() + ' 的' : '';
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
    noiseBuf: null,
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
    /** 短促高频咔哒：老虎机卷轴每划过一格响一次 */
    tick: function () { this.tone(1250, 0.02, 'square', 0.016); },

    /** 白噪声爆发，freq 是带通中心频率（掷骰子撞击、沙锤一类质感）；
        q 是带通品质因数，越高越"金属"（不传用 0.9 的宽钝声） */
    noise: function (dur, gain, freq, delay, q) {
      var ctx = this.audio();
      if (!ctx) return;
      try {
        if (!this.noiseBuf) {
          var len = Math.floor(ctx.sampleRate * 0.15);
          var buf = ctx.createBuffer(1, len, ctx.sampleRate);
          var data = buf.getChannelData(0);
          for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
          this.noiseBuf = buf;
        }
        var t0 = ctx.currentTime + (delay || 0);
        var src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = freq;
        bp.Q.value = q || 0.9;
        var amp = ctx.createGain();
        amp.gain.setValueAtTime(gain, t0);
        amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(bp).connect(amp).connect(ctx.destination);
        src.start(t0);
        src.stop(t0 + dur + 0.02);
      } catch (e) { /* 播放失败不影响游戏 */ }
    },

    /** 掷骰子撞击桌面：v 是冲击速度，越大越响、闷锤越沉（弹跳逐次衰减） */
    diceHit: function (v) {
      var k = Math.min(1, v / 12);
      this.noise(0.04 + 0.05 * k, 0.02 + 0.075 * k, 1400 + Math.random() * 900);
      this.tone(90 + 70 * k, 0.06 + 0.04 * k, 'triangle', 0.012 + 0.05 * k);
    },

    /* ---------- 弹珠机撞击声（物理步 120Hz 会刷出海量接触，全放会糊成一片） ---------- */
    _hitWin: 0,      // 限流窗口起点
    _hitLeft: 0,     // 窗口内剩余配额
    _hitLast: 0,     // 上一声的时刻，相邻两声至少隔 16ms
    _thudLast: 0,

    /** 弹珠撞击：type 'peg' 铜钉 | 'ball' 弹珠互撞 | 'wall' 壁板 | 'flipper' 翻板；
        v 是撞击速度，越大越响越亮；配额耗尽或间隔太近的接触直接丢弃 */
    marble: function (type, v) {
      var now = Date.now();
      if (now - this._hitWin > 100) { this._hitWin = now; this._hitLeft = 6; }
      if (this._hitLeft <= 0 || now - this._hitLast < 16) return;
      var k = Math.min(1, v / 7);
      if (k < 0.1) return;
      this._hitLeft--;
      this._hitLast = now;
      switch (type) {
        case 'peg':      // 钢珠碰铜钉：高频金属 ping
          this.tone(2500 + Math.random() * 1100 - 300 * k, 0.03 + 0.025 * k, 'triangle', 0.01 + 0.04 * k);
          this.noise(0.015 + 0.015 * k, 0.006 + 0.03 * k, 5200 + Math.random() * 1600, 0, 5);
          break;
        case 'ball':     // 玻璃珠互撞：更脆、更高、更短
          this.tone(3300 + Math.random() * 900, 0.022, 'sine', 0.012 + 0.05 * k);
          this.noise(0.012, 0.005 + 0.025 * k, 6800, 0, 6);
          break;
        case 'wall':     // 壁板：比钉子闷
          this.tone(200 + 90 * k, 0.05 + 0.03 * k, 'triangle', 0.012 + 0.04 * k);
          this.noise(0.03, 0.008 + 0.025 * k, 1100, 0, 1.2);
          break;
        case 'flipper':  // 翻板：木头 thunk
          this.tone(430 + 120 * k, 0.06, 'triangle', 0.012 + 0.04 * k);
          this.noise(0.035, 0.008 + 0.03 * k, 1900, 0, 1.5);
          break;
      }
    },

    /** 珠子落进底槽的闷响（多颗同落时限流，只响一声） */
    thud: function () {
      var now = Date.now();
      if (now - this._thudLast < 70) return;
      this._thudLast = now;
      this.noise(0.05, 0.05, 300, 0, 1.4);
      this.tone(140, 0.09, 'triangle', 0.05);
    },

    /** 大奖 fanfare（黄瓜三连）：上行琶音接长尾和弦 */
    bigwin: function () {
      var self = this;
      [523, 659, 784, 1047].forEach(function (f, i) { self.tone(f, 0.18, 'triangle', 0.05, i * 0.09); });
      [1047, 1319, 1568].forEach(function (f) { self.tone(f, 0.55, 'triangle', 0.045, 0.42); });
    },

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
        toast(balance < MIN_BET ? '余额不足，请领取救济金' : '余额不足 ' + n + ' 小黄瓜', 'lose');
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

    /** 整局净结果直接入账（斗地主联机结算用）：赢加输扣，余额地板 0 */
    applyNet: function (net) {
      net = Math.round(Number(net) || 0);
      if (net > 0) write(balance + net, true);
      else if (net < 0) write(balance + net, true);
      this.record(net, net === 0 ? 'push' : undefined);
    },

    /** 管理员直接设定余额（替换而非增减） */
    setBalance: function (n) {
      write(clampInt(n), true);
    },

    getName: getName,
    getUid: getUid,
    setName: setName,
    requireName: requireName,
    promptName: promptName,

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
      toast('已补满 ' + START + ' 小黄瓜', 'win');
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
