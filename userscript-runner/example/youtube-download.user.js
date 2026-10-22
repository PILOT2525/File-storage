// ==UserScript==
// @name         YouTube InnerTube downloader
// @namespace    local.youtubedl
// @version      1.3
// @description  Download YouTube video/audio via InnerTube, straight from the page
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://music.youtube.com/*
// @run-at       document-start
// @noframes
// ==/UserScript==

/* Delivery notes
 * - Does NOT use javascript: URLs (YouTube's CSP nonce blocks bookmarklets in every browser).
 * - Uses no @grant: runs in the userscript manager's context, outside the page CSP.
 * - If the >>> button never appears, open <html data-itdl="..."> in DevTools: no attribute means
 *   the script never executed (manager setting / not saved / wrong URL), not a code error.
 */

/*
 * YouTube InnerTube downloader - core (v1.3)
 *
 * Runs as a userscript (Tampermonkey/Violentmonkey/Greasemonkey) or as an
 * unpacked extension content script. Both run outside the page's CSP, which is
 * what broke the bookmarklet: YouTube sends script-src with a nonce, so
 * javascript: URLs are refused by the browser.
 *
 * Diagnostics: this script leaves a marker at <html data-itdl="1.3"> so you can
 * tell from the page console whether it ran at all.
 */
(() => {
  'use strict';

  const VERSION = '1.3';
  const tag = '[InnerTube downloader]';

  try {
    console.info(tag, 'v' + VERSION + ' loading on', location.href);
  } catch (e) {}

  const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
  const ANDROID_UA = 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip';
  const FALLBACK_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

  const CLIENTS = {
    visionos: {
      name: 'VISIONOS', ver: '1.02', num: '101',
      extra: { deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', osName: 'visionOS', osVersion: '26.5.23O471', userAgent: SAFARI_UA }
    },
    android: {
      name: 'ANDROID', ver: '21.26.364', num: '3',
      extra: { androidSdkVersion: 30, osName: 'Android', osVersion: '11', userAgent: ANDROID_UA }
    }
  };

  const S = {
    box: 'all: initial; position: fixed; z-index: 2147483647; top: 16px; right: 16px; width: 340px; max-height: 80vh; display: flex; flex-direction: column; background: #16161a; color: #ececf1; border: 1px solid #33333c; border-radius: 14px; box-shadow: 0 18px 60px rgba(0,0,0,.6); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; overflow: hidden;',
    head: 'display: flex; align-items: center; gap: 8px; padding: 11px 12px 10px; border-bottom: 1px solid #2a2a32; flex: none;',
    body: 'padding: 10px 12px 12px; overflow: auto;',
    h: 'font-size: 10.5px; letter-spacing: .09em; text-transform: uppercase; opacity: .55; margin: 12px 0 5px; font-weight: 600;',
    btn: 'flex: 1; min-width: 0; text-align: left; padding: 7px 10px; border: 1px solid #3a3a44; background: #232329; color: #e9e9ef; border-radius: 8px; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
    icon: 'flex: none; width: 30px; padding: 0; border: 1px solid #3a3a44; background: #232329; color: #b9b9c4; border-radius: 8px; font: inherit; font-size: 13px; cursor: pointer;',
    note: 'font-size: 11px; line-height: 1.4; opacity: .55; margin-top: 10px;',
    launch: 'all: initial; position: fixed; z-index: 2147483647; right: 18px; bottom: 18px; width: 48px; height: 48px; border-radius: 50%; background: #e11d48; color: #fff; border: 1px solid #be123c; box-shadow: 0 6px 20px rgba(0,0,0,.45); font: 600 20px/48px system-ui, sans-serif; text-align: center; cursor: pointer; user-select: none;'
  };

  const el = (t, style, text) => {
    const n = document.createElement(t);
    if (style) n.style.cssText = style;
    if (text != null) n.textContent = text;
    return n;
  };

  const root = () => document.documentElement || document.body;

  function parseVideoId(input) {
    if (!input) return null;
    try {
      const u = new URL(input, location.origin);
      if (u.hostname === 'youtu.be') {
        const s = u.pathname.slice(1, 12);
        return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
      }
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|live|embed|v|e)\/([A-Za-z0-9_-]{11})/);
      return m ? m[1] : null;
    } catch (e) {
      if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
      return null;
    }
  }

  function visitorData() {
    try {
      const v = window.ytcfg && typeof window.ytcfg.get === 'function' && window.ytcfg.get('VISITOR_DATA');
      if (v) return v;
    } catch (e) {}
    try {
      const m = document.documentElement.innerHTML.match(/"visitorData":"([^"]+)"/);
      if (m) return m[1];
    } catch (e) {}
    return '';
  }

  function apiKey() {
    try {
      const k = window.ytcfg && typeof window.ytcfg.get === 'function' && window.ytcfg.get('INNERTUBE_API_KEY');
      if (k) return k;
    } catch (e) {}
    return FALLBACK_KEY;
  }

  async function player(clientKey, id) {
    const c = CLIENTS[clientKey];
    const visitor = visitorData();
    const client = Object.assign({ clientName: c.name, clientVersion: c.ver, hl: 'en', gl: 'US' }, c.extra);
    const headers = {
      'Content-Type': 'application/json',
      'X-Youtube-Client-Name': c.num,
      'X-Youtube-Client-Version': c.ver
    };
    if (visitor) headers['X-Goog-Visitor-Id'] = visitor;
    const res = await fetch('/youtubei/v1/player?key=' + encodeURIComponent(apiKey()) + '&prettyPrint=false', {
      method: 'POST',
      headers,
      body: JSON.stringify({ context: { client }, videoId: id, contentCheckOk: true, racyCheckOk: true }),
      credentials: 'omit'
    });
    if (!res.ok) throw new Error('InnerTube HTTP ' + res.status + ' (' + clientKey + ')');
    return res.json();
  }

  function money(bytes) {
    if (!bytes) return 'size n/a';
    const mb = bytes / 1048576;
    return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(mb >= 100 ? 0 : 1) + ' MB';
  }

  function collect(players) {
    const out = { muxed: [], video: [], audio: [], title: '', status: '', reason: '', seconds: 0 };
    Object.keys(players).forEach((k) => {
      const p = players[k];
      if (!p) return;
      const ps = p.playabilityStatus || {};
      const vd = p.videoDetails || {};
      if (!out.title) { out.title = vd.title || ''; out.seconds = +vd.lengthSeconds || 0; }
      if (ps.status === 'OK') { out.status = 'OK'; out.reason = ''; }
      else if (ps.status && out.status !== 'OK') { out.status = out.status || ps.status; out.reason = out.reason || ps.reason || ''; }

      const sd = p.streamingData || {};
      const seen = new Set();
      const push = (list, f, kind) => {
        if (!f || !f.url) return;
        const key = kind + ':' + f.itag;
        if (seen.has(key)) return;
        seen.add(key);
        const isAudio = /^audio\//.test(f.mimeType || '');
        const codec = ((f.mimeType || '').match(/codecs="([^"]+)"/) || [])[1] || '';
        list.push({
          itag: f.itag, url: f.url, mime: (f.mimeType || '').split(';')[0], codec,
          size: +(f.contentLength || 0),
          label: isAudio
            ? (f.bitrate ? Math.round(f.bitrate / 1000) + ' kbps' : String(f.audioQuality || '').replace(/^AUDIO_QUALITY_/, '').toLowerCase())
            : (f.qualityLabel || ''),
          height: f.height || 0, fps: f.fps || 0, bitrate: +(f.bitrate || 0),
          durationMs: +(f.approxDurationMs || 0)
        });
      };
      (sd.formats || []).forEach((f) => push(out.muxed, f, 'muxed'));
      (sd.adaptiveFormats || []).forEach((f) => {
        const isAudio = /audio\//.test(f.mimeType || '');
        push(isAudio ? out.audio : out.video, f, isAudio ? 'audio' : 'video');
      });
    });

    [out.muxed, out.video, out.audio].forEach((list) => {
      list.forEach((it) => {
        if (!it.size) {
          const secs = it.durationMs ? it.durationMs / 1000 : out.seconds;
          if (secs && it.bitrate) { it.size = Math.round((it.bitrate * secs) / 8); it.estimated = true; }
        }
      });
    });

    const rank = (c) => (/avc1/.test(c) ? 0 : /av01/.test(c) ? 1 : /vp0?9/.test(c) ? 2 : 3);
    out.muxed.sort((a, b) => (b.height - a.height) || (b.bitrate - a.bitrate));
    out.video.sort((a, b) => (b.height - a.height) || (b.fps - a.fps) || (rank(a.codec) - rank(b.codec)) || (b.bitrate - a.bitrate));
    out.audio.sort((a, b) => ((/mp4/.test(b.mime) ? 1 : 0) - (/mp4/.test(a.mime) ? 1 : 0)) || (b.bitrate - a.bitrate));

    const byHeight = new Map();
    out.video.forEach((v) => {
      const k = v.height + 'x' + v.fps;
      const cur = byHeight.get(k);
      if (!cur || rank(v.codec) < rank(cur.codec)) byHeight.set(k, v);
    });
    out.video = Array.from(byHeight.values());
    return out;
  }

  function extFor(item) {
    if (/audio\/mp4/.test(item.mime)) return 'm4a';
    if (/video\/mp4/.test(item.mime)) return 'mp4';
    return 'webm';
  }

  function fileName(item, title, id) {
    const safe = (title || id || 'video').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
    const bits = [item.label, item.codec.split('.')[0], 'itag' + item.itag].filter(Boolean).join(' ');
    return safe + ' [' + bits + '].' + extFor(item);
  }

  function label(item) {
    const kind = /audio/.test(item.mime) ? (item.mime.split('/')[1] === 'mp4' ? 'm4a' : 'opus')
      : extFor(item) + (item.codec ? ' ' + item.codec.split('.')[0] : '');
    return [item.label || String(item.itag), kind, (item.estimated ? '~' : '') + money(item.size)].join(' \u00b7 ');
  }

  // ---------- panel ----------
  let busy = false;

  function openPanel(id) {
    const old = document.getElementById('itdl-panel');
    if (old) old.remove();

    const box = el('div', S.box);
    box.id = 'itdl-panel';

    const head = el('div', S.head);
    const wrap = el('div', 'flex:1;min-width:0');
    wrap.append(
      el('div', 'font-weight:700;font-size:13.5px', 'InnerTube downloader'),
      el('div', 'font-size:11px;opacity:.55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', id)
    );
    wrap.lastChild.id = 'itdl-title';
    const close = el('button', S.icon, '\u00d7');
    close.title = 'Close (Esc)';
    close.onclick = () => box.remove();
    head.append(wrap, close);

    const body = el('div', S.body);
    const groups = el('div');
    groups.id = 'itdl-groups';
    const status = el('div', 'font-size:11.5px;opacity:.7;margin-top:10px', 'Contacting InnerTube\u2026');
    status.id = 'itdl-status';
    const track = el('div', 'height:4px;background:#2a2a32;border-radius:2px;overflow:hidden;margin-top:7px');
    const bar = el('div', 'height:100%;width:0;background:#3ea6ff;transition:width .15s');
    bar.id = 'itdl-bar';
    track.appendChild(bar);
    body.append(groups, status, track);
    box.append(head, body);
    root().appendChild(box);

    const keys = Object.keys(CLIENTS);
    Promise.allSettled(keys.map((k) => player(k, id))).then((results) => {
      const players = {};
      results.forEach((r, i) => { if (r.status === 'fulfilled') players[keys[i]] = r.value; });
      if (!Object.keys(players).length) {
        status.textContent = 'InnerTube rejected the request: ' +
          results.map((r) => (r.reason && r.reason.message) || 'unknown').join('; ');
        return;
      }
      render(box, collect(players), id);
    }).catch((e) => {
      status.textContent = 'Error: ' + ((e && e.message) || e);
    });
  }

  function addRow(box, item, title, id) {
    const row = el('div', 'display:flex;gap:6px;margin:5px 0');
    const b = el('button', S.btn, label(item));
    b.onclick = () => startDownload(box, item, title, id);
    b.onmouseenter = () => (b.style.background = '#2c2c35');
    b.onmouseleave = () => (b.style.background = '#232329');
    const c = el('button', S.icon, '\u29c9');
    c.title = 'Copy direct URL';
    c.onclick = () => {
      const done = (ok) => { c.textContent = ok ? '\u2713' : '\u00d7'; setTimeout(() => (c.textContent = '\u29c9'), 1200); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(item.url).then(() => done(true), () => done(false));
        else done(false);
      } catch (e) { done(false); }
    };
    row.append(b, c);
    return row;
  }

  function section(box, title, items, vid, id) {
    if (!items.length) return;
    const groups = box.querySelector('#itdl-groups');
    groups.appendChild(el('div', S.h, title));
    items.forEach((item) => groups.appendChild(addRow(box, item, vid, id)));
  }

  function render(box, res, id) {
    const groups = box.querySelector('#itdl-groups');
    const status = box.querySelector('#itdl-status');
    groups.textContent = '';
    box.querySelector('#itdl-title').textContent = res.title || id;

    if (!res.muxed.length && !res.video.length && !res.audio.length) {
      status.textContent = 'No downloadable formats' + (res.reason ? ': ' + res.reason : '.') +
        (res.status === 'LOGIN_REQUIRED' ? ' (this video needs a signed-in session)' : '');
      return;
    }
    status.textContent = res.status === 'OK' ? 'Ready.' : (res.reason || 'Some formats unavailable.');

    section(box, 'Video + audio \u00b7 single file', res.muxed, res.title, id);
    section(box, 'Video only \u00b7 no sound', res.video, res.title, id);
    section(box, 'Audio only', res.audio, res.title, id);
    groups.appendChild(el('div', S.note,
      'Above ~360p YouTube sends video and audio separately; join them with ' +
      'ffmpeg -i video.mp4 -i audio.m4a -c copy out.mp4'));
  }

  async function startDownload(box, item, title, id) {
    if (busy) return;
    busy = true;
    const status = box.querySelector('#itdl-status');
    const bar = box.querySelector('#itdl-bar');
    const buttons = box.querySelectorAll('#itdl-groups button');
    buttons.forEach((b) => (b.disabled = true));
    const name = fileName(item, title, id);

    try {
      status.textContent = 'Fetching\u2026';
      const res = await fetch(item.url, { credentials: 'omit', cache: 'no-store' });
      if (!res.ok) throw new Error('googlevideo HTTP ' + res.status + ' (URL may have expired - reopen the panel)');

      const total = +(res.headers.get('content-length') || item.size || 0);
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;

      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        chunks.push(step.value);
        got += step.value.length;
        const pct = total ? Math.round((got / total) * 100) : 0;
        status.textContent = money(got) + (total ? ' / ' + money(total) + ' \u00b7 ' + pct + '%' : '');
        bar.style.width = (total ? Math.min(100, (got / total) * 100) : 0) + '%';
      }

      const blob = new Blob(chunks, { type: item.mime });
      const a = el('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.style.display = 'none';
      root().appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      bar.style.width = '100%';
      status.textContent = 'Saved ' + name;
      console.info(tag, 'saved', name);
    } catch (e) {
      status.textContent = 'Failed: ' + ((e && e.message) || e);
      console.error(tag, 'download failed', e);
    } finally {
      busy = false;
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  // ---------- launcher ----------
  function ensureLauncher() {
    let b = document.getElementById('itdl-launcher');
    if (b) return b;
    b = el('div', S.launch, '\u2b07');
    b.id = 'itdl-launcher';
    b.title = 'Download with InnerTube (Alt+Shift+D)';
    b.onclick = () => {
      let id = parseVideoId(location.href);
      if (!id) {
        const pasted = prompt('YouTube video URL or ID:');
        id = parseVideoId(pasted);
      }
      if (!id) { alert('Open a YouTube video, or paste a video URL.'); return; }
      openPanel(id);
    };
    root().appendChild(b);
    return b;
  }

  function boot() {
    if (!document.documentElement) { setTimeout(boot, 50); return; }
    document.documentElement.setAttribute('data-itdl', VERSION);
    ensureLauncher();

    // Re-add the button if YouTube's SPA re-renders the document root.
    setInterval(() => { try { ensureLauncher(); } catch (e) {} }, 2500);

    // Keyboard shortcut.
    document.addEventListener('keydown', (e) => {
      // Alt+Shift+D: Alt+D alone is reserved by Chrome/Edge for the address bar and never reaches the page.
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyD' || e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        const id = parseVideoId(location.href);
        if (id) openPanel(id); else ensureLauncher().click();
      }
      if (e.key === 'Escape') {
        const p = document.getElementById('itdl-panel');
        if (p) p.remove();
      }
    }, true);

    // YouTube SPA navigation: drop a stale panel when the video changes.
    let lastId = parseVideoId(location.href);
    let autoOpened = false;
    const onNav = () => {
      const id = parseVideoId(location.href);
      if (id !== lastId) {
        lastId = id;
        const p = document.getElementById('itdl-panel');
        if (p) p.remove();
      }
      ensureLauncher();
      if (id && !autoOpened) { autoOpened = true; setTimeout(() => openPanel(id), 800); }
    };
    document.addEventListener('yt-navigate-finish', onNav);
    window.addEventListener('popstate', onNav);

    // First watch page: open once, unprompted.
    const id = parseVideoId(location.href);
    if (id) { autoOpened = true; setTimeout(() => { try { openPanel(id); } catch (e) {} }, 1200); }

    console.info(tag, 'v' + VERSION + ' ready (Alt+Shift+D opens the panel)' + (id ? ' (video ' + id + ')' : ' (no video on this page)'));
  }

  try {
    boot();
  } catch (e) {
    console.error(tag, 'failed to start:', e);
    try { document.documentElement.setAttribute('data-itdl-error', String(e && e.message)); } catch (x) {}
  }
})();