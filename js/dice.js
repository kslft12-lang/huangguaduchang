/* 骰子猜大小 */
(function () {
  'use strict';

  Casino.mountHeader('dice');

  var CHIPS = [10, 50, 100, 500];

  var dice = [0, 1, 2].map(function (i) { return Die.create(document.getElementById('die' + i)); });
  var chipRow = document.getElementById('chipRow');
  var targetRow = document.getElementById('targetRow');
  var targetBtns = Array.prototype.slice.call(targetRow.querySelectorAll('.target'));
  var banner = document.getElementById('banner');
  var sumOut = document.getElementById('sumOut');
  var betOut = document.getElementById('betOut');
  var lastOut = document.getElementById('lastOut');
  var historyEl = document.getElementById('history');

  var bet = 0;          // 当前选中的筹码额
  var picked = 50;      // 'all' 表示「全部」筹码被选中
  var busy = false;
  var history = [];

  function showFaces(faces) {
    dice.forEach(function (d, i) { Die.set(d, faces[i]); });
  }

  /* ---------- 下注筹码 ---------- */

  function buildChips() {
    CHIPS.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-btn';
      b.dataset.value = String(v);
      b.textContent = String(v);
      b.addEventListener('click', function () { selectChip(v); });
      chipRow.appendChild(b);
    });

    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'chip-btn chip-btn--all';
    all.dataset.value = 'all';
    all.textContent = '全部';
    all.addEventListener('click', function () { selectChip('all'); });
    chipRow.appendChild(all);
  }

  function selectChip(v) {
    if (busy) return;
    picked = (v === 'all') ? 'all' : v;
    bet = (v === 'all') ? Casino.getBalance() : v;
    Casino.sfx.click();
    render();
  }

  function currentBet() {
    return picked === 'all' ? Casino.getBalance() : picked;
  }

  function render() {
    var balance = Casino.getBalance();
    bet = currentBet();

    Array.prototype.forEach.call(chipRow.children, function (el) {
      var v = el.dataset.value;
      var on = (v === 'all') ? picked === 'all' : Number(v) === picked;
      el.classList.toggle('is-on', on);
      var cost = (v === 'all') ? balance : Number(v);
      el.disabled = busy || cost < Casino.MIN_BET || cost > balance;
    });

    betOut.textContent = bet.toLocaleString('zh-CN');

    targetBtns.forEach(function (btn) {
      btn.disabled = busy || bet < Casino.MIN_BET || bet > balance;
    });
  }

  /* ---------- 结果 ---------- */

  function judge(target, faces) {
    var sum = faces[0] + faces[1] + faces[2];
    var triple = faces[0] === faces[1] && faces[1] === faces[2];
    var tag = triple ? '豹' : (sum >= 11 ? '大' : '小');
    var win;
    if (target === '豹子') win = triple;
    else if (target === '大') win = !triple && sum >= 11;
    else win = !triple && sum <= 10;
    return { sum: sum, triple: triple, tag: tag, win: win };
  }

  function pushLog(tag, sum, net) {
    history.unshift({ tag: tag, sum: sum, net: net });
    history = history.slice(0, 10);
    historyEl.innerHTML = history.map(function (h) {
      return '<span class="history__item" data-r="' + h.tag + '">' + h.sum + ' · ' + h.tag + '</span>';
    }).join('');
  }

  function rnd() { return Die.rand(); }

  function roll(target) {
    if (busy) return;

    var stake = currentBet();
    if (stake < Casino.MIN_BET || stake > Casino.getBalance()) {
      Casino.toast('余额不足 ' + stake + ' 筹码', 'lose');
      Casino.sfx.lose();
      return;
    }

    busy = true;
    Casino.bet(stake);
    Casino.addWager(stake);
    render();

    banner.dataset.kind = 'push';
    banner.textContent = '骰子抛出中…';
    sumOut.textContent = '—';
    targetBtns.forEach(function (b) { b.disabled = true; });

    // 先定下点数，再由物理动画滚到该点数上
    var faces = [rnd(), rnd(), rnd()];
    var left = dice.length;

    Casino.sfx.roll();
    dice.forEach(function (d, i) {
      Die.roll(d, faces[i], {
        delay: i * 90,
        onDone: function () {
          if (--left > 0) return;
          finish(target, stake, faces);
        }
      });
    });
  }

  function finish(target, stake, faces) {
    var r = judge(target, faces);
    var mult = target === '豹子' ? 25 : 2;
    var ret = r.win ? stake * mult : 0;
    var net = ret - stake;

    sumOut.textContent = String(r.sum);
    lastOut.textContent = r.sum + ' · ' + r.tag;

    if (r.win) {
      Casino.payout(ret, net);
      banner.dataset.kind = 'win';
      banner.innerHTML = '开出 <b>' + r.sum + ' 点 · ' + r.tag + '</b>，押中 ' + target +
        '，赢得 <span class="banner__amount">+' + net.toLocaleString('zh-CN') + '</span>';
      Casino.sfx.win();
    } else {
      Casino.record(-stake);
      banner.dataset.kind = 'lose';
      banner.innerHTML = '开出 <b>' + r.sum + ' 点 · ' + r.tag + '</b>，你押的是 ' + target +
        '，输掉 <span class="banner__amount">' + stake.toLocaleString('zh-CN') + '</span>';
      Casino.sfx.lose();
    }

    pushLog(r.tag, r.sum, net);

    busy = false;
    render();
  }

  /* ---------- 启动 ---------- */

  buildChips();
  showFaces([1, 2, 3]);
  targetBtns.forEach(function (btn) {
    btn.addEventListener('click', function () { roll(btn.dataset.target); });
  });
  Casino.onChange(render);
  render();
})();
