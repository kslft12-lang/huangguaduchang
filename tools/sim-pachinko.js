/* ============================================================
   弹珠机分布与返还率统计（Node 端，与浏览器共用 js/pachinko-core.js）
   用法：
     node tools/sim-pachinko.js                      # 三种难度各跑一遍
     node tools/sim-pachinko.js --level=hard --n=40000
     node tools/sim-pachinko.js --level=hard --pull=0.03 --jitter=0.4   # 手动调参
   ============================================================ */
'use strict';

const path = require('path');
const Core = require(path.join(__dirname, '..', 'js', 'pachinko-core.js'));

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

const N = Number(arg('n', 40000));
const SEED = Number(arg('seed', 1));
const only = arg('level', null);
const keys = only ? [only] : Object.keys(Core.LEVELS);

/** 跑一个难度：返回概率向量、返还率、落槽轨迹 */
function run(key, n, seed) {
  const cfg = Core.config(key);
  if (arg('pull', null) !== null) cfg.CENTER_PULL = Number(arg('pull'));
  if (arg('jitter', null) !== null) cfg.JITTER = Number(arg('jitter'));
  if (arg('spread', null) !== null) cfg.DROP_SPREAD = Number(arg('spread'));
  if (arg('gapbottom', null) !== null) Core.LEVELS.hard.funnel.gapBottom = Number(arg('gapbottom'));
  if (arg('gaptop', null) !== null) Core.LEVELS.hard.funnel.gapTop = Number(arg('gaptop'));
  if (arg('rows', null) !== null) Core.LEVELS[key].rows = Number(arg('rows'));
  if (arg('dy', null) !== null) Core.LEVELS[key].dy = Number(arg('dy'));

  const L = Core.level(key);
  const pegs = Core.buildPegs(key);
  const rnd = mulberry32(seed);
  const s = cfg.STEP / (1000 / 60);

  const counts = new Array(cfg.SLOTS).fill(0);
  const trace = [];
  let stepsTotal = 0, stepsMax = 0, stuck = 0;

  for (let i = 0; i < n; i++) {
    const b = Core.ball(rnd, cfg);
    let steps = 0;
    while (!Core.landed(b, cfg)) {
      Core.step(b, pegs, cfg, rnd, s);
      if (++steps > 60000) { stuck++; break; }
    }
    stepsTotal += steps;
    if (steps > stepsMax) stepsMax = steps;
    if (steps <= 60000) counts[Core.slotOf(b.x, cfg)]++;
    if (i < 12) trace.push(Core.slotOf(b.x, cfg) + 1);
  }

  const p = counts.map(c => c / n);
  const rtp = p.reduce((a, pi, i) => a + pi * L.mults[i], 0);
  // 单注回报的方差，用来比较三种难度的波动
  const e2 = p.reduce((a, pi, i) => a + pi * L.mults[i] * L.mults[i], 0);

  return { key, L, cfg, pegs: pegs.length, p, rtp, sd: Math.sqrt(e2 - rtp * rtp), trace, avgSteps: stepsTotal / n, stepsMax, stuck };
}

for (const key of keys) {
  const r = run(key, N, SEED);
  console.log('=== %s（%s） 钉 %d 颗 · N=%d · seed=%d · CENTER_PULL=%s JITTER=%s',
    r.key, r.L.label, r.pegs, N, SEED, r.cfg.CENTER_PULL, r.cfg.JITTER);
  console.log('    平均落底 %d 步（%s 秒）· 最长 %d 步 · 未落底 %d',
    Math.round(r.avgSteps), (r.avgSteps * r.cfg.STEP / 1000).toFixed(2), r.stepsMax, r.stuck);
  console.log('    槽位  赔率    概率      贡献');
  r.p.forEach((pi, i) => {
    console.log('      %d   %s×   %s%%   %s',
      i + 1, String(r.L.mults[i]).padEnd(4), (pi * 100).toFixed(2).padStart(6), (pi * r.L.mults[i]).toFixed(4));
  });
  console.log('    返还率 RTP = %s%%   庄家优势 = %s%%   单注标准差 = %s',
    (r.rtp * 100).toFixed(2), ((1 - r.rtp) * 100).toFixed(2), r.sd.toFixed(3));
  console.log('    概率向量: [%s]', r.p.map(x => x.toFixed(4)).join(', '));
  console.log('    前 12 颗落槽（浏览器同种子对拍）: [%s]', r.trace.join(', '));
  console.log('');
}
