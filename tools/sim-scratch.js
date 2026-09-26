/* ============================================================
   刮刮乐奖级与返还率核算（Node 端，奖级表与 js/scratch.js 保持一致）
   用法：
     node tools/sim-scratch.js                # 闭式解 + 蒙特卡洛对拍
     node tools/sim-scratch.js --n=200000
   ============================================================ */
'use strict';

const SYMS = [
  { ch: '🪳', name: '有一天', w: 0.30, mult: 0.5 },  // 安慰奖：拿回一半
  { ch: '🍊', name: '橘子',   w: 0.22, mult: 1 },    // 保本
  { ch: '🍎', name: '苹果',   w: 0.15, mult: 2 },
  { ch: '🥕', name: '胡萝卜', w: 0.12, mult: 3 },
  { ch: '🍄', name: '蘑菇',   w: 0.10, mult: 4 },
  { ch: '🥟', name: '包子',   w: 0.07, mult: 6 },
  { ch: '🥒', name: '黄瓜',   w: 0.04, mult: 20 },   // 大奖
];
const TRIPLE_X = 2;   // 三个相同，奖金翻倍

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function arg(name, def) {
  const hit = process.argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.split('=')[1] : def;
}

/* ---------- 闭式解 ----------
   某图案出现 ≥2 次的概率 = 3w² − 2w³（含三同，按一次计）；
   三同把该图案奖金再乘 TRIPLE_X，额外贡献 w³ · mult · (TRIPLE_X − 1)。
   三格独立抽取，不同图案不可能同时成对（鸽笼），判定无歧义。 */
let hit = 0, rtp = 0, tripleRate = 0;
console.log('图案    权重    P(≥2同)   P(三同)   倍率   赔付贡献');
for (const s of SYMS) {
  const p2 = 3 * s.w * s.w - 2 * s.w ** 3;
  const p3 = s.w ** 3;
  hit += p2;
  tripleRate += p3;
  const c = p2 * s.mult + p3 * s.mult * (TRIPLE_X - 1);
  rtp += c;
  console.log('  %s  %s%%   %s%%   %s%%   ×%s  %s',
    s.ch, (s.w * 100).toFixed(0), (p2 * 100).toFixed(2), (p3 * 100).toFixed(2),
    s.mult, c.toFixed(4));
}
console.log('  中奖面（≥2 同，含有一天半退） = %s%%', (hit * 100).toFixed(2));
console.log('  三同率（奖金翻倍）       = %s%%', (tripleRate * 100).toFixed(2));
console.log('  返还率 RTP（闭式解）     = %s%%   庄家优势 = %s%%',
  (rtp * 100).toFixed(2), ((1 - rtp) * 100).toFixed(2));

/* ---------- 蒙特卡洛对拍（与 js/scratch.js 同一条抽取/结算逻辑） ---------- */

const N = Number(arg('n', 200000));
const SEED = Number(arg('seed', 7));
const STAKE = 1000;   // 整数注，×0.5 不产生舍入

function weightedPick(rnd) {
  let r = rnd();
  for (const s of SYMS) { r -= s.w; if (r < 0) return s; }
  return SYMS[SYMS.length - 1];
}

/** 与浏览器结算同一套：任一图案出现 ≥2 次即中该倍率，三同翻倍 */
function settle(cells, stake) {
  const counts = new Map();
  for (const s of cells) counts.set(s, (counts.get(s) || 0) + 1);
  let ret = 0;
  for (const [s, n] of counts) {
    if (n >= 2) { ret = Math.round(stake * s.mult * (n === 3 ? TRIPLE_X : 1)); break; }
  }
  return ret;
}

const rnd = mulberry32(SEED);
let wins = 0, pushes = 0, totalRet = 0;
for (let i = 0; i < N; i++) {
  const cells = [weightedPick(rnd), weightedPick(rnd), weightedPick(rnd)];
  const ret = settle(cells, STAKE);
  totalRet += ret;
  if (ret > STAKE) wins++;
  else if (ret === STAKE) pushes++;
}
console.log('');
console.log('  蒙特卡洛 N=%d · seed=%d · 注 %d', N, SEED, STAKE);
console.log('  净赢率 %s%% · 保本率 %s%% · 中奖面 %s%%',
  (wins / N * 100).toFixed(2), (pushes / N * 100).toFixed(2), ((wins + pushes) / N * 100).toFixed(2));
console.log('  返还率 RTP（模拟） = %s%%', (totalRet / N / STAKE * 100).toFixed(2));
