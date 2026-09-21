/* ============================================================
   弹珠机 · 物理、台面几何与赔率表
   浏览器与 Node 共用同一份实现（tools/sim-pachinko.js 用它跑分布统计），
   所以这里的常量就是游戏真实用的常量，不存在两份。

   三种难度各自有不同的铜钉布局、物理参数和底槽赔率表：
     简单 —— 稀疏规则网格，落点集中，赔率温和、波动小
     普通 —— 常规交错网格
     困难 —— 密钉 + 底部 V 形导流钉，把珠子往中间赶，边缘高赔率槽极难进
   赔率表由 tools/sim-pachinko.js 跑 4 万颗球标定，改布局或改赔率都要重跑。
   ============================================================ */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.PachinkoCore = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var W = 480, H = 640;
  var WALL = 8, BALL_R = 7, PEG_R = 5;
  var SLOT_TOP = 524, SLOTS = 7;

  // 三种难度共用的物理基准，各难度只覆盖 JITTER / CENTER_PULL / DROP_SPREAD
  var BASE = {
    W: W, H: H,
    WALL: WALL,
    BALL_R: BALL_R,
    PEG_R: PEG_R,
    SLOT_TOP: SLOT_TOP,
    SLOTS: SLOTS,
    G: 0.34,
    REST: 0.55,
    VX_DAMP: 0.93,
    VX_MAX: 5.5,
    VY_MAX: 9,
    VY_MIN_AFTER_HIT: 0.9,
    STEP: 1000 / 120
  };

  /* ---------- 铜钉布局 ---------- */

  /** 交错网格：偶数排在 x = gap/2 + c*step，奇数排错开半格 */
  function grid(opts) {
    var pts = [];
    var cols = opts.cols, rows = opts.rows;
    var step = W / cols;
    for (var r = 0; r < rows; r++) {
      var y = opts.y0 + r * opts.dy;
      var even = r % 2 === 0;
      var n = even ? cols : cols - 1;
      var x0 = even ? step / 2 : step;
      for (var c = 0; c < n; c++) {
        var x = x0 + c * step;
        if (x < WALL + PEG_R + 2 || x > W - WALL - PEG_R - 2) continue;
        pts.push({ x: x, y: y });
      }
    }
    return pts;
  }

  /** 底部 V 形导流钉：从两侧向中间收，把珠子赶向正中槽。收口宽度可调，越窄边缘槽越难进 */
  function funnel(opts) {
    var pts = [];
    for (var i = 0; i < opts.count; i++) {
      var t = i / (opts.count - 1);
      var y = opts.yTop + t * (opts.yBottom - opts.yTop);
      var off = opts.gapTop + (opts.gapBottom - opts.gapTop) * t;
      pts.push({ x: W / 2 - 26 - off, y: y });
      pts.push({ x: W / 2 + 26 + off, y: y });
    }
    return pts;
  }

  // prob 是 tools/sim-pachinko.js 跑 4 万颗球实测的落点概率（seed=1 与 seed=99 复核一致）。
  // 界面上的返还率和各槽概率都由它算出来，所以改赔率会自动跟着变；但改了铜钉布局必须重跑模拟器更新 prob。
  var LEVELS = {
    easy: {
      key: 'easy',
      label: '简单',
      blurb: '铜钉稀疏，珠子落点集中，最差只输一半，波动最小。',
      rows: 7, cols: 6, y0: 112, dy: 54,
      jitter: 0.26, centerPull: 0.016, spread: 0.14,
      mults: [2, 1.5, 1, 0.5, 1, 1.5, 2],
      prob: [0.0447, 0.0873, 0.1455, 0.4425, 0.1477, 0.0857, 0.0466]
    },
    normal: {
      key: 'normal',
      label: '普通',
      blurb: '标准交错铜钉阵，中间空槽最容易进，边缘 5 倍。',
      rows: 9, cols: 8, y0: 92, dy: 43,
      jitter: 0.30, centerPull: 0.02, spread: 0.12,
      mults: [5, 2, 1, 0, 1, 2, 5],
      prob: [0.0267, 0.0862, 0.1666, 0.4324, 0.1701, 0.0893, 0.0286]
    },
    hard: {
      key: 'hard',
      label: '困难',
      blurb: '密钉加底部 V 形导流钉，珠子被赶向正中空槽；边缘 10 倍约 500 颗中 1 颗。',
      rows: 12, cols: 8, y0: 66, dy: 31,
      jitter: 0.34, centerPull: 0.0096, spread: 0.12,
      funnel: { count: 6, yTop: 424, yBottom: 502, gapTop: 178, gapBottom: 150 },
      mults: [10, 3, 1, 0, 1, 3, 10],
      prob: [0.0020, 0.0935, 0.1632, 0.4867, 0.1608, 0.0918, 0.0019]
    }
  };

  var DEFAULT_LEVEL = 'normal';

  function level(key) {
    return LEVELS[key] || LEVELS[DEFAULT_LEVEL];
  }

  /** 返还率 = Σ 实测概率 × 赔率。概率来自模拟器，赔率改了这里会立刻跟着变 */
  function rtp(key) {
    var L = level(key);
    return L.prob.reduce(function (a, p, i) { return a + p * L.mults[i]; }, 0);
  }

  /** 界面展示用的难度列表，顺序固定 */
  function levelList() {
    return ['easy', 'normal', 'hard'].map(function (k) { return LEVELS[k]; });
  }

  function buildPegs(key) {
    var L = level(key);
    var pegs = grid(L);
    if (L.funnel) {
      pegs = pegs.filter(function (p) { return p.y < L.funnel.yTop - L.dy * 0.6; });
      pegs = pegs.concat(funnel(L.funnel));
    }
    return pegs;
  }

  function config(key) {
    var L = level(key);
    var cfg = {};
    for (var k in BASE) cfg[k] = BASE[k];
    cfg.JITTER = L.jitter;
    cfg.CENTER_PULL = L.centerPull;
    cfg.DROP_SPREAD = L.spread;
    cfg.SLOT_W = W / SLOTS;
    return cfg;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function ball(rnd, cfg) {
    var spread = cfg.W * cfg.DROP_SPREAD;
    return {
      x: cfg.W / 2 + (rnd() - 0.5) * spread * 2,
      y: 30,
      vx: (rnd() - 0.5) * 1.4,
      vy: 0
    };
  }

  function collidePeg(b, p, cfg, rnd) {
    var dx = b.x - p.x;
    var dy = b.y - p.y;
    var min = cfg.BALL_R + cfg.PEG_R;
    var d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return false;

    var d = Math.sqrt(d2) || 0.001;
    var nx = dx / d, ny = dy / d;
    b.x = p.x + nx * min;
    b.y = p.y + ny * min;

    var dot = b.vx * nx + b.vy * ny;
    b.vx = (b.vx - 2 * dot * nx) * cfg.REST + (rnd() - 0.5) * cfg.JITTER;
    b.vy = (b.vy - 2 * dot * ny) * cfg.REST;

    if (b.vy < cfg.VY_MIN_AFTER_HIT) b.vy = cfg.VY_MIN_AFTER_HIT + rnd() * 0.7;

    // 横向阻尼 + 向中线回正：这两项决定落点分布的胖瘦
    b.vx = b.vx * cfg.VX_DAMP - (b.x - cfg.W / 2) * cfg.CENTER_PULL;
    b.vx = clamp(b.vx, -cfg.VX_MAX, cfg.VX_MAX);
    b.vy = clamp(b.vy, -3, cfg.VY_MAX);
    return true;
  }

  /** s 为时间缩放（1 = 一个 1/60 秒步） */
  function step(b, pegs, cfg, rnd, s) {
    b.vy += cfg.G * s;
    b.x += b.vx * s;
    b.y += b.vy * s;

    if (b.x < cfg.WALL + cfg.BALL_R) { b.x = cfg.WALL + cfg.BALL_R; b.vx = Math.abs(b.vx) * cfg.REST; }
    if (b.x > cfg.W - cfg.WALL - cfg.BALL_R) { b.x = cfg.W - cfg.WALL - cfg.BALL_R; b.vx = -Math.abs(b.vx) * cfg.REST; }

    if (b.y < cfg.SLOT_TOP) {
      for (var i = 0; i < pegs.length; i++) collidePeg(b, pegs[i], cfg, rnd);
    } else {
      b.vx *= 0.9;      // 进槽后收敛横向速度，避免视觉上跨槽
    }
  }

  function landed(b, cfg) {
    return b.y + cfg.BALL_R >= cfg.H - 4;
  }

  function slotOf(x, cfg) {
    return clamp(Math.floor(x / cfg.SLOT_W), 0, cfg.SLOTS - 1);
  }

  return {
    W: W, H: H,
    SLOT_TOP: SLOT_TOP,
    SLOTS: SLOTS,
    LEVELS: LEVELS,
    DEFAULT_LEVEL: DEFAULT_LEVEL,
    level: level,
    levelList: levelList,
    rtp: rtp,
    config: config,
    buildPegs: buildPegs,
    clamp: clamp,
    ball: ball,
    step: step,
    landed: landed,
    slotOf: slotOf
  };
});
