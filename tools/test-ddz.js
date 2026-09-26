/* ============================================================
   斗地主规则断言 + 随机整局压力测试（Node）
   用法：node tools/test-ddz.js [局数=200]
   随机局里 bot 的走牌生成与 ddz-rules 的 detect/beats 互为交叉验证：
   bot 认为合法的出牌若被 applyAction 拒绝即失败。
   ============================================================ */
'use strict';

const path = require('path');
const R = require(path.join(__dirname, '..', 'js', 'ddz-rules.js'));

let passed = 0;
function ok(cond, msg) {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exitCode = 1;
  } else {
    passed++;
  }
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---------- 牌与发牌 ---------- */

{
  const deck = R.newDeck();
  ok(deck.length === 54, '一副牌 54 张');
  ok(new Set(deck).size === 54, '无重复');
  const byRank = {};
  deck.forEach(c => { const r = R.rankOf(c); (byRank[r] = byRank[r] || []).push(c); });
  for (let r = 3; r <= 14; r++) ok(byRank[r].length === 4, 'rank ' + r + ' 有 4 张');
  ok(R.rankOf(52) === 16 && R.rankOf(53) === 17, '双王 rank 16/17');
  ok(R.cardText(52) === '小王' && R.cardText(53) === '大王', '王的名字');
  ok(R.cardText(0) === '3' && R.cardText(48) === '2' && R.cardText(44) === 'A', '牌面文本');

  const rnd = mulberry32(7);
  const d = R.deal(rnd);
  ok(d.hands.length === 3 && d.hands.every(h => h.length === 17), '三家各 17 张');
  ok(d.kitty.length === 3, '底牌 3 张');
  const all = d.hands.flat().concat(d.kitty);
  ok(new Set(all).size === 54, '一手不重不漏');
}

/* ---------- 牌型识别 ---------- */

function d(...cs) { return R.detect(cs); }

ok(d(0).type === 'single' && d(0).main === 3, '单张');
ok(d(0, 1).type === 'pair', '对子');
ok(d(52, 53).type === 'rocket', '王炸');
ok(d(52, 0) === null, '王+散牌不成对');
ok(d(0, 1, 2).type === 'trio' && d(0, 1, 2).main === 3, '三张');
ok(d(0, 1, 2, 3).type === 'bomb' && d(0, 1, 2, 3).main === 3, '炸弹');
ok(d(48, 49, 50, 51).main === 15, '2222 炸弹');
ok(d(0, 1, 2, 4).type === 'trio1' && d(0, 1, 2, 4).main === 3, '三带一');
ok(d(0, 1, 2, 8, 9).type === 'trio2', '三带二');
ok(d(0, 1, 2, 3, 4) === null, '四张带一不是型');

ok(d(0, 4, 8, 12, 16).type === 'straight' && d(0, 4, 8, 12, 16).main === 7, '顺子 34567');
ok(d(20, 24, 28, 32, 36, 40, 44).type === 'straight' && d(20, 24, 28, 32, 36, 40, 44).main === 14, '顺子 8..A');
ok(d(0, 4, 8, 12) === null, '顺子至少 5 张');
ok(d(0, 4, 8, 12, 48) === null, '2 不入顺子');
ok(d(0, 4, 8, 12, 52) === null, '王不入顺子');
ok(d(0, 4, 8, 12, 44, 48) === null, 'JQKA2 不连');

ok(d(0, 1, 4, 5, 8, 9).type === 'pairSeq', '连对 334455');
ok(d(36, 37, 40, 41, 44, 45).type === 'pairSeq', '连对 QQKKAA');
ok(d(0, 1, 4, 5) === null, '连对至少 3 对');
ok(d(44, 45, 48, 49) === null, 'AA22 不连');

ok(d(0, 1, 2, 4, 5, 6).type === 'plane' && d(0, 1, 2, 4, 5, 6).main === 4, '飞机 333444');
ok(d(48, 49, 50, 44, 45, 46) === null, '2 不能进机身');
ok(d(0, 1, 2, 4, 5, 6, 16, 20).type === 'plane1', '飞机带两单 33344477');
ok(d(0, 1, 2, 4, 5, 6, 16, 52).type === 'plane1', '飞机带单（含王）');
ok(d(0, 1, 2, 4, 5, 6, 16) === null, '7 张不成飞机');
ok(d(0, 1, 2, 4, 5, 6, 8, 9, 12, 13).type === 'plane2' && d(0, 1, 2, 4, 5, 6, 8, 9, 12, 13).main === 4, '飞机带对');
ok(d(0, 1, 2, 4, 5, 6, 8, 9).type === 'plane1', '飞机带两单（两单可为对子 5,5）');
ok(d(0, 1, 2, 4, 5, 6, 52, 53).type === 'plane1', '飞机带双王两单');
ok(d(0, 1, 2, 4, 5, 6, 8, 9, 12, 13).type === 'plane2' && d(0, 1, 2, 4, 5, 6, 8, 9, 12, 13).main === 4, '333444+55+66 = 飞机带对');
ok(d(0, 1, 2, 4, 5, 6, 8, 9, 10, 11) === null, '333444+5555 余 4 张同点不成翅');

ok(d(0, 1, 2, 3, 4, 5).type === 'four1', '四带二单');
ok(d(0, 1, 2, 3, 8, 9).type === 'four1', '四带一对当两单');
ok(d(0, 1, 2, 3, 8, 9, 12, 13).type === 'four2', '四带两对 3333+55+66');
ok(d(0, 1, 2, 3, 4, 8, 12) === null, '四带三单不是型');

// 同点数歧义恒定：优先飞机
ok(d(0, 1, 2, 3, 4, 5, 6, 7).type === 'plane1' && d(0, 1, 2, 3, 4, 5, 6, 7).main === 4, '33334444 → 飞机带单 main4');
ok(d(4, 5, 6, 7, 8, 9, 10, 11).type === 'plane1' && d(4, 5, 6, 7, 8, 9, 10, 11).main === 5, '44445555 → 飞机带单 main5');
ok(d(0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14).type === 'plane' && d(0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14).main === 6, '333444555666 → 纯飞机 main6');

/* ---------- 比较 ---------- */

ok(R.beats(d(52, 53), d(48, 49, 50, 51)), '王炸压最大炸弹');
ok(R.beats(d(48, 49, 50, 51), d(0, 1, 2, 3)), '大炸压小炸');
ok(!R.beats(d(0, 1, 2, 3), d(48, 49, 50, 51)), '小炸不压大炸');
ok(R.beats(d(0, 1, 2, 3), d(0, 4, 8)), '炸弹压普通牌型');
ok(!R.beats(d(0, 4, 8), d(0, 1, 2, 3)), '普通牌型不压炸弹');
ok(!R.beats(d(48, 49, 50, 51), d(52, 53)), '炸弹不压王炸');
ok(R.beats(d(4), d(0)), '大单压小单');
ok(!R.beats(d(0, 2), d(4, 6)), '小对不压大对');
ok(R.beats(d(0, 1), d(48, 49)) === false, '3 对不压 2 对');
ok(R.beats(d(48, 49), d(0, 1)), '2 对压 3 对');
ok(!R.beats(d(0, 1, 2, 4), d(8, 9, 10, 11)), '三带一 main 3 不压 main 5');
ok(R.beats(d(8, 9, 10, 12), d(0, 1, 2, 4)), '三带一 main 5 压 main 3');
ok(R.beats(d(0, 4, 8, 12, 16), d(1, 5, 9, 13, 17)) === false, '同长顺子比 main：相等不压');
ok(R.beats(d(4, 8, 12, 16, 20), d(0, 4, 8, 12, 16)), '顺子 main 8 压 main 7');
ok(!R.beats(d(0, 4, 8, 12, 16, 20), d(0, 4, 8, 12, 16)), '顺子长度不同不压');
ok(!R.beats(d(0, 1, 2, 4, 5, 6), d(8, 9, 10, 12, 13, 14)), '飞机 main 4 不压 main 5');
ok(R.beats(d(8, 9, 10, 12, 13, 14), d(0, 1, 2, 4, 5, 6)), '飞机 main 5 压 main 4');
ok(R.beats(d(0, 1, 2, 3), null), '自由出牌任意合法型');

/* ---------- 对局状态机：脚本流 ---------- */

{
  const rnd = mulberry32(11);
  const seats = [{ pid: 'a', name: '甲' }, { pid: 'b', name: '乙' }, { pid: 'c', name: '丙' }];
  const st = R.createGame(seats, rnd, 0);
  ok(st.phase === 'bid' && st.turn === 0, '开局叫分从 0 号位');

  ok(!R.applyAction(st, 'b', { t: 'bid', v: 1 }, rnd).ok, '轮次外的叫分被拒');
  ok(R.applyAction(st, 'a', { t: 'bid', v: 2 }, rnd).ok, '甲叫 2');
  ok(!R.applyAction(st, 'b', { t: 'bid', v: 2 }, rnd).ok, '平叫被拒');
  ok(R.applyAction(st, 'b', { t: 'bid', v: 3 }, rnd).ok, '乙叫 3');
  ok(R.applyAction(st, 'c', { t: 'bid', v: 0 }, rnd).ok, '丙不叫');
  ok(st.phase === 'play' && st.landlord === 1, '乙（3 分）当地主');
  ok(st.seats[1].hand.length === 20, '地主 20 张');
  ok(st.turn === 1, '地主先出');

  ok(!R.applyAction(st, 'b', { t: 'pass' }, rnd).ok, '领出不能不出');
  const hand = st.seats[1].hand;
  ok(!R.applyAction(st, 'b', { t: 'play', cards: [hand[0], hand[1], hand[5]] }, rnd).ok, '乱选不是牌型');
  ok(R.applyAction(st, 'b', { t: 'play', cards: [hand[19]] }, rnd).ok, '地主出最小单');
  ok(!R.applyAction(st, 'b', { t: 'play', cards: [hand[0]] }, rnd).ok, '轮次外出牌被拒');

  ok(R.applyAction(st, 'c', { t: 'pass' }, rnd).ok, '丙不出');
  ok(R.applyAction(st, 'a', { t: 'pass' }, rnd).ok, '甲不出');
  ok(st.table === null && st.turn === 1, '两家不出，地主重新领出');

  // 地主一直单出、农民一直不出 → 春天
  let guard = 0;
  while (st.phase === 'play' && guard++ < 200) {
    const pid = st.seats[st.turn].pid;
    const mv = pid === 'b' ? R.autoMove(st.seats[1].hand, st.table) : { t: 'pass' };
    const res = R.applyAction(st, pid, mv, rnd);
    ok(res.ok, '脚本局动作被拒: ' + (res.error || ''));
    if (!res.ok) break;
  }
  ok(st.phase === 'over' && st.winner === 1, '地主清空手牌获胜');
  ok(st.result.spring === true, '农民一张未出 → 春天');
  ok(st.highestBid === 3 && st.result.base === 6, '底分 = 叫分 3 × 春天 2');
  const s = st.result.scores;
  ok(s[1] === 12 && s[0] === -6 && s[2] === -6, '春天计分 12/-6/-6');
  ok(s[0] + s[1] + s[2] === 0, '零和');
}

/* ---------- 反春（rigged 牌：地主只出第一手就再也拿不到出牌权） ---------- */

{
  const rnd = mulberry32(23);
  const seats = [{ pid: 'a' }, { pid: 'b' }, { pid: 'c' }];
  const st = R.createGame(seats, rnd, 0);
  R.applyAction(st, 'a', { t: 'bid', v: 1 }, rnd);
  R.applyAction(st, 'b', { t: 'bid', v: 0 }, rnd);
  R.applyAction(st, 'c', { t: 'bid', v: 0 }, rnd);
  ok(st.landlord === 0, '甲 1 分当地主');

  // rig：地主 3 + 四个四/五/六/七；底牌 888；农民乙 9+四组10/J/Q/K；农民丙 333+8+999+AAAA+2222+双王
  st.seats[0].hand = R.sortDesc([0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  st.seats[1].hand = R.sortDesc([24, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43]);
  st.seats[2].hand = R.sortDesc([1, 2, 3, 23, 25, 26, 27, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53]);
  st.kitty = [20, 21, 22];
  st.seats[0].hand = R.sortDesc(st.seats[0].hand.concat(st.kitty));   // 地主吃底

  let guard = 0, landlordPlays = 0;
  while (st.phase === 'play' && guard++ < 300) {
    const seat = st.turn;
    const pid = st.seats[seat].pid;
    let mv;
    if (seat === 0) {
      // 地主：领出打最小单（只应发生在第一手），跟牌一律不出
      mv = !st.table && landlordPlays === 0 ? R.autoMove(st.seats[0].hand, null) : { t: 'pass' };
      if (mv.t === 'play') landlordPlays++;
    } else {
      mv = botMove(st.seats[seat].hand, st.table, rnd);
    }
    const res = R.applyAction(st, pid, mv, rnd);
    ok(res.ok, '反春局动作被拒: ' + (res.error || ''));
    if (!res.ok) break;
  }
  ok(st.phase === 'over' && st.winner !== 0, '农民赢');
  ok(landlordPlays === 1 && st.seats[0].played === 1, '地主只出过第一手');
  ok(st.result.spring === true, '反春成立');
  ok(st.result.scores[0] < 0 && st.result.scores[1] > 0 && st.result.scores[2] > 0, '反春计分方向');
  ok(st.result.scores.reduce((a, b) => a + b, 0) === 0, '零和');
}

/* ---------- 流局重发 ---------- */

{
  const rnd = mulberry32(31);
  const st = R.createGame([{ pid: 'a' }, { pid: 'b' }, { pid: 'c' }], rnd, 0);
  R.applyAction(st, 'a', { t: 'bid', v: 0 }, rnd);
  R.applyAction(st, 'b', { t: 'bid', v: 0 }, rnd);
  R.applyAction(st, 'c', { t: 'bid', v: 0 }, rnd);
  ok(st.phase === 'bid' && st.firstBidder === 1 && st.bidsDone === 0, '全不叫 → 重发，首叫位轮换');
  ok(st.seats.every(s => s.hand.length === 17 && s.bid === -1), '重发后手牌重置');
}

/* ---------- 随机整局 ---------- */

/** 测试 bot：生成它认为合法的走牌（与 detect/beats 交叉验证） */
function botMove(hand, table, rnd) {
  const byRank = {};
  hand.forEach(c => { const r = R.rankOf(c); (byRank[r] = byRank[r] || []).push(c); });
  const ranks = Object.keys(byRank).map(Number).sort((a, b) => a - b);
  const take = (arr) => arr.sort((a, b) => R.rankOf(a) - R.rankOf(b) || a - b);

  function smallest(runLen, minR) {           // 满足 runLen 张的最小点数组
    for (const r of ranks) if (r > minR && byRank[r].length >= runLen) return r;
    return -1;
  }
  function straightRun(runLen, cntNeed, minR) { // 连续 runLen 个点数各至少 cntNeed 张
    let run = 0;
    for (let r = 3; r <= 15; r++) {
      if (r <= 14 && (byRank[r] || []).length >= cntNeed && r > minR) {
        run++;
        if (run >= runLen) {
          const out = [];
          for (let rr = r - runLen + 1; rr <= r; rr++) out.push(byRank[rr][0]);
          return take(out);
        }
      } else run = 0;
    }
    return null;
  }

  if (!table) {                               // 领出：随机挑一种最小型
    const roll = rnd();
    if (roll < 0.35) return { t: 'play', cards: [take(hand.slice())[0]] };
    const pr = smallest(2, -1);
    if (roll < 0.6 && pr >= 0) return { t: 'play', cards: take(byRank[pr].slice(0, 2)) };
    const tr = smallest(3, -1);
    if (roll < 0.75 && tr >= 0) return { t: 'play', cards: take(byRank[tr].slice(0, 3)) };
    const sq = straightRun(5, 1, -1);
    if (roll < 0.9 && sq) return { t: 'play', cards: sq };
    return { t: 'play', cards: [take(hand.slice())[0]] };
  }

  const c = table.combo;
  let mv = null;
  switch (c.type) {
    case 'single': {
      const r = smallest(1, c.main);
      mv = r >= 0 ? [byRank[r][0]] : null;
      break;
    }
    case 'pair': {
      const r = smallest(2, c.main);
      mv = r >= 0 ? byRank[r].slice(0, 2) : null;
      break;
    }
    case 'trio': {
      const r = smallest(3, c.main);
      mv = r >= 0 ? byRank[r].slice(0, 3) : null;
      break;
    }
    case 'trio1': {
      const r = smallest(3, c.main);
      if (r >= 0) {
        const rest = hand.filter(x => R.rankOf(x) !== r);
        if (rest.length) mv = byRank[r].slice(0, 3).concat([take(rest.slice())[0]]);
      }
      break;
    }
    case 'trio2': {
      const r = smallest(3, c.main);
      if (r >= 0) {
        for (const rr of ranks) {
          if (rr !== r && byRank[rr].length >= 2) { mv = byRank[r].slice(0, 3).concat(byRank[rr].slice(0, 2)); break; }
        }
      }
      break;
    }
    case 'straight': mv = straightRun(c.n, 1, c.main); break;
    case 'pairSeq': mv = straightRun(c.n / 2, 2, c.main); break;
    case 'plane': case 'plane1': case 'plane2': {
      const k = c.type === 'plane' ? c.n / 3 : c.type === 'plane1' ? c.n / 4 : c.n / 5;
      // 找连续 k 个 > main 的三张
      let start = -1, run = 0;
      for (let r = 3; r <= 14; r++) {
        if ((byRank[r] || []).length >= 3 && r > c.main) {
          run++;
          if (run >= k) { start = r - k + 1; break; }
        } else run = 0;
      }
      if (start >= 0) {
        const body = [];
        for (let r = start; r < start + k; r++) body.push(byRank[r][0], byRank[r][1], byRank[r][2]);
        const used = new Set(body.map(R.rankOf));
        const rest = hand.filter(x => !used.has(R.rankOf(x)));
        if (c.type === 'plane') mv = body;
        else if (c.type === 'plane1') {
          if (rest.length >= k) mv = body.concat(take(rest.slice()).slice(0, k));
        } else {
          const pairs = [];
          const seen = {};
          for (const x of take(rest.slice())) {
            const rr = R.rankOf(x);
            seen[rr] = (seen[rr] || 0) + 1;
            if (seen[rr] <= 2 && byRank[rr].length >= 2) pairs.push(x);
            if (pairs.length === 2 * k) break;
          }
          if (pairs.length === 2 * k) mv = body.concat(pairs);
        }
      }
      break;
    }
    case 'four1': case 'four2': {
      const r = smallest(4, c.main);
      if (r >= 0) {
        const body = byRank[r].slice(0, 4);
        const rest = hand.filter(x => R.rankOf(x) !== r);
        if (c.type === 'four1' && rest.length >= 2) mv = body.concat(take(rest.slice()).slice(0, 2));
        if (c.type === 'four2') {
          const pairs = [], seen = {};
          for (const x of take(rest.slice())) {
            const rr = R.rankOf(x);
            seen[rr] = (seen[rr] || 0) + 1;
            if (seen[rr] <= 2 && byRank[rr].length >= 2) pairs.push(x);
            if (pairs.length === 4) break;
          }
          if (pairs.length === 4) mv = body.concat(pairs);
        }
      }
      break;
    }
    case 'bomb': {
      const r = smallest(4, c.main);
      mv = r >= 0 ? byRank[r].slice(0, 4) : null;
      break;
    }
    case 'rocket': mv = null; break;
  }
  if (mv) return { t: 'play', cards: take(mv) };
  // 压不过：小概率甩炸弹/王炸
  if (c.type !== 'bomb' && c.type !== 'rocket' && rnd() < 0.25) {
    const bq = smallest(4, -1);
    if (bq >= 0) return { t: 'play', cards: byRank[bq].slice(0, 4) };
  }
  if (byRank[16] && byRank[17] && rnd() < 0.5) return { t: 'play', cards: [52, 53] };
  return { t: 'pass' };
}

{
  const N = Number(process.argv[2]) || 200;
  let redealCnt = 0, bombCnt = 0, planeCnt = 0, springCnt = 0, totalPlays = 0;
  for (let g = 0; g < N; g++) {
    const rnd = mulberry32(1000 + g);
    const st = R.createGame([{ pid: 'a' }, { pid: 'b' }, { pid: 'c' }], rnd, g % 3);
    let steps = 0;
    while (st.phase !== 'over') {
      if (++steps > 10000) { ok(false, '第 ' + g + ' 局死循环'); break; }
      const seat = st.turn;
      const pid = st.seats[seat].pid;
      const mv = st.phase === 'bid'
        ? { t: 'bid', v: rnd() < 0.2 || st.highestBid >= 3 ? 0 : st.highestBid + 1 + Math.floor(rnd() * (3 - st.highestBid)) }
        : botMove(st.seats[seat].hand, st.table, rnd);
      const res = R.applyAction(st, pid, mv, rnd);
      if (!res.ok) {
        ok(false, '第 ' + g + ' 局动作被拒（' + pid + ' ' + JSON.stringify(mv).slice(0, 60) + '）: ' + res.error);
        break;
      }
      st.lastEvents.forEach(ev => {
        if (ev.t === 'redeal') redealCnt++;
        if (ev.t === 'bomb' || ev.t === 'rocket') bombCnt++;
        if (ev.t === 'play' && (ev.combo.indexOf('plane') === 0 || ev.combo === 'straight' || ev.combo === 'pairSeq')) planeCnt++;
        if (ev.t === 'spring') springCnt++;
        if (ev.t === 'play') totalPlays++;
      });
    }
    if (st.phase === 'over') {
      ok(st.result.scores.reduce((a, b) => a + b, 0) === 0, '第 ' + g + ' 局零和');
      ok(st.seats[st.winner].hand.length === 0, '第 ' + g + ' 局赢家手牌为空');
      ok(st.result.base >= 1, '第 ' + g + ' 局底分 ≥ 1');
      ok(st.result.base <= 3 * 8 * 2, '第 ' + g + ' 局底分不超上限');
    }
  }
  console.log('随机 %d 局：出牌 %d 次 · 重发 %d · 炸弹/王炸 %d · 顺/连对/飞机 %d · 春天 %d',
    N, totalPlays, redealCnt, bombCnt, planeCnt, springCnt);
  ok(totalPlays > N * 10, '整局在真实推进（出牌量合理）');
}

console.log('ddz-rules: ' + passed + ' 项断言通过' + (process.exitCode ? '（有失败）' : ''));
