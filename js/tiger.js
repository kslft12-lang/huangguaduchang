/* 老虎机：三列卷轴，逐列停止。结果在按下「开始」的瞬间就已随机定死，
   卷轴只是高速演示（每帧换一个符号），所以不可能靠看节奏预判。 */
(function () {
  'use strict';

  Casino.mountHeader('tiger');

  var CHIPS = [10, 50, 100, 500];

  // 卷轴符号：顺序即卷轴上的排列；w 是出现概率，mult 是内部赔率（界面不展示）。
  // Σw = 1.00；三同命中率 Σw³ ≈ 4.4%；加权赔付后总返还率 ≈ 82.5%（50%~90% 区间内）。
  var SYMBOLS = [
    { name: '橘子',   ch: '🍊', w: 0.22, mult: 22 },
    { name: '苹果',   ch: '🍎', w: 0.15, mult: 28 },
    { name: '包子',   ch: '🥟', w: 0.07, mult: 70 },
    { name: '有一天', ch: '🪳', w: 0.30, mult: 13, img: 'img/yiyouyitian.png' },
    { name: '胡萝卜', ch: '🥕', w: 0.12, mult: 33 },
    { name: '蘑菇',   ch: '🍄', w: 0.10, mult: 45 },
    { name: '黄瓜',   ch: '🥒', w: 0.04, mult: 300 }
  ];

  var CUCUMBER = SYMBOLS[SYMBOLS.length - 1];

  var ROWS = 5;                 // 每列可见 5 个图形，第 3 个（下标 2）在兑奖线上
  var LINE_ROW = 2;

  var reelEls = [0, 1, 2].map(function (i) { return document.getElementById('reel' + i); });
  var cellEls = reelEls.map(function (el) {
    return Array.prototype.slice.call(el.querySelectorAll('.reel__cell'));
  });
  var chipRow = document.getElementById('chipRow');
  var startBtn = document.getElementById('startBtn');
  var stopBtn = document.getElementById('stopBtn');
  var banner = document.getElementById('banner');
  var historyEl = document.getElementById('history');

  var picked = 50;
  var busy = false;         // 一局进行中（含扣注后的滚动与结算）
  var spinning = false;     // 正在滚动且尚未全部停稳
  var stoppedCount = 0;
  var targets = [];         // 本局三列目标符号
  var stake = 0;
  var history = [];
  var lastTick = 0;         // 卷轴咔哒声的节流

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

    startBtn.disabled = busy || bet < Casino.MIN_BET || bet > balance;
    startBtn.textContent = spinning ? '转动中…' : '开始';
    stopBtn.disabled = !spinning;
  }

  /* ---------- 卷轴 ---------- */

  function weightedPick(rnd) {
    var r = rnd();
    for (var i = 0; i < SYMBOLS.length; i++) {
      r -= SYMBOLS[i].w;
      if (r < 0) return SYMBOLS[i];
    }
    return SYMBOLS[SYMBOLS.length - 1];
  }

  function randSym() { return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]; }

  /** 有图案图片的符号用 <img> 渲染，其余用 emoji 字符 */
  function symbolHtml(s) {
    return s.img ? '<img class="sym-img" src="' + s.img + '" alt="' + s.name + '">' : s.ch;
  }

  /** 写一整列：syms 是 5 个符号，中间那格落在兑奖线上 */
  function setColumn(i, syms, stopped) {
    for (var j = 0; j < ROWS; j++) cellEls[i][j].innerHTML = symbolHtml(syms[j]);
    reelEls[i].classList.toggle('is-stopped', !!stopped);
  }

  /** 滚动中：整列 5 格每帧全部换随机符号——三列共 15 格狂闪，
      60fps 下根本看不清，不可能靠节奏预判；结果早在开局时就定好了 */
  function spinColumn(i) {
    var syms = [];
    for (var j = 0; j < ROWS; j++) syms.push(randSym());
    setColumn(i, syms, false);
  }

  function spin() {
    var rnd = Math.random;
    targets = [weightedPick(rnd), weightedPick(rnd), weightedPick(rnd)];
    stoppedCount = 0;
    spinning = true;
    reelEls.forEach(function (el) { el.classList.remove('is-stopped'); });
    render();
  }

  function frame() {
    if (!spinning) return;
    for (var i = 0; i < 3; i++) {
      if (i >= stoppedCount) spinColumn(i);
    }
    var now = performance.now();
    if (now - lastTick >= 55) { lastTick = now; Casino.sfx.tick(); }
    requestAnimationFrame(frame);
  }

  function stopOne() {
    if (!spinning) return;
    Casino.sfx.click();
    // 目标符号固定落在兑奖线（中间格），上下两格给随机陪衬
    var syms = [];
    for (var j = 0; j < ROWS; j++) {
      syms.push(j === LINE_ROW ? targets[stoppedCount] : randSym());
    }
    setColumn(stoppedCount, syms, true);
    stoppedCount++;
    if (stoppedCount === 3) finish();
    else render();
  }

  function finish() {
    var a = targets[0], b = targets[1], c = targets[2];
    var win = a === b && b === c;
    var ret = win ? stake * a.mult : 0;
    var net = ret - stake;

    if (win) {
      Casino.payout(ret, net);
      banner.dataset.kind = 'win';
      banner.innerHTML = '三列都是 <b>' + symbolHtml(a) + ' ' + a.name + '</b>，' +
        '赢得 <span class="banner__amount">' + net.toLocaleString('zh-CN') + '</span> 小黄瓜';
      if (a === CUCUMBER) {
        banner.innerHTML = '🎉 最终大奖！三根黄瓜排成一条线，赢了 <span class="banner__amount">' +
          net.toLocaleString('zh-CN') + '</span> 小黄瓜';
        Casino.toast('🎉 黄瓜三连 · 最终大奖！', 'win', 3200);
        Casino.sfx.bigwin();
      } else {
        Casino.sfx.win();
      }
    } else {
      Casino.record(-stake);
      banner.dataset.kind = 'lose';
      banner.innerHTML = '三列是 ' + targets.map(symbolHtml).join(' ') +
        '，没成一条线，输掉 <span class="banner__amount">' + stake.toLocaleString('zh-CN') + '</span> 小黄瓜';
      Casino.sfx.lose();
    }

    pushLog(a, b, c, net);

    spinning = false;
    busy = false;
    render();
  }

  function pushLog(a, b, c, net) {
    var icon = (a === b && b === c) ? symbolHtml(a) : '·';
    history.unshift({ icon: icon, line: symbolHtml(a) + ' ' + symbolHtml(b) + ' ' + symbolHtml(c), net: net });
    history = history.slice(0, 10);
    historyEl.innerHTML = history.map(function (h) {
      return '<span class="history__item' + (h.net > 0 ? ' is-win' : '') + '">' +
        h.line + ' ' + h.icon + (h.net >= 0 ? ' +' : '') + h.net + '</span>';
    }).join('');
  }

  /* ---------- 事件 ---------- */

  function start() {
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

    banner.dataset.kind = 'push';
    banner.textContent = '卷轴转起来了…按「停止」依次停下列子。';

    spin();
    Casino.sfx.roll();
    requestAnimationFrame(frame);
    render();
  }

  buildChips();

  // 奖级表：由 SYMBOLS 生成（按倍率升序 = 概率降序），改赔率不用同步改页面
  document.getElementById('prizeTable').innerHTML = SYMBOLS.slice()
    .sort(function (a, b) { return a.mult - b.mult; })
    .map(function (s) {
      var tier = s.mult >= 100 ? 'high' : (s.mult >= 40 ? 'mid' : 'low');
      return '<div class="slot-line" data-tier="' + tier + '"><span>' + symbolHtml(s) + ' ' + s.name +
        ' ×' + s.mult + '</span><b>净赚 ' + (s.mult - 1) + ' 倍</b></div>';
    }).join('');

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stopOne);
  Casino.onChange(render);
  render();
})();
