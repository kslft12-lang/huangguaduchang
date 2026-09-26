/* 弹珠机（物理与赔率表在 js/pachinko-core.js，与 tools/sim-pachinko.js 共用同一份） */
(function () {
  'use strict';

  Casino.mountHeader('pachinko');

  var Core = window.PachinkoCore;
  var W = Core.W, H = Core.H;
  var MAX_BALLS = 10;
  var CHIPS = [10, 50, 100, 500];
  var LEVEL_KEY = 'casino.pachinko.level';

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var field = document.createElement('canvas');
  var ballCountEl = document.getElementById('ballCount');
  var hintEl = document.getElementById('hint');
  var banner = document.getElementById('banner');
  var dropBtn = document.getElementById('dropBtn');
  var clearBtn = document.getElementById('clearBtn');
  var chipRow = document.getElementById('chipRow');
  var legendEl = document.getElementById('legend');
  var levelRow = document.getElementById('levelRow');
  var levelBlurb = document.getElementById('levelBlurb');

  var levelKey = Core.DEFAULT_LEVEL;
  try {
    var saved = localStorage.getItem(LEVEL_KEY);
    if (saved && Core.LEVELS[saved]) levelKey = saved;
  } catch (e) { /* 隐私模式忽略 */ }

  var lvl = Core.level(levelKey);
  var cfg = Core.config(levelKey);
  var pegs = Core.buildPegs(levelKey);
  var balls = [];
  var picked = 50;
  var dpr = 1;

  /* ---------- 配色 ---------- */

  function tierOf(m, maxM) {
    if (m === 0) return 'zero';
    if (m < 1) return 'low';
    if (m === 1) return 'flat';
    return m >= maxM ? 'high' : 'mid';
  }

  var STYLE = {
    high: { fill: 'rgba(232,184,75,.22)', stroke: '#e8b84b', text: '#f8dd8f' },
    mid: { fill: 'rgba(61,220,151,.15)', stroke: 'rgba(61,220,151,.8)', text: '#3ddc97' },
    flat: { fill: 'rgba(255,255,255,.06)', stroke: 'rgba(255,255,255,.3)', text: '#a49b8c' },
    low: { fill: 'rgba(232,184,75,.08)', stroke: 'rgba(232,184,75,.45)', text: '#d8c48a' },
    zero: { fill: 'rgba(239,91,107,.10)', stroke: 'rgba(239,91,107,.6)', text: '#ef5b6b' }
  };

  function slotStyle(m) {
    return STYLE[tierOf(m, Math.max.apply(null, lvl.mults))];
  }

  /* ---------- 静态底图预渲染 ---------- */

  function buildField() {
    field.width = W * dpr;
    field.height = H * dpr;
    var f = field.getContext('2d');
    f.setTransform(dpr, 0, 0, dpr, 0, 0);

    var bg = f.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0d2119');
    bg.addColorStop(0.55, '#071410');
    bg.addColorStop(1, '#040c09');
    f.fillStyle = bg;
    f.fillRect(0, 0, W, H);

    // 顶部投币口
    f.fillStyle = 'rgba(232,184,75,.7)';
    f.fillRect(W / 2 - 46, 18, 92, 4);
    f.fillStyle = 'rgba(232,184,75,.16)';
    f.fillRect(W / 2 - 26, 22, 52, 30);

    // 铜钉
    pegs.forEach(function (p) {
      f.beginPath();
      f.arc(p.x, p.y + 1.5, cfg.PEG_R, 0, Math.PI * 2);
      f.fillStyle = 'rgba(0,0,0,.55)';
      f.fill();

      var g = f.createRadialGradient(p.x - 1.8, p.y - 2, 0.5, p.x, p.y, cfg.PEG_R);
      g.addColorStop(0, '#fdf0c4');
      g.addColorStop(0.5, '#d8a93c');
      g.addColorStop(1, '#7a5716');
      f.beginPath();
      f.arc(p.x, p.y, cfg.PEG_R, 0, Math.PI * 2);
      f.fillStyle = g;
      f.fill();
    });

    // 底槽
    var maxM = Math.max.apply(null, lvl.mults);
    lvl.mults.forEach(function (m, i) {
      var x = i * cfg.SLOT_W;
      var st = STYLE[tierOf(m, maxM)];

      f.fillStyle = st.fill;
      f.fillRect(x + 2, cfg.SLOT_TOP, cfg.SLOT_W - 4, H - cfg.SLOT_TOP - 2);

      f.strokeStyle = st.stroke;
      f.lineWidth = m === 0 ? 2 : 1;
      f.strokeRect(x + 2, cfg.SLOT_TOP + 0.5, cfg.SLOT_W - 4, H - cfg.SLOT_TOP - 2);

      f.fillStyle = st.text;
      f.font = '700 17px ui-monospace, Consolas, monospace';
      f.textAlign = 'center';
      f.textBaseline = 'middle';
      f.fillText(m + '×', x + cfg.SLOT_W / 2, cfg.SLOT_TOP + 38);

      if (m === 0) {
        f.font = '600 11px system-ui, sans-serif';
        f.fillText('空槽', x + cfg.SLOT_W / 2, cfg.SLOT_TOP + 60);
      }
    });

    // 槽口分隔线
    f.strokeStyle = 'rgba(232,184,75,.35)';
    f.lineWidth = 1;
    f.beginPath();
    f.moveTo(0, cfg.SLOT_TOP);
    f.lineTo(W, cfg.SLOT_TOP);
    f.stroke();

    // 黄铜机框：左右立柱 + 顶梁 + 底梁 + 铆钉（画在底槽之后，边框保持完整）
    var rail = f.createLinearGradient(0, 0, cfg.WALL, 0);
    rail.addColorStop(0, '#f8dd8f');
    rail.addColorStop(0.45, '#d8a93c');
    rail.addColorStop(1, '#6e4e12');
    f.fillStyle = rail;
    f.fillRect(0, 0, cfg.WALL, H);
    f.fillRect(W - cfg.WALL, 0, cfg.WALL, H);
    f.fillRect(0, 0, W, 5);
    f.fillRect(0, H - 4, W, 4);

    // 内侧暗边，机框看起来有厚度
    f.fillStyle = 'rgba(0,0,0,.55)';
    f.fillRect(cfg.WALL - 1.5, 0, 1.5, H);
    f.fillRect(W - cfg.WALL, 0, 1.5, H);

    // 铆钉
    [[cfg.WALL / 2, 24], [cfg.WALL / 2, H - 20], [W - cfg.WALL / 2, 24], [W - cfg.WALL / 2, H - 20],
     [cfg.WALL / 2, cfg.SLOT_TOP - 14], [W - cfg.WALL / 2, cfg.SLOT_TOP - 14]]
      .forEach(function (p) {
        f.beginPath();
        f.arc(p[0], p[1], 3.2, 0, Math.PI * 2);
        f.fillStyle = 'rgba(0,0,0,.55)';
        f.fill();
        f.beginPath();
        f.arc(p[0] - 0.6, p[1] - 0.8, 2.3, 0, Math.PI * 2);
        f.fillStyle = '#f8dd8f';
        f.fill();
      });
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildField();
  }

  /* ---------- 结算 ---------- */

  function land(b) {
    Casino.sfx.thud();
    var idx = Core.slotOf(b.x, cfg);
    var mult = lvl.mults[idx];
    var ret = Math.round(b.stake * mult);
    var net = ret - b.stake;

    if (ret > 0) Casino.payout(ret, net);
    else Casino.record(-b.stake);

    banner.dataset.kind = net > 0 ? 'win' : (net < 0 ? 'lose' : 'push');
    banner.innerHTML = '落在第 ' + (idx + 1) + ' 槽（' + mult + '×），下注 ' + b.stake +
      ' → 返还 <span class="banner__amount">' + ret.toLocaleString('zh-CN') + '</span>';

    if (net > 0) { Casino.toast('+' + net + ' 小黄瓜', 'win'); Casino.sfx.win(); }
    else if (net < 0) { Casino.toast(net + ' 小黄瓜', 'lose'); Casino.sfx.lose(); }
    else { Casino.toast('保本', 'push'); Casino.sfx.click(); }
  }

  /* ---------- 主循环 ---------- */

  var acc = 0;
  var last = 0;
  var hitEvents = [];   // 物理步推出的撞击事件，浏览器拿来播撞击音效（模拟器不用）

  function frame(t) {
    if (!last) last = t;
    var dt = Math.min(t - last, 60);
    last = t;
    acc += dt;

    var scale = cfg.STEP / (1000 / 60);
    while (acc >= cfg.STEP) {
      cfg.tick = (cfg.tick || 0) + 1;   // 每物理步推进一次挡板相位（与模拟器同速率）
      hitEvents.length = 0;
      for (var i = balls.length - 1; i >= 0; i--) {
        var b = balls[i];
        Core.step(b, pegs, cfg, Math.random, scale, hitEvents);
        if (Core.landed(b, cfg)) {
          b.y = H - 4 - cfg.BALL_R;
          balls.splice(i, 1);
          land(b);
        }
      }
      Core.collideBalls(balls, cfg, hitEvents);   // 台面多颗珠时互相碰撞
      for (var e = 0; e < hitEvents.length; e++) {
        Casino.sfx.marble(hitEvents[e].t, hitEvents[e].v);
      }
      acc -= cfg.STEP;
    }

    draw();
    ballCountEl.textContent = String(balls.length);
    requestAnimationFrame(frame);
  }

  function drawFlipper() {
    var t = cfg.tick || 0;
    var hw = cfg.FLIPPER_HALF_W;
    [-1, 1].forEach(function (side) {
      var s = Core.flipperSeg(cfg, side, t);

      // 阴影
      ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.lineCap = 'round';
      ctx.lineWidth = hw * 2 + 3;
      ctx.beginPath();
      ctx.moveTo(s.px, s.py + 4);
      ctx.lineTo(s.tx, s.ty + 4);
      ctx.stroke();

      // 桨身（黄铜渐变：枢轴暗、板头亮，呈现一体铸造感）
      var g = ctx.createLinearGradient(s.px, s.py, s.tx, s.ty);
      g.addColorStop(0, '#8a6418');
      g.addColorStop(0.5, '#d8a93c');
      g.addColorStop(1, '#b8862a');
      ctx.strokeStyle = g;
      ctx.lineWidth = hw * 2;
      ctx.beginPath();
      ctx.moveTo(s.px, s.py);
      ctx.lineTo(s.tx, s.ty);
      ctx.stroke();

      // 板头圆片（加厚的桨端，带一颗受光点）
      ctx.beginPath();
      ctx.arc(s.tx, s.ty, hw + 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#d8a93c';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.tx - side * 1.5, s.ty - 1.5, hw - 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#eec568';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.tx - side * 2.4, s.ty - 2.4, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(253,240,196,.75)';
      ctx.fill();

      // 轴心铆钉
      ctx.beginPath();
      ctx.arc(s.px, s.py, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.px, s.py, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#d8a93c';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.px - 1, s.py - 1.2, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fill();
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(field, 0, 0, W, H);
    drawFlipper();

    balls.forEach(function (b) {
      b.trail.forEach(function (p, i) {
        var k = (i + 1) / b.trail.length;
        ctx.beginPath();
        ctx.arc(p.x, p.y, cfg.BALL_R * 0.55 * k, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(248,221,143,' + (0.22 * k).toFixed(3) + ')';
        ctx.fill();
      });

      var g = ctx.createRadialGradient(b.x - 2.5, b.y - 3, 0.5, b.x, b.y, cfg.BALL_R);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.45, '#f6dc94');
      g.addColorStop(1, '#a9791c');
      ctx.beginPath();
      ctx.arc(b.x, b.y, cfg.BALL_R, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  /* ---------- 难度切换 ---------- */

  function renderLevels() {
    levelRow.innerHTML = Core.levelList().map(function (L) {
      var on = L.key === levelKey ? ' is-on' : '';
      var top = Math.max.apply(null, L.mults);
      return '<button type="button" class="level-btn' + on + '" data-key="' + L.key + '">' +
        '<b>' + L.label + '</b>' +
        '<span>最高 ' + top + '×</span>' +
        '</button>';
    }).join('');
    levelBlurb.textContent = lvl.blurb;
  }

  function renderLegend() {
    var maxM = Math.max.apply(null, lvl.mults);
    legendEl.innerHTML = lvl.mults.map(function (m, i) {
      var where = i === 0 ? '最左'
        : i === lvl.mults.length - 1 ? '最右'
        : i === (lvl.mults.length - 1) / 2 ? '正中'
        : String(i + 1);
      return '<div class="slot-line" data-tier="' + tierOf(m, maxM) + '">' +
        '<span>第 ' + (i + 1) + ' 槽（' + where + '）</span>' +
        '<b>' + m + '× · ' + (lvl.prob[i] * 100).toFixed(1) + '%</b></div>';
    }).join('');
  }

  function setLevel(key) {
    if (key === levelKey || !Core.LEVELS[key]) return;

    // 台面上还没落底的珠子是按旧台面造的，换台面前把本金退回去
    if (balls.length) {
      var n = balls.length;
      var refund = balls.reduce(function (a, b) { return a + b.stake; }, 0);
      balls.length = 0;
      Casino.refund(refund);
      Casino.toast('换关卡，台面 ' + n + ' 颗珠本金 ' + refund + ' 已退还', 'push', 2600);
    }

    levelKey = key;
    try { localStorage.setItem(LEVEL_KEY, key); } catch (e) { /* ignore */ }
    lvl = Core.level(key);
    cfg = Core.config(key);
    pegs = Core.buildPegs(key);
    acc = 0;

    banner.dataset.kind = 'push';
    banner.textContent = '已切到「' + lvl.label + '」，选小黄瓜后投币。';

    renderLevels();
    renderLegend();
    resize();     // 重建底图
    render();
    draw();
  }

  /* ---------- 界面 ---------- */

  function currentBet() { return picked; }

  function render() {
    var flying = balls.length;
    var maxed = flying >= MAX_BALLS;

    Array.prototype.forEach.call(chipRow.children, function (el) {
      var cost = Number(el.dataset.value);
      el.classList.toggle('is-on', picked === cost);
      el.disabled = cost > Casino.getBalance() || cost < Casino.MIN_BET;
    });

    dropBtn.disabled = maxed || !Casino.canBet(currentBet());
    clearBtn.disabled = flying === 0;
    dropBtn.textContent = maxed ? '台面已满' : ('投币 ' + currentBet().toLocaleString('zh-CN'));
    hintEl.textContent = flying ? '台面 ' + flying + ' 颗，落底自动结算' : '选小黄瓜 → 投币';
  }

  function drop() {
    if (balls.length >= MAX_BALLS) {
      Casino.toast('台面上最多 ' + MAX_BALLS + ' 颗珠', 'lose');
      return;
    }
    var stake = currentBet();
    if (!Casino.bet(stake)) return;

    Casino.addWager(stake);
    var b = Core.ball(Math.random, cfg);
    b.stake = stake;
    b.trail = [];
    balls.push(b);

    Casino.sfx.roll();
    banner.dataset.kind = 'push';
    banner.textContent = '珠子下落中…下注 ' + stake;
    render();
  }

  /* ---------- 启动 ---------- */

  CHIPS.forEach(function (v) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip-btn';
    b.dataset.value = String(v);
    b.textContent = String(v);
    b.addEventListener('click', function () {
      picked = v;
      Casino.sfx.click();
      render();
    });
    chipRow.appendChild(b);
  });

  levelRow.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.level-btn') : null;
    if (!btn) return;
    Casino.sfx.click();
    setLevel(btn.dataset.key);
  });

  dropBtn.addEventListener('click', drop);
  clearBtn.addEventListener('click', function () {
    if (!balls.length) return;
    var n = balls.length;
    balls.length = 0;
    Casino.toast('已清空台面，' + n + ' 颗未落底的珠子不退还', 'lose', 2600);
    render();
  });

  window.addEventListener('resize', resize);
  Casino.onChange(render);

  renderLevels();
  renderLegend();
  resize();
  render();
  draw();   // 先同步画一帧，台面不用等第一次 rAF 才出现
  requestAnimationFrame(frame);
})();
