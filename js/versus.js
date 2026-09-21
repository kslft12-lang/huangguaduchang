/* 骰子比大小：庄家先手亮出点数 → 玩家选择继续或加注 → 再开奖
   比牌规则见 js/versus-rules.js（111 > 456 > 普通点数 > 111 的大小循环） */
(function () {
  'use strict';

  Casino.mountHeader('versus');

  var R = window.VersusRules;
  var CHIPS = [10, 50, 100, 500];
  var PAUSE_MS = 420;

  var playerHandEl = document.getElementById('playerHand');
  var dealerHandEl = document.getElementById('dealerHand');
  var playerBadge = document.getElementById('playerBadge');
  var dealerBadge = document.getElementById('dealerBadge');
  var banner = document.getElementById('banner');
  var baseOut = document.getElementById('baseOut');
  var raiseOut = document.getElementById('raiseOut');
  var tallyEl = document.getElementById('tally');
  var declareEl = document.getElementById('declare');
  var startBtn = document.getElementById('startBtn');
  var raiseBtn = document.getElementById('raiseBtn');
  var keepBtn = document.getElementById('keepBtn');
  var chipRow = document.getElementById('chipRow');
  var logList = document.getElementById('logList');

  var picked = 50;
  var phase = 'bet';       // bet | dealer | choice | player | reveal | over
  var busy = false;
  var baseStake = 0;
  var raiseStake = 0;
  var raiseMult = 0;
  var declared = 0;        // 庄家亮出的那一颗的点数
  var declareIdx = 0;      // 亮的是第几颗
  var dealer = [0, 0, 0];
  var player = [0, 0, 0];
  var log = [];
  var tally = { win: 0, push: 0, lose: 0 };

  var playerDice = buildDice(playerHandEl, 3);
  var dealerDice = buildDice(dealerHandEl, 3);

  function buildDice(host, n) {
    host.innerHTML = '';
    var out = [];
    for (var i = 0; i < n; i++) out.push(Die.create(host));
    return out;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function currentBet() { return picked; }
  function staked() { return baseStake + raiseStake; }

  /* ---------- 界面 ---------- */

  function render() {
    var balance = Casino.getBalance();

    Array.prototype.forEach.call(chipRow.children, function (el) {
      var cost = Number(el.dataset.value);
      el.classList.toggle('is-on', picked === cost);
      el.disabled = busy || phase !== 'bet' && phase !== 'over' || cost > balance || cost < Casino.MIN_BET;
    });

    var canStart = (phase === 'bet' || phase === 'over') && !busy && Casino.canBet(currentBet());
    startBtn.hidden = !(phase === 'bet' || phase === 'over');
    startBtn.disabled = !canStart;
    startBtn.textContent = phase === 'over' ? '再来一局' : ('下注并开局 ' + currentBet().toLocaleString('zh-CN'));

    var choosing = phase === 'choice' && !busy;
    keepBtn.hidden = !choosing;
    raiseBtn.hidden = !choosing;
    if (choosing) {
      var affordable = Casino.canBet(baseStake);
      var allowed = R.canRaise(declared);
      raiseBtn.disabled = !affordable || !allowed;
      raiseBtn.textContent = allowed
        ? ('加注 ' + baseStake.toLocaleString('zh-CN') + ' · 赢返 ' +
           R.raiseReturn(baseStake, raiseMult).toLocaleString('zh-CN'))
        : '加注（庄家亮 ' + declared + ' 点，无利可图）';
      keepBtn.textContent = '继续（原注 ' + baseStake.toLocaleString('zh-CN') +
        ' · 赢返 ' + R.baseReturn(baseStake).toLocaleString('zh-CN') + '）';
    }

    baseOut.textContent = baseStake.toLocaleString('zh-CN');
    raiseOut.textContent = raiseStake
      ? (raiseStake.toLocaleString('zh-CN') + ' → ' + R.raiseReturn(raiseStake, raiseMult).toLocaleString('zh-CN'))
      : '—';
    tallyEl.textContent = tally.win + ' / ' + tally.push + ' / ' + tally.lose;
    logList.innerHTML = log.length
      ? log.slice(0, 8).map(function (l) {
          return '<li><span>' + l.text + '</span><b data-ton="' + l.ton + '">' +
            (l.net > 0 ? '+' : '') + l.net + '</b></li>';
        }).join('')
      : '<li><span>还没有记录</span></li>';
  }

  function resetTable() {
    playerDice.forEach(function (d) { Die.set(d, Die.rand()); });
    dealerDice.forEach(function (d) { Die.set(d, Die.rand()); });
    playerBadge.textContent = '—';
    dealerBadge.textContent = '—';
    playerBadge.dataset.kind = '';
    dealerBadge.dataset.kind = '';
    declareEl.textContent = '等待庄家亮点数…';
  }
  /* ---------- 掷骰 ---------- */

  function rollGroup(objs, faces, done) {
    var left = objs.length;
    Casino.sfx.roll();
    objs.forEach(function (d, i) {
      Die.roll(d, faces[i], {
        delay: i * 90,
        onDone: function () { if (--left === 0) done(); }
      });
    });
  }

  /* ---------- 一局 ---------- */

  async function start() {
    if (busy || (phase !== 'bet' && phase !== 'over')) return;

    var stake = currentBet();
    if (!Casino.bet(stake)) return;

    baseStake = stake;
    raiseStake = 0;
    raiseMult = 0;
    for (var i = 0; i < 3; i++) { dealer[i] = 0; player[i] = 0; }
    Casino.addWager(stake);

    busy = true;
    phase = 'dealer';
    resetTable();
    render();

    // 庄家先手，亮出点数（这就是「声明点数」）
    banner.dataset.kind = 'push';
    banner.textContent = '庄家先手，掷骰中…';

    rollGroup(dealerDice, [Die.rand(), Die.rand(), Die.rand()], function () {
      dealer = dealerDice.map(function (d) { return d.face; });

      // 只亮一颗，另外两颗扣着 —— 这就是「声明一个点数」
      declareIdx = Math.floor(Math.random() * dealerDice.length);
      declared = dealer[declareIdx];
      dealerDice.forEach(function (d, i) { if (i !== declareIdx) Die.cover(d); });

      var t = R.lookupDeclare(declared);
      raiseMult = t.raiseMult;
      dealerBadge.textContent = '亮 ' + declared;

      phase = 'choice';
      busy = false;
      declareEl.textContent = '庄家声明 ' + declared + ' 点（第 ' + (declareIdx + 1) + ' 颗，另两颗扣着）';
      banner.dataset.kind = 'push';
      banner.textContent = R.canRaise(declared)
        ? '庄家亮出 ' + declared + ' 点。加注 ' + baseStake.toLocaleString('zh-CN') +
          ' 赢返 ' + R.raiseReturn(baseStake, raiseMult).toLocaleString('zh-CN') + '，或按原注继续。'
        : '庄家亮出 ' + declared + ' 点，加注无利可图，只能继续。';
      render();
    });
  }

  async function play(raise) {
    if (busy || phase !== 'choice') return;

    if (raise) {
      if (!R.canRaise(declared) || !Casino.bet(baseStake)) return;
      raiseStake = baseStake;
      Casino.addWager(baseStake);
    }

    busy = true;
    phase = 'player';
    render();

    banner.dataset.kind = 'push';
    banner.textContent = '你掷骰中…';
    await sleep(PAUSE_MS);

    rollGroup(playerDice, [Die.rand(), Die.rand(), Die.rand()], function () {
      player = playerDice.map(function (d) { return d.face; });
      playerBadge.textContent = R.shortName(player);
      reveal();
    });
  }

  /** 开奖：把庄家扣着的两颗翻开，然后结算 */
  async function reveal() {
    phase = 'reveal';
    banner.dataset.kind = 'push';
    banner.textContent = '开奖，庄家翻开另外两颗…';

    dealerDice.forEach(function (d) { Die.uncover(d); });
    dealerBadge.textContent = R.shortName(dealer);
    Casino.sfx.click();

    await sleep(PAUSE_MS);
    settle();
  }

  function settle() {
    var r = R.compare(player, dealer);
    var total = staked();
    var ret = 0;

    if (r > 0) {
      ret = R.baseReturn(baseStake);
      if (raiseStake > 0) ret += R.raiseReturn(raiseStake, raiseMult);
    } else if (r === 0) {
      ret = total;
    }

    var net = ret - total;
    if (ret > 0) Casino.refund(ret);
    Casino.record(net, r === 0 ? 'push' : undefined);

    var kind = r > 0 ? 'win' : (r < 0 ? 'lose' : 'push');
    var text = R.describe(player, dealer, r);

    playerBadge.dataset.kind = kind === 'win' ? 'bj' : (kind === 'lose' ? 'bust' : '');
    dealerBadge.dataset.kind = kind === 'lose' ? 'bj' : (kind === 'win' ? 'bust' : '');

    if (kind === 'win') tally.win++;
    else if (kind === 'push') tally.push++;
    else tally.lose++;

    log.unshift({
      text: text + (raiseStake ? '（含加注）' : ''),
      net: net,
      ton: net > 0 ? 'up' : (net < 0 ? 'down' : '')
    });
    log = log.slice(0, 8);

    banner.dataset.kind = kind;
    banner.innerHTML = text + '，' +
      (kind === 'win' ? '赢得 <span class="banner__amount">+' + net.toLocaleString('zh-CN') + '</span>'
        : kind === 'push' ? '退还本金 <span class="banner__amount">' + total.toLocaleString('zh-CN') + '</span>'
        : '输掉 <span class="banner__amount">' + total.toLocaleString('zh-CN') + '</span>');

    if (kind === 'win') Casino.sfx.win();
    else if (kind === 'lose') Casino.sfx.lose();
    else Casino.sfx.click();

    phase = 'over';
    busy = false;
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
      if (busy || (phase !== 'bet' && phase !== 'over')) return;
      picked = v;
      Casino.sfx.click();
      render();
    });
    chipRow.appendChild(b);
  });

  startBtn.addEventListener('click', start);
  keepBtn.addEventListener('click', function () { play(false); });
  raiseBtn.addEventListener('click', function () { play(true); });
  Casino.onChange(render);

  // 侧栏列出「庄家亮出几点 → 加注赔多少」的完整定价表
  document.getElementById('raiseTable').innerHTML = [1, 2, 3, 4, 5, 6].map(function (x) {
    var t = R.lookupDeclare(x);
    var tier = t.canRaise ? (t.raiseMult >= 1 ? 'high' : 'mid') : 'zero';
    return '<div class="slot-line" data-tier="' + tier + '"><span>庄家亮 ' + x + ' 点</span><b>' +
      (t.canRaise ? t.raiseMult.toFixed(2) + ' 倍' : '不可加注') + '</b></div>';
  }).join('');

  resetTable();
  render();
})();
