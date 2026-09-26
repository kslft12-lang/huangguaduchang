/* 刮刮乐：一张三格奖券，刮开银涂层揭晓图案。
   结果在买券瞬间就已随机定死（每格独立按权重抽取），刮开只是揭晓。
   刮出两个相同图案即按倍率返还，三个相同再翻倍。 */
(function () {
  'use strict';

  Casino.mountHeader('scratch');

  var CHIPS = [10, 50, 100, 500];

  // 图案表：w 是出现概率（与老虎机同一套），mult 是两同返还倍率（含本金，界面奖级表如实展示）。
  // Σw = 1.00；两同命中率 ≈ 48.7%，三同率 ≈ 4.4%，加权返还率 ≈ 80.6%（node tools/sim-scratch.js 复算）。
  var SYMBOLS = [
    { ch: '🪳', name: '有一天', w: 0.30, mult: 0.5, img: 'img/yiyouyitian.png' },  // 安慰奖：拿回一半
    { ch: '🍊', name: '橘子',   w: 0.22, mult: 1 },    // 保本
    { ch: '🍎', name: '苹果',   w: 0.15, mult: 2 },
    { ch: '🥕', name: '胡萝卜', w: 0.12, mult: 3 },
    { ch: '🍄', name: '蘑菇',   w: 0.10, mult: 4 },
    { ch: '🥟', name: '包子',   w: 0.07, mult: 6 },
    { ch: '🥒', name: '黄瓜',   w: 0.04, mult: 20 }    // 大奖；三同 ×40
  ];
  var TRIPLE_X = 2;        // 三个相同：奖金翻倍
  var OPEN_AT = 0.45;      // 剩余涂层不足 45% 时整格自动揭开
  var OPEN_GAP = 170;      // 「一键刮开」逐格揭开的间隔

  var chipRow = document.getElementById('chipRow');
  var buyBtn = document.getElementById('buyBtn');
  var openBtn = document.getElementById('openBtn');
  var banner = document.getElementById('banner');
  var historyEl = document.getElementById('history');
  var ticketNoEl = document.getElementById('ticketNo');

  var cells = [0, 1, 2].map(function (i) {
    var host = document.getElementById('cell' + i);
    var canvas = host.querySelector('canvas');
    return {
      host: host,
      canvas: canvas,
      ctx: canvas.getContext('2d'),
      open: true,        // 初始空券视为已揭开，避免误刮
      down: false,
      last: null,
      lastCheck: 0
    };
  });

  var picked = 50;
  var busy = false;        // 券已买、还没结清
  var stake = 0;
  var targets = [];
  var history = [];

  /** 有图案图片的符号用 <img> 渲染，其余用 emoji 字符 */
  function symbolHtml(s) {
    return s.img ? '<img class="sym-img" src="' + s.img + '" alt="' + s.name + '">' : s.ch;
  }

  /* ---------- 下注 ---------- */

  function buildChips() {
    CHIPS.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-btn';
      b.dataset.value = String(v);
      b.textContent = String(v);
      b.addEventListener('click', function () {
        if (busy) return;
        picked = v;
        Casino.sfx.click();
        render();
      });
      chipRow.appendChild(b);
    });

    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'chip-btn chip-btn--all';
    all.dataset.value = 'all';
    all.textContent = '全部';
    all.addEventListener('click', function () {
      if (busy) return;
      picked = 'all';
      Casino.sfx.click();
      render();
    });
    chipRow.appendChild(all);
  }

  function currentBet() {
    return picked === 'all' ? Casino.getBalance() : picked;
  }

  function render() {
    var balance = Casino.getBalance();
    var bet = currentBet();

    Array.prototype.forEach.call(chipRow.children, function (el) {
      var v = el.dataset.value;
      var on = (v === 'all') ? picked === 'all' : Number(v) === picked;
      el.classList.toggle('is-on', on);
      var cost = (v === 'all') ? balance : Number(v);
      el.disabled = busy || cost < Casino.MIN_BET || cost > balance;
    });

    buyBtn.disabled = busy || bet < Casino.MIN_BET || bet > balance;
    buyBtn.textContent = busy ? '刮完这张…' : '来一张';

    var allOpen = cells[0].open && cells[1].open && cells[2].open;
    openBtn.disabled = !busy || allOpen;
  }

  /* ---------- 涂层 ---------- */

  function paintFoil(c) {
    var ctx = c.ctx;
    var w = c.canvas.width;
    var h = c.canvas.height;

    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);

    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#f4eddb');
    g.addColorStop(0.5, '#d9cdab');
    g.addColorStop(1, '#b6aa8a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 斜向高光条 + 噪点，做出可刮的金属质感
    ctx.strokeStyle = 'rgba(255, 255, 255, .3)';
    ctx.lineWidth = Math.max(1, w * 0.012);
    for (var x = -h; x < w; x += w * 0.09) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(60, 48, 22, .12)';
    for (var i = 0; i < 90; i++) {
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }

    ctx.fillStyle = 'rgba(58, 44, 16, .48)';
    ctx.font = '700 ' + Math.round(w * 0.15) + 'px ' + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('刮 开', w / 2, h / 2);
  }

  function sizeCanvas(c) {
    var rect = c.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(60, Math.round(rect.width * dpr));
    var h = Math.max(60, Math.round(rect.height * dpr));
    if (c.canvas.width !== w || c.canvas.height !== h) {
      c.canvas.width = w;
      c.canvas.height = h;
    }
  }

  /* ---------- 刮擦 ---------- */

  function cellOf(canvasEl) {
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].canvas === canvasEl) return cells[i];
    }
    return null;
  }

  function toCanvasXY(c, e) {
    var r = c.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (c.canvas.width / r.width),
      y: (e.clientY - r.top) * (c.canvas.height / r.height)
    };
  }

  function eraseAt(c, p) {
    var ctx = c.ctx;
    var r = c.canvas.width * 0.1;   // 刮擦半径（相对格宽）
    ctx.globalCompositeOperation = 'destination-out';
    if (c.last) {
      ctx.lineWidth = r * 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(c.last.x, c.last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    c.last = p;
  }

  /** 按 1/4 抽样估计剩余涂层比例，低于阈值整格揭开 */
  function checkOpen(c) {
    if (c.open || !busy) return;
    var d = c.ctx.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
    var opaque = 0;
    for (var i = 3; i < d.length; i += 16) {
      if (d[i] > 40) opaque++;
    }
    if (opaque / (d.length / 16) < OPEN_AT) openCell(c);
  }

  function openCell(c) {
    if (c.open || !busy) return;
    c.open = true;
    c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
    c.host.classList.remove('is-idle');
    c.host.classList.add('is-open');
    Casino.sfx.click();
    if (cells[0].open && cells[1].open && cells[2].open) settle();
    else render();
  }

  function onDown(e) {
    var c = cellOf(e.currentTarget);
    if (!c || c.open || !busy) return;
    e.preventDefault();
    try { c.canvas.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器忽略 */ }
    c.down = true;
    c.last = null;
    c.lastCheck = performance.now();
    eraseAt(c, toCanvasXY(c, e));
  }

  function onMove(e) {
    var c = cellOf(e.currentTarget);
    if (!c || !c.down || c.open) return;
    e.preventDefault();
    eraseAt(c, toCanvasXY(c, e));
    var now = performance.now();
    if (now - c.lastCheck > 260) {
      c.lastCheck = now;
      checkOpen(c);
    }
  }

  function onUp(e) {
    var c = cellOf(e.currentTarget);
    if (!c || !c.down) return;
    c.down = false;
    c.last = null;
    checkOpen(c);
  }

  /* ---------- 结算 ---------- */

  function weightedPick() {
    var r = Math.random();
    for (var i = 0; i < SYMBOLS.length; i++) {
      r -= SYMBOLS[i].w;
      if (r < 0) return SYMBOLS[i];
    }
    return SYMBOLS[SYMBOLS.length - 1];
  }

  function buy() {
    if (busy) return;
    var bet = currentBet();
    if (bet < Casino.MIN_BET || bet > Casino.getBalance()) {
      Casino.toast('余额不足 ' + bet + ' 小黄瓜', 'lose');
      Casino.sfx.lose();
      return;
    }

    busy = true;
    stake = bet;
    Casino.bet(stake);
    Casino.addWager(stake);

    targets = [weightedPick(), weightedPick(), weightedPick()];
    ticketNoEl.textContent = 'NO.' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');

    cells.forEach(function (c, i) {
      c.host.querySelector('.scr-cell__prize').innerHTML = symbolHtml(targets[i]);
      c.open = false;
      c.down = false;
      c.last = null;
      c.host.classList.remove('is-idle', 'is-open', 'is-win', 'is-dim');
      sizeCanvas(c);
      paintFoil(c);
    });

    banner.dataset.kind = 'push';
    banner.textContent = '券已到手：用手指或鼠标刮开银涂层，刮出两个相同图案即中奖。';

    Casino.sfx.roll();
    render();
  }

  function scratchAll() {
    if (!busy) return;
    var closed = cells.filter(function (c) { return !c.open; });
    closed.forEach(function (c, i) {
      setTimeout(function () { openCell(c); }, i * OPEN_GAP);
    });
  }

  function settle() {
    var counts = {};
    targets.forEach(function (s) { counts[s.ch] = (counts[s.ch] || 0) + 1; });

    var hit = null, n = 0;
    for (var i = 0; i < SYMBOLS.length; i++) {
      if (counts[SYMBOLS[i].ch] >= 2) { hit = SYMBOLS[i]; n = counts[SYMBOLS[i].ch]; break; }
    }

    var ret = hit ? Math.round(stake * hit.mult * (n === 3 ? TRIPLE_X : 1)) : 0;
    var net = ret - stake;

    cells.forEach(function (c, i) {
      var on = !!hit && targets[i].ch === hit.ch;
      c.host.classList.toggle('is-win', on);
      c.host.classList.toggle('is-dim', !!hit && !on);
    });

    var n2 = function (v) { return v.toLocaleString('zh-CN'); };

    if (net > 0) {
      banner.dataset.kind = 'win';
      banner.innerHTML = (n === 3 ? '🎉 三同！' : '') +
        '刮出 ' + symbolHtml(hit) + ' <b>' + hit.name + ' ×' + (hit.mult * (n === 3 ? TRIPLE_X : 1)) + '</b>' +
        '，赢得 <span class="banner__amount">' + n2(net) + '</span> 小黄瓜';
      Casino.sfx.win();
      if (hit.ch === '🥒') Casino.toast('🎉 黄瓜大奖！', 'win', 3000);
    } else if (net === 0) {
      banner.dataset.kind = 'push';
      banner.innerHTML = (n === 3 ? '三个 ' : '两个 ') + symbolHtml(hit) + ' ' + hit.name +
        '，拿回票价 <span class="banner__amount">' + n2(stake) + '</span>，不亏不赚';
      Casino.sfx.click();
    } else if (ret > 0) {
      banner.dataset.kind = 'lose';
      banner.innerHTML = '两个 ' + symbolHtml(hit) + ' ' + hit.name + '，安慰奖拿回 <span class="banner__amount">' +
        n2(ret) + '</span> 小黄瓜';
      Casino.sfx.lose();
    } else {
      banner.dataset.kind = 'lose';
      banner.innerHTML = '刮出 ' + targets.map(symbolHtml).join(' ') +
        '，没凑成对，<span class="banner__amount">' + n2(stake) + '</span> 小黄瓜打水漂';
      Casino.sfx.lose();
    }

    if (ret > 0) Casino.refund(ret);
    Casino.record(net, net === 0 ? 'push' : undefined);

    pushLog(net);

    busy = false;
    render();
  }

  function pushLog(net) {
    history.unshift({ line: targets.map(symbolHtml).join(' '), net: net });
    history = history.slice(0, 10);
    historyEl.innerHTML = history.map(function (h) {
      return '<span class="history__item' + (h.net > 0 ? ' is-win' : '') + '">' +
        h.line + (h.net >= 0 ? ' +' : ' ') + h.net + '</span>';
    }).join('');
  }

  /* ---------- 事件 ---------- */

  cells.forEach(function (c) {
    c.canvas.addEventListener('pointerdown', onDown);
    c.canvas.addEventListener('pointermove', onMove);
    c.canvas.addEventListener('pointerup', onUp);
    c.canvas.addEventListener('pointercancel', onUp);
    c.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });

  buildChips();
  buyBtn.addEventListener('click', buy);
  openBtn.addEventListener('click', scratchAll);
  Casino.onChange(render);
  render();
})();
