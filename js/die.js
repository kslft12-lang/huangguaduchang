/* ============================================================
   3D 物理骰子（骰子猜大小 / 骰子比大小共用）

   一个真立方体（6 个面各画好自己的点位），靠 CSS 3D 变换做刚体动画：
   抛出 → 重力下落 → 落地按恢复系数弹跳并带随机自旋 → 能量耗尽后补间到目标点数。
   方向约定：y 是离桌面的高度（>=0），vy 向上为正；绕 X/Y/Z 的角是角度。
   ============================================================ */
(function (root) {
  'use strict';

  var PIPS = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9]
  };

  // 立方体六面：face 是该面印的点数，tx/ty 是把该面转到正对镜头所需的基础旋转。
  // 相对面之和为 7（1-6、2-5、3-4）。
  var FACES = [
    { key: 'front', face: 1, tx: 0, ty: 0 },
    { key: 'back', face: 6, tx: 0, ty: 180 },
    { key: 'right', face: 3, tx: 0, ty: -90 },
    { key: 'left', face: 4, tx: 0, ty: 90 },
    { key: 'top', face: 2, tx: -90, ty: 0 },
    { key: 'bottom', face: 5, tx: 90, ty: 0 }
  ];

  var G = 0.85;            // 重力（px / 60fps 帧²）
  var REST = 0.46;         // 落地恢复系数
  var STOP_VY = 1.15;      // 竖直速度低于此值就不再弹，进入定格
  var TOSS_MIN = 8.5;      // 抛出初速度（向上）
  var TOSS_MAX = 12.5;
  var SETTLE_MS = 340;     // 定格补间时长
  var MAX_DT = 3;          // 单帧最大步进（防止切回标签页时大跳）
  var GUARD_MS = 3000;     // 兜底：动画正常约 1.8 秒，超时直接定格
  var TILT_X = -16;        // 静止时的观察俯仰（露出顶面）
  var TILT_Y = -18;        // 静止时的观察偏转（露出右侧面）

  function reduced() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function pipHtml(face) {
    var cells = PIPS[face] || [];
    var html = '';
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      html += '<span class="die__pip" style="grid-area:' +
        Math.ceil(c / 3) + '/' + (((c - 1) % 3) + 1) + '"></span>';
    }
    return html;
  }

  function faceInfo(face) {
    for (var i = 0; i < FACES.length; i++) if (FACES[i].face === face) return FACES[i];
    return FACES[0];
  }

  /** 把目标角调成与 target 同余、且在旋转方向上离 cur 至少一圈的角，避免定格时倒转 */
  function forwardAngle(cur, target, spin) {
    var k = Math.round((cur - target) / 360);
    var t = target + 360 * k;
    t += spin >= 0 ? 360 : -360;
    return t;
  }

  function transformOf(d) {
    return 'translateY(' + (-d.y).toFixed(2) + 'px)' +
      ' rotateX(' + TILT_X + 'deg) rotateY(' + TILT_Y + 'deg)' +
      ' rotateZ(' + d.rz.toFixed(2) + 'deg)' +
      ' rotateX(' + d.rx.toFixed(2) + 'deg)' +
      ' rotateY(' + d.ry.toFixed(2) + 'deg)';
  }

  function paintShadow(d) {
    var k = Math.max(0, 1 - d.y / 95);          // 越高影子越小越淡
    d.shadow.style.opacity = (0.22 + 0.58 * k).toFixed(2);
    d.shadow.style.transform = 'scale(' + (0.5 + 0.5 * k).toFixed(3) + ')';
  }

  function paint(d) {
    d.el.style.transform = transformOf(d);
    d.el.dataset.face = String(d.face);
    if (d.hidden) d.el.classList.add('is-hidden');
    else d.el.classList.remove('is-hidden');
    paintShadow(d);
  }

  function clearGuard(d) {
    if (d.guard) { clearTimeout(d.guard); d.guard = 0; }
  }

  /** 收尾：从动画队列里摘掉、清兜底、通知调用方 */
  function complete(d) {
    var i = active.indexOf(d);
    if (i !== -1) active.splice(i, 1);
    clearGuard(d);
    if (d.onDone) { var cb = d.onDone; d.onDone = null; cb(d); }
  }

  /* ---------- 动画循环 ---------- */

  var active = [];
  var rafId = 0;
  var lastT = 0;

  function tick(now) {
    var dt = lastT ? Math.min((now - lastT) / (1000 / 60), MAX_DT) : 1;
    lastT = now;

    for (var i = active.length - 1; i >= 0; i--) {
      var d = active[i];
      if (step(d, dt)) paint(d);
      else { paint(d); complete(d); }
    }

    if (active.length) rafId = requestAnimationFrame(tick);
    else { rafId = 0; lastT = 0; }
  }

  function wake() {
    if (!rafId) { lastT = 0; rafId = requestAnimationFrame(tick); }
  }

  function step(d, dt) {
    if (d.wait > 0) { d.wait -= dt * (1000 / 60); return true; }

    if (d.phase === 'fly') {
      d.vy -= G * dt;
      d.y += d.vy * dt;
      d.rx += d.vrx * dt;
      d.ry += d.vry * dt;
      d.rz += d.vrz * dt;

      if (d.y <= 0) {
        d.y = 0;
        if (-d.vy > STOP_VY) {
          d.vy = -d.vy * REST;
          // 每次弹跳都换一点自旋，看起来才不像机械重复
          d.vrx = d.vrx * 0.5 + (Math.random() - 0.5) * 11;
          d.vry = d.vry * 0.5 + (Math.random() - 0.5) * 13;
          d.vrz = d.vrz * 0.5 + (Math.random() - 0.5) * 9;
        } else {
          beginSettle(d);
        }
      }
      return true;
    }

    // settle：补间到目标点数，同时最后落一下
    d.t += dt * (1000 / 60);
    var k = Math.min(1, d.t / SETTLE_MS);
    var e = 1 - Math.pow(1 - k, 3);
    d.rx = d.rx0 + (d.rxT - d.rx0) * e;
    d.ry = d.ry0 + (d.ryT - d.ry0) * e;
    d.rz = d.rz0 + (d.rzT - d.rz0) * e;
    d.y = d.y0 * (1 - k * k);

    if (k >= 1) {
      d.y = 0;
      d.rx = d.rxT; d.ry = d.ryT; d.rz = d.rzT;
      d.phase = 'idle';
      return false;
    }
    return true;
  }

  function beginSettle(d) {
    var f = faceInfo(d.face);
    d.phase = 'settle';
    d.t = 0;
    d.y0 = 5 + Math.random() * 5;
    d.y = d.y0;
    d.rx0 = d.rx; d.ry0 = d.ry; d.rz0 = d.rz;
    d.rxT = forwardAngle(d.rx, f.tx, d.vrx);
    d.ryT = forwardAngle(d.ry, f.ty, d.vry);
    d.rzT = forwardAngle(d.rz, 90 * d.quarter, d.vrz);
  }

  /* ---------- 对外接口 ---------- */

  function create(host) {
    var slot = document.createElement('div');
    slot.className = 'die-slot';

    var shadow = document.createElement('div');
    shadow.className = 'die__shadow';

    var el = document.createElement('div');
    el.className = 'die';
    el.innerHTML = FACES.map(function (f) {
      return '<div class="die__face die__face--' + f.key + '">' + pipHtml(f.face) + '</div>';
    }).join('');

    slot.appendChild(shadow);
    slot.appendChild(el);
    host.appendChild(slot);

    var d = {
      slot: slot, shadow: shadow, el: el,
      y: 0, vy: 0, rx: 0, ry: 0, rz: 0, vrx: 0, vry: 0, vrz: 0,
      face: 1, hidden: false, phase: 'idle', t: 0, wait: 0, quarter: 0, onDone: null
    };
    paint(d);
    return d;
  }

  /** 直接定格到某个点数，不做动画；hidden 为 true 时扣着（背面朝上） */
  function set(die, face, hidden) {
    var f = faceInfo(face);
    clearGuard(die);
    die.face = face;
    die.phase = 'idle';
    die.wait = 0;
    die.y = 0; die.vy = 0;
    die.vrx = die.vry = die.vrz = 0;
    die.quarter = Math.floor(Math.random() * 4);
    die.rx = f.tx;
    die.ry = f.ty;
    die.rz = 90 * die.quarter;
    die.hidden = !!hidden;
    paint(die);
  }

  /** 扣着 / 翻开（盖住的那面用背纹，看不出点数） */
  function cover(die) { die.hidden = true; paint(die); }
  function uncover(die) { die.hidden = false; paint(die); }

  /** 掷一次：物理滚动后停在 face 上 */
  function roll(die, face, opts) {
    opts = opts || {};
    clearGuard(die);
    die.face = face;
    die.hidden = false;
    die.wait = opts.delay || 0;
    die.quarter = Math.floor(Math.random() * 4);
    die.onDone = opts.onDone || null;

    if (reduced()) {
      set(die, face);
      if (die.onDone) { var cb = die.onDone; die.onDone = null; cb(die); }
      return;
    }

    die.phase = 'fly';
    die.y = 0;
    die.vy = TOSS_MIN + Math.random() * (TOSS_MAX - TOSS_MIN);
    die.vrx = (Math.random() - 0.5) * 26;
    die.vry = (Math.random() - 0.5) * 30;
    die.vrz = (Math.random() - 0.5) * 18;
    die.rx = Math.random() * 360;
    die.ry = Math.random() * 360;
    die.rz = Math.random() * 360;

    if (active.indexOf(die) === -1) active.push(die);
    paint(die);
    wake();

    // 浏览器可能暂停 animation frame（例如切到后台标签页），超时就直接定格，
    // 否则整局会一直卡在"掷骰中"
    die.guard = setTimeout(function () {
      if (die.phase === 'idle') return;
      set(die, face);
      complete(die);
    }, GUARD_MS);
  }

  function rand() { return 1 + Math.floor(Math.random() * 6); }
  function sum(faces) { return faces.reduce(function (a, v) { return a + v; }, 0); }

  root.Die = {
    PIPS: PIPS,
    FACES: FACES,
    create: create,
    set: set,
    cover: cover,
    uncover: uncover,
    roll: roll,
    rand: rand,
    sum: sum
  };
})(window);
