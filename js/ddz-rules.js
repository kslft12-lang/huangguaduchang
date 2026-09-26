/* ============================================================
   斗地主 · 牌、牌型识别与对局状态机
   浏览器与 Node 共用同一份实现（tools/test-ddz.js 用它跑断言和随机整局）。
   房主是唯一权威：客户端只发动作，房主调 applyAction 推进状态再广播快照；
   seats[].hand 只存在于房主本地，广播快照里只带接收者自己的手牌。

   牌的编码：整数 0..53。0..51 = rank 3..14（3..A），花色 = id % 4（♠♥♣♦）；
   52 = 小王（rank 16）、53 = 大王（rank 17）。rank 15 是「2」。
   牌型：单/对/三/三带一/三带二/顺子(≥5,3..A)/连对(≥3)/飞机(≥2连三,纯/带单/带对)/
   四带二单/四带两对/炸弹/王炸。二和王不入顺子、连对、飞机身。
   同点数歧义（如 44445555）优先按飞机解释（机身更大、main 更高），判定恒定。
   计分：底分 = 叫分 × 2^min(炸弹数,3)，春天/反春 ×2；地主 ±2×底分、农民各 ∓底分。
   ============================================================ */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.DdzRules = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SUITS = ['♠', '♥', '♣', '♦'];
  var RANK_TEXT = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '王', 17: '王' };
  var MAX_BOMB_POW = 3;   // 炸弹倍率上限 2^3 = 8，防止余额被一发带走

  function rankOf(c) { return c < 52 ? 3 + (c >> 2) : (c === 52 ? 16 : 17); }
  function suitOf(c) { return c < 52 ? SUITS[c & 3] : ''; }
  function isRed(c) { return c < 52 ? ((c & 3) === 1 || (c & 3) === 3) : c === 53; }
  function cardText(c) {
    if (c >= 52) return c === 52 ? '小王' : '大王';
    var r = rankOf(c);
    return RANK_TEXT[r] || String(r);
  }

  function newDeck() {
    var d = [];
    for (var i = 0; i < 54; i++) d.push(i);
    return d;
  }

  function shuffle(a, rnd) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** 降序排（大→小），同点数按 id 稳定 */
  function sortDesc(cards) {
    return cards.slice().sort(function (a, b) {
      var d = rankOf(b) - rankOf(a);
      return d !== 0 ? d : a - b;
    });
  }

  /** 发牌：3 手各 17 张 + 底牌 3 张 */
  function deal(rnd) {
    var deck = shuffle(newDeck(), rnd);
    return { hands: [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)], kitty: deck.slice(51) };
  }

  /* ---------- 牌型识别 ---------- */

  /** 返回 {type, main, n} 或 null。main 是比较用的主牌点数 */
  function detect(cards) {
    var n = cards.length;
    if (n < 1 || n > 20) return null;
    var ranks = cards.map(rankOf).sort(function (a, b) { return b - a; });

    if (n === 2 && ranks[0] === 17 && ranks[1] === 16) return { type: 'rocket', main: 17, n: 2 };

    var cnt = {}, order = [];
    for (var i = 0; i < n; i++) {
      var r = ranks[i];
      if (cnt[r] === undefined) { cnt[r] = 0; order.push(r); }
      cnt[r]++;
    }
    var kinds = order.length;
    var maxR = order[0];
    var c0 = cnt[order[0]];

    if (n === 1) return { type: 'single', main: maxR, n: 1 };
    if (n === 2 && kinds === 1) return { type: 'pair', main: maxR, n: 2 };
    if (n === 3 && kinds === 1) return { type: 'trio', main: maxR, n: 3 };
    if (n === 4 && kinds === 1) return { type: 'bomb', main: maxR, n: 4 };
    if (n === 4 && kinds === 2 && (c0 === 3 || cnt[order[1]] === 3)) {
      return { type: 'trio1', main: c0 === 3 ? maxR : order[1], n: 4 };
    }
    if (n === 5 && kinds === 2 && (c0 === 3 || cnt[order[1]] === 3)) {
      return { type: 'trio2', main: c0 === 3 ? maxR : order[1], n: 5 };
    }
    // 顺子 / 连对：3..A 连续（order 降序相邻差 1）
    if (kinds === n && n >= 5 && maxR <= 14 && consecutive(order)) {
      return { type: 'straight', main: maxR, n: n };
    }
    if (n >= 6 && n % 2 === 0 && kinds === n / 2 && maxR <= 14 && consecutive(order)) {
      return { type: 'pairSeq', main: maxR, n: n };
    }
    // 飞机（纯 / 带单 / 带对），机身点数 3..A 连续
    var plane = detectPlane(cards, cnt, order, n);
    if (plane) return plane;
    // 四带二单（6 张：炸弹 + 任 2 张）/ 四带两对（8 张：炸弹 + 两对）
    var quad = null, extra = [];
    for (var k = 0; k < kinds; k++) {
      if (cnt[order[k]] === 4 && quad === null) quad = order[k];
      else extra.push(order[k]);
    }
    if (quad !== null && n === 6 && extra.length <= 2) return { type: 'four1', main: quad, n: 6 };
    if (quad !== null && n === 8 && extra.length === 2 && cnt[extra[0]] === 2 && cnt[extra[1]] === 2) {
      return { type: 'four2', main: quad, n: 8 };
    }
    return null;
  }

  function consecutive(descList) {
    for (var i = 1; i < descList.length; i++) {
      if (descList[i - 1] - descList[i] !== 1) return false;
    }
    return true;
  }

  /** 飞机：枚举连续三张窗口（k≥2），余牌恰为 0（纯）/ k（带 k 单）/ 2k（带 k 对）。
      多解（如 44445555 可带翅也可四带二）取 main 最大者，同级优先纯飞机 > 带对 > 带单 */
  function detectPlane(cards, cnt, order, n) {
    var tr = order.filter(function (r) { return cnt[r] >= 3 && r <= 14; });
    var best = null;
    for (var s = 0; s < tr.length; s++) {
      for (var e = s; e < tr.length; e++) {
        if (e > s && tr[e - 1] - tr[e] !== 1) break;   // 窗口断了
        var k = e - s + 1;
        if (k < 2) continue;
        var lo = tr[e], hi = tr[s];
        var leftover = n - 3 * k;
        var cand = null;
        if (leftover === 0) cand = { type: 'plane', main: hi, n: n };
        else if (leftover === k) cand = { type: 'plane1', main: hi, n: n };
        else if (leftover === 2 * k) {
          var pairs = true;
          for (var r in cnt) {
            var rem = cnt[r] - (r >= lo && r <= hi ? 3 : 0);
            if (rem !== 0 && rem !== 2) { pairs = false; break; }
          }
          if (pairs) cand = { type: 'plane2', main: hi, n: n };
        }
        if (cand) {
          var pri = cand.main * 10 + (cand.type === 'plane' ? 2 : cand.type === 'plane2' ? 1 : 0);
          if (!best || pri > best._pri) { cand._pri = pri; best = cand; }
        }
      }
    }
    if (best) delete best._pri;
    return best;
  }

  /** cur 能否压过 prev（prev 为 null 表示自由出牌） */
  function beats(cur, prev) {
    if (!cur) return false;
    if (!prev) return true;
    if (cur.type === 'rocket') return true;
    if (prev.type === 'rocket') return false;
    if (cur.type === 'bomb') return prev.type !== 'bomb' || cur.main > prev.main;
    if (prev.type === 'bomb') return false;
    return cur.type === prev.type && cur.n === prev.n && cur.main > prev.main;
  }

  /** 超时自动动作：跟牌一律不出（合法且不添乱），领出打最小的单张保牌局推进 */
  function autoMove(hand, table) {
    if (table) return { t: 'pass' };
    var s = sortAsc(hand);
    return { t: 'play', cards: [s[0]] };
  }

  function sortAsc(cards) {
    return cards.slice().sort(function (a, b) {
      var d = rankOf(a) - rankOf(b);
      return d !== 0 ? d : a - b;
    });
  }

  /* ---------- 对局状态机（房主本地推进） ---------- */

  /** seats: [{pid, name}] ×3；firstBidder 每局轮换 */
  function createGame(seats, rnd, firstBidder) {
    var d = deal(rnd);
    var st = {
      phase: 'bid',
      seats: [],
      kitty: d.kitty,
      landlord: -1,
      firstBidder: (firstBidder || 0) % 3,
      turn: (firstBidder || 0) % 3,
      highestBid: 0,
      bidsDone: 0,
      table: null,        // {seat, combo, cards}，领出时为 null
      lastLeader: -1,
      passCount: 0,
      bombs: 0,
      winner: -1,
      result: null
    };
    for (var i = 0; i < 3; i++) {
      st.seats.push({
        pid: seats[i].pid, name: seats[i].name, seat: i,
        hand: sortDesc(d.hands[i]),   // 仅房主本地
        bid: -1, played: 0
      });
    }
    return st;
  }

  function redeal(st, rnd) {
    var d = deal(rnd);
    for (var i = 0; i < 3; i++) {
      st.seats[i].hand = sortDesc(d.hands[i]);
      st.seats[i].bid = -1;
      st.seats[i].played = 0;
    }
    st.kitty = d.kitty;
    st.firstBidder = (st.firstBidder + 1) % 3;
    st.turn = st.firstBidder;
    st.highestBid = 0;
    st.bidsDone = 0;
    st.landlord = -1;
    st.table = null;
    st.lastLeader = -1;
    st.passCount = 0;
    st.bombs = 0;
    st.winner = -1;
    st.result = null;
  }

  function seatOf(st, pid) {
    for (var i = 0; i < 3; i++) if (st.seats[i].pid === pid) return i;
    return -1;
  }

  function inHand(hand, cards) {
    var pool = hand.slice();
    for (var i = 0; i < cards.length; i++) {
      var at = pool.indexOf(cards[i]);
      if (at < 0) return false;
      pool.splice(at, 1);
    }
    return true;
  }

  /** 推进一步。就地修改 st，返回 {ok, error?}（牌局事件在 st.lastEvents 里） */
  function applyAction(st, pid, action, rnd) {
    st.lastEvents = [];
    var seat = seatOf(st, pid);
    if (seat < 0) return { ok: false, error: 'not-in-room' };

    if (st.phase === 'bid') {
      if (action.t !== 'bid') return { ok: false, error: 'expect-bid' };
      if (seat !== st.turn) return { ok: false, error: 'not-your-turn' };
      var v = Math.floor(Number(action.v));
      if (!(v >= 0 && v <= 3)) return { ok: false, error: 'bad-bid' };
      if (v > 0 && v <= st.highestBid) return { ok: false, error: 'bid-too-low' };
      st.seats[seat].bid = v;
      if (v > st.highestBid) st.highestBid = v;
      st.bidsDone++;
      st.lastEvents.push({ t: 'bid', seat: seat, v: v });
      if (st.bidsDone < 3) {
        st.turn = (st.turn + 1) % 3;
        return { ok: true };
      }
      if (st.highestBid === 0) {           // 流局：重发
        redeal(st, rnd);
        st.lastEvents.push({ t: 'redeal' });
        return { ok: true };
      }
      for (var i = 0; i < 3; i++) {
        if (st.seats[i].bid === st.highestBid) st.landlord = i;
      }
      var L = st.seats[st.landlord];
      L.hand = sortDesc(L.hand.concat(st.kitty));
      st.phase = 'play';
      st.turn = st.landlord;
      st.lastEvents.push({ t: 'landlord', seat: st.landlord, bid: st.highestBid });
      return { ok: true };
    }

    if (st.phase !== 'play') return { ok: false, error: 'not-playing' };
    if (seat !== st.turn) return { ok: false, error: 'not-your-turn' };

    if (action.t === 'pass') {
      if (!st.table) return { ok: false, error: 'must-lead' };
      st.passCount++;
      st.lastEvents.push({ t: 'pass', seat: seat });
      if (st.passCount >= 2) {             // 两家不出，桌面清空，由最后出牌者领出
        st.table = null;
        st.turn = st.lastLeader;
      } else {
        st.turn = (st.turn + 1) % 3;
      }
      return { ok: true };
    }

    if (action.t !== 'play') return { ok: false, error: 'bad-action' };
    var cards = action.cards;
    if (!Array.isArray(cards) || cards.length === 0) return { ok: false, error: 'bad-action' };
    var me = st.seats[seat];
    if (!inHand(me.hand, cards)) return { ok: false, error: 'not-in-hand' };
    var combo = detect(cards);
    if (!combo) return { ok: false, error: 'bad-combo' };
    if (st.table && !beats(combo, st.table.combo)) return { ok: false, error: 'cannot-beat' };

    me.hand = me.hand.filter(function (c) { return cards.indexOf(c) < 0; });
    me.played++;
    if (combo.type === 'bomb' || combo.type === 'rocket') {
      st.bombs++;
      st.lastEvents.push({ t: combo.type, seat: seat });
    }
    st.lastLeader = seat;
    st.table = { seat: seat, combo: combo, cards: sortDesc(cards) };
    st.passCount = 0;
    st.lastEvents.push({ t: 'play', seat: seat, combo: combo.type, cards: st.table.cards });

    if (me.hand.length === 0) {
      finish(st, seat);
    } else {
      st.turn = (st.turn + 1) % 3;
    }
    return { ok: true };
  }

  function finish(st, seat) {
    st.phase = 'over';
    st.winner = seat;
    st.turn = -1;
    var landlordWon = seat === st.landlord;
    var spring = landlordWon
      ? st.seats.every(function (s) { return s.seat === st.landlord || s.played === 0; })
      : st.seats[st.landlord].played <= 1;   // 反春：地主只出过第一手
    var base = st.highestBid * Math.pow(2, Math.min(st.bombs, MAX_BOMB_POW)) * (spring ? 2 : 1);
    st.result = {
      landlordWon: landlordWon,
      spring: spring,
      base: base,
      scores: st.seats.map(function (s) {
        if (s.seat === st.landlord) return landlordWon ? 2 * base : -2 * base;
        return landlordWon ? -base : base;
      })
    };
    st.lastEvents.push({ t: spring ? 'spring' : 'win', landlordWon: landlordWon });
  }

  return {
    SUITS: SUITS,
    RANK_TEXT: RANK_TEXT,
    MAX_BOMB_POW: MAX_BOMB_POW,
    rankOf: rankOf,
    suitOf: suitOf,
    isRed: isRed,
    cardText: cardText,
    newDeck: newDeck,
    shuffle: shuffle,
    sortDesc: sortDesc,
    sortAsc: sortAsc,
    deal: deal,
    detect: detect,
    beats: beats,
    autoMove: autoMove,
    createGame: createGame,
    applyAction: applyAction,
    seatOf: seatOf
  };
});
