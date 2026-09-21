/* ============================================================
   骰子比大小 · 比牌规则与赔率
   browser 与 Node 共用（tools/odds-versus.js 用它打印/核对概率表），两边不存在两份实现。

   比牌规则（大小循环）：
     111（三条一） > 456（顺子） > 其它按总点数比 > 111
   也就是说 456 是"最大"但输给 111，111 是"最小"但赢 456。
   高亮：222~666 这些豹子不特殊，按总点数参与普通比较。

   加注定价：
     庄家先手亮出点数后，玩家的加注必须是"按当前局面的真实胜率定价"的独立一注，
     否则玩家只在庄家点数低时才加注就能稳定套利。所以加注赔率由穷举 216×216 种
     组合算出的条件胜率反推：加注赔率 m 满足  P(赢)×(1+m) + P(平) = TARGET_RTP。
   ============================================================ */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.VersusRules = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TARGET_RTP = 0.95;   // 加注那一注的目标返还率
  var WIN_MULT = 0.9;      // 底注赢时的派彩倍数
  var MIN_RAISE_MULT = 0.3; // 加注赔率低于这个值就没意义（庄家点数太低），界面直接禁用

  /* ---------- 牌型 ---------- */

  function sorted(d) { return d.slice().sort(function (a, b) { return a - b; }); }
  function sum(d) { return d[0] + d[1] + d[2]; }

  function isThreeOne(d) { return d[0] === 1 && d[1] === 1 && d[2] === 1; }
  function isStraight(d) {
    var s = sorted(d);
    return s[0] === 4 && s[1] === 5 && s[2] === 6;
  }

  /** 0 = 普通（比点数）；1 = 顺子 456；2 = 三条一 111 */
  function cls(d) {
    if (isThreeOne(d)) return 2;
    if (isStraight(d)) return 1;
    return 0;
  }

  function compare(a, b) {
    var ca = cls(a), cb = cls(b);
    if (ca === cb) {
      if (ca !== 0) return 0;                    // 111 对 111、456 对 456 都是平
      var sa = sum(a), sb = sum(b);
      return sa > sb ? 1 : (sa < sb ? -1 : 0);
    }
    if (ca === 2) return cb === 1 ? 1 : -1;      // 111 赢 456，输给普通
    if (cb === 2) return ca === 1 ? -1 : 1;
    if (ca === 1) return 1;                      // 456 赢普通
    return -1;
  }

  function handName(d) {
    if (isThreeOne(d)) return '三条一（最大牌型，但输给普通点）';
    if (isStraight(d)) return '顺子 456（最大点，输给 111）';
    return sum(d) + ' 点';
  }

  /** 短名，用于牌桌上的徽标和战报 */
  function shortName(d) {
    if (isThreeOne(d)) return '111';
    if (isStraight(d)) return '456 顺子';
    return sum(d) + ' 点';
  }

  /** 一句话说明这一把为什么是这个结果（含 111/456 的特殊压制） */
  function describe(player, dealer, r) {
    var p = shortName(player), d = shortName(dealer);
    if (r > 0) {
      if (cls(player) === 2) return '你掷出 111，庄家是 ' + d + '，三条一压顺子';
      if (cls(player) === 1) return '你掷出 456 顺子，压制庄家的 ' + d;
      return '你 ' + p + ' 大于庄家 ' + d;
    }
    if (r < 0) {
      if (cls(player) === 2) return '你掷出 111（最小牌型），输给庄家的 ' + d;
      if (cls(dealer) === 1) return '庄家掷出 456 顺子，压制你的 ' + p;
      if (cls(dealer) === 2) return '庄家掷出 111，三条一压你的顺子';
      return '你 ' + p + ' 小于庄家 ' + d;
    }
    if (cls(player) === 2) return '双方都是 111，平局';
    if (cls(player) === 1) return '双方都是 456 顺子，平局';
    return '双方都是 ' + p + '，平局';
  }

  /* ---------- 穷举 216 种牌 ---------- */

  var HANDS = [];
  (function build() {
    for (var a = 1; a <= 6; a++) {
      for (var b = 1; b <= 6; b++) {
        for (var c = 1; c <= 6; c++) HANDS.push([a, b, c]);
      }
    }
  })();


  /** 底注返还率：赢拿回 (1+0.9) 倍，平退本，输光。直接穷举 216×216 对拼 */
  var BASE_RTP = (function () {
    var win = 0, tie = 0, n = 0;
    HANDS.forEach(function (dealer) {
      HANDS.forEach(function (player) {
        var r = compare(player, dealer);
        if (r > 0) win++;
        else if (r === 0) tie++;
        n++;
      });
    });
    return (win * (1 + WIN_MULT) + tie) / n;
  })();

  /* ---------- 庄家先手只亮一颗，加注赔率按这颗骰子定价 ----------
     庄家亮出 x 之后，他的牌面是 {x, u, v}，u、v 各 1~6 均匀（36 种）；
     玩家的牌仍是 216 种等概率。所以 P(赢|x) 只依赖 x，与是哪一颗无关。 */
  var DECLARE = {};
  (function buildDeclare() {
    for (var x = 1; x <= 6; x++) {
      var win = 0, tie = 0, total = 0;
      for (var u = 1; u <= 6; u++) {
        for (var v = 1; v <= 6; v++) {
          var hand = [x, u, v];
          for (var i = 0; i < HANDS.length; i++) {
            var r = compare(HANDS[i], hand);
            if (r > 0) win++;
            else if (r === 0) tie++;
            total++;
          }
        }
      }
      var pWin = win / total, pTie = tie / total;
      // 加注：赢拿 (1+m) 倍、平退本、输光 → P(赢)×(1+m) + P(平) = TARGET_RTP
      var m = pWin > 0 ? (TARGET_RTP - pTie) / pWin - 1 : -1;
      DECLARE[x] = {
        x: x,
        pWin: pWin,
        pTie: pTie,
        raiseMult: m,
        canRaise: m >= MIN_RAISE_MULT
      };
    }
  })();

  function lookupDeclare(x) { return DECLARE[x]; }
  function canRaise(x) { return DECLARE[x].canRaise; }

  /* 派彩公式：界面显示和实际结算共用，保证「看到多少就返多少」 */
  function baseReturn(stake) { return stake + Math.round(stake * WIN_MULT); }
  function raiseReturn(stake, mult) { return stake + Math.round(stake * mult); }

  return {
    HANDS: HANDS,
    DECLARE: DECLARE,
    TARGET_RTP: TARGET_RTP,
    WIN_MULT: WIN_MULT,
    MIN_RAISE_MULT: MIN_RAISE_MULT,
    BASE_RTP: BASE_RTP,
    compare: compare,
    cls: cls,
    sum: sum,
    shortName: shortName,
    handName: handName,
    describe: describe,
    lookupDeclare: lookupDeclare,
    canRaise: canRaise,
    baseReturn: baseReturn,
    raiseReturn: raiseReturn
  };
});
