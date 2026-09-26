/* ============================================================
   斗地主 · 界面与联机会话
   房主权威：房主本地跑 js/ddz-rules.js 的状态机，把每人视角的快照
   发到各自的私有主题；成员只发动作、渲染快照。规则与协议见那两个文件。
   ============================================================ */
(function () {
  'use strict';

  Casino.mountHeader('ddz');

  var R = window.DdzRules;
  var Net = window.DdzNet;
  var ANTE = 100;                 // 基准注
  var BID_MS = 30000;             // 叫分限时
  var PLAY_MS = 60000;            // 出牌限时
  var JOIN_WAIT = 6000;           // 加入等待房主回应

  /* ---------- 身份（pid 每标签页唯一，同机多开互不干扰） ---------- */

  var pid = sessionStorage.getItem('ddz.pid');
  if (!pid) {
    pid = Math.random().toString(16).slice(2, 10);
    try { sessionStorage.setItem('ddz.pid', pid); } catch (e) { /* ignore */ }
  }
  var myName = '玩家' + pid.slice(0, 4).toUpperCase();
  try { myName = localStorage.getItem('ddz.name') || myName; } catch (e) { /* ignore */ }

  /* ---------- DOM ---------- */

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    nameInput: $('nameInput'), netDot: $('netDot'), netText: $('netText'),
    createPubBtn: $('createPubBtn'), createPrivBtn: $('createPrivBtn'),
    codeInput: $('codeInput'), joinBtn: $('joinBtn'), roomList: $('roomList'),
    lobbyPanel: $('lobbyPanel'), roomPanel: $('roomPanel'), tablePanel: $('tablePanel'),
    roomCode: $('roomCode'), roomKind: $('roomKind'), copyBtn: $('copyBtn'),
    leaveBtn: $('leaveBtn'), seatRow: $('seatRow'), roomHint: $('roomHint'), startBtn: $('startBtn'),
    oppLeft: $('oppLeft'), oppRight: $('oppRight'), kittyBox: $('kittyBox'), multBox: $('multBox'),
    tableCards: $('tableCards'), tableNote: $('tableNote'),
    meInfo: $('meInfo'), bidBar: $('bidBar'), playBar: $('playBar'),
    playBtn: $('playBtn'), passBtn: $('passBtn'), myHand: $('myHand'),
    resultBox: $('resultBox')
  };

  /* ---------- 会话状态 ---------- */

  var net = null;
  var mode = 'lobby';        // lobby | room
  var isHost = false;
  var room = null;           // 房主本地权威
  var view = null;           // 当前快照（房主本地构建 / 成员接收）
  var selected = [];
  var settledRound = -1;     // 已入账的局号
  var joinTimer = null;
  var countdownTimer = null;
  var graceTimer = null;     // hostGone 宽限：等房主重连，别急着解散
  var pingTimer = null;      // 成员向房主报活（防幽灵座位）
  var pruneTimer = null;     // 房主清理久无音讯的座位

  function toast(msg, kind, ms) { Casino.toast(msg, kind, ms); }

  /* ---------- 联机层 ---------- */

  function ensureNet() {
    if (net) return net;
    net = Net.client({
      pid: pid,
      onStatus: paintStatus,
      onLobby: renderRoomList,
      onHub: onHubMsg,
      onPrivate: onPrivateMsg,
      onHost: onHostMsg,
      onBeat: function () {
        if (isHost && room) pushState();   // 心跳时重广播，成员丢的快照 5s 内补上
      }
    });
    return net;
  }

  function paintStatus(s) {
    var map = {
      connecting: ['待连', 'is-wait'],
      online: ['已连接', 'is-ok'],
      offline: ['重连中', 'is-wait'],
      unavailable: ['联机服务不可达', 'is-bad']
    };
    var m = map[s] || ['未连接', ''];
    els.netText.textContent = m[0];
    els.netDot.className = 'dot ' + m[1];
  }

  /* ---------- 大厅 ---------- */

  function renderRoomList(list) {
    if (mode !== 'lobby') return;
    if (!list.length) {
      els.roomList.innerHTML = '<p class="room-empty">暂时没有公开房，开一间吧。</p>';
      return;
    }
    els.roomList.innerHTML = list.map(function (r) {
      var full = r.n >= 3;
      return '<div class="room-row">' +
        '<b>' + r.code + '</b>' +
        '<span>' + esc(r.host) + ' 的房 · ' + r.n + '/3 人</span>' +
        (full ? '<em>满员</em>' : '<button class="btn btn--sm" data-join="' + r.code + '" type="button">加入</button>') +
        '</div>';
    }).join('');
  }

  els.roomList.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-join]') : null;
    if (!btn) return;
    joinRoom(btn.getAttribute('data-join'));
  });

  function joinRoom(codeRaw) {
    var code = String(codeRaw || '').toUpperCase().trim();
    if (!/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(code)) {
      toast('房间码是 4 位字符', 'lose');
      return;
    }
    if (mode !== 'lobby') return;
    Casino.sfx.click();
    ensureNet();
    isHost = false;
    net.join(code);
    net.toHost({ t: 'join', name: myName });
    els.codeInput.value = code;
    joinTimer = setTimeout(function () {
      if (mode === 'lobby') toast('没有等到房间回应：房号可能不存在或已满', 'lose', 3000);
    }, JOIN_WAIT);
  }

  function createRoom(isPublic) {
    if (mode !== 'lobby') return;
    Casino.sfx.click();
    ensureNet();
    isHost = true;
    var code = Net.makeCode();
    room = {
      code: code, isPublic: isPublic,
      seats: [{ pid: pid, name: myName }],
      game: null, seq: 0, round: 0, firstBidder: 0,
      lastSeq: {}, lastPing: {}, timer: null, deadline: 0
    };
    net.host(code, isPublic);
    enterRoom();
    pushState();
    if (isPublic) updateLobbyMeta();
  }

  function enterRoom() {
    mode = 'room';
    clearTimeout(joinTimer);
    selected = [];
    els.lobbyPanel.hidden = true;
    els.roomPanel.hidden = false;
    els.tablePanel.hidden = true;
    els.resultBox.hidden = true;
    if (isHost) {
      els.roomCode.textContent = room.code;
      els.roomKind.textContent = room.isPublic ? '公开房' : '私密房';
      pruneTimer = setInterval(pruneSeats, 10000);
    } else {
      pingTimer = setInterval(function () { net.toHost({ t: 'ping' }); }, 10000);
    }
    render();
  }

  function exitToLobby() {
    clearTimeout(room && room.timer);
    clearInterval(countdownTimer);
    cancelGrace();
    clearInterval(pingTimer); pingTimer = null;
    clearInterval(pruneTimer); pruneTimer = null;
    if (net) net.leave();
    mode = 'lobby';
    isHost = false;
    room = null;
    view = null;
    selected = [];
    settledRound = -1;
    els.lobbyPanel.hidden = false;
    els.roomPanel.hidden = true;
    els.tablePanel.hidden = true;
    els.resultBox.hidden = true;
    net.browse(true);
    render();
  }

  /* ---------- 成员收消息 ---------- */

  function onPrivateMsg(msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'view') {
      if (view && msg.seq <= view.seq) return;   // QoS1 重复投递去重
      view = msg;
      if (mode === 'lobby') enterRoom();
      settleIfOver();
      render();
    } else if (msg.t === 'full') {
      toast('房间已满（3 人）', 'lose');
      exitToLobby();
    } else if (msg.t === 'busy') {
      toast('对局进行中，稍后再来', 'lose');
      exitToLobby();
    } else if (msg.t === 'err') {
      toast(errText(msg.error), 'lose');
    }
  }

  function onHubMsg(msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'hb') cancelGrace();
    if (msg.t === 'roomClosed') {
      toast(msg.reason || '房主解散了房间', 'lose', 3000);
      exitToLobby();
    } else if (msg.t === 'hostGone') {
      // 房主掉线≠房间死亡：浏览器会冻结后台标签，房主解冻后会自动重连，
      // 宽限 150s（broker 侧 ~90s 踢线 + 重连余量），心跳恢复就当无事发生
      if (graceTimer) return;
      toast('房主连接中断，等待重连…', 'push', 14000);
      graceTimer = setTimeout(function () {
        graceTimer = null;
        toast('房主没有回来，房间解散', 'lose', 3000);
        exitToLobby();
      }, 150000);
    } else if (msg.t === 'seatLost' && msg.pid === pid) {
      toast('你掉线太久，座位被移出了', 'lose', 3000);
      exitToLobby();
    } else if (msg.t === 'seatHold' && msg.pid === pid) {
      toast('连接中断，托管代打中——重连后自动恢复', 'push', 4000);
    }
  }

  function cancelGrace() {
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
  }

  function errText(code) {
    return {
      'not-your-turn': '还没轮到你',
      'bid-too-low': '叫分必须比当前高',
      'must-lead': '该你领出，不能不出',
      'bad-combo': '这不是合法牌型',
      'cannot-beat': '压不过上家的牌',
      'not-in-hand': '手里没有这些牌'
    }[code] || '动作无效';
  }

  function settleIfOver() {
    if (!view || !view.result || view.phase !== 'over') return;
    if (settledRound === view.round) return;
    settledRound = view.round;
    var netScore = view.result.scores[view.mySeat] || 0;
    Casino.addWager(ANTE);
    Casino.applyNet(netScore);
    if (netScore > 0) { toast('+' + netScore + ' 小黄瓜', 'win'); Casino.sfx.win(); }
    else if (netScore < 0) { toast(netScore + ' 小黄瓜', 'lose'); Casino.sfx.lose(); }
    else { toast('平局', 'push'); Casino.sfx.click(); }
  }

  /* ---------- 房主收消息 ---------- */

  function onHostMsg(msg) {
    if (!isHost || !room || !msg || !msg.t) return;
    if (msg.t === 'join') return hostAddSeat(msg);
    if (msg.t === 'leave') return hostDropSeat(msg.pid, msg.name);
    if (msg.t === 'ping') {
      room.lastPing[msg.pid] = Date.now();
      // 掉线的座位报活了：恢复在线并广播
      for (var p = 0; p < room.seats.length; p++) {
        if (room.seats[p].pid === msg.pid && room.seats[p].offline) {
          room.seats[p].offline = false;
          pushState();
        }
      }
      return;
    }
    if (msg.pid && msg.seq !== undefined) {
      if (room.lastSeq[msg.pid] >= msg.seq) return;   // QoS1 重复去重
      room.lastSeq[msg.pid] = msg.seq;
    }
    if (!room.game) return;
    var g = room.game;
    if (msg.pid !== g.seats[g.turn].pid) {
      net.toPlayer(msg.pid, { t: 'err', error: 'not-your-turn' });
      return;
    }
    applyAndPush(msg.pid, msg, false);
  }

  /** 房主清幽灵：大厅阶段 75 秒没报活的座位移出（后台冻结的标签解冻后
      会重连并继续报活；开局后的离开直接解散对局） */
  function pruneSeats() {
    if (!isHost || !room || room.game) return;
    var now = Date.now();
    for (var i = room.seats.length - 1; i >= 0; i--) {
      var s = room.seats[i];
      if (s.pid === pid) continue;
      if (now - (room.lastPing[s.pid] || s.joinedAt || now) > 75000) {
        hostDropSeat(s.pid, s.name);
      }
    }
  }

  function hostAddSeat(msg) {
    for (var i = 0; i < room.seats.length; i++) {
      if (room.seats[i].pid === msg.pid) {
        // 已在座（重连/重进/快照丢失）：幂等重发，别让人卡在旧界面
        room.seats[i].offline = false;
        room.seq++;
        net.toPlayer(msg.pid, { t: 'welcome' });
        net.toPlayer(msg.pid, buildView(i));
        return;
      }
    }
    if (room.seats.length >= 3) { net.toPlayer(msg.pid, { t: 'full' }); return; }
    if (room.game) { net.toPlayer(msg.pid, { t: 'busy' }); return; }
    room.seats.push({ pid: msg.pid, name: String(msg.name || '玩家').slice(0, 8), joinedAt: Date.now() });
    room.lastPing[msg.pid] = Date.now();
    net.toPlayer(msg.pid, { t: 'welcome' });
    Casino.sfx.click();
    pushState();
    updateLobbyMeta();
  }

  /** 离开/掉线：大厅阶段释放座位；对局中座位保留、自动托管代打，
      玩家重连（同 pid 的 ping/join）后自动恢复——一人掉线不再毁掉整局 */
  function hostDropSeat(deadPid, name) {
    for (var i = 0; i < room.seats.length; i++) {
      if (room.seats[i].pid === deadPid) {
        var who = room.seats[i].name || name || '玩家';
        if (room.game) {
          if (room.seats[i].offline) return;
          room.seats[i].offline = true;
          net.broadcast({ t: 'seatHold', pid: deadPid });
          toast(who + ' 掉线，由托管代打', 'push');
          pushState();
          return;
        }
        room.seats.splice(i, 1);
        delete room.lastPing[deadPid];
        net.broadcast({ t: 'seatLost', pid: deadPid });   // 让掉线的幽灵端自己回大厅
        toast(who + ' 离开了房间', 'push');
        pushState();
        updateLobbyMeta();
        return;
      }
    }
  }

  /** 房主：应用动作 → 广播每人视角 */
  function applyAndPush(actorPid, action, auto) {
    var g = room.game;
    var res = R.applyAction(g, actorPid, action, Math.random);
    if (!res.ok) {
      if (!auto) {
        // 拒绝多半因为客户端视图过期：连错误带最新视角一起纠正
        room.seq++;
        var fixed = buildView(R.seatOf(g, actorPid));
        if (actorPid === pid) {
          toast(errText(res.error), 'lose');
          view = fixed;
          render();
        } else {
          net.toPlayer(actorPid, { t: 'err', error: res.error });
          net.toPlayer(actorPid, fixed);
        }
      }
      return;
    }
    pushState();
    if (g.phase === 'over') {
      clearTimeout(room.timer);
      room.deadline = 0;
    } else {
      armTimer();
    }
    updateLobbyMeta();
  }

  function pushState() {
    room.seq++;
    for (var i = 0; i < room.seats.length; i++) {
      var snap = buildView(i);
      if (room.seats[i].pid === pid) {
        if (!view || snap.seq >= view.seq) { view = snap; settleIfOver(); }
      } else {
        net.toPlayer(room.seats[i].pid, snap);
      }
    }
    render();
  }

  function buildView(seatIdx) {
    var g = room.game;
    var base = {
      t: 'view', seq: room.seq, round: room.round, code: room.code,
      mySeat: seatIdx, turn: -1, landlord: -1, highestBid: 0,
      bombs: 0, deadline: room.deadline || 0,
      seats: room.seats.map(function (s) { return { pid: s.pid, name: s.name, bid: -1 }; }),
      events: []
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
    base.firstBidder = g.firstBidder;
    base.deadline = room.deadline || 0;
    base.events = g.lastEvents || [];
    base.seats = g.seats.map(function (s, si) {
      return {
        pid: s.pid, name: s.name, bid: s.bid, played: s.played,
        handCount: s.hand.length,
        offline: !!(room.seats[si] && room.seats[si].offline),
        role: g.landlord >= 0 ? (s.seat === g.landlord ? 'landlord' : 'farmer') : null
      };
    });
    base.mySeat = seatIdx;
    base.hand = g.seats[seatIdx].hand;
    return base;
  }

  /* ---------- 房主计时器（掉线/挂机的玩家自动托管） ---------- */

  function armTimer() {
    clearTimeout(room.timer);
    if (!room.game || room.game.phase === 'over') { room.deadline = 0; return; }
    var ms = room.game.phase === 'bid' ? BID_MS : PLAY_MS;
    room.deadline = Date.now() + ms;
    room.timer = setTimeout(onDeadline, ms);
  }

  function onDeadline() {
    var g = room && room.game;
    if (!g || g.phase === 'over') return;
    var seatPid = g.seats[g.turn].pid;
    var mv = g.phase === 'bid' ? { t: 'bid', v: 0 } : R.autoMove(g.seats[g.turn].hand, g.table);
    applyAndPush(seatPid, mv, true);
  }

  /* ---------- 房主开新局 / 再来一局 ---------- */

  function startGame() {
    if (!isHost || room.game || room.seats.length !== 3) return;
    Casino.sfx.click();
    room.game = R.createGame(room.seats, Math.random, room.firstBidder);
    room.lastSeq = {};
    settledRound = -1;
    net.setLobbyMeta(null);      // 开局后从大厅隐身
    els.resultBox.hidden = true;
    pushState();
    armTimer();
  }

  function nextRound() {
    if (!isHost) return;
    Casino.sfx.click();
    room.round++;
    room.firstBidder = (room.firstBidder + 1) % 3;
    room.game = null;
    settledRound = -1;
    // 一局打完，把掉线没回来的座位请出去（他们的端早就不在广播里了）
    for (var i = room.seats.length - 1; i >= 0; i--) {
      if (room.seats[i].offline && room.seats[i].pid !== pid) {
        net.broadcast({ t: 'seatLost', pid: room.seats[i].pid });
        room.seats.splice(i, 1);
      }
    }
    els.resultBox.hidden = true;
    pushState();
    updateLobbyMeta();
  }

  function updateLobbyMeta() {
    if (!isHost || !room) return;
    if (room.isPublic && !room.game) {
      net.setLobbyMeta({ host: myName, n: room.seats.length, phase: 'lobby' });
    } else {
      net.setLobbyMeta(null);
    }
  }

  /* ---------- 渲染 ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  function render() {
    if (mode === 'lobby') return;
    renderRoom();
    if (view && view.phase && view.phase !== 'lobby') {
      renderTable();
      renderResult();
    } else {
      els.tablePanel.hidden = true;
      els.resultBox.hidden = true;
    }
  }

  function renderResult() {
    if (view.phase !== 'over' || !view.result) {
      els.resultBox.hidden = true;
      return;
    }
    var r = view.result;
    var meNet = r.scores[view.mySeat] || 0;
    var lines = view.seats.map(function (s, i) {
      var sc = r.scores[i] || 0;
      return '<div class="ddz-scoreline' + (s.pid === pid ? ' is-me' : '') + '">' +
        '<span>' + esc(s.name) + (s.pid === pid ? '（我）' : '') +
        (i === view.landlord ? '<i class="tag tag--landlord">地主</i>' : '') + '</span>' +
        '<b>' + (sc > 0 ? '+' : '') + sc + '</b></div>';
    }).join('');
    els.resultBox.innerHTML =
      '<div class="ddz-result__head" data-kind="' + (meNet > 0 ? 'win' : meNet < 0 ? 'lose' : 'push') + '">' +
      (meNet > 0 ? '🎉 你赢了' : meNet < 0 ? '你输了' : '平局') +
      (r.spring ? ' · ' + (r.landlordWon ? '春天' : '反春') + ' ×2' : '') + '</div>' +
      lines +
      '<p class="ddz-result__note">底分 ' + r.base + (view.bombs ? ' · 炸弹 ×' + Math.pow(2, Math.min(view.bombs, R.MAX_BOMB_POW)) : '') +
      ' · 每局基准注 ' + ANTE + '，结果已计入你的小黄瓜。</p>' +
      (isHost ? '<button class="btn btn--lg" data-action="next" type="button">再来一局</button>'
              : '<p class="ddz-result__wait">等待房主开下一局…</p>');
    els.resultBox.hidden = false;
  }

  els.resultBox.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-action="next"]') : null;
    if (btn) nextRound();
  });

  function renderRoom() {
    if (!isHost) {
      els.roomCode.textContent = view ? view.code : els.roomCode.textContent;
      els.roomKind.textContent = '已加入';
    }
    var seats = view ? view.seats : (room ? room.seats.map(function (s) { return { pid: s.pid, name: s.name }; }) : []);
    els.seatRow.innerHTML = [0, 1, 2].map(function (i) {
      var s = seats[i];
      return '<div class="seat' + (s ? '' : ' seat--empty') + '">' +
        '<b>' + (s ? esc(s.name) : '空位') + '</b>' +
        '<span>' + (s ? (s.pid === pid ? '（我）' : '已就座') : '等待玩家…') + '</span>' +
        '</div>';
    }).join('');
    var need = 3 - seats.length;
    if (isHost) {
      els.startBtn.hidden = need > 0;
      els.roomHint.textContent = need > 0 ? '还差 ' + need + ' 人，把房号发给朋友（公开房会出现在大厅列表）。' : '人齐了，开局！';
    } else {
      els.startBtn.hidden = true;
      els.roomHint.textContent = need > 0 ? '等待房主凑齐 ' + 3 + ' 人开局…' : '等待房主开局…';
    }
  }

  function renderTable() {
    els.roomPanel.hidden = true;
    els.tablePanel.hidden = false;
    var my = view.mySeat;
    var right = (my + 1) % 3;
    var left = (my + 2) % 3;
    renderOpp(els.oppLeft, left, '上家');
    renderOpp(els.oppRight, right, '下家');
    renderKitty();
    renderMult();
    renderFelt();
    renderMe();
    renderHand();
    playEventSfx();
    armCountdown();
  }

  function seatAt(i) { return view.seats[i] || { name: '?', bid: -1, handCount: 0, role: null }; }

  function renderOpp(el, seatIdx, tag) {
    var s = seatAt(seatIdx);
    var isTurn = view.turn === seatIdx && (view.phase === 'bid' || view.phase === 'play');
    var bidText = s.bid > 0 ? '叫 ' + s.bid + ' 分' : (s.bid === 0 ? '不叫' : '');
    var cards = view.table && view.table.seat === seatIdx ? view.table.cards : null;
    el.className = 'opp' + (isTurn ? ' opp--turn' : '');
    el.innerHTML =
      '<div class="opp__name">' + esc(s.name) +
      (s.role === 'landlord' ? '<i class="tag tag--landlord">地主</i>' : (view.landlord >= 0 ? '<i class="tag">农民</i>' : '')) +
      (s.offline ? '<i class="tag tag--off">离线·托管</i>' : '') +
      '</div>' +
      '<div class="opp__meta">' + tag + ' · ' + (view.phase === 'bid' ? (bidText || '思考中') : s.handCount + ' 张') +
      (isTurn ? ' <i class="dot dot--live"></i>' : '') + '</div>' +
      '<div class="opp__cards">' + (cards ? cards.map(function (c) { return cardHtml(c, true); }).join('') : '') + '</div>';
  }

  function renderKitty() {
    if (view.kitty) {
      els.kittyBox.innerHTML = '<span class="ddz-kittylabel">底牌</span>' +
        view.kitty.map(function (c) { return cardHtml(c, true); }).join('');
    } else {
      els.kittyBox.innerHTML = '<span class="ddz-kittylabel">底牌</span>' +
        '<span class="dcard dcard--sm dcard--back">?</span>'.repeat(3);
    }
  }

  function renderMult() {
    var bits = ['基准注 ' + ANTE];
    if (view.highestBid > 0) bits.push('叫分 ' + view.highestBid);
    if (view.bombs > 0) bits.push('炸弹 ×' + Math.pow(2, Math.min(view.bombs, R.MAX_BOMB_POW)));
    els.multBox.textContent = bits.join(' · ');
  }

  function renderFelt() {
    var t = view.table;
    els.tableCards.innerHTML = t ? t.cards.map(function (c) { return cardHtml(c, false); }).join('') : '';
    var note = '';
    if (view.phase === 'bid') {
      note = '叫分中（' + countBids() + '/3）';
      if (view.highestBid > 0) note += ' · 当前 ' + view.highestBid + ' 分';
    } else if (view.phase === 'play' && !t) {
      note = seatAt(view.turn).name + ' 领出';
    }
    els.tableNote.textContent = note;
  }

  function countBids() {
    return view.seats.filter(function (s) { return s.bid >= 0; }).length;
  }

  function renderMe() {
    var my = view.mySeat;
    var s = seatAt(my);
    var isTurn = view.turn === my && (view.phase === 'bid' || view.phase === 'play');
    els.meInfo.innerHTML = '<b>' + esc(s.name) + '</b>（我）' +
      (s.role === 'landlord' ? '<i class="tag tag--landlord">地主</i>' : (view.landlord >= 0 ? '<i class="tag">农民</i>' : '')) +
      (view.phase === 'play' ? ' · 手牌 ' + (view.hand ? view.hand.length : 0) + ' 张' : '');
    els.meInfo.className = 'ddz-meinfo' + (isTurn ? ' ddz-meinfo--turn' : '');

    var bidding = view.phase === 'bid' && isTurn;
    els.bidBar.hidden = !bidding;
    if (bidding) {
      Array.prototype.forEach.call(els.bidBar.children, function (btn) {
        var v = Number(btn.dataset.bid);
        btn.disabled = v > 0 && v <= view.highestBid;
      });
    }
    var playing = view.phase === 'play' && isTurn;
    els.playBar.hidden = !playing;
    els.passBtn.disabled = playing && !view.table;   // 领出不能不出
    if (!playing && !bidding) selected = [];
  }

  var lastEventSig = '';
  function playEventSfx() {
    var evs = view.events || [];
    var sig = view.seq + ':' + JSON.stringify(evs);
    if (sig === lastEventSig) return;   // 心跳重广播带同样的事件，别重复响
    lastEventSig = sig;
    evs.forEach(function (ev) {
      if (ev.t === 'play') Casino.sfx.tick();
      else if (ev.t === 'bomb') Casino.sfx.diceHit(8);
      else if (ev.t === 'rocket') Casino.sfx.diceHit(10);
      else if (ev.t === 'landlord') Casino.sfx.roll();
      else if (ev.t === 'bid' || ev.t === 'pass') Casino.sfx.click();
    });
  }

  function armCountdown() {
    clearInterval(countdownTimer);
    if (!view.deadline || view.phase === 'over' || view.phase === 'lobby') return;
    var base = els.tableNote.textContent;
    countdownTimer = setInterval(function () {
      var left = Math.max(0, Math.ceil((view.deadline - Date.now()) / 1000));
      els.tableNote.textContent = base + ' · ' + left + 's';
    }, 500);
    els.tableNote.textContent = base;
  }

  /* ---------- 手牌 ---------- */

  function cardHtml(c, small) {
    var cls = 'dcard' + (R.isRed(c) ? ' dcard--red' : '') + (small ? ' dcard--sm' : '');
    var r = R.cardText(c);
    var suit = R.suitOf(c);
    if (c >= 52) {
      return '<span class="' + cls + ' dcard--joker"><b>' + r + '</b><i>' + (c === 53 ? '☀' : '☾') + '</i></span>';
    }
    return '<span class="' + cls + '"><b>' + r + '</b><i>' + suit + '</i></span>';
  }

  function renderHand() {
    var hand = view.hand || [];
    els.myHand.innerHTML = hand.map(function (c) {
      var sel = selected.indexOf(c) >= 0 ? ' dcard--sel' : '';
      return cardHtml(c, false).replace('class="dcard', 'data-card="' + c + '" class="dcard' + sel);
    }).join('');
  }

  els.myHand.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-card]') : null;
    if (!el) return;
    var c = Number(el.getAttribute('data-card'));
    var at = selected.indexOf(c);
    if (at >= 0) selected.splice(at, 1);
    else {
      if (selected.length >= 20) return;
      selected.push(c);
    }
    Casino.sfx.click();
    renderHand();
  });

  /* ---------- 动作按钮 ---------- */

  /** 成员把动作发给房主；房主本地直接推进状态机（toHost 只认 member 角色，
      房主的动作走网络回环会被静默丢弃——只能干等托管超时的元凶） */
  function submitAction(action) {
    if (isHost && room && room.game) applyAndPush(pid, action, false);
    else net.toHost(action);
  }

  els.bidBar.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-bid]') : null;
    if (!btn || btn.disabled) return;
    submitAction({ t: 'bid', v: Number(btn.dataset.bid) });
    Casino.sfx.click();
  });

  els.playBtn.addEventListener('click', function () {
    if (!selected.length) { toast('先选要出的牌', 'lose'); return; }
    var combo = R.detect(selected);
    if (!combo) { toast('这不是合法牌型', 'lose'); return; }
    submitAction({ t: 'play', cards: selected.slice().sort(function (a, b) { return a - b; }) });
    selected = [];
    Casino.sfx.roll();
  });

  els.passBtn.addEventListener('click', function () {
    submitAction({ t: 'pass' });
    selected = [];
    Casino.sfx.click();
  });

  /* ---------- 界面事件 ---------- */

  els.nameInput.value = myName;
  els.nameInput.addEventListener('change', function () {
    myName = els.nameInput.value.trim().slice(0, 8) || myName;
    try { localStorage.setItem('ddz.name', myName); } catch (e) { /* ignore */ }
  });

  els.createPubBtn.addEventListener('click', function () { createRoom(true); });
  els.createPrivBtn.addEventListener('click', function () { createRoom(false); });
  els.joinBtn.addEventListener('click', function () { joinRoom(els.codeInput.value); });
  els.codeInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') joinRoom(els.codeInput.value);
  });
  els.startBtn.addEventListener('click', startGame);
  els.leaveBtn.addEventListener('click', function () {
    Casino.sfx.click();
    exitToLobby();
  });
  els.copyBtn.addEventListener('click', function () {
    var code = room ? room.code : '';
    var done = function () { toast('房号 ' + code + ' 已复制', 'win'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, function () { toast('房号 ' + code, 'push'); });
    } else {
      toast('房号 ' + code, 'push');
    }
  });

  window.addEventListener('beforeunload', function () {
    if (net) net.leave();
  });

  paintStatus('connecting');
  ensureNet();
  net.browse(true);

  // 调试钩子：控制台里看会话内部状态（不影响正常逻辑）
  window.__ddzDebug = function () {
    return {
      mode: mode, isHost: isHost,
      room: room ? { code: room.code, seats: room.seats, phase: room.game ? room.game.phase : 'lobby', seq: room.seq, round: room.round, hasGame: !!room.game } : null,
      view: view
    };
  };
})();
