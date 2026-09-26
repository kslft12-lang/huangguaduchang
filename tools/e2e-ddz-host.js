/* ============================================================
   斗地主 E2E 房主（Node，真实 broker）
   用法：node tools/e2e-ddz-host.js [--code=TEST]
   Node 扮演房主 + 一名机器人牌友，给浏览器真人玩家留第三个座位：
     - 房主自动公开建房、两人到齐后 2 秒自动开局
     - 房主和机器人按"领出最小单、跟牌不出"打（保证牌局必然推进到结束）
     - 每步广播快照，60s 无动作自动托管（R.autoMove）
   全程打完自动退出。浏览器端验证：大厅列表、凭码加入、手牌渲染、
   叫分/出牌按钮、结算面板、余额入账、零报错。
   ============================================================ */
'use strict';

const path = require('path');

global.window = global;
global.mqtt = require(path.join(__dirname, '..', 'js', 'lib', 'mqtt.min.js'));
const R = require(path.join(__dirname, '..', 'js', 'ddz-rules.js'));
require(path.join(__dirname, '..', 'js', 'ddz-net.js'));
const Net = global.DdzNet;   // ddz-net.js 是浏览器 IIFE，挂全局而非 module.exports

const arg = (name, def) => {
  const hit = process.argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.split('=')[1] : def;
};
const CODE = (arg('code', 'TEST')).toUpperCase();
const HOST_PID = 'host-bot-1';
const BOT_PID = 'bot-farmer';

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);

const room = {
  code: CODE,
  seats: [{ pid: HOST_PID, name: '房主Bot' }],
  game: null, seq: 0, round: 0, firstBidder: 0,
  lastSeq: {}, lastPing: {}, timer: null, deadline: 0
};

const host = Net.client({
  pid: HOST_PID,
  onStatus: s => console.log('[host status]', s),
  onHost: onHostMsg
});

function publish() {
  room.seq++;
  for (let i = 0; i < room.seats.length; i++) {
    host.toPlayer(room.seats[i].pid, buildView(i));
  }
}

function buildView(seatIdx) {
  const g = room.game;
  const base = {
    t: 'view', seq: room.seq, round: room.round, code: room.code,
    mySeat: seatIdx, turn: -1, landlord: -1, highestBid: 0, bombs: 0,
    deadline: room.deadline || 0, events: [],
    seats: room.seats.map(s => ({ pid: s.pid, name: s.name, bid: -1 }))
  };
  if (!g) return base;
  base.phase = g.phase;
  base.turn = g.turn;
  base.landlord = g.landlord;
  base.highestBid = g.highestBid;
  base.bombs = g.bombs;
  base.table = g.table ? { seat: g.table.seat, cards: g.table.cards } : null;
  base.kitty = g.phase === 'bid' ? null : g.kitty;
  base.winner = g.winner;
  base.result = g.result;
  base.deadline = room.deadline || 0;
  base.events = g.lastEvents || [];
  base.seats = g.seats.map(s => ({
    pid: s.pid, name: s.name, bid: s.bid, played: s.played, handCount: s.hand.length,
    role: g.landlord >= 0 ? (s.seat === g.landlord ? 'landlord' : 'farmer') : null
  }));
  base.mySeat = seatIdx;
  base.hand = g.seats[seatIdx].hand;
  return base;
}

function armTimer() {
  clearTimeout(room.timer);
  if (!room.game || room.game.phase === 'over') { room.deadline = 0; return; }
  const ms = room.game.phase === 'bid' ? 30000 : 60000;
  room.deadline = Date.now() + ms;
  room.timer = setTimeout(onDeadline, ms);
}

function onDeadline() {
  const g = room.game;
  if (!g || g.phase === 'over') return;
  const pid = g.seats[g.turn].pid;
  const mv = g.phase === 'bid' ? { t: 'bid', v: 0 } : R.autoMove(g.seats[g.turn].hand, g.table);
  apply(pid, mv, true);
}

function apply(pid, action, auto) {
  const g = room.game;
  const res = R.applyAction(g, pid, action, rnd);
  if (!res.ok) { console.log('[host] 拒绝', pid, JSON.stringify(action).slice(0, 50), res.error); return; }
  (g.lastEvents || []).forEach(ev => console.log('[host event]', JSON.stringify(ev).slice(0, 90)));
  publish();
  if (g.phase === 'over') {
    clearTimeout(room.timer);
    room.deadline = 0;
    console.log('[host] 对局结束 scores=%j spring=%s', g.result.scores, g.result.spring);
    setTimeout(() => { console.log('E2E-HOST-DONE'); host.leave(); process.exit(0); }, 4000);
  } else {
    armTimer();
  }
}

function botMoveFor(seatIdx) {
  const g = room.game;
  if (g.phase === 'bid') return { t: 'bid', v: g.highestBid === 0 ? 1 : 0 };
  return R.autoMove(g.seats[seatIdx].hand, g.table);
}

function onHostMsg(msg) {
  if (!msg || !msg.t) return;
  if (msg.t === 'join') {
    if (room.game || room.seats.length >= 3) { host.toPlayer(msg.pid, { t: 'full' }); return; }
    if (room.seats.some(s => s.pid === msg.pid)) return;   // 已在座（重复 join 忽略）
    room.seats.push({ pid: msg.pid, name: String(msg.name || '玩家').slice(0, 8), joinedAt: Date.now() });
    room.lastPing[msg.pid] = Date.now();
    host.toPlayer(msg.pid, { t: 'welcome' });
    console.log('[host] 入座', msg.pid, '当前', room.seats.length, '人');
    publish();
    host.setLobbyMeta(room.isPublic === false ? null : { host: '房主Bot', n: room.seats.length, phase: 'lobby' });
    if (room.seats.length === 3) {
      setTimeout(() => {
        if (room.game || room.seats.length !== 3) return;
        room.game = R.createGame(room.seats, rnd, room.firstBidder);
        room.lastSeq = {};
        console.log('[host] 开局 firstBidder=%d', room.firstBidder);
        publish();
        armTimer();
      }, 2000);
    }
    return;
  }
  if (msg.t === 'ping') { room.lastPing[msg.pid] = Date.now(); return; }
  if (msg.t === 'leave') {
    const i = room.seats.findIndex(s => s.pid === msg.pid);
    if (i >= 0) {
      room.seats.splice(i, 1);
      console.log('[host] 离座', msg.pid);
      publish();
    }
    return;
  }
  if (!room.game) return;
  const g = room.game;
  if (msg.pid !== g.seats[g.turn].pid) { host.toPlayer(msg.pid, { t: 'err', error: 'not-your-turn' }); return; }
  apply(msg.pid, msg, false);
}

// 房主自己的回合 + 机器人回合自动走牌
setInterval(() => {
  const g = room.game;
  if (!g || g.phase === 'over') return;
  const seat = g.turn;
  const pid = g.seats[seat].pid;
  if (pid !== HOST_PID && pid !== BOT_PID) return;   // 真人玩家自己出
  const mv = botMoveFor(seat);
  apply(pid, mv, true);
}, 1500);

host.host(CODE, true);
host.setLobbyMeta({ host: '房主Bot', n: 1, phase: 'lobby' });

// 机器人牌友入座
setTimeout(() => {
  const bot = Net.client({
    pid: BOT_PID,
    onPrivate: m => { if (m.t === 'view' && m.phase === 'over') console.log('[bot] 收到结算'); }
  });
  bot.join(CODE);
  bot.toHost({ t: 'join', name: '农民Bot' });
  global.__bot = bot;
}, 1500);

setTimeout(() => { console.log('E2E-HOST-TIMEOUT（3 分钟未打完）'); host.leave(); process.exit(1); }, 180000);
