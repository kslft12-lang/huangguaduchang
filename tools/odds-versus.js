/* ============================================================
   骰子比大小赔率核对
   用法： node tools/odds-versus.js
   打印底注返还率、庄家只亮一颗时加注的定价表，并跑一遍比牌规则断言。
   ============================================================ */
'use strict';

const path = require('path');
const R = require(path.join(__dirname, '..', 'js', 'versus-rules.js'));

console.log('比牌规则：111 > 456 > 普通点数 > 111（循环）');
console.log('底注返还率（赢赔 %s 倍、平退本） = %s%%   庄家优势 %s%%',
  R.WIN_MULT, (R.BASE_RTP * 100).toFixed(2), ((1 - R.BASE_RTP) * 100).toFixed(2));

/* ---------- 庄家先手只亮一颗时的加注定价 ---------- */
console.log('');
console.log('庄家先手亮出一颗骰子后（另两颗扣着，36 种等可能），加注赔率只能按这颗骰子定：');
console.log('');
console.log('亮出的骰子   我方胜率   平局率    加注赔率   加注 50 赢返');

const rows = [1, 2, 3, 4, 5, 6].map(x => R.lookupDeclare(x));
rows.forEach(t => {
  const stake = 50;
  const ret = t.canRaise ? (stake + Math.round(stake * t.raiseMult)) : null;
  console.log('   %s 点%s %s%%   %s%%   %s   %s',
    t.x,
    '     ',
    (t.pWin * 100).toFixed(1).padStart(6),
    (t.pTie * 100).toFixed(1).padStart(5),
    t.canRaise ? (t.raiseMult.toFixed(2) + ' 倍').padStart(9) : '  不可加注',
    ret === null ? '—' : String(ret).padStart(4));
});

const raisable = rows.filter(t => t.canRaise).length;
console.log('');
console.log('可加注的亮牌情况：%d / 6 种（亮 1 点时加注无利可图，界面禁用）', raisable);

// 校验：按定价加注时，加注那一注的整体返还率
const fair = rows.reduce((a, t) => a + (t.pWin * (1 + Math.max(0, t.raiseMult)) + t.pTie), 0) / rows.length;
console.log('加注一注的整体返还率 = %s%%（目标 %s%%；禁用局面按不加注计）',
  (fair * 100).toFixed(2), (R.TARGET_RTP * 100).toFixed(0));

// 校验：如果加注固定赔 0.9 倍，玩家挑局面加注能不能套利
const exploit = rows.filter(t => t.pWin > 0.5);
console.log('');
console.log('若加注固定赔 0.9 倍，玩家只在亮 1 点（P(赢)>50%%，共 %d 种）时加注的期望：%s 倍本金（>0 即为可套利）',
  exploit.length,
  (exploit.reduce((a, t) => a + (t.pWin * 1.9 - 1), 0) / exploit.length).toFixed(3));

/* ---------- 比牌规则边界用例 ---------- */
console.log('');
console.log('比牌规则断言：');

const cases = [
  ['111 压 456（最小牌型压最大点）', [1, 1, 1], [4, 5, 6], 1],
  ['456 对 111 必输', [6, 5, 4], [1, 1, 1], -1],
  ['111 是"最小点"，输给普通点数', [1, 1, 1], [5, 5, 5], -1],
  ['111 也输给小点数 123', [1, 1, 1], [3, 2, 1], -1],
  ['456 通吃普通点数', [6, 4, 5], [6, 6, 6], 1],
  ['111 对 111 平', [1, 1, 1], [1, 1, 1], 0],
  ['456 对 456 平（任意顺序都算顺子）', [5, 6, 4], [6, 4, 5], 0],
  ['普通点数比总点数', [2, 3, 4], [6, 6, 5], -1],
  ['666 按总点数 18 参与普通比较', [6, 6, 6], [5, 6, 5], 1],
  ['112 是普通 4 点，不是三条一', [1, 1, 2], [1, 2, 1], 0]
];

let bad = 0;
cases.forEach(([name, a, b, want]) => {
  const got = R.compare(a, b);
  const ok = got === want;
  if (!ok) bad++;
  console.log('  %s %s  （%s 对 %s 期望 %s，实际 %s）',
    ok ? 'OK  ' : 'FAIL', name, a.join(''), b.join(''), want, got);
});
console.log(bad === 0 ? '全部通过' : (bad + ' 条不通过'));
