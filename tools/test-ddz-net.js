/* ============================================================
   斗地主联机冒烟测试（Node，真实公共 broker）
   用法：node tools/test-ddz-net.js
   三个客户端连 broker.emqx.io：房主建房（公开）→ 大厅列表可见 →
   两家凭码加入 → 房主广播快照 → 成员发动作 → 退出清房。
   需要外网；超时 60s 视为失败。
   ============================================================ */
'use strict';

const path = require('path');

// ddz-net.js 是浏览器脚本（IIFE 挂 window.DdzNet），Node 里先补全局再加载
global.window = global;
global.mqtt = require(path.join(__dirname, '..', 'js', 'lib', 'mqtt.min.js'));
require(path.join(__dirname, '..', 'js', 'ddz-net.js'));
const Net = global.DdzNet;

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function waitCond(fn, ms, step) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (fn() || Date.now() - t0 > ms) { clearInterval(iv); resolve(fn()); }
    }, step || 150);
  });
}

function makeClient(pid, tag) {
  const box = { pid, tag, lobby: [], hub: [], priv: [], host: [], status: [] };
  box.net = Net.client({
    pid,
    onStatus: s => box.status.push(s),
    onLobby: list => { box.lobby = list; },
    onHub: m => box.hub.push(m),
    onPrivate: m => box.priv.push(m),
    onHost: m => box.host.push(m)
  });
  return box;
}

(async function main() {
  console.log('== 斗地主联机冒烟（真实 broker） ==');
  const host = makeClient('hostpid', 'host');
  const p2 = makeClient('p2pid', 'p2');
  const p3 = makeClient('p3pid', 'p3');

  const code = Net.makeCode();
  console.log('房号:', code);

  // 1. 房主建房（公开）+ 大厅心跳
  host.net.host(code, true);
  host.net.setLobbyMeta({ host: '房主', n: 1, phase: 'lobby' });

  // 2. p2 逛大厅，等列表出现该房
  p2.net.browse(true);
  const listed = await waitCond(() => p2.lobby.some(r => r.code === code), 20000);
  ok(listed, '公开房出现在大厅列表');

  // 3. p2 凭码加入（订阅与应答在公共 broker 上可能有竞态，快照重发到收到为止）
  p2.net.join(code);
  p2.net.toHost({ t: 'join', name: '乙' });
  const joined2 = await waitCond(() => host.host.some(m => m.t === 'join' && m.pid === 'p2pid'), 20000);
  ok(joined2, '房主收到 join');
  host.host = [];
  const gotView = await waitCond(() => {
    host.net.toPlayer('p2pid', { t: 'view', seq: 1, phase: 'lobby', seats: [{ pid: 'hostpid', name: '房主' }], mySeat: -1 });
    return p2.priv.some(m => m.t === 'view');
  }, 20000, 1000);
  ok(gotView, '成员收到私有快照');

  // 4. p3 加入后房主广播 hub
  p3.net.join(code);
  p3.net.toHost({ t: 'join', name: '丙' });
  await waitCond(() => host.host.some(m => m.t === 'join' && m.pid === 'p3pid'), 20000);
  host.host = [];
  host.net.broadcast({ t: 'hb' });
  const hubSeen = await waitCond(() => p2.hub.some(m => m.t === 'hb') && p3.hub.some(m => m.t === 'hb'), 20000);
  ok(hubSeen, '房主 hub 广播两家都收到');

  // 5. 成员→房主动作
  p2.net.toHost({ t: 'bid', v: 2 });
  const actSeen = await waitCond(() => host.host.some(m => m.t === 'bid' && m.pid === 'p2pid'), 20000);
  ok(actSeen, '房主收到成员动作');

  // 6. 退出清房：房主发 roomClosed，pub retain 清空
  host.net.broadcast({ t: 'roomClosed' });
  const closed = await waitCond(() => p2.hub.some(m => m.t === 'roomClosed') && p3.hub.some(m => m.t === 'roomClosed'), 20000);
  ok(closed, '成员收到房间解散');
  host.net.setLobbyMeta(null);

  const gone = await waitCond(() => p2.lobby.every(r => r.code !== code), 20000);
  ok(gone, '大厅列表里的房间已注销');

  [host, p2, p3].forEach(c => c.net.destroy());
  console.log('冒烟结果: %d 通过, %d 失败', passed, failed);
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
})().catch(e => {
  console.error('冒烟异常:', e && e.message || e);
  process.exit(1);
});
