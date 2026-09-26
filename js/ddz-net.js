/* ============================================================
   斗地主 · 联机层（公共 MQTT 中转，无需自建服务器）
   走 wss://broker.emqx.io:8084/mqtt，连不上换 wss://broker.hivemq.com:8884/mqtt。
   房间即主题（前缀 hgdd1 防撞车）：
     hgdd1/pub/<房号>          大厅心跳（retained，公开房才有）
     hgdd1/room/<房号>/hub     房主广播 + 房主 LWT（hostGone）
     hgdd1/room/<房号>/p/<pid> 房主→该玩家的私有快照（手牌只走这里）
     hgdd1/room/<房号>/act     玩家→房主动作 + 玩家 LWT（leave）
   LWT 在连接建立时就要定死，所以建房/加入会以对应遗嘱重连一次。
   QoS：hub/p/act 用 1（可靠），pub 心跳用 0（最新即可）。QoS1 可能重复投递，
   去重由上层按消息里的 seq 做。
   公共 broker 无鉴权，别在昵称里放真实信息；这是玩具赌场。
   ============================================================ */
(function (global) {
  'use strict';

  var PREFIX = 'hgdd1';
  var BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
  var CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // 无 0/O/1/I/L
  var HB_MS = 5000;

  function makeCode() {
    var s = '';
    for (var i = 0; i < 4; i++) s += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    return s;
  }

  function topics(code) {
    return {
      pub: PREFIX + '/pub/' + code,
      hub: PREFIX + '/room/' + code + '/hub',
      act: PREFIX + '/room/' + code + '/act',
      priv: PREFIX + '/room/' + code + '/p/'
    };
  }

  /** opts: {pid, onStatus, onLobby, onHub, onPrivate, onHost} */
  function client(opts) {
    var api = {};
    var conn = null;
    var brokerIdx = 0;
    var everOnline = false;
    var role = 'lobby';          // lobby | host | member
    var code = null;
    var seq = 0;
    var hbTimer = null;
    var hbMeta = null;           // 大厅条目（公开房才有）
    var wantedSubs = [];         // 重连后要恢复的订阅
    var lobbyOn = false;
    var rooms = {};              // 大厅聚合 {code: {…, seen}}
    var lobbyFlushTimer = null;
    var connReady = false;       // CONNACK 之后才能 publish，之前先排队
    var outbox = [];

    function status(s) { if (opts.onStatus) opts.onStatus(s); }

    function will() {
      if (role === 'host') {
        var t = topics(code);
        return { topic: t.hub, payload: JSON.stringify({ t: 'hostGone' }), qos: 1, retain: false };
      }
      if (role === 'member') {
        var t2 = topics(code);
        return { topic: t2.act, payload: JSON.stringify({ t: 'leave', pid: opts.pid }), qos: 1, retain: false };
      }
      return null;
    }

    function connect() {
      if (!global.mqtt) { status('unavailable'); return; }
      status(everOnline ? 'offline' : 'connecting');
      var c = global.mqtt.connect(BROKERS[brokerIdx], {
        clientId: PREFIX + '-' + opts.pid + '-' + Math.random().toString(16).slice(2, 6),
        keepalive: 60,      // 后台标签的定时器会被浏览器节流到 1 次/分钟，短 keepalive 会被 broker 误踢
        clean: true,
        reconnectPeriod: everOnline ? 2500 : 0,   // 首连失败直接换 broker，不掉线重试
        connectTimeout: 8000,
        protocolVersion: 4,
        will: will()
      });
      conn = c;

      // 事件都带连接归属守卫：换连接后旧 client 迟到的 close 不能把新连接的
      // connReady 打回 false——否则所有 publish 会永远卡进发送队列（他人无法加入的元凶）
      c.on('connect', function () {
        if (conn !== c) return;
        everOnline = true;
        connReady = true;
        status('online');
        wantedSubs.forEach(function (t) { c.subscribe(t, { qos: 1 }); });
        if (lobbyOn) c.subscribe(PREFIX + '/pub/+', { qos: 0 });
        startHeartbeat();
        var box = outbox; outbox = [];
        box.forEach(function (m) {
          try { c.publish(m.topic, m.text, { qos: m.qos, retain: !!m.retain }); } catch (e) { /* ignore */ }
        });
      });
      c.on('close', function () {
        if (conn !== c) return;
        connReady = false;
        status('offline');
        stopHeartbeat();
      });
      c.on('error', function () {
        if (conn !== c) return;
        if (!everOnline && brokerIdx < BROKERS.length - 1) {
          brokerIdx++;
          c.end(true);
          connect();
        } else if (!everOnline) {
          status('unavailable');
        }
      });
      c.on('message', function (t, p) { if (conn === c) onMessage(t, p); });
    }

    function startHeartbeat() {
      stopHeartbeat();
      if (role !== 'host') return;
      hbTimer = setInterval(function () {
        if (!conn) return;
        var t = topics(code);
        publish(t.hub, { t: 'hb' }, 1, false);
        if (hbMeta) publish(t.pub, Object.assign({ t: 'hb' }, hbMeta), 0, true);
        if (opts.onBeat) opts.onBeat();     // 房主顺带重广播当前状态，成员丢包 5s 内自愈
      }, HB_MS);
      // 立刻发一轮，别让大厅干等 5 秒
      var t0 = topics(code);
      publish(t0.hub, { t: 'hb' }, 1, false);
      if (hbMeta) publish(t0.pub, Object.assign({ t: 'hb' }, hbMeta), 0, true);
    }

    function stopHeartbeat() {
      if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
    }

    /** obj 为 null 时发空 payload（清 retained 用） */
    function publish(topic, obj, qos, retain) {
      var text = obj === null || obj === undefined ? '' : JSON.stringify(obj);
      if (!conn || !connReady) {            // 未连上：排队等 CONNACK（上限防陈旧堆积）
        if (outbox.length < 30) outbox.push({ topic: topic, text: text, qos: qos, retain: retain });
        return;
      }
      try { conn.publish(topic, text, { qos: qos, retain: !!retain }); } catch (e) { /* 掉线中，丢弃 */ }
    }

    function onMessage(topic, payload) {
      var text = payload ? payload.toString() : '';
      if (topic.indexOf(PREFIX + '/pub/') === 0) {   // 大厅心跳：先于 JSON 解析处理空 payload
        if (!lobbyOn) return;
        var rc = topic.slice(PREFIX.length + 5);
        if (!text) {
          delete rooms[rc];                          // 空 retained = 房间注销
        } else {
          var hb = null;
          try { hb = JSON.parse(text); } catch (e) { return; }
          if (hb && hb.t === 'hb') {
            rooms[rc] = { code: rc, host: hb.host, n: hb.n, phase: hb.phase, seen: Date.now() };
          }
        }
        scheduleLobbyFlush();
        return;
      }
      var msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      if (!msg || !msg.t) return;
      var m = topic.match(/^hgdd1\/room\/([^/]+)\/(hub|act|p\/.+)$/);
      if (m) {
        var roomCode = m[1], kind = m[2];
        if (roomCode !== code) return;
        if (kind === 'hub' && opts.onHub) opts.onHub(msg, roomCode);
        else if (kind === 'act' && role === 'host' && opts.onHost) opts.onHost(msg, roomCode);
        else if (kind.indexOf('p/') === 0 && kind.slice(2) === opts.pid && opts.onPrivate) opts.onPrivate(msg, roomCode);
      }
    }

    function scheduleLobbyFlush() {
      if (lobbyFlushTimer) return;
      lobbyFlushTimer = setTimeout(function () {
        lobbyFlushTimer = null;
        if (!opts.onLobby) return;
        var now = Date.now();
        var list = [];
        for (var k in rooms) {
          if (now - rooms[k].seen > 20000) {
            delete rooms[k];
            // 房主死了没来得及注销：任何人顺手把 broker 上的 retained 清掉，
            // 不然每个新订阅者都会永远看到这个僵尸房（活房 5s 内会重发，误清能自愈）
            publish(PREFIX + '/pub/' + k, null, 0, true);
          } else {
            list.push({ code: rooms[k].code, host: rooms[k].host, n: rooms[k].n, phase: rooms[k].phase });
          }
        }
        list.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
        opts.onLobby(list);
      }, 150);
    }

    /* ---------- 对外动作 ---------- */

    // 逛大厅：订阅公开房心跳
    api.browse = function (on) {
      lobbyOn = on;
      if (!on) { rooms = {}; return; }
      if (conn && everOnline) conn.subscribe(PREFIX + '/pub/+', { qos: 0 });
      else connect();
    };

    // 以房主身份进房（换遗嘱重连）
    api.host = function (roomCode, isPublic) {
      role = 'host'; code = roomCode;
      hbMeta = null; outbox = [];
      wantedSubs = [topics(code).act];
      if (conn) conn.end(true);
      connect();
    };

    // 成员加入
    api.join = function (roomCode) {
      role = 'member'; code = roomCode;
      outbox = [];
      wantedSubs = [topics(code).hub, topics(code).priv + opts.pid];
      if (conn) conn.end(true);
      connect();
    };

    api.leave = function () {
      stopHeartbeat();
      if (role === 'host' && conn) {
        var t = topics(code);
        publish(t.hub, { t: 'roomClosed' }, 1, false);
        if (hbMeta) publish(t.pub, null, 0, true);   // 空 retained 注销
      }
      if (role === 'member' && conn) publish(topics(code).act, { t: 'leave', pid: opts.pid }, 1, false);
      role = 'lobby'; code = null; hbMeta = null; wantedSubs = []; outbox = [];
      if (conn) conn.end(true);
      conn = null;
    };

    api.toHost = function (msg) {
      if (role !== 'member') return;
      msg.pid = opts.pid;
      msg.seq = ++seq;
      publish(topics(code).act, msg, 1, false);
    };

    api.broadcast = function (msg) {
      if (role !== 'host') return;
      publish(topics(code).hub, msg, 1, false);
    };

    api.toPlayer = function (pid, msg) {
      if (role !== 'host') return;
      publish(topics(code).priv + pid, msg, 1, false);
    };

    api.setLobbyMeta = function (meta) {   // 房主：null 表示从大厅隐身
      hbMeta = meta;
      if (role === 'host' && code && !meta) {
        publish(topics(code).pub, null, 0, true);   // 空 retained 注销
      }
    };

    api.code = function () { return code; };
    api.destroy = function () { api.leave(); };

    return api;
  }

  global.DdzNet = { makeCode: makeCode, client: client, PREFIX: PREFIX, BROKERS: BROKERS };
})(window);
