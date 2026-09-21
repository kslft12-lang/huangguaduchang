/* 21点 */
(function () {
  'use strict';

  Casino.mountHeader('blackjack');

  var DECKS = 6;
  var SHOE_SIZE = 52 * DECKS;
  var RESHUFFLE_AT = SHOE_SIZE * 0.25;
  var SUITS = [
    { s: '♠', red: false }, { s: '♥', red: true },
    { s: '♦', red: true }, { s: '♣', red: false }
  ];
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var CHIPS = [10, 50, 100, 500];

  var dealerHandEl = document.getElementById('dealerHand');
  var playerHandEl = document.getElementById('playerHand');
  var dealerBadge = document.getElementById('dealerBadge');
  var playerBadge = document.getElementById('playerBadge');
  var banner = document.getElementById('banner');
  var betOut = document.getElementById('betOut');
  var shoeFill = document.getElementById('shoeFill');
  var shoeNum = document.getElementById('shoeNum');
  var logList = document.getElementById('logList');
  var chipRow = document.getElementById('chipRow');

  var dealBtn = document.getElementById('dealBtn');
  var hitBtn = document.getElementById('hitBtn');
  var standBtn = document.getElementById('standBtn');
  var doubleBtn = document.getElementById('doubleBtn');

  var shoe = [];
  var phase = 'bet';     // bet | player | dealer | over
  var busy = false;
  var picked = 50;       // 当前选中的小黄瓜面额
  var roundBet = 0;      // 本局锁定的基础注（双倍时再加一份）
  var staked = 0;        // 本局已投入的总注
  var player = [];
  var dealer = [];
  var log = [];

  /* ---------- 牌靴 ---------- */

  function buildShoe() {
    shoe = [];
    for (var d = 0; d < DECKS; d++) {
      for (var i = 0; i < SUITS.length; i++) {
        for (var j = 0; j < RANKS.length; j++) {
          shoe.push({ r: RANKS[j], s: SUITS[i].s, red: SUITS[i].red });
        }
      }
    }
    for (var k = shoe.length - 1; k > 0; k--) {
      var m = Math.floor(Math.random() * (k + 1));
      var tmp = shoe[k]; shoe[k] = shoe[m]; shoe[m] = tmp;
    }
  }

  function draw() {
    if (shoe.length <= RESHUFFLE_AT) {
      buildShoe();
      Casino.toast('牌靴已重新洗牌');
    }
    return shoe.pop();
  }

  function value(cards) {
    var total = 0, aces = 0;
    cards.forEach(function (c) {
      if (c.hidden) return;
      if (c.r === 'A') { aces++; total += 11; }
      else if (c.r === 'J' || c.r === 'Q' || c.r === 'K') total += 10;
      else total += Number(c.r);
    });
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return { total: total, soft: aces > 0 };
  }

  function isBlackjack(cards) { return cards.length === 2 && value(cards).total === 21; }

  /* ---------- 渲染 ---------- */

  function cardNode(card) {
    var el = document.createElement('div');
    if (card.hidden) {
      el.className = 'card card--back is-hole';
      return el;
    }
    el.className = 'card' + (card.red ? ' card--red' : '');
    el.innerHTML =
      '<span class="card__corner"><span class="r">' + card.r + '</span><span class="s">' + card.s + '</span></span>' +
      '<span class="card__mid">' + card.s + '</span>';
    return el;
  }

  function paintHand(el, cards) {
    el.innerHTML = '';
    cards.forEach(function (c) { el.appendChild(cardNode(c)); });
  }

  function badgeFor(el, cards, opts) {
    if (!cards.length) {
      el.textContent = '—';
      el.dataset.kind = '';
      return;
    }
    var v = value(cards);
    el.textContent = v.total + (v.soft && v.total !== 21 ? '（软）' : '');
    if (v.total > 21) el.dataset.kind = 'bust';
    else if (opts && opts.bj && isBlackjack(cards)) el.dataset.kind = 'bj';
    else el.dataset.kind = '';
  }

  function render() {
    var balance = Casino.getBalance();

    paintHand(dealerHandEl, dealer);
    paintHand(playerHandEl, player);

    badgeFor(dealerBadge, dealer);
    badgeFor(playerBadge, player, { bj: true });

    betOut.textContent = (staked || currentBet()).toLocaleString('zh-CN');

    var pct = Math.max(0, Math.min(100, (shoe.length / SHOE_SIZE) * 100));
    shoeFill.style.width = pct + '%';
    shoeNum.textContent = String(shoe.length);

    Array.prototype.forEach.call(chipRow.children, function (el) {
      var cost = Number(el.dataset.value);
      el.classList.toggle('is-on', picked === cost);
      el.disabled = busy || phase !== 'bet' || cost > balance || cost < Casino.MIN_BET;
    });

    var canAct = phase === 'player' && !busy;
    var canDeal = phase === 'bet' && !busy && Casino.canBet(currentBet());
    var canNext = phase === 'over' && !busy;
    dealBtn.disabled = !(canDeal || canNext);
    dealBtn.textContent = canNext ? '下一局' : '发牌';
    hitBtn.disabled = !canAct;
    standBtn.disabled = !canAct;
    doubleBtn.disabled = !canAct || player.length !== 2 || !Casino.canBet(roundBet || currentBet());

    logList.innerHTML = log.length
      ? log.slice(0, 8).map(function (l) {
          return '<li><span>' + l.text + '</span><b data-ton="' + l.ton + '">' +
            (l.net > 0 ? '+' : '') + l.net + '</b></li>';
        }).join('')
      : '<li><span>还没有记录</span></li>';
  }

  function currentBet() { return picked; }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------- 流程 ---------- */

  async function startRound() {
    var stake = currentBet();
    if (!Casino.canBet(stake)) {
      Casino.toast('余额不足 ' + stake + ' 小黄瓜', 'lose');
      Casino.sfx.lose();
      return;
    }
    if (!Casino.bet(stake)) return;

    busy = true;
    staked = stake;
    roundBet = stake;
    Casino.addWager(stake);
    player = [];
    dealer = [];
    phase = 'player';
    banner.dataset.kind = 'push';
    banner.textContent = '发牌…';
    Casino.sfx.click();
    render();

    player.push(draw()); render(); await sleep(280);
    dealer.push(draw()); render(); await sleep(280);
    player.push(draw()); render(); await sleep(280);

    var hole = draw();
    hole.hidden = true;
    dealer.push(hole);
    render(); await sleep(280);

    if (isBlackjack(player)) {
      banner.dataset.kind = 'push';
      banner.textContent = '黑杰克！等庄家亮牌…';
      render();
      await sleep(520);
      dealer.forEach(function (c) { c.hidden = false; });
      render();
      await sleep(460);
      settle();
      return;
    }

    busy = false;
    phase = 'player';
    banner.dataset.kind = 'push';
    banner.textContent = '你 ' + value(player).total + ' 点，要牌还是停牌？';
    render();
  }

  async function hit() {
    if (busy || phase !== 'player') return;
    busy = true;
    Casino.sfx.click();
    player.push(draw());
    render();
    await sleep(240);

    var v = value(player);
    if (v.total > 21) {
      settle();
      return;
    }
    if (v.total === 21) {
      await dealerTurn();
      return;
    }
    busy = false;
    banner.textContent = '你 ' + v.total + ' 点，要牌还是停牌？';
    render();
  }

  async function double() {
    if (busy || phase !== 'player' || player.length !== 2) return;
    var extra = roundBet || currentBet();
    if (!Casino.canBet(extra)) {
      Casino.toast('余额不足以双倍下注', 'lose');
      Casino.sfx.lose();
      return;
    }
    busy = true;
    if (!Casino.bet(extra)) { busy = false; return; }
    staked += extra;
    Casino.addWager(extra);
    Casino.sfx.click();

    player.push(draw());
    render();
    await sleep(300);
    doubleBtn.disabled = true;

    if (value(player).total > 21) { settle(); return; }
    await dealerTurn();
  }

  async function stand() {
    if (busy || phase !== 'player') return;
    Casino.sfx.click();
    await dealerTurn();
  }

  async function dealerTurn() {
    phase = 'dealer';
    busy = true;
    render();

    dealer.forEach(function (c) { c.hidden = false; });
    banner.dataset.kind = 'push';
    banner.textContent = '庄家亮牌：' + value(dealer).total + ' 点';
    render();
    await sleep(460);

    while (value(dealer).total < 17) {
      dealer.push(draw());
      render();
      await sleep(460);
    }
    settle();
  }

  function settle() {
    var p = value(player);
    var d = value(dealer);
    var pBJ = isBlackjack(player);
    var dBJ = isBlackjack(dealer);

    var ret = 0;
    var text = '';
    var kind = 'push';

    if (p.total > 21) {
      text = '你爆牌 ' + p.total + ' 点，庄家赢';
      kind = 'lose';
    } else if (pBJ && !dBJ) {
      ret = Math.floor(staked * 2.5);
      text = '黑杰克！赔 3:2';
      kind = 'win';
    } else if (dBJ && !pBJ) {
      text = '庄家黑杰克，你输了';
      kind = 'lose';
    } else if (pBJ && dBJ) {
      ret = staked;
      text = '双方黑杰克，平局';
      kind = 'push';
    } else if (d.total > 21) {
      ret = staked * 2;
      text = '庄家爆牌 ' + d.total + ' 点，你赢';
      kind = 'win';
    } else if (p.total > d.total) {
      ret = staked * 2;
      text = '你 ' + p.total + ' 点 大于 庄家 ' + d.total + ' 点';
      kind = 'win';
    } else if (p.total < d.total) {
      text = '你 ' + p.total + ' 点 小于 庄家 ' + d.total + ' 点';
      kind = 'lose';
    } else {
      ret = staked;
      text = '同为 ' + p.total + ' 点，平局';
      kind = 'push';
    }

    var net = ret - staked;
    if (ret > 0) Casino.refund(ret);
    Casino.record(net, kind === 'push' ? 'push' : undefined);

    log.unshift({ text: text, net: net, ton: net > 0 ? 'up' : (net < 0 ? 'down' : '') });
    log = log.slice(0, 8);

    banner.dataset.kind = kind;
    banner.innerHTML = text + '　<span class="banner__amount">' +
      (net > 0 ? '+' + net : net < 0 ? String(net) : '0') + '</span>';

    if (net > 0) Casino.sfx.win();
    else if (net < 0) Casino.sfx.lose();

    phase = 'over';
    busy = false;
    render();
  }

  /* ---------- 绑定 ---------- */

  CHIPS.forEach(function (v) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip-btn';
    b.dataset.value = String(v);
    b.textContent = String(v);
    b.addEventListener('click', function () {
      if (busy || phase !== 'bet') return;
      picked = v;
      Casino.sfx.click();
      render();
    });
    chipRow.appendChild(b);
  });

  dealBtn.addEventListener('click', function () {
    if (phase === 'over' || phase === 'bet') {
      if (phase === 'over') { phase = 'bet'; staked = 0; roundBet = 0; player = []; dealer = []; render(); }
      startRound();
    }
  });
  hitBtn.addEventListener('click', hit);
  standBtn.addEventListener('click', stand);
  doubleBtn.addEventListener('click', double);

  buildShoe();
  render();
})();
