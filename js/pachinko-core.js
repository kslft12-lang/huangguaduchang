/* ============================================================
   弹珠机 · 物理、台面几何与赔率表
   浏览器与 Node 共用同一份实现（tools/sim-pachinko.js 用它跑分布统计），
   所以这里的常量就是游戏真实用的常量，不存在两份。

   三种难度共用均匀对称的铜钉交错网格（列等间距、奇数行错半格），
   区别在钉的密度、顶部人字檐的宽度和底部翻板的开口节奏：
     简单 —— 人字檐窄、钉少，落点温和偏两边，波动小
     普通 —— 人字檐更宽 + 轻微离心拉力，珠子更容易跑两边
     困难 —— 最宽人字檐 + 密钉 + 离心拉力，珠子大量贴边，正中大奖极难进
   碰撞模型：钉子碰撞把速度拆成法向/切向，法向按 REST 反弹、切向只留一点摩擦；
   随机抖动按撞击速度缩放（快球混乱、慢擦平滑），只有几乎停住的慢碰才补下坠，
   快球的反弹轨迹保持自然（会向上弹起再落下）。台面多颗珠时彼此做等质量弹性互撞
   （collideBalls），模拟器一次只跑一颗，所以 4 万颗球的概率表不受互撞影响。
   step / collidePeg / collideFlipper 支持可选的 events 数组：撞击时推入
   { t: 'peg'|'wall'|'flipper'|'ball', v: 撞击速度 }，浏览器用它播撞击音效；
   模拟器不传即零开销。
   槽口上方有两根 45° 斜翻板（FLIPPER_*）：板头静止时在中线紧贴，
   同相位做单向开合（(1-cos)/2 半波，只向两侧张开、从不交叉）。
   珠子只有在翻板张开的瞬间才能从中间漏下，其余时候砸在斜板上、
   被切向踢力拨向板根，滚进两侧壁槽和走廊——弹珠更容易落两边。
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
    /* 碰撞手感：钢珠在铜钉上几乎不打滑（PEG_FRICTION），玻璃珠互撞比碰钉更弹
       （BALL_REST）；ASSIST_SPEED 以下视为"慢擦"，才补下坠防停钉，快球不干预 */
    PEG_FRICTION: 0.985,
    BALL_REST: 0.75,
    ASSIST_SPEED: 1.4,
    VX_DAMP: 0.93,
    VX_MAX: 5.5,
    VY_MAX: 9,
    VY_MIN_AFTER_HIT: 0.9,
    STEP: 1000 / 120,
    /* 底部双翻板：左右各一根斜板（基准 45° 倾斜），板头静止时在中线紧贴，
       像两扇合拢的门。两板同相位做**单向开合**：只向两侧张开、从不交叉
       （(1-cos)/2 半波相位，闭合端平滑停顿、张开端顺畅回落，接近真实的
       气动门）。珠子只有在张开的瞬间才能从中间漏下去，其余时候砸在
       斜板上、沿板面滑向两侧壁槽；轴与墙之间的走廊让两侧的球落向边缘槽。
       相位由 cfg.tick 推进（每物理步 +1，浏览器与模拟器同一速率）。 */
    FLIPPER_Y: 500,
    FLIPPER_LEN: 204,
    FLIPPER_PIVOT_X: 96,
    FLIPPER_HALF_W: 6,
    FLIPPER_BASE_ANGLE: 0.7854,
    FLIPPER_AMP_ANGLE: 0.225,
    FLIPPER_SPEED: 0.05,
    FLIPPER_REST: 0.5,
    FLIPPER_JITTER: 0.7,
    FLIPPER_KICK: 0.7
  };

  /* ---------- 铜钉布局 ---------- */

  /** 均匀对称交错网格：列等间距、奇数行错半格，左右完全镜像。
      球往两边跑靠顶部人字檐劈珠 + 底部翻板拨球，钉阵本身不引导偏向 */
  function grid(opts) {
    var pts = [];
    var cols = opts.cols, rows = opts.rows;
    var step = W / cols;
    for (var r = 0; r < rows; r++) {
      var y = opts.y0 + r * opts.dy;
      var even = r % 2 === 0;
      var n = even ? cols : cols - 1;
      var x = even ? step / 2 : step;
      for (var c = 0; c < n; c++) {
        if (x >= WALL + PEG_R + 2 && x <= W - WALL - PEG_R - 2) pts.push({ x: x, y: y });
        x += step;
      }
    }
    return pts;
  }

  /** 顶部人字分珠檐（Λ）：落在檐上的珠子沿斜线被劈向两边 */
  function roof(opts) {
    var pts = [];
    for (var i = 0; i < opts.count; i++) {
      var t = i / (opts.count - 1);
      var y = opts.yTop + t * (opts.yBottom - opts.yTop);
      var off = opts.gapTop + (opts.gapBottom - opts.gapTop) * t;
      pts.push({ x: opts.apexX - off, y: y });
      pts.push({ x: opts.apexX + off, y: y });
    }
    return pts;
  }

  // prob 是 tools/sim-pachinko.js 跑 4 万颗球实测的落点概率（seed=1 与 seed=99 复核一致）。
  // 界面上的返还率和各槽概率都由它算出来，所以改赔率会自动跟着变；但改了铜钉布局必须重跑模拟器更新 prob。
  var LEVELS = {
    easy: {
      key: 'easy',
      label: '简单',
      blurb: '人字檐把落珠往外劈，均匀对称钉阵；翻板开合留缝，中间 2 倍只要赶对时机就能进。波动最小。',
      rows: 7, cols: 6, y0: 124, dy: 52,
      jitter: 0.26, centerPull: 0, spread: 0.14,
      roof: { count: 3, yTop: 58, yBottom: 90, gapTop: 26, gapBottom: 76, apexX: 240 },
      flipper: { FLIPPER_AMP_ANGLE: 0.38 },
      mults: [0.7, 0.9, 1.1, 2, 1.1, 0.9, 0.7],
      prob: [0.3813, 0.0520, 0.0295, 0.0746, 0.0310, 0.0544, 0.3771]
    },
    normal: {
      key: 'normal',
      label: '普通',
      blurb: '人字檐更宽 + 轻微离心拉力，均匀对称钉阵把珠子往两边送；中间 3 倍要赶翻板张开的瞬间才漏得进。',
      rows: 8, cols: 8, y0: 124, dy: 40,
      jitter: 0.30, centerPull: -0.001, spread: 0.12,
      roof: { count: 4, yTop: 56, yBottom: 100, gapTop: 24, gapBottom: 92, apexX: 240 },
      flipper: { FLIPPER_AMP_ANGLE: 0.39 },
      mults: [0.6, 0.8, 1.0, 3, 1.0, 0.8, 0.6],
      prob: [0.3740, 0.0624, 0.0390, 0.0543, 0.0387, 0.0622, 0.3694]
    },
    hard: {
      key: 'hard',
      label: '困难',
      blurb: '最宽人字檐 + 密钉 + 离心拉力，均匀对称钉阵让珠子满场向两边跑；正中 5 倍只剩翻板一张一合的瞬间可钻。',
      rows: 12, cols: 8, y0: 100, dy: 30,
      jitter: 0.34, centerPull: -0.003, spread: 0.12,
      roof: { count: 6, yTop: 54, yBottom: 120, gapTop: 22, gapBottom: 128, apexX: 240 },
      flipper: { FLIPPER_AMP_ANGLE: 0.26 },
      mults: [0.5, 0.7, 1.0, 5, 1.0, 0.7, 0.5],
      prob: [0.4285, 0.0381, 0.0213, 0.0256, 0.0208, 0.0365, 0.4293]
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

  /** 中央脊梁钉列：正中一列竖钉，把从翻板开口直落的球劈向两边 */
  function spine(opts) {
    var pts = [];
    for (var i = 0; i < opts.count; i++) {
      pts.push({ x: opts.x, y: opts.y0 + i * opts.dy });
    }
    return pts;
  }

  /** 点到线段的最短距离（翻板净空检查用） */
  function distToSeg(p, seg) {
    var dx = seg.tx - seg.px, dy = seg.ty - seg.py;
    var t = clamp(((p.x - seg.px) * dx + (p.y - seg.py) * dy) / (dx * dx + dy * dy), 0, 1);
    var ex = p.x - (seg.px + dx * t), ey = p.y - (seg.py + dy * t);
    return Math.sqrt(ex * ex + ey * ey);
  }

  /** 翻板扫掠走廊里不能有钉：珠子贴板滑行时要同时离板轴 ≥ FLIPPER_HALF_W+BALL_R、
      离钉 ≥ PEG_R+BALL_R，所以板轴到钉的净距必须 ≥ 两者之和（25px），否则珠子会被
      楔死在钉与板面的缝里（板身扫过扇形内的钉还会被板头直接压住）。左右对称，
      两侧都查一遍省得推镜像 */
  function clearOfFlippers(pts, cfg) {
    var a0 = cfg.FLIPPER_BASE_ANGLE;
    var a1 = a0 + cfg.FLIPPER_AMP_ANGLE;
    var minClear = cfg.FLIPPER_HALF_W + cfg.PEG_R + 2 * cfg.BALL_R;
    var tOpen = Math.PI / cfg.FLIPPER_SPEED / 2;   // 完全张开的相位
    return pts.filter(function (p) {
      for (var side = -1; side <= 1; side += 2) {
        var px = side < 0 ? cfg.FLIPPER_PIVOT_X : cfg.W - cfg.FLIPPER_PIVOT_X;
        var dx = p.x - px, dy = p.y - cfg.FLIPPER_Y;
        var rho = Math.sqrt(dx * dx + dy * dy);
        if (rho > cfg.FLIPPER_LEN + minClear) continue;
        // 板身方向角（canvas 坐标）：左板 -a、右板 -(π-a)；扇形内且够得着的钉必被轴扫过
        var lo = side < 0 ? -a1 : -(Math.PI - a0);
        var hi = side < 0 ? -a0 : -(Math.PI - a1);
        var phi = Math.atan2(dy, dx);
        if (phi >= lo && phi <= hi && rho <= cfg.FLIPPER_LEN + cfg.FLIPPER_HALF_W + cfg.PEG_R) return false;
        if (distToSeg(p, flipperSeg(cfg, side, 0)) < minClear) return false;
        if (distToSeg(p, flipperSeg(cfg, side, tOpen)) < minClear) return false;
      }
      return true;
    });
  }

  function buildPegs(key) {
    var L = level(key);
    var pegs = grid(L);
    if (L.roof) {
      // 人字檐下方清场，避免和网格钉挤在一起
      pegs = pegs.filter(function (p) { return p.y > L.roof.yBottom + L.dy * 0.55; });
      pegs = pegs.concat(roof(L.roof));
    }
    if (L.spine) {
      // 脊梁钉与同一列附近的网格钉互斥，避免挤成一团
      pegs = pegs.filter(function (p) {
        return !(Math.abs(p.x - L.spine.x) < 14 && p.y >= L.spine.y0 - 10);
      });
      pegs = pegs.concat(spine(L.spine));
    }
    return clearOfFlippers(pegs, config(key));
  }

  function config(key) {
    var L = level(key);
    var cfg = {};
    for (var k in BASE) cfg[k] = BASE[k];
    cfg.JITTER = L.jitter;
    cfg.CENTER_PULL = L.centerPull;
    cfg.DROP_SPREAD = L.spread;
    cfg.SLOT_W = W / SLOTS;
    // 每档可以覆盖翻板几何（现在三档共用同一副翻板，保留入口备用）
    if (L.flipper) {
      for (var k in L.flipper) cfg[k] = L.flipper[k];
    }
    return cfg;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function ball(rnd, cfg) {
    var spread = cfg.W * cfg.DROP_SPREAD;
    return {
      x: cfg.W / 2 + (rnd() - 0.5) * spread * 2,
      y: 30,
      vx: (rnd() - 0.5) * 1.4,
      vy: 0,
      bestY: 30,   // 下坠进展的最低点标记（防滞留看门狗用）
      stall: 0
    };
  }

  function collidePeg(b, p, cfg, rnd, events) {
    var dx = b.x - p.x;
    var dy = b.y - p.y;
    var min = cfg.BALL_R + cfg.PEG_R;
    var d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return false;

    var d = Math.sqrt(d2) || 0.001;
    var nx = dx / d, ny = dy / d;
    b.x = p.x + nx * min;
    b.y = p.y + ny * min;

    // 法向按弹性系数反弹，切向只留一点摩擦——比整速度乘 REST 更接近钢珠碰铜钉
    var dot = b.vx * nx + b.vy * ny;
    var hitSpeed = -dot;                          // 进钉的法向撞击速度
    var vtx = b.vx - dot * nx, vty = b.vy - dot * ny;
    b.vx = vtx * cfg.PEG_FRICTION - dot * nx * cfg.REST +
      (rnd() - 0.5) * cfg.JITTER * Math.max(0, Math.min(1, hitSpeed / 3));
    b.vy = vty * cfg.PEG_FRICTION - dot * ny * cfg.REST;

    // 保证向下进度防滞留：慢擦、或反弹后几乎水平的擦碰都补下坠；
    // 只有快速撞击弹起来的球（hitSpeed 大且 vy 明显向上）保持自然反弹轨迹
    if (b.vy < cfg.VY_MIN_AFTER_HIT && (hitSpeed < cfg.ASSIST_SPEED || b.vy > -0.5)) {
      b.vy = cfg.VY_MIN_AFTER_HIT + rnd() * 0.7;
    }

    // 横向阻尼 + 中线拉力（正数回中、负数离心）：这项决定落点分布的胖瘦
    b.vx = b.vx * cfg.VX_DAMP - (b.x - cfg.W / 2) * cfg.CENTER_PULL;
    b.vx = clamp(b.vx, -cfg.VX_MAX, cfg.VX_MAX);
    b.vy = clamp(b.vy, -3, cfg.VY_MAX);
    if (events && hitSpeed >= 0.35) events.push({ t: 'peg', v: hitSpeed });
    return true;
  }

  /* ---------- 底部双翻板 ---------- */

  /** 单根翻板几何：side = -1 左板 / +1 右板，绕离壁轴同相位做单向开合
      （(1-cos)/2 半波：闭合端紧贴、张开端只向外退，两板从不交叉）。
      返回枢轴、板头、倾角与角速度（rad/物理步），t 省略时用 cfg.tick */
  function flipperSeg(cfg, side, t) {
    t = t == null ? (cfg.tick || 0) : t;
    var ph = t * cfg.FLIPPER_SPEED;
    var swell = (1 - Math.cos(ph)) / 2;
    var a = cfg.FLIPPER_BASE_ANGLE + cfg.FLIPPER_AMP_ANGLE * swell;
    var px = side < 0 ? cfg.FLIPPER_PIVOT_X : cfg.W - cfg.FLIPPER_PIVOT_X;
    var dir = side < 0 ? 1 : -1;   // 左板向右伸、右板向左伸
    return {
      px: px, py: cfg.FLIPPER_Y,
      tx: px + dir * cfg.FLIPPER_LEN * Math.cos(a),
      ty: cfg.FLIPPER_Y - cfg.FLIPPER_LEN * Math.sin(a),
      dir: dir,
      a: a,
      w: cfg.FLIPPER_AMP_ANGLE * cfg.FLIPPER_SPEED * Math.sin(ph) / 2
    };
  }

  /** 与单根翻板做胶囊碰撞：沿板面法向反弹，并继承翻板转动的表面速度
      （翻板扇起来拨球、扇下去漏球全靠这个） */
  function collideFlipperSeg(b, seg, cfg, rnd, events) {
    var dx = seg.tx - seg.px, dy = seg.ty - seg.py;
    var len2 = dx * dx + dy * dy;
    var l = Math.sqrt(len2);
    var tt = clamp(((b.x - seg.px) * dx + (b.y - seg.py) * dy) / len2, 0, 1);
    var cx = seg.px + dx * tt, cy = seg.py + dy * tt;
    var nx = b.x - cx, ny = b.y - cy;
    var min = cfg.BALL_R + cfg.FLIPPER_HALF_W;
    var d2 = nx * nx + ny * ny;
    if (d2 >= min * min) return false;

    var d = Math.sqrt(d2) || 0.001;
    nx /= d; ny /= d;
    b.x = cx + nx * min;
    b.y = cy + ny * min;

    // 绕轴转动的表面速度（垂直板面，轴端为 0、越靠板头越快）
    var s = Math.sqrt(tt * tt * len2);
    var svx = -seg.w * s * seg.dir * Math.sin(seg.a);
    var svy = -seg.w * s * Math.cos(seg.a);
    var rvx = b.vx - svx, rvy = b.vy - svy;
    var vn = rvx * nx + rvy * ny;
    if (vn > 0) return true;   // 已经在弹开：只修正位置，不再加速

    // 沿板面向枢轴方向的切向踢力：球被"拨"向板根，快速滑离板面滚进壁侧走廊，
    // 不会骑在板头上反复弹跳（也贴合挡板把珠子拨向两边的观感）
    var tanX = (seg.px - seg.tx) / l, tanY = (seg.py - seg.ty) / l;
    b.vx = svx + (rvx - 2 * vn * nx) * cfg.FLIPPER_REST + tanX * cfg.FLIPPER_KICK;
    b.vy = svy + (rvy - 2 * vn * ny) * cfg.FLIPPER_REST + tanY * cfg.FLIPPER_KICK;
    if (b.vy < cfg.VY_MIN_AFTER_HIT) b.vy = cfg.VY_MIN_AFTER_HIT + 0.3;
    b.vx += (rnd() - 0.5) * cfg.FLIPPER_JITTER;   // 抖动打破对称
    b.vx = clamp(b.vx, -cfg.VX_MAX, cfg.VX_MAX);
    b.vy = clamp(b.vy, -3, cfg.VY_MAX);
    if (events && -vn >= 0.35) events.push({ t: 'flipper', v: -vn });
    return true;
  }

  /** 与两根翻板碰撞。翻板高抬时把珠子拨向两边壁槽，落下时中间豁口直通正中槽；
      珠子在翻板上会连续碰撞，直到滚出豁口或滑进壁槽为止 */
  function collideFlipper(b, cfg, rnd, events) {
    if (b.vy < 0) return;   // 向上弹起的瞬间不拦，避免把珠子卡在板下
    collideFlipperSeg(b, flipperSeg(cfg, -1), cfg, rnd, events);
    collideFlipperSeg(b, flipperSeg(cfg, 1), cfg, rnd, events);
  }

  /** 台面多颗珠时的弹珠互撞：等质量、沿球心连线交换法向冲量（BALL_REST），
      重叠时各退一半做位置校正。模拟器一次只跑一颗，浏览器在每物理步
      step 完所有珠子后调用一次。events 可选，见文件头 */
  function collideBalls(balls, cfg, events) {
    var n = balls.length;
    var min = cfg.BALL_R * 2;
    for (var i = 0; i < n; i++) {
      var a = balls[i];
      for (var j = i + 1; j < n; j++) {
        var b = balls[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-6) continue;
        var d = Math.sqrt(d2);
        var nx = dx / d, ny = dy / d;

        var overlap = min - d;
        if (overlap > 0.1) {           // 留 0.1px 容差，静止接触不硬推
          var push = (overlap - 0.1) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }

        var vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn >= 0) continue;         // 正在分开
        var hit = -vn;
        if (hit < 0.3) continue;       // 微碰只校正位置，不当真撞
        if (events && hit >= 0.35) events.push({ t: 'ball', v: hit });
        var imp = (1 + cfg.BALL_REST) * hit / 2;
        a.vx -= imp * nx; a.vy -= imp * ny;
        b.vx += imp * nx; b.vy += imp * ny;
        a.vx = clamp(a.vx, -cfg.VX_MAX, cfg.VX_MAX);
        a.vy = clamp(a.vy, -3, cfg.VY_MAX);
        b.vx = clamp(b.vx, -cfg.VX_MAX, cfg.VX_MAX);
        b.vy = clamp(b.vy, -3, cfg.VY_MAX);
      }
    }
  }

  /** s 为时间缩放（1 = 一个 1/60 秒步）；events 可选，撞击事件推入其中 */
  function step(b, pegs, cfg, rnd, s, events) {
    b.vy += cfg.G * s;
    b.x += b.vx * s;
    b.y += b.vy * s;

    if (b.x < cfg.WALL + cfg.BALL_R) {
      if (events && b.vx < -0.35) events.push({ t: 'wall', v: -b.vx });
      b.x = cfg.WALL + cfg.BALL_R; b.vx = Math.abs(b.vx) * cfg.REST;
    }
    if (b.x > cfg.W - cfg.WALL - cfg.BALL_R) {
      if (events && b.vx > 0.35) events.push({ t: 'wall', v: b.vx });
      b.x = cfg.W - cfg.WALL - cfg.BALL_R; b.vx = -Math.abs(b.vx) * cfg.REST;
    }
    if (b.y < cfg.WALL + cfg.BALL_R) {   // 顶梁：快球反弹自然化后可能向上弹，别飞出台面
      if (events && b.vy < -0.35) events.push({ t: 'wall', v: -b.vy });
      b.y = cfg.WALL + cfg.BALL_R; b.vy = Math.abs(b.vy) * cfg.REST;
    }

    // 防滞留看门狗：0.75 秒（90 步）没有向下进展就侧向抖一下脱困——
    // 真机靠机身振动把卡住的珠子抖落；单球下坠总有进展，不会触发
    if (b.y > (b.bestY || 0) + 2) { b.bestY = b.y; b.stall = 0; }
    else if (++b.stall > 90) {
      b.stall = 0;
      b.vx = (rnd() < 0.5 ? -1 : 1) * (1.6 + rnd() * 1.6);
      if (b.vy < 1.2) b.vy = 1.2;
    }

    if (b.y < cfg.SLOT_TOP) {
      for (var i = 0; i < pegs.length; i++) collidePeg(b, pegs[i], cfg, rnd, events);
      collideFlipper(b, cfg, rnd, events);
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
    collideBalls: collideBalls,
    landed: landed,
    slotOf: slotOf,
    flipperSeg: flipperSeg
  };
});
