;(() => {
  if (!document.body.classList.contains('page-watch')) return;
const params = new URLSearchParams(location.search);
const videoId = params.get('v');
const listParam = params.get('list');
const indexParam = parseInt(params.get('index') || '-1', 10);

document.addEventListener('DOMContentLoaded', () => {
  initHeaderSearch();
  if (!videoId) {
    showWatchError('動画IDが指定されていません。', true);
  } else {
    initWatch(videoId);
  }
});

function getSavedPosition(videoId) {
  try {
    const raw = localStorage.getItem('chocotube_positions');
    if (!raw) return 0;
    const positions = JSON.parse(raw);
    const entry = positions[videoId];
    if (!entry) return 0;
    if (Date.now() - entry.ts > 30 * 24 * 60 * 60 * 1000) return 0;
    return entry.t || 0;
  } catch { return 0; }
}
function savePosition(videoId, time) {
  try {
    const raw = localStorage.getItem('chocotube_positions');
    const positions = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    Object.keys(positions).forEach(k => {
      if (now - (positions[k].ts || 0) > 30 * 24 * 60 * 60 * 1000) delete positions[k];
    });
    if (time > 5) {
      positions[videoId] = { t: Math.floor(time), ts: now };
    } else {
      delete positions[videoId];
    }
    localStorage.setItem('chocotube_positions', JSON.stringify(positions));
  } catch {}
}
function clearSavedPosition(videoId) {
  try {
    const raw = localStorage.getItem('chocotube_positions');
    if (!raw) return;
    const positions = JSON.parse(raw);
    delete positions[videoId];
    localStorage.setItem('chocotube_positions', JSON.stringify(positions));
  } catch {}
}

function showWatchError(msg, isHome) {
  const main = document.getElementById('watchMain');
  main.innerHTML = `
    <div class="watch-error">
      <div class="watch-error-icon">⚠️</div>
      <h2>${escapeHtml(msg)}</h2>
      ${isHome ? '<p><a href="/">トップページへ戻る</a></p>' : ''}
    </div>
  `;
}

function createRelatedSkeleton() {
  const div = document.createElement('div');
  div.className = 'related-skeleton';
  div.innerHTML = `
    <div class="related-sk-thumb"></div>
    <div class="related-sk-info">
      <div class="related-sk-line rsk-t1"></div>
      <div class="related-sk-line rsk-t2"></div>
      <div class="related-sk-line rsk-ch"></div>
      <div class="related-sk-line rsk-vw"></div>
    </div>
  `;
  return div;
}

function createRelatedCard(video) {
  const a = document.createElement('a');
  a.className = 'related-card';
  a.href = `/watch?v=${video.videoId}`;
  const thumb = getThumbnailUrl(video.videoId);
  const dur = formatDuration(video.lengthSeconds);
  const views = formatViews(video.viewCount);
  const channelHref = video.authorId ? `/channel?id=${encodeURIComponent(video.authorId)}` : null;

  a.innerHTML = `
    <div class="related-thumb-wrap">
      <img class="related-thumb" src="${thumb}" alt="${escapeHtml(video.title)}" loading="lazy" onload="this.classList.add('loaded')" />
      ${dur ? `<span class="related-duration">${dur}</span>` : ''}
    </div>
    <div class="related-info">
      <div class="related-title-text">${escapeHtml(video.title)}</div>
      <div class="related-channel-row">
        ${channelHref
          ? `<a class="related-ch-channel-link" href="${channelHref}">
               <div class="related-ch-icon-wrap"><div class="related-ch-placeholder"></div></div>
               <span class="related-channel">${escapeHtml(video.author || '')}</span>
             </a>`
          : `<div class="related-ch-icon-wrap"><div class="related-ch-placeholder"></div></div>
             <span class="related-channel">${escapeHtml(video.author || '')}</span>`
        }
      </div>
      ${views ? `<div class="related-views">${views}</div>` : ''}
    </div>
  `;

  if (channelHref) {
    const chLink = a.querySelector('.related-ch-channel-link');
    chLink.addEventListener('click', e => e.stopPropagation());
  }

  return a;
}

function lazyLoadRelatedIcons(videos, cards) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const wrap = entry.target;
      const authorId = wrap.dataset.authorId;
      if (!authorId) return;
      observer.unobserve(wrap);
      delete wrap.dataset.authorId;

      fetchChannelAvatar(authorId).then(thumbs => {
        if (!thumbs || !wrap.isConnected) return;
        const iconUrl = getChannelIconUrl(thumbs);
        if (!iconUrl) return;
        const placeholder = wrap.querySelector('.related-ch-placeholder');
        if (!placeholder) return;
        const img = document.createElement('img');
        img.className = 'related-ch-icon';
        img.src = iconUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.onload = () => img.classList.add('loaded');
        placeholder.replaceWith(img);
      });
    });
  }, { rootMargin: '120px' });

  cards.forEach((card, i) => {
    const video = videos[i];
    if (!video || !video.authorId) return;
    const wrap = card.querySelector('.related-ch-icon-wrap');
    if (!wrap) return;
    wrap.dataset.authorId = video.authorId;
    observer.observe(wrap);
  });
}

function renderRelated(videos) {
  const list = document.getElementById('relatedList');
  list.innerHTML = '';
  if (!videos || videos.length === 0) {
    list.innerHTML = '<p style="color:var(--muted);font-size:.85rem;">関連動画がありません</p>';
    return;
  }
  const slice = videos.slice(0, 20);
  const cards = slice.map(v => {
    const card = createRelatedCard(v);
    list.appendChild(card);
    return card;
  });
  lazyLoadRelatedIcons(slice, cards);
}

function setupQualities(formatStreams) {
  const qualityBtns = document.getElementById('qualityBtns');
  const qualityLoading = document.getElementById('qualityLoading');
  const vcQualOpts = document.getElementById('vcQualOpts');
  const vcQualBtn  = document.getElementById('vcQualBtn');
  const player = document.getElementById('videoPlayer');

  if (qualityLoading) qualityLoading.hidden = true;
  if (vcQualOpts) vcQualOpts.innerHTML = '';

  if (!formatStreams || formatStreams.length === 0) return null;

  const preferred = ['1080p60', '1080p', '720p60', '720p', '480p', '360p', '240p', '144p'];
  const sorted = [...formatStreams].sort((a, b) => {
    const ai = preferred.indexOf(a.qualityLabel);
    const bi = preferred.indexOf(b.qualityLabel);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  function setQuality(fmt) {
    const currentTime = player.currentTime;
    const wasPlaying = !player.paused;
    const prevMode = streamOnlyMode;

    if (prevMode === 'audio') {
      // Switching quality while in audio mode → exit audio mode, go normal
      streamOnlyMode = 'normal';
      const _pw = document.getElementById('playerWrap');
      if (_pw) _pw.classList.remove('stream-audio-only');
      const _atb = document.getElementById('audioTrackBar');
      if (_atb) _atb.setAttribute('hidden', '');
      player.muted = volState.muted;
    }
    // If video-only mode: keep mode, keep muted — just change quality
    lastNormalStreamSrc = fmt.url;
    player.src = fmt.url;
    player.currentTime = currentTime;
    if (prevMode === 'video') player.muted = true;
    if (wasPlaying) player.play().catch(() => {});
    const label = fmt.qualityLabel || fmt.quality || '?';
    if (vcQualOpts) vcQualOpts.querySelectorAll('.vctrls-dd-opt').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.url === fmt.url);
    });
    // In video-only mode keep the "映像のみ" label in the overlay btn and keep track btn active
    if (prevMode === 'video') {
      document.querySelectorAll('#qualityBtns .quality-btn-track[data-track-mode="video"]').forEach(b => b.classList.add('active'));
      document.querySelectorAll('#vcQualOpts .vctrls-dd-opt-track[data-track-mode="video"]').forEach(b => b.classList.add('active'));
      if (vcQualBtn) vcQualBtn.textContent = '映像のみ';
      // Deactivate all videoTrackBtns since quality changed back to muxed stream
      const vtb = document.getElementById('videoTrackBtns');
      if (vtb) vtb.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
    } else {
      if (vcQualBtn) vcQualBtn.textContent = label;
    }
    document.querySelectorAll('.vctrls-dd-wrap.dd-open').forEach(w => w.classList.remove('dd-open'));
  }

  sorted.forEach(fmt => {
    const label = fmt.qualityLabel || fmt.quality || '?';

    // Quality buttons only go in the overlay dropdown, not the panel
    // (the panel shows mode buttons: 通常 / 音声のみ / 映像のみ)
    if (vcQualOpts) {
      const opt = document.createElement('button');
      opt.className = 'vctrls-dd-opt';
      opt.textContent = label;
      opt.dataset.url = fmt.url;
      opt.addEventListener('click', () => setQuality(fmt));
      vcQualOpts.appendChild(opt);
    }
  });

  return sorted[0];
}

let hqActive = false;
let hqSyncRemovers = [];
let lastStreamSrc = '';
// ── iframe 再生位置トラッキング ──
// YouTube IFrame API の postMessage で実際の currentTime を取得する
let _iframeCurrentTime = 0;   // IFrame API から取得した実際の再生位置
let _iframeStartSec    = 0;   // iframe 起動時の開始秒（フォールバック用）
let _iframeStartWall   = 0;   // iframe 起動時のタイムスタンプ（フォールバック用）
let _iframeEl          = null; // 現在アクティブな iframe 要素
let _iframePolling     = null; // setInterval の ID
let _iframeDuration    = 0;   // iframe 動画の尺（onStateChange duration補完用）
let _clipStartSec      = -1;  // 再生区間: 開始秒 (-1 = 未設定)
let _clipEndSec        = -1;  // 再生区間: 終了秒 (-1 = 未設定)

function parseTimeSec(s) {
  const t = (s || '').trim();
  if (!t) return -1;
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const parts = t.split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN) || parts.length < 2 || parts.length > 3) return -1;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function _sendIframeCmd(fn, args) {
  if (!_iframeEl || !_iframeEl.contentWindow) return;
  try {
    _iframeEl.contentWindow.postMessage(JSON.stringify({ event: 'command', func: fn, args: args || [] }), '*');
  } catch (_) {}
}

function _sendListening() {
  if (!_iframeEl || !_iframeEl.contentWindow) return;
  try {
    _iframeEl.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
  } catch (_) {}
}

// postMessage でリアルタイムの currentTime を受け取る
window.addEventListener('message', function(e) {
  if (!_iframeEl) return;
  try {
    const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    if (!data) return;
    if (data.event === 'readyToListen') {
      _sendListening();
    } else if (data.event === 'infoDelivery') {
      // currentTime を更新
      const t = data.info && (data.info.currentTime ?? data.info.currentTimeFloat);
      if (typeof t === 'number' && isFinite(t) && t > 0) _iframeCurrentTime = t;
      // duration を補完
      const _dur = data.info && data.info.duration;
      if (typeof _dur === 'number' && isFinite(_dur) && _dur > 0) _iframeDuration = _dur;
    } else if (data.event === 'onStateChange') {
      const _state = data.info;
      // info=0: 自然終了 / info=2: 一時停止（終端付近でYouTubeがpauseを送る場合あり）
      if (_state === 0 || _state === 2) {
        const isEnded = _state === 0;
        const isNearEnd = _state === 2 && _iframeDuration > 0 && _iframeCurrentTime > 0 &&
          (_iframeDuration - _iframeCurrentTime) <= 5;
        if (isEnded || isNearEnd) {
          const _s = getSettings();
          const restartSec = _clipStartSec >= 0 ? _clipStartSec : 0;
          if (!listParam && _s.loop) {
            // ループ: クリップ開始位置（または先頭）から再生し直す
            _sendIframeCmd('loadVideoById', [{ videoId: currentVideoId, startSeconds: restartSec }]);
          } else if (isEnded && !listParam && _s.autoplayNext) {
            // 次の動画へ自動移動（ended のみ。near-end では発火しない）
            if (_relatedVideos.length > 0) {
              window.location.href = '/watch?v=' + encodeURIComponent(_relatedVideos[0].videoId);
            }
          }
        }
      }
    }
  } catch (_) {}
});

function startIframeTracking(iframeEl, startSec) {
  stopIframeTracking();
  _iframeEl          = iframeEl;
  _iframeCurrentTime = 0;
  _iframeStartSec    = startSec || 0;
  _iframeStartWall   = Date.now();
  // ハンドシェイク（1.5秒後）
  setTimeout(_sendListening, 1500);
  // 1秒ごとに currentTime をポーリング & clipEnd チェック
  _iframePolling = setInterval(function() {
    _sendIframeCmd('getCurrentTime', []);
    // 再生区間: 終了位置チェック
    if (_clipEndSec >= 0 && _iframeCurrentTime > 0 && _iframeCurrentTime >= _clipEndSec) {
      const _s = getSettings();
      const restartSec = _clipStartSec >= 0 ? _clipStartSec : 0;
      if (_s.loop) {
        _sendIframeCmd('loadVideoById', [{ videoId: currentVideoId, startSeconds: restartSec }]);
      } else {
        _sendIframeCmd('seekTo', [_clipEndSec, true]);
        _sendIframeCmd('pauseVideo', []);
      }
    }
  }, 1000);
}

function stopIframeTracking() {
  if (_iframePolling) { clearInterval(_iframePolling); _iframePolling = null; }
  _iframeEl          = null;
  _iframeCurrentTime = 0;
  _iframeStartSec    = 0;
  _iframeStartWall   = 0;
}

function getIframeCurrentTime() {
  if (_iframeCurrentTime > 0) return _iframeCurrentTime;
  // IFrame API からまだ値が届いていない場合は壁時計でフォールバック
  if (_iframeStartWall > 0) {
    return _iframeStartSec + (Date.now() - _iframeStartWall) / 1000;
  }
  return 0;
}

function getEstimatedCurrentTime() {
  const player = document.getElementById('videoPlayer');
  if (_iframeEl) return getIframeCurrentTime();
  return player ? player.currentTime : 0;
}
let volState = (() => {
  const s = getSettings();
  const vol = Math.max(0, Math.min(1, (s.defaultVolume ?? 100) / 100));
  return { vol, muted: false };
})();
let currentStreamData = null;
let currentVideoMeta = null;
let currentVideoId = '';
let _relatedVideos = [];
let streamOnlyMode = 'normal'; // 'normal' | 'audio' | 'video'
let streamBestAudioUrl = '';
let streamAudioFormats = [];
let streamVideoFormats = [];
let lastNormalStreamSrc = '';
let cachedInvInstance = null;
let playerErrorHandler = null;

function isPlaybackModeActive(modeId) {
  const mode = document.getElementById(modeId);
  return !!mode && mode.classList.contains('active');
}

function isStreamModeActive() {
  return isPlaybackModeActive('modeStream');
}

function isExternalEmbedModeActive() {
  return isPlaybackModeActive('modeNocookie') || isPlaybackModeActive('modeEdu');
}

function teardownHQ() {
  const audio = document.getElementById('hqAudio');
  const player = document.getElementById('videoPlayer');
  hqSyncRemovers.forEach(fn => fn());
  hqSyncRemovers = [];
  if (audio) { audio.pause(); audio.src = ''; }
  if (player) player.muted = false;
  hqActive = false;
  const hqBar = document.getElementById('hqBar');
  if (hqBar) hqBar.setAttribute('hidden', '');
}

function setupHQSync(player, audio) {
  hqSyncRemovers.forEach(fn => fn());
  hqSyncRemovers = [];

  function onPlay() { audio.currentTime = player.currentTime; audio.play().catch(() => {}); }
  function onPause() { audio.pause(); }
  function onSeeked() { audio.currentTime = player.currentTime; }
  function onRateChange() { audio.playbackRate = player.playbackRate; }
  function onTimeUpdate() {
    if (Math.abs(audio.currentTime - player.currentTime) > 0.5) {
      audio.currentTime = player.currentTime;
    }
  }

  player.addEventListener('play', onPlay);
  player.addEventListener('pause', onPause);
  player.addEventListener('seeked', onSeeked);
  player.addEventListener('ratechange', onRateChange);
  player.addEventListener('timeupdate', onTimeUpdate);

  hqSyncRemovers = [
    () => player.removeEventListener('play', onPlay),
    () => player.removeEventListener('pause', onPause),
    () => player.removeEventListener('seeked', onSeeked),
    () => player.removeEventListener('ratechange', onRateChange),
    () => player.removeEventListener('timeupdate', onTimeUpdate),
  ];
}

function applyHQStream(restoreTime, autoplay) {
  const videoSelect = document.getElementById('hqVideoSelect');
  const audioSelect = document.getElementById('hqAudioSelect');
  const player = document.getElementById('videoPlayer');
  const audio = document.getElementById('hqAudio');
  const status = document.getElementById('hqStatus');

  const videoUrl = videoSelect.value;
  const audioUrl = audioSelect.value;

  if (!videoUrl || !audioUrl) {
    status.textContent = 'ストリームが見つかりません';
    status.className = 'hq-status hq-fail';
    return;
  }

  const ct = restoreTime ?? player.currentTime;
  const shouldPlay = autoplay ?? !player.paused;

  player.muted = true;
  player.src = videoUrl;
  audio.src = audioUrl;
  audio.volume = volState.vol;
  audio.muted = volState.muted;

  setupHQSync(player, audio);

  player.currentTime = ct;
  audio.currentTime = ct;

  if (shouldPlay) {
    tryAutoplay(player, audio);
  }

  status.textContent = '';
  status.className = 'hq-status';
}

function initHQMode(streamData) {
  const adaptiveFormats = streamData.adaptiveFormats || [];

  function videoHeight(f) {
    const fromLabel = parseInt(f.qualityLabel);
    if (fromLabel) return fromLabel;
    const sizeMatch = (f.size || '').match(/x(\d+)/);
    return sizeMatch ? parseInt(sizeMatch[1]) : 0;
  }

  function encLabel(f) {
    const enc = (f.encoding || '').toLowerCase();
    if (enc.startsWith('av01') || enc.startsWith('av1')) return 'AV1';
    if (enc === 'vp9') return 'VP9';
    if (enc === 'h264' || enc === 'avc1') return 'H.264';
    if (enc === 'aac' || enc === 'mp4a') return 'AAC';
    if (enc === 'opus') return 'Opus';
    if (f.container === 'webm') return 'VP9';
    if (f.container === 'm4a' || f.container === 'mp4') return 'AAC';
    return enc || f.container || '?';
  }

  const CODEC_PREF = { 'H.264': 0, 'VP9': 1, 'AV1': 2 };

  const videoFormats = adaptiveFormats
    .filter(f => f.type && f.type.startsWith('video/'))
    .sort((a, b) => {
      const hDiff = videoHeight(b) - videoHeight(a);
      if (hDiff !== 0) return hDiff;
      return (CODEC_PREF[encLabel(a)] ?? 9) - (CODEC_PREF[encLabel(b)] ?? 9);
    });

  const audioFormats = adaptiveFormats
    .filter(f => f.type && f.type.startsWith('audio/'))
    .sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));

  if (audioFormats.length > 0) {
    streamBestAudioUrl = audioFormats[0].url;
    streamAudioFormats = audioFormats;
  }

  streamVideoFormats = videoFormats;

  const modeHQBtn = document.getElementById('modeHQ');
  if (videoFormats.length === 0 || audioFormats.length === 0) {
    if (modeHQBtn) modeHQBtn.disabled = true;
    if (modeHQBtn) modeHQBtn.title = '高画質ストリームが取得できませんでした';
    return;
  }

  if (modeHQBtn) { modeHQBtn.disabled = false; modeHQBtn.title = ''; }

  const videoSelect = document.getElementById('hqVideoSelect');
  const audioSelect = document.getElementById('hqAudioSelect');
  const vcHQVidOpts = document.getElementById('vcHQVidOpts');
  const vcHQAudOpts = document.getElementById('vcHQAudOpts');
  const vcHQVidBtn  = document.getElementById('vcHQVidBtn');
  const vcHQAudBtn  = document.getElementById('vcHQAudBtn');

  function shortQualityLabel(select, fallback) {
    const opt = select.options[select.selectedIndex];
    if (!opt) return fallback;
    return opt.textContent.split(' [')[0] || fallback;
  }

  function syncHQOverlayFromSelects() {
    if (vcHQVidBtn) vcHQVidBtn.textContent = shortQualityLabel(videoSelect, '映像');
    if (vcHQAudBtn) vcHQAudBtn.textContent = shortQualityLabel(audioSelect, '音声');
    if (vcHQVidOpts) {
      vcHQVidOpts.querySelectorAll('.vctrls-dd-opt').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.url === videoSelect.value);
      });
    }
    if (vcHQAudOpts) {
      vcHQAudOpts.querySelectorAll('.vctrls-dd-opt').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.url === audioSelect.value);
      });
    }
  }

  function closeHQOverlayDropdowns() {
    document.querySelectorAll('.vctrls-dd-wrap.dd-open').forEach(w => w.classList.remove('dd-open'));
  }

  videoSelect.innerHTML = '';
  if (vcHQVidOpts) vcHQVidOpts.innerHTML = '';
  videoFormats.forEach((f, i) => {
    const fps = f.fps ? ` ${f.fps}fps` : '';
    const label = `${f.qualityLabel || '?'}${fps} [${encLabel(f)}]`;

    const opt = document.createElement('option');
    opt.value = f.url;
    opt.textContent = label;
    if (i === 0) opt.selected = true; // always pick the best (sorted highest first)
    videoSelect.appendChild(opt);

    if (vcHQVidOpts) {
      const btn = document.createElement('button');
      btn.className = 'vctrls-dd-opt';
      btn.textContent = label;
      btn.dataset.url = f.url;
      btn.addEventListener('click', () => {
        videoSelect.value = f.url;
        videoSelect.dispatchEvent(new Event('change'));
        closeHQOverlayDropdowns();
      });
      vcHQVidOpts.appendChild(btn);
    }
  });

  audioSelect.innerHTML = '';
  if (vcHQAudOpts) vcHQAudOpts.innerHTML = '';
  audioFormats.forEach((f, i) => {
    const kbps = f.bitrate ? `${Math.round(parseInt(f.bitrate) / 1000)}kbps` : '?';
    const label = `${kbps} [${encLabel(f)}]`;

    const opt = document.createElement('option');
    opt.value = f.url;
    opt.textContent = label;
    audioSelect.appendChild(opt);

    if (vcHQAudOpts) {
      const btn = document.createElement('button');
      btn.className = 'vctrls-dd-opt';
      btn.textContent = label;
      btn.dataset.url = f.url;
      btn.addEventListener('click', () => {
        audioSelect.value = f.url;
        audioSelect.dispatchEvent(new Event('change'));
        closeHQOverlayDropdowns();
      });
      vcHQAudOpts.appendChild(btn);
    }
  });

  videoSelect.onchange = () => {
    syncHQOverlayFromSelects();
    if (hqActive) applyHQStream();
  };
  audioSelect.onchange = () => {
    syncHQOverlayFromSelects();
    if (hqActive) applyHQStream();
  };
  syncHQOverlayFromSelects();
}

function initModeBar(videoId) {
  const player = document.getElementById('videoPlayer');
  const nocookiePlayer = document.getElementById('nocookiePlayer');
  const errorEl = document.getElementById('playerError');
  const errorMsg = document.getElementById('playerErrorMsg');
  const reloadBtn = document.getElementById('reloadBtn');
  const modeStream = document.getElementById('modeStream');
  const modeNocookie = document.getElementById('modeNocookie');
  const modeHQ = document.getElementById('modeHQ');

  reloadBtn.addEventListener('click', () => {
    errorEl.hidden = true;
    reloadBtn.hidden = true;
    player.removeAttribute('hidden');
    player.load();
    player.play().catch(() => {});
  });

  function setOverlayQualMode(mode) {
    const qw = document.getElementById('vcQualWrap');
    const vw = document.getElementById('vcHQVidWrap');
    const aw = document.getElementById('vcHQAudWrap');
    if (mode === 'stream') {
      if (qw) qw.removeAttribute('hidden');
      if (vw) vw.setAttribute('hidden', '');
      if (aw) aw.setAttribute('hidden', '');
    } else if (mode === 'hq') {
      if (qw) qw.setAttribute('hidden', '');
      if (vw) vw.removeAttribute('hidden');
      if (aw) aw.removeAttribute('hidden');
    } else {
      if (qw) qw.setAttribute('hidden', '');
      if (vw) vw.setAttribute('hidden', '');
      if (aw) aw.setAttribute('hidden', '');
    }
  }

  modeStream.addEventListener('click', () => {
    if (modeStream.classList.contains('active')) return;
    const ct = getEstimatedCurrentTime();
    stopIframeTracking();
    if (hqActive) teardownHQ();
    modeStream.classList.add('active');
    modeNocookie.classList.remove('active');
    modeHQ.classList.remove('active');
    const _mEdu = document.getElementById('modeEdu');
    if (_mEdu) _mEdu.classList.remove('active');
    const _ep = document.getElementById('eduPlayer');
    if (_ep) { _ep.setAttribute('hidden', ''); _ep.src = 'about:blank'; }
    const _eb = document.getElementById('eduBar');
    if (_eb) _eb.setAttribute('hidden', '');
    nocookiePlayer.setAttribute('hidden', '');
    nocookiePlayer.src = 'about:blank';
    errorEl.hidden = true;
    reloadBtn.hidden = true;
    document.getElementById('qualityBar').removeAttribute('hidden');
    document.getElementById('vctrls').classList.add('vctrls-show');
    setOverlayQualMode('stream');
    if (streamAltBarReady) {
      document.getElementById('streamAltBtn').removeAttribute('hidden');
      setInstanceLabel(cachedInvInstance);
    }
    if (lastStreamSrc) {
      player.src = lastStreamSrc;
      player.currentTime = ct;
      player.removeAttribute('hidden');
      player.play().catch(() => {});
    } else if (player.src) {
      player.removeAttribute('hidden');
      player.play().catch(() => {});
    } else {
      errorEl.hidden = false;
      errorMsg.textContent = 'このAPIではストリームURLが取得できませんでした。YouTubeで視聴してください。';
    }
  });

  modeHQ.addEventListener('click', () => {
    if (modeHQ.classList.contains('active')) return;
    const ct = getEstimatedCurrentTime();
    stopIframeTracking();
    lastStreamSrc = (streamOnlyMode === 'audio' && lastNormalStreamSrc) ? lastNormalStreamSrc : player.src;
    if (streamOnlyMode !== 'normal') {
      streamOnlyMode = 'normal';
      const _pw = document.getElementById('playerWrap');
      if (_pw) _pw.classList.remove('stream-audio-only');
      const _atb = document.getElementById('audioTrackBar');
      if (_atb) _atb.setAttribute('hidden', '');
      const _vtb = document.getElementById('videoTrackBar');
      if (_vtb) _vtb.setAttribute('hidden', '');
    }
    modeHQ.classList.add('active');
    modeStream.classList.remove('active');
    modeNocookie.classList.remove('active');
    const _mEdu2 = document.getElementById('modeEdu');
    if (_mEdu2) _mEdu2.classList.remove('active');
    const _ep2 = document.getElementById('eduPlayer');
    if (_ep2) { _ep2.setAttribute('hidden', ''); _ep2.src = 'about:blank'; }
    const _eb2 = document.getElementById('eduBar');
    if (_eb2) _eb2.setAttribute('hidden', '');
    nocookiePlayer.setAttribute('hidden', '');
    nocookiePlayer.src = 'about:blank';
    errorEl.hidden = true;
    reloadBtn.hidden = true;
    document.getElementById('streamAltBtn').setAttribute('hidden', '');
    document.getElementById('qualityBar').setAttribute('hidden', '');
    document.getElementById('hqBar').removeAttribute('hidden');
    document.getElementById('vctrls').classList.add('vctrls-show');
    setOverlayQualMode('hq');
    hqActive = true;
    player.removeAttribute('hidden');
    applyHQStream(ct, true);
  });

  modeNocookie.addEventListener('click', () => {
    if (modeNocookie.classList.contains('active')) return;
    const ct = getEstimatedCurrentTime();
    stopIframeTracking();
    if (hqActive) teardownHQ();
    modeNocookie.classList.add('active');
    modeStream.classList.remove('active');
    modeHQ.classList.remove('active');
    const _mEdu3 = document.getElementById('modeEdu');
    if (_mEdu3) _mEdu3.classList.remove('active');
    const _ep3 = document.getElementById('eduPlayer');
    if (_ep3) { _ep3.setAttribute('hidden', ''); _ep3.src = 'about:blank'; }
    const _eb3 = document.getElementById('eduBar');
    if (_eb3) _eb3.setAttribute('hidden', '');
    player.pause();
    player.setAttribute('hidden', '');
    document.getElementById('playerSkeleton').hidden = true;
    errorEl.hidden = true;
    reloadBtn.hidden = true;
    document.getElementById('streamAltBtn').setAttribute('hidden', '');
    document.getElementById('qualityBar').setAttribute('hidden', '');
    document.getElementById('vctrls').classList.remove('vctrls-show');
    setOverlayQualMode('none');
    const _ncStart = ct > 1 ? `&start=${Math.floor(ct)}` : '';
    const _ncPlay  = ct > 1 || getSettings().autoplay ? 1 : 0;
    const _ncStartSec = ct > 1 ? ct : 0;
    nocookiePlayer.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=${_ncPlay}${_ncStart}&enablejsapi=1`;
    nocookiePlayer.removeAttribute('hidden');
    startIframeTracking(nocookiePlayer, _ncStartSec);
  });

  // ── Edu mode ──
  const modeEdu     = document.getElementById('modeEdu');
  const eduPlayer   = document.getElementById('eduPlayer');
  const eduBar      = document.getElementById('eduBar');
  const eduSelect   = document.getElementById('eduParamSelect');
  const eduStatus   = document.getElementById('eduStatus');

  let eduParams = [];

  async function fetchEduParams() {
    try {
      const res = await fetch('/api/edu-params');
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('invalid');
      eduParams = data;
      if (eduSelect) {
        eduSelect.innerHTML = '';
        eduParams.forEach((p, i) => {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = p.label;
          eduSelect.appendChild(opt);
        });
        eduSelect.selectedIndex = 0;
      }
    } catch (e) {
      if (eduStatus) { eduStatus.textContent = 'パラメータ取得失敗'; eduStatus.className = 'pc-alt-status stream-alt-fail'; }
    }
  }

  fetchEduParams();

  function getEduSrc(startSec = 0) {
    const idx = eduSelect ? parseInt(eduSelect.value, 10) : 0;
    let param = (eduParams[idx] && eduParams[idx].value) ? eduParams[idx].value : '?autoplay=1';

    // postMessage が機能するように競合・干渉するパラメータを除去する
    // origin= はドメインをロックして postMessage をブロックするため必ず除去
    param = param
      .replace(/([?&])enablejsapi=[^&]*/g, '')
      .replace(/([?&])origin=[^&]*/g, '')
      .replace(/([?&])autoplay=[^&]*/g, '')
      .replace(/([?&])loop=[^&]*/g, '')
      .replace(/([?&])playlist=[^&]*/g, '')
      .replace(/([?&])start=[^&]*/g, '')
      .replace(/\?&/g, '?')
      .replace(/&&+/g, '&')
      .replace(/[?&]$/, '');

    // ?が消えて &パラメータだけ残った場合、先頭の & を ? に変換
    if (!param.includes('?') && param.includes('&')) {
      param = param.replace('&', '?');
    }

    const shouldPlay = startSec > 0 || getSettings().autoplay;
    const autoplayVal = shouldPlay ? '1' : '0';
    const sep = param.includes('?') ? '&' : '?';
    const muteParam = params.get('muted') === '1' ? '&mute=1' : '';
    const startParam = startSec > 0 ? `&start=${Math.floor(startSec)}` : '';

    return `https://www.youtubeeducation.com/embed/${videoId}${param}${sep}autoplay=${autoplayVal}&enablejsapi=1${muteParam}${startParam}`;
  }

  function activateEdu() {
    const ct = getEstimatedCurrentTime();
    stopIframeTracking();
    if (hqActive) teardownHQ();
    modeEdu.classList.add('active');
    modeStream.classList.remove('active');
    modeHQ.classList.remove('active');
    modeNocookie.classList.remove('active');
    player.pause();
    player.setAttribute('hidden', '');
    document.getElementById('playerSkeleton').hidden = true;
    nocookiePlayer.setAttribute('hidden', '');
    nocookiePlayer.src = 'about:blank';
    errorEl.hidden = true;
    reloadBtn.hidden = true;
    document.getElementById('streamAltBtn').setAttribute('hidden', '');
    document.getElementById('qualityBar').setAttribute('hidden', '');
    document.getElementById('hqBar').setAttribute('hidden', '');
    if (eduBar) eduBar.removeAttribute('hidden');
    document.getElementById('vctrls').classList.remove('vctrls-show');
    setOverlayQualMode('none');
    if (eduPlayer) {
      const eduStartSec = ct > 1 ? ct : 0;
      eduPlayer.src = getEduSrc(eduStartSec);
      eduPlayer.removeAttribute('hidden');
      startIframeTracking(eduPlayer, eduStartSec);
    }
  }

  if (modeEdu) modeEdu.addEventListener('click', () => {
    if (modeEdu.classList.contains('active')) return;
    activateEdu();
  });

  if (eduSelect) eduSelect.addEventListener('change', () => {
    if (modeEdu && modeEdu.classList.contains('active') && eduPlayer) {
      const ct = getEstimatedCurrentTime();
      stopIframeTracking();
      const eduStartSec = ct > 1 ? ct : 0;
      eduPlayer.src = getEduSrc(eduStartSec);
      startIframeTracking(eduPlayer, eduStartSec);
    }
  });

  const modeParam = params.get('mode');
  if (modeParam === 'nocookie') {
    setTimeout(() => modeNocookie.click(), 0);
  } else if (modeParam === 'edu' && modeEdu) {
    setTimeout(() => modeEdu.click(), 0);
  }

}

async function tryAutoplay(videoEl, audioEl) {
  async function _doPlay() {
    if (audioEl) {
      return Promise.all([videoEl.play(), audioEl.play()]);
    }
    return videoEl.play();
  }
  try {
    await _doPlay();
    return;
  } catch (e) {
    if (e.name === 'AbortError') {
      await new Promise(r => setTimeout(r, 120));
      try {
        await _doPlay();
        return;
      } catch (e2) {
        if (e2.name !== 'NotAllowedError') return;
      }
    } else if (e.name !== 'NotAllowedError') {
      return;
    }
  }
  videoEl.muted = true;
  if (audioEl) audioEl.muted = true;
  try {
    await _doPlay();
    videoEl.dispatchEvent(new CustomEvent('autoplay-muted', { detail: { hasAudio: !!audioEl } }));
  } catch (_) {}
}

function setupStreamOnlyBtns() {
  const qualityBtns  = document.getElementById('qualityBtns');
  const vcQualOpts   = document.getElementById('vcQualOpts');
  const audioTrackBtns = document.getElementById('audioTrackBtns');
  if (!qualityBtns) return;

  // Remove previous track buttons
  qualityBtns.querySelectorAll('.quality-btn-track').forEach(b => b.remove());
  if (vcQualOpts) vcQualOpts.querySelectorAll('.vctrls-dd-opt-track').forEach(b => b.remove());

  function addPanelBtn(label, mode) {
    const btn = document.createElement('button');
    btn.className = 'quality-btn quality-btn-track';
    btn.textContent = label;
    btn.dataset.trackMode = mode;
    btn.addEventListener('click', () => switchStreamOnlyMode(mode));
    qualityBtns.appendChild(btn);
  }

  function addOverlayOpt(label, mode) {
    if (!vcQualOpts) return;
    const opt = document.createElement('button');
    opt.className = 'vctrls-dd-opt vctrls-dd-opt-track';
    opt.textContent = label;
    opt.dataset.trackMode = mode;
    opt.addEventListener('click', () => {
      switchStreamOnlyMode(mode);
      document.querySelectorAll('.vctrls-dd-wrap.dd-open').forEach(w => w.classList.remove('dd-open'));
    });
    vcQualOpts.appendChild(opt);
  }

  // "通常" button — always first, active when in normal mode
  addPanelBtn('通常', 'normal');
  addOverlayOpt('通常', 'normal');
  if (streamOnlyMode === 'normal') {
    document.querySelectorAll('#qualityBtns .quality-btn-track[data-track-mode="normal"]').forEach(b => b.classList.add('active'));
  }

  if (streamBestAudioUrl) {
    addPanelBtn('音声のみ', 'audio');
    addOverlayOpt('音声のみ', 'audio');
  }
  addPanelBtn('映像のみ', 'video');
  addOverlayOpt('映像のみ', 'video');

  // Populate audio track quality buttons
  if (audioTrackBtns) {
    audioTrackBtns.innerHTML = '';
    streamAudioFormats.forEach((f, i) => {
      const kbps = f.bitrate ? `${Math.round(parseInt(f.bitrate) / 1000)}kbps` : '?';
      const enc  = (f.encoding || f.container || '').toLowerCase();
      const codec = enc.startsWith('opus') ? 'Opus' : enc.startsWith('mp4a') || enc === 'aac' ? 'AAC' : enc || '?';
      const label = `${kbps} [${codec}]`;
      const btn = document.createElement('button');
      btn.className = 'quality-btn' + (i === 0 ? ' active' : '');
      btn.textContent = label;
      btn.dataset.audioUrl = f.url;
      btn.addEventListener('click', () => switchAudioTrack(f.url, audioTrackBtns));
      audioTrackBtns.appendChild(btn);
    });
  }

  // Populate video track quality buttons (adaptive video-only streams only)
  const videoTrackBtns = document.getElementById('videoTrackBtns');
  if (videoTrackBtns) {
    videoTrackBtns.innerHTML = '';

    // Adaptive video-only streams
    streamVideoFormats.forEach(f => {
      const height = (() => {
        const fromLabel = parseInt(f.qualityLabel);
        if (fromLabel) return fromLabel;
        const m = (f.size || '').match(/x(\d+)/);
        return m ? parseInt(m[1]) : 0;
      })();
      const enc = (f.encoding || '').toLowerCase();
      let codec = enc.startsWith('av01') || enc.startsWith('av1') ? 'AV1'
        : enc === 'vp9' ? 'VP9'
        : enc === 'h264' || enc === 'avc1' ? 'H.264'
        : f.container === 'webm' ? 'VP9'
        : enc || f.container || '?';
      const label = height ? `${height}p [${codec}]` : (f.qualityLabel || codec || '?');
      const btn = document.createElement('button');
      btn.className = 'quality-btn';
      btn.textContent = label;
      btn.dataset.videoUrl = f.url;
      btn.addEventListener('click', () => switchVideoTrack(f.url, videoTrackBtns));
      videoTrackBtns.appendChild(btn);
    });
  }
}

function switchStreamOnlyMode(mode) {
  const player        = document.getElementById('videoPlayer');
  const playerWrap    = document.getElementById('playerWrap');
  const vcQualBtn     = document.getElementById('vcQualBtn');
  const audioTrackBar = document.getElementById('audioTrackBar');
  const videoTrackBar = document.getElementById('videoTrackBar');
  if (!player || !playerWrap) return;

  const ct         = player.currentTime;
  const wasPlaying = !player.paused;
  const prevMode   = streamOnlyMode;
  streamOnlyMode   = mode;

  document.querySelectorAll('#qualityBtns .quality-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#vcQualOpts .vctrls-dd-opt').forEach(b => b.classList.remove('active'));

  if (mode === 'normal') {
    playerWrap.classList.remove('stream-audio-only');
    if (audioTrackBar) audioTrackBar.setAttribute('hidden', '');
    if (videoTrackBar) videoTrackBar.setAttribute('hidden', '');
    const restoreSrc = lastNormalStreamSrc || player.src;
    if (prevMode === 'audio' || prevMode === 'video') {
      player.src = restoreSrc;
      player.currentTime = ct;
    }
    player.muted = volState.muted;
    if (wasPlaying) player.play().catch(() => {});
    // Mark the matching quality button active
    const curSrc = player.src;
    document.querySelectorAll('#qualityBtns .quality-btn:not(.quality-btn-track)').forEach(b => {
      b.classList.toggle('active', b.dataset.url === curSrc);
    });
    document.querySelectorAll('#qualityBtns .quality-btn-track[data-track-mode="normal"]').forEach(b => b.classList.add('active'));
    document.querySelectorAll('#vcQualOpts .vctrls-dd-opt-track[data-track-mode="normal"]').forEach(b => b.classList.add('active'));
    const _vcQb = document.getElementById('vcQualBtn');
    if (_vcQb) {
      const activeQBtn = document.querySelector('#qualityBtns .quality-btn:not(.quality-btn-track).active');
      _vcQb.textContent = activeQBtn ? activeQBtn.textContent : '画質';
    }
    return;

  } else if (mode === 'audio') {
    if (!streamBestAudioUrl) return;
    if (prevMode !== 'audio') lastNormalStreamSrc = player.src;
    // Set audio poster: try maxresdefault → hqdefault → player poster fallback
    playerWrap.style.setProperty('--audio-poster', `url(${player.poster})`);
    if (currentVideoId) {
      const tryUrls = [
        `https://i.ytimg.com/vi/${currentVideoId}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${currentVideoId}/hqdefault.jpg`,
      ];
      (function tryNext(i) {
        if (i >= tryUrls.length) return;
        const img = new Image();
        img.onload = () => playerWrap.style.setProperty('--audio-poster', `url(${tryUrls[i]})`);
        img.onerror = () => tryNext(i + 1);
        img.src = tryUrls[i];
      })(0);
    }
    playerWrap.classList.add('stream-audio-only');
    if (audioTrackBar) audioTrackBar.removeAttribute('hidden');
    if (videoTrackBar) videoTrackBar.setAttribute('hidden', '');
    player.muted = false;
    player.volume = volState.vol;
    player.src = streamBestAudioUrl;
    player.currentTime = ct;
    if (wasPlaying) player.play().catch(() => {});
    document.querySelectorAll('#qualityBtns .quality-btn-track[data-track-mode="audio"]').forEach(b => b.classList.add('active'));
    document.querySelectorAll('#vcQualOpts .vctrls-dd-opt-track[data-track-mode="audio"]').forEach(b => b.classList.add('active'));
    if (vcQualBtn) vcQualBtn.textContent = '音声のみ';

  } else if (mode === 'video') {
    playerWrap.classList.remove('stream-audio-only');
    if (audioTrackBar) audioTrackBar.setAttribute('hidden', '');
    if (videoTrackBar) videoTrackBar.removeAttribute('hidden');
    if (prevMode === 'audio' && lastNormalStreamSrc) {
      player.src = lastNormalStreamSrc;
    }
    player.muted = true;

    // Auto-select the highest quality adaptive video stream
    const vtb = document.getElementById('videoTrackBtns');
    if (streamVideoFormats.length > 0) {
      const best = streamVideoFormats[0];
      player.src = best.url;
      if (vtb) {
        vtb.querySelectorAll('.quality-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.videoUrl === best.url);
        });
      }
    } else {
      if (vtb) vtb.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
    }

    player.currentTime = ct;
    if (wasPlaying) player.play().catch(() => {});
    document.querySelectorAll('#qualityBtns .quality-btn-track[data-track-mode="video"]').forEach(b => b.classList.add('active'));
    document.querySelectorAll('#vcQualOpts .vctrls-dd-opt-track[data-track-mode="video"]').forEach(b => b.classList.add('active'));
    if (vcQualBtn) vcQualBtn.textContent = '映像のみ';
  }
}

function switchAudioTrack(url, container) {
  if (!url || streamOnlyMode !== 'audio') return;
  const player = document.getElementById('videoPlayer');
  if (!player) return;
  streamBestAudioUrl = url;
  const ct = player.currentTime;
  const wasPlaying = !player.paused;
  player.src = url;
  player.currentTime = ct;
  if (wasPlaying) player.play().catch(() => {});
  if (container) {
    container.querySelectorAll('.quality-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.audioUrl === url);
    });
  }
}

function switchVideoTrack(url, container) {
  if (streamOnlyMode !== 'video') return;
  const player = document.getElementById('videoPlayer');
  if (!player) return;
  const ct = player.currentTime;
  const wasPlaying = !player.paused;
  if (!url) return;
  player.src = url;
  player.muted = true;
  player.currentTime = ct;
  if (wasPlaying) player.play().catch(() => {});
  if (container) {
    container.querySelectorAll('.quality-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.videoUrl === url);
    });
  }
}

function setupPlayer(streamData, videoId) {
  currentStreamData = streamData;
  currentVideoId = videoId;
  const player = document.getElementById('videoPlayer');
  const skeleton = document.getElementById('playerSkeleton');
  const errorEl = document.getElementById('playerError');
  const errorMsg = document.getElementById('playerErrorMsg');
  const reloadBtn = document.getElementById('reloadBtn');

  player.poster = getThumbnailUrl(videoId);

  const formats = streamData.formatStreams || [];

  if (formats.length === 0) {
    skeleton.hidden = true;
    if (isExternalEmbedModeActive()) {
      errorEl.hidden = true;
      reloadBtn.hidden = true;
    } else {
      errorEl.hidden = false;
      errorMsg.textContent = 'このAPIではストリームURLが取得できませんでした。YouTubeで視聴してください。';
    }
    const qualityLoading = document.getElementById('qualityLoading');
    if (qualityLoading) qualityLoading.hidden = true;
  } else {
    const bestFormat = setupQualities(formats);
    if (!bestFormat) return;

    lastNormalStreamSrc = bestFormat.url;
    player.src = bestFormat.url;
    skeleton.hidden = true;

    const vcQualBtn = document.getElementById('vcQualBtn');
    if (vcQualBtn) {
      vcQualBtn.textContent = bestFormat.qualityLabel || bestFormat.quality || '画質';
      const firstOpt = document.querySelector('#vcQualOpts .vctrls-dd-opt');
      if (firstOpt) firstOpt.classList.add('active');
    }
    // Mark "通常" as active (no individual quality buttons in panel anymore)
    document.querySelectorAll('#qualityBtns .quality-btn-track[data-track-mode="normal"]').forEach(b => b.classList.add('active'));

    const setOvMode = document.getElementById('vcQualWrap');
    if (setOvMode) setOvMode.removeAttribute('hidden');

    if (!isExternalEmbedModeActive()) {
      player.removeAttribute('hidden');
      if (getSettings().autoplay) {
        tryAutoplay(player, null);
      }
    }

    if (playerErrorHandler) {
      player.removeEventListener('error', playerErrorHandler);
    }
    playerErrorHandler = () => {
      if (!isExternalEmbedModeActive() && !reloadAllInProgress) {
        const savedTime = player.currentTime;
        player.setAttribute('hidden', '');
        doStreamAlt(videoId, savedTime).catch(() => {
          reloadAll(videoId);
        });
      }
    };
    player.addEventListener('error', playerErrorHandler);
  }

  initHQMode(streamData);
  setupStreamOnlyBtns();
}

function formatDescription(rawHtml, rawText) {
  let html = rawHtml.trim();

  if (!html) {
    if (!rawText.trim()) return '';
    html = escapeHtml(rawText)
      .replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s<>"]+)/g, '<a href="$1">$1</a>')
      .replace(/#(\w+)/g, '<a href="/hashtag?tag=$1">#$1</a>');
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString('<div>' + html + '</div>', 'text/html');

  doc.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href') || '';
    const text = a.textContent.trim();

    const isHashtag = text.startsWith('#') ||
      /youtube\.com\/hashtag\//i.test(href) ||
      /\/hashtag\//i.test(href);

    if (isHashtag) {
      const tag = text.startsWith('#')
        ? text.slice(1)
        : (href.match(/\/hashtag\/([^/?&]+)/) || [])[1] || text.replace(/^#/, '');
      a.href = `/hashtag?tag=${encodeURIComponent(tag)}`;
      a.removeAttribute('target');
      a.removeAttribute('rel');
      return;
    }

    const ytVideoMatch = href.match(/(?:youtube\.com\/watch[^"]*[?&]v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (ytVideoMatch) {
      a.href = `/watch?v=${ytVideoMatch[1]}`;
      a.removeAttribute('target');
      a.removeAttribute('rel');
      return;
    }

    // Channel ID: /channel/UCxxxx or youtube.com/channel/UCxxxx
    const channelIdMatch = href.match(/(?:youtube\.com)?\/channel\/([A-Za-z0-9_-]+)/);
    if (channelIdMatch) {
      a.href = `/channel?id=${channelIdMatch[1]}`;
      a.removeAttribute('target');
      a.removeAttribute('rel');
      return;
    }

    // Handle: /@handle or youtube.com/@handle[?...]
    const handleMatch = href.match(/(?:youtube\.com)?\/(@[^/?&\s]+)/);
    if (handleMatch) {
      a.href = `/channel?id=${encodeURIComponent(handleMatch[1])}`;
      a.removeAttribute('target');
      a.removeAttribute('rel');
      return;
    }

    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  return doc.querySelector('div').innerHTML;
}

function updateWatchSubBtn(btn, authorId, subscribedOverride) {
  const subscribed = subscribedOverride !== undefined ? subscribedOverride : isSubscribed(authorId);
  btn.className = subscribed ? 'sub-btn subscribed' : 'sub-btn';
  btn.innerHTML = subscribed
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg> 登録済み`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> 登録`;
}

function initWatchPlaylistBtn(videoId, meta) {
  const wrap = document.getElementById('watchPlWrap');
  const btn = document.getElementById('watchPlBtn');
  const popup = document.getElementById('watchPlPopup');
  if (!wrap || !btn || !popup) return;

  wrap.hidden = false;

  const videoData = {
    videoId,
    title: meta.title || '',
    author: meta.author || '',
    authorId: meta.authorId || '',
    lengthSeconds: meta.lengthSeconds || 0
  };

  const ICON_ADD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="19" height="19">
    <line x1="3" y1="5" x2="15" y2="5"/><line x1="3" y1="10" x2="15" y2="10"/><line x1="3" y1="15" x2="11" y2="15"/>
    <line x1="18" y1="12" x2="18" y2="20"/><line x1="14" y1="16" x2="22" y2="16"/>
  </svg>`;
  const ICON_ADDED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="19" height="19">
    <line x1="3" y1="5" x2="15" y2="5"/><line x1="3" y1="10" x2="15" y2="10"/><line x1="3" y1="15" x2="11" y2="15"/>
    <polyline points="14 18 17 21 22 14" stroke-width="2.3"/>
  </svg>`;

  function updateBtn() {
    const inAny = getPlaylistsContaining(videoId).length > 0;
    btn.innerHTML = inAny ? ICON_ADDED : ICON_ADD;
    btn.title = inAny ? '追加済み（クリックで変更）' : 'プレイリストに追加';
    btn.classList.toggle('watch-pl-btn--saved', inAny);
  }

  updateBtn();

  function renderPopup() {
    const pls = getPlaylists();
    const inPls = getPlaylistsContaining(videoId);
    popup.innerHTML = '';

    if (!pls.length) {
      const hint = document.createElement('div');
      hint.className = 'watch-pl-hint';
      hint.textContent = 'プレイリストがありません';
      popup.appendChild(hint);
    } else {
      pls.forEach(pl => {
        const row = document.createElement('label');
        row.className = 'watch-pl-row';
        const checked = inPls.includes(pl.id);
        row.innerHTML = `
          <input type="checkbox" class="watch-pl-check" data-id="${escapeHtml(pl.id)}" ${checked ? 'checked' : ''} />
          <span class="watch-pl-name">${escapeHtml(pl.name)}</span>
          <span class="watch-pl-cnt">${pl.videos.length}本</span>
        `;
        row.querySelector('input').addEventListener('change', (e) => {
          if (e.target.checked) {
            addVideoToPlaylist(pl.id, videoData);
          } else {
            removeVideoFromPlaylist(pl.id, videoId);
          }
          updateBtn();
        });
        popup.appendChild(row);
      });
    }

    const divider = document.createElement('div');
    divider.className = 'watch-pl-divider';
    popup.appendChild(divider);

    const newRow = document.createElement('button');
    newRow.className = 'watch-pl-new-btn';
    newRow.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> 新しいプレイリストを作成`;
    newRow.addEventListener('click', () => {
      const name = prompt('プレイリスト名を入力してください');
      if (name && name.trim()) {
        const pl = createPlaylist(name.trim());
        addVideoToPlaylist(pl.id, videoData);
        updateBtn();
        renderPopup();
      }
    });
    popup.appendChild(newRow);
  }

  let popupOpen = false;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    popupOpen = !popupOpen;
    popup.hidden = !popupOpen;
    if (popupOpen) renderPopup();
  });

  document.addEventListener('click', (e) => {
    if (popupOpen && !wrap.contains(e.target)) {
      popupOpen = false;
      popup.hidden = true;
    }
  }, true);
}

function getStreamExt(fmt) {
  if (fmt.container) return fmt.container.replace(/^m4a$/, 'mp4');
  if (fmt.type) {
    const m = fmt.type.match(/^(video|audio)\/(\w+)/);
    if (m) return m[2] === 'webm' ? 'webm' : 'mp4';
  }
  return 'mp4';
}

function getStreamCodecLabel(fmt) {
  const enc = (fmt.encoding || '').toLowerCase();
  if (enc.startsWith('av01') || enc.startsWith('av1')) return 'AV1';
  if (enc === 'vp9') return 'VP9';
  if (enc === 'h264' || enc === 'avc1') return 'H.264';
  if (enc === 'aac' || enc === 'mp4a') return 'AAC';
  if (enc === 'opus') return 'Opus';
  if (fmt.type) {
    const t = fmt.type.toLowerCase();
    if (t.includes('vp9')) return 'VP9';
    if (t.includes('av01') || t.includes('av1')) return 'AV1';
    if (t.includes('avc') || t.includes('h264')) return 'H.264';
    if (t.includes('opus')) return 'Opus';
    if (t.includes('aac') || t.includes('mp4a')) return 'AAC';
  }
  if (fmt.container === 'webm') return 'VP9';
  if (fmt.container === 'm4a' || fmt.container === 'mp4') return 'AAC';
  return enc || fmt.container || '';
}

function buildDownloadUrl(streamUrl, filename) {
  return `/download?url=${encodeURIComponent(streamUrl)}&filename=${encodeURIComponent(filename)}`;
}

function makeDlRow(label, sublabel, href) {
  const row = document.createElement('div');
  row.className = 'dl-item';
  row.innerHTML = `
    <div class="dl-item-info">
      <span class="dl-item-label">${escapeHtml(label)}</span>
      ${sublabel ? `<span class="dl-item-sub">${escapeHtml(sublabel)}</span>` : ''}
    </div>
    <a class="dl-btn" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="ダウンロード">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      リンクを開く
    </a>
  `;
  return row;
}

function initFavBtn(videoId, meta) {
  const btn = document.getElementById('watchFavBtn');
  if (!btn) return;

  const iconOutline = btn.querySelector('.fav-icon-outline');
  const iconFilled  = btn.querySelector('.fav-icon-filled');

  function updateFavBtn(faved) {
    if (faved) {
      btn.title = 'お気に入りから削除';
      btn.classList.add('faved');
      if (iconOutline) iconOutline.hidden = true;
      if (iconFilled)  iconFilled.hidden  = false;
    } else {
      btn.title = 'お気に入りに追加';
      btn.classList.remove('faved');
      if (iconOutline) iconOutline.hidden = false;
      if (iconFilled)  iconFilled.hidden  = true;
    }
  }

  updateFavBtn(isFavorite(videoId));
  btn.hidden = false;

  btn.onclick = () => {
    const faved = toggleFavorite({
      videoId,
      title: meta.title || '',
      author: meta.author || '',
      authorId: meta.authorId || '',
      authorThumbnails: meta.authorThumbnails || null,
      lengthSeconds: meta.lengthSeconds || 0,
      videoThumbnails: meta.videoThumbnails || null,
      viewCount: meta.viewCount || 0,
      publishedText: meta.publishedText || ''
    });
    updateFavBtn(faved);
  };
}

function initShareBtn(videoId) {
  const btn = document.getElementById('watchShareBtn');
  const panel = document.getElementById('watchSharePanel');
  if (!btn || !panel) return;
  btn.removeAttribute('hidden');
  if (btn.dataset.shareInit) return;
  btn.dataset.shareInit = '1';
  setupSharePanel(btn, panel, () => {
    const vid = (new URLSearchParams(location.search)).get('v') || videoId;
    return {
      videoId: vid,
      ytUrl: `https://www.youtube.com/watch?v=${vid}`,
      appUrl: location.href,
      title: document.title,
    };
  });
}

function initDownloadBtn(videoId, meta) {
  const btn = document.getElementById('watchDlBtn');
  const backdrop = document.getElementById('dlModalBackdrop');
  const closeBtn = document.getElementById('dlModalClose');
  const body = document.getElementById('dlModalBody');
  if (!btn || !backdrop || !body) return;

  btn.removeAttribute('hidden');
  if (btn.dataset.dlInit) return;
  btn.dataset.dlInit = '1';

  function buildModalContent() {
    body.innerHTML = '';
    const latestMeta = currentVideoMeta || meta;
    const latestVideoId = (new URLSearchParams(location.search)).get('v') || videoId;
    const safeTitle = (latestMeta.title || latestVideoId).replace(/[/\\?%*:|"<>]/g, '_').substring(0, 80);
    const sd = currentStreamData || {};

    const formatStreams = sd.formatStreams || [];
    const adaptiveFormats = sd.adaptiveFormats || [];
    const videoFormats = adaptiveFormats.filter(f => f.type && f.type.startsWith('video/'));
    const audioFormats = adaptiveFormats.filter(f => f.type && f.type.startsWith('audio/'));

    function makeSection(title, svgIcon) {
      const sec = document.createElement('div');
      sec.className = 'dl-section';
      sec.innerHTML = `<div class="dl-section-title">${svgIcon}${escapeHtml(title)}</div>`;
      return sec;
    }

    const COMBINED_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="2" y="3" width="20" height="14" rx="2"/><polygon points="10 8 16 11 10 14 10 8" fill="currentColor" stroke="none"/><path d="M8 21h8M12 17v4"/></svg>`;
    const VIDEO_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="2" y="4" width="15" height="16" rx="2"/><path d="M17 8l5 4-5 4V8z"/></svg>`;
    const AUDIO_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
    const THUMB_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;

    if (formatStreams.length > 0) {
      const sec = makeSection('通常ストリーム（映像＋音声）', COMBINED_ICON);
      const preferred = ['1080p60','1080p','720p60','720p','480p','360p','240p','144p'];
      const sorted = [...formatStreams].sort((a, b) => {
        const ai = preferred.indexOf(a.qualityLabel); const bi = preferred.indexOf(b.qualityLabel);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
      sorted.forEach(fmt => {
        const quality = fmt.qualityLabel || fmt.quality || '?';
        const codec = getStreamCodecLabel(fmt);
        const ext = getStreamExt(fmt);
        const sub = codec ? `${codec} · ${ext.toUpperCase()}` : ext.toUpperCase();
        sec.appendChild(makeDlRow(quality, sub, fmt.url));
      });
      body.appendChild(sec);
    }

    if (videoFormats.length > 0) {
      function videoHeight(f) {
        const n = parseInt(f.qualityLabel); if (n) return n;
        const m = (f.size || '').match(/x(\d+)/); return m ? parseInt(m[1]) : 0;
      }
      const CODEC_PREF = { 'H.264': 0, 'VP9': 1, 'AV1': 2 };
      const sortedV = [...videoFormats].sort((a, b) => {
        const hd = videoHeight(b) - videoHeight(a); if (hd !== 0) return hd;
        return (CODEC_PREF[getStreamCodecLabel(a)] ?? 9) - (CODEC_PREF[getStreamCodecLabel(b)] ?? 9);
      });
      const sec = makeSection('映像のみ（音声なし）', VIDEO_ICON);
      sortedV.forEach(fmt => {
        const fps = fmt.fps ? ` ${fmt.fps}fps` : '';
        const quality = `${fmt.qualityLabel || '?'}${fps}`;
        const codec = getStreamCodecLabel(fmt);
        const ext = getStreamExt(fmt);
        const sub = codec ? `${codec} · ${ext.toUpperCase()}` : ext.toUpperCase();
        sec.appendChild(makeDlRow(quality, sub, fmt.url));
      });
      body.appendChild(sec);
    }

    if (audioFormats.length > 0) {
      const sortedA = [...audioFormats].sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
      const sec = makeSection('音声のみ', AUDIO_ICON);
      sortedA.forEach(fmt => {
        const kbps = fmt.bitrate ? `${Math.round(parseInt(fmt.bitrate) / 1000)}kbps` : '?';
        const codec = getStreamCodecLabel(fmt);
        const ext = getStreamExt(fmt);
        const sub = codec ? `${codec} · ${ext.toUpperCase()}` : ext.toUpperCase();
        sec.appendChild(makeDlRow(kbps, sub, fmt.url));
      });
      body.appendChild(sec);
    }

    const thumbSec = makeSection('サムネイル', THUMB_ICON);
    const thumbDefs = [
      { label: 'maxres (1280×720)', key: 'maxresdefault', url: `https://i.ytimg.com/vi/${latestVideoId}/maxresdefault.jpg` },
      { label: 'hq (480×360)', key: 'hqdefault', url: `https://i.ytimg.com/vi/${latestVideoId}/hqdefault.jpg` },
      { label: 'mq (320×180)', key: 'mqdefault', url: `https://i.ytimg.com/vi/${latestVideoId}/mqdefault.jpg` },
      { label: 'sd (640×480)', key: 'sddefault', url: `https://i.ytimg.com/vi/${latestVideoId}/sddefault.jpg` },
    ];
    if (latestMeta.videoThumbnails && latestMeta.videoThumbnails.length > 0) {
      const apiThumbs = [...latestMeta.videoThumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
      const seen = new Set();
      apiThumbs.forEach(t => {
        if (!t.url || seen.has(t.url)) return;
        seen.add(t.url);
        const w = t.width || '?'; const h = t.height || '?';
        const label = `${t.quality || ''} ${w}×${h}`.trim();
        thumbSec.appendChild(makeDlRow(label, 'JPG', buildDownloadUrl(t.url, `${safeTitle}_thumb_${w}x${h}.jpg`)));
      });
    } else {
      thumbDefs.forEach(td => {
        thumbSec.appendChild(makeDlRow(td.label, 'JPG', buildDownloadUrl(td.url, `${safeTitle}_thumb_${td.key}.jpg`)));
      });
    }
    body.appendChild(thumbSec);

    if (body.children.length === 0) {
      body.innerHTML = '<div class="dl-empty">ダウンロード可能なストリームがありません。</div>';
    }
  }

  btn.addEventListener('click', () => {
    buildModalContent();
    const latestVid = (new URLSearchParams(location.search)).get('v') || videoId;
    const existingPageLink = document.getElementById('dlModalPageLink');
    if (existingPageLink) existingPageLink.href = `/dl?v=${latestVid}`;
    backdrop.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
  });

  closeBtn.addEventListener('click', () => {
    backdrop.setAttribute('hidden', '');
    document.body.style.overflow = '';
  });

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      backdrop.setAttribute('hidden', '');
      document.body.style.overflow = '';
    }
  });
}

function renderVideoInfo(meta, videoId) {
  currentVideoMeta = meta;
  document.title = `${meta.title || '動画'} - Choco-tube-plus`;

  document.getElementById('infoSkeleton').hidden = true;
  const infoEl = document.getElementById('videoInfo');
  infoEl.removeAttribute('hidden');

  document.getElementById('watchTitle').textContent = meta.title || '';

  const views = formatViews(meta.viewCount);
  const date = meta.publishedText || '';
  const likes = meta.likeCount ? `👍 ${meta.likeCount.toLocaleString()}` : '';
  const metaParts = [views, date, likes].filter(Boolean);
  document.getElementById('watchMeta').innerHTML = metaParts.map((p, i) =>
    i < metaParts.length - 1
      ? `<span>${escapeHtml(p)}</span><span class="meta-sep">·</span>`
      : `<span>${escapeHtml(p)}</span>`
  ).join('');

  const channelId = meta.authorId || '';
  const channelLinkEl = document.getElementById('channelLink');
  if (channelId) {
    channelLinkEl.href = `/channel?id=${encodeURIComponent(channelId)}`;
  }

  document.getElementById('channelName').textContent = meta.author || '';

  const subs = meta.subCountText || (meta.subCount ? formatSubs(meta.subCount) : '');
  if (subs) {
    document.getElementById('channelSubs').textContent = `登録者 ${subs}`;
  }

  const thumbs = meta.authorThumbnails;
  const avatarEl = document.getElementById('channelAvatar');
  const placeholderEl = document.getElementById('channelAvatarPlaceholder');

  function showAvatar(iconUrl) {
    avatarEl.src = iconUrl;
    avatarEl.alt = meta.author || '';
    avatarEl.onload = () => {
      avatarEl.classList.add('loaded');
      avatarEl.removeAttribute('hidden');
      placeholderEl.setAttribute('hidden', '');
    };
  }

  if (thumbs && thumbs.length > 0) {
    showAvatar(getChannelIconUrl(thumbs));
  } else if (channelId) {
    fetchChannelAvatar(channelId).then(fetchedThumbs => {
      if (!fetchedThumbs || !avatarEl.isConnected) return;
      showAvatar(getChannelIconUrl(fetchedThumbs));
    });
  }

  document.getElementById('ytLink').href = `https://www.youtube.com/watch?v=${videoId}`;

  const watchSubBtn = document.getElementById('watchSubBtn');
  if (watchSubBtn && channelId) {
    updateWatchSubBtn(watchSubBtn, channelId);
    watchSubBtn.hidden = false;
    watchSubBtn.onclick = () => {
      const subscribed = toggleSubscription({
        authorId: channelId,
        author: meta.author || '',
        authorThumbnails: meta.authorThumbnails || [],
        subCountText: meta.subCountText || null,
        subCount: meta.subCount || null
      });
      updateWatchSubBtn(watchSubBtn, channelId, subscribed);
    };
  }

  initWatchPlaylistBtn(videoId, meta);
  initShareBtn(videoId);
  initDownloadBtn(videoId, meta);
  initFavBtn(videoId, meta);

  addHistory({
    videoId,
    title: meta.title || '',
    author: meta.author || '',
    authorId: channelId,
    lengthSeconds: meta.lengthSeconds || 0,
    videoThumbnails: meta.videoThumbnails || null
  });

  const rawHtml = meta.descriptionHtml || '';
  const rawText = meta.description || '';
  const descEl = document.getElementById('descriptionText');
  const toggleEl = document.getElementById('descToggle');
  const descWrap = document.getElementById('descriptionWrap');
  const formattedDesc = formatDescription(rawHtml, rawText);

  if (!formattedDesc.trim()) {
    descWrap.hidden = true;
  } else {
    descEl.innerHTML = formattedDesc;
    toggleEl.hidden = true;
    requestAnimationFrame(() => {
      if (descEl.scrollHeight > descEl.clientHeight + 4) {
        toggleEl.hidden = false;
        let isExpanded = false;
        toggleEl.addEventListener('click', () => {
          isExpanded = !isExpanded;
          if (isExpanded) {
            descEl.style.maxHeight = descEl.scrollHeight + 'px';
            toggleEl.textContent = '折りたたむ';
          } else {
            descEl.style.maxHeight = '';
            toggleEl.textContent = 'もっと見る';
          }
        });
      }
    });
  }
}

/* ===== COMMENTS ===== */
let currentSortBy = 'top';
let currentContinuation = null;
let commentsLoading = false;

function createCommentSkeleton() {
  const div = document.createElement('div');
  div.className = 'comment-skeleton';
  div.innerHTML = `
    <div class="cs-avatar"></div>
    <div class="cs-body">
      <div class="cs-line cs-name"></div>
      <div class="cs-line cs-t1"></div>
      <div class="cs-line cs-t2"></div>
      <div class="cs-line cs-t3"></div>
    </div>
  `;
  return div;
}

function createCommentItem(c) {
  const div = document.createElement('div');
  div.className = 'comment-item';

  const authorHref = c.authorId ? `/channel?id=${encodeURIComponent(c.authorId)}` : null;
  const thumbs = c.authorThumbnails;
  const iconUrl = thumbs && thumbs.length
    ? wsrv(thumbs[thumbs.length - 1].url || thumbs[0].url, 72)
    : '';

  const likesHtml = c.likeCount
    ? `<span class="comment-likes">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
        ${c.likeCount.toLocaleString()}
       </span>`
    : '';

  const repliesHtml = c.replyCount
    ? `<span class="comment-replies">返信 ${c.replyCount}</span>`
    : '';

  div.innerHTML = `
    <div class="comment-avatar-wrap">
      ${iconUrl
        ? `<img class="comment-avatar" src="${iconUrl}" alt="${escapeHtml(c.author || '')}" loading="lazy" onload="this.classList.add('loaded')" />`
        : `<div class="comment-avatar-placeholder"></div>`
      }
    </div>
    <div class="comment-body">
      <div class="comment-header">
        ${authorHref
          ? `<a class="comment-author${c.authorVerified ? ' verified' : ''}" href="${authorHref}">${escapeHtml(c.author || '')}</a>`
          : `<span class="comment-author${c.authorVerified ? ' verified' : ''}">${escapeHtml(c.author || '')}</span>`
        }
        ${c.publishedText ? `<span class="comment-date">${escapeHtml(c.publishedText)}</span>` : ''}
        ${c.isPinned ? `<span class="comment-pinned">📌 固定</span>` : ''}
      </div>
      <div class="comment-text">${escapeHtml(c.content || '')}</div>
      <div class="comment-footer">${likesHtml}${repliesHtml}</div>
    </div>
  `;
  return div;
}

function showCommentSkeletons(count = 6) {
  const list = document.getElementById('commentsList');
  for (let i = 0; i < count; i++) list.appendChild(createCommentSkeleton());
}

function removeCommentSkeletons() {
  document.querySelectorAll('.comment-skeleton').forEach(el => el.remove());
}

async function loadComments(videoId, sortBy, continuation = null, append = false) {
  if (commentsLoading) return;
  commentsLoading = true;

  const list = document.getElementById('commentsList');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  loadMoreBtn.disabled = true;

  if (!append) {
    list.innerHTML = '';
    showCommentSkeletons(6);
  } else {
    showCommentSkeletons(3);
  }

  try {
    let url = `/api/comments/${videoId}?sort_by=${sortBy}`;
    if (continuation) url += `&continuation=${encodeURIComponent(continuation)}`;

    const data = await withRetry(() => fetchMain(url), 10);
    removeCommentSkeletons();

    if (!append && data.commentCount) {
      const countEl = document.getElementById('commentCount');
      countEl.textContent = `(${Number(data.commentCount).toLocaleString()})`;
    }

    const comments = data.comments || [];
    if (comments.length === 0 && !append) {
      list.innerHTML = '<p style="color:var(--muted);font-size:.85rem;padding:0.5rem 0;">コメントはありません。</p>';
    } else {
      comments.forEach(c => list.appendChild(createCommentItem(c)));
    }

    currentContinuation = data.continuation || null;
    if (currentContinuation) {
      loadMoreWrap.hidden = false;
      loadMoreBtn.disabled = false;
    } else {
      loadMoreWrap.hidden = true;
    }
  } catch (e) {
    removeCommentSkeletons();
    if (!append) {
      list.innerHTML = '<p style="color:var(--muted);font-size:.85rem;padding:0.5rem 0;">コメントの取得に失敗しました。</p>';
    }
    loadMoreWrap.hidden = true;
    console.error('comments error:', e);
  }

  commentsLoading = false;
}

function initComments(videoId) {
  const sortBtns = document.querySelectorAll('.sort-btn');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  sortBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.sort === currentSortBy) return;
      sortBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSortBy = btn.dataset.sort;
      currentContinuation = null;
      document.getElementById('commentCount').textContent = '';
      loadComments(videoId, currentSortBy);
    });
  });

  loadMoreBtn.addEventListener('click', () => {
    loadComments(videoId, currentSortBy, currentContinuation, true);
  });

  loadComments(videoId, currentSortBy);
}

/* ===== TRANSCRIPT / CAPTIONS ===== */
let transcriptTracks = [];
let currentLang = null;
let activeTranscriptLine = null;

function tsToSeconds(val) {
  if (!val && val !== 0) return 0;
  if (typeof val === 'number') {
    return val > 10000 ? val / 1000 : val;
  }
  return parseFloat(val) || 0;
}

function formatTs(secs) {
  secs = Math.floor(secs);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function highlightTranscriptLine(player) {
  if (!transcriptTracks.length) return;
  const time = player.currentTime;
  const lines = document.querySelectorAll('.transcript-line[data-start]');
  let best = null;
  lines.forEach(line => {
    const start = parseFloat(line.dataset.start);
    const end = parseFloat(line.dataset.end);
    if (time >= start && time < end) best = line;
  });
  if (best && best !== activeTranscriptLine) {
    if (activeTranscriptLine) activeTranscriptLine.classList.remove('active');
    best.classList.add('active');
    activeTranscriptLine = best;
    const container = document.getElementById('transcriptContent');
    if (container) {
      const topOfLine = best.offsetTop;
      const containerMid = container.clientHeight / 2;
      container.scrollTo({ top: topOfLine - containerMid, behavior: 'smooth' });
    }
  }
}

async function loadTranscript(videoId, lang, langBtns) {
  const content = document.getElementById('transcriptContent');
  content.innerHTML = '<div class="transcript-loading"><div class="transcript-spinner"></div>読み込み中...</div>';

  langBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.lang === lang));
  currentLang = lang;
  activeTranscriptLine = null;

  // find source for this lang
  const activeBtn = langBtns.find(b => b.dataset.lang === lang);
  const source = activeBtn ? (activeBtn.dataset.source || 'auto') : 'auto';

  try {
    const res = await fetch(`/api/transcript-data/${encodeURIComponent(videoId)}?lang=${encodeURIComponent(lang)}&source=${encodeURIComponent(source)}`);
    const data = await res.json();
    const lines = Array.isArray(data) ? data : (data.transcript || data.captions || []);

    if (!lines.length) {
      content.innerHTML = '<div class="transcript-empty">このトラックにはテキストがありません。</div>';
      return;
    }

    content.innerHTML = '';
    lines.forEach((line, i) => {
      const startSec = tsToSeconds(line.start);
      const nextLine = lines[i + 1];
      const endSec = nextLine ? tsToSeconds(nextLine.start) : startSec + tsToSeconds(line.duration || 5);

      const div = document.createElement('div');
      div.className = 'transcript-line';
      div.dataset.start = startSec;
      div.dataset.end = endSec;
      div.innerHTML = `
        <span class="transcript-ts">${formatTs(startSec)}</span>
        <span class="transcript-text">${escapeHtml(line.text || '')}</span>
      `;
      div.addEventListener('click', () => {
        const player = document.getElementById('videoPlayer');
        if (player) {
          player.currentTime = startSec;
          player.play().catch(() => {});
          player.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
      content.appendChild(div);
    });

    const player = document.getElementById('videoPlayer');
    if (player && !player.dataset.transcriptBound) {
      player.dataset.transcriptBound = '1';
      player.addEventListener('timeupdate', () => highlightTranscriptLine(player));
    }

  } catch (e) {
    content.innerHTML = '<div class="transcript-empty">トランスクリプトの取得に失敗しました。</div>';
    console.error('transcript error:', e);
  }
}

async function initTranscript(videoId) {
  const section = document.getElementById('transcriptSection');
  const body = document.getElementById('transcriptBody');
  const header = document.getElementById('transcriptHeader');
  const chevron = document.querySelector('.transcript-chevron');
  const langsEl = document.getElementById('transcriptLangs');

  if (!section || !body) return;

  try {
    const res = await fetch(`/api/transcript-langs/${encodeURIComponent(videoId)}`);
    const data = await res.json();
    const tracks = Array.isArray(data) ? data : (data.tracks || []);

    if (!tracks.length) return;

    transcriptTracks = tracks;
    section.removeAttribute('hidden');

    const langBtns = [];
    tracks.forEach(track => {
      const langCode = track.language_code || track.languageCode || '';
      const label = track.label || langCode || '?';
      const source = track.source || 'auto';
      const isGenerated = track.is_generated || false;

      const btn = document.createElement('button');
      btn.className = 'lang-btn';
      btn.dataset.lang = langCode;
      btn.dataset.source = source;

      // label + auto-generated badge
      const nameSpan = document.createElement('span');
      nameSpan.textContent = label;
      btn.appendChild(nameSpan);
      if (isGenerated) {
        const badge = document.createElement('span');
        badge.className = 'lang-badge lang-badge-auto';
        badge.textContent = '自動';
        btn.appendChild(badge);
      }
      if (source === 'yta') {
        const badge = document.createElement('span');
        badge.className = 'lang-badge lang-badge-yta';
        badge.textContent = 'YT';
        btn.appendChild(badge);
      }

      btn.addEventListener('click', () => {
        if (!body.hidden && btn.dataset.lang === currentLang) return;
        if (body.hidden) {
          body.removeAttribute('hidden');
          chevron.classList.add('open');
        }
        loadTranscript(videoId, btn.dataset.lang, langBtns);
      });
      langBtns.push(btn);
      langsEl.appendChild(btn);
    });

    header.addEventListener('click', (e) => {
      if (e.target.closest('.lang-btn')) return;
      const isOpen = !body.hidden;
      if (isOpen) {
        body.setAttribute('hidden', '');
        chevron.classList.remove('open');
      } else {
        body.removeAttribute('hidden');
        chevron.classList.add('open');
        if (!currentLang && langBtns.length > 0) {
          loadTranscript(videoId, langBtns[0].dataset.lang, langBtns);
        }
      }
    });

  } catch (e) {
    console.error('captions error:', e);
  }
}

const PLAYLIST_CACHE_TTL = 30 * 60 * 1000;

function getPlaylistCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > PLAYLIST_CACHE_TTL) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function setPlaylistCache(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

async function initPlaylistPanel(playlistId, globalIndex) {
  const panel = document.getElementById('playlistPanel');
  panel.hidden = false;

  const PLAYLIST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
  const PLAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

  function renderPanelItems(panel, videos, activeIndex, buildHref) {
    const listEl = panel.querySelector('#plPanelList');
    listEl.innerHTML = '';
    const total = videos.length;

    videos.forEach((video, i) => {
      const isActive = i === activeIndex;
      const href = buildHref(video, i);
      const thumb = getThumbnailUrl(video.videoId);
      const dur = formatDuration(video.lengthSeconds);

      const item = document.createElement('a');
      item.className = `pl-panel-item${isActive ? ' active' : ''}`;
      item.href = href;
      item.innerHTML = `
        <span class="pl-panel-num">${isActive ? PLAY_SVG : i + 1}</span>
        <div class="pl-panel-thumb-wrap">
          <img class="pl-panel-thumb" src="${thumb}" alt="" loading="lazy" onload="this.classList.add('loaded')" />
          ${dur ? `<span class="pl-panel-dur">${dur}</span>` : ''}
        </div>
        <div class="pl-panel-item-info">
          <div class="pl-panel-item-title">${escapeHtml(video.title || '')}</div>
          <div class="pl-panel-item-ch">${escapeHtml(video.author || '')}</div>
        </div>
      `;
      listEl.appendChild(item);
    });

    const activeEl = listEl.querySelector('.pl-panel-item.active');
    if (activeEl) {
      setTimeout(() => activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 100);
    }

    if (activeIndex + 1 < total) {
      const nextVideo = videos[activeIndex + 1];
      const nextUrl = buildHref(nextVideo, activeIndex + 1);
      document.getElementById('videoPlayer').addEventListener('ended', () => {
        if (getSettings().autoplayNext) {
          window.location.href = nextUrl;
        }
      });
    }
  }

  /* ---- ユーザー自作プレイリスト (pl_xxxxx) ---- */
  if (playlistId.startsWith('pl_')) {
    const pl = getPlaylist(playlistId);
    if (!pl) {
      panel.innerHTML = `<div class="pl-panel-error">プレイリストが見つかりません</div>`;
      return;
    }
    const videos = pl.videos;
    const idx = Math.max(globalIndex, 0);
    const total = videos.length;

    panel.innerHTML = `
      <div class="pl-panel">
        <div class="pl-panel-header">
          <div class="pl-panel-label-row">
            ${PLAYLIST_SVG}
            <span>マイプレイリスト</span>
            <a class="pl-panel-all-link" href="/library">ライブラリへ</a>
          </div>
          <div class="pl-panel-title">${escapeHtml(pl.name)}</div>
          <div class="pl-panel-progress">${idx >= 0 ? `${idx + 1} / ${total}` : `${total}本の動画`}</div>
        </div>
        <div class="pl-panel-list" id="plPanelList"></div>
      </div>
    `;

    renderPanelItems(panel, videos, idx, (video, i) =>
      `/watch?v=${video.videoId}&list=${encodeURIComponent(playlistId)}&index=${i}`
    );
    return;
  }

  /* ---- Invidious プレイリスト ---- */
  const page = Math.floor(Math.max(globalIndex, 0) / 100) + 1;
  const indexOnPage = Math.max(globalIndex, 0) % 100;

  panel.innerHTML = `
    <div class="pl-panel">
      <div class="pl-panel-header">
        <div class="pl-panel-label-row">
          ${PLAYLIST_SVG}
          <span>再生リスト</span>
        </div>
        <div class="pl-panel-title sk-line" style="height:14px;width:80%;margin-top:0.4rem;"></div>
        <div class="sk-line" style="height:11px;width:40%;margin-top:0.3rem;"></div>
      </div>
      <div class="pl-panel-list" id="plPanelList">
        ${[...Array(5)].map(() => `
          <div class="pl-panel-item-sk">
            <div class="pl-panel-sk-num sk-line"></div>
            <div class="pl-panel-sk-thumb skeleton-animate"></div>
            <div class="pl-panel-sk-info">
              <div class="sk-line" style="height:12px;width:90%"></div>
              <div class="sk-line" style="height:10px;width:55%;margin-top:0.3rem"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  try {
    const cacheKey = `plCache_${playlistId}_${page}`;
    let data = getPlaylistCache(cacheKey);
    if (!data) {
      data = await withRetry(() => fetchMain(`/api/playlists/${encodeURIComponent(playlistId)}?page=${page}`), 10);
      if (data && data.videos && data.videos.length > 0) setPlaylistCache(cacheKey, data);
    }
    const videos = data.videos || [];
    const totalVideos = data.videoCount || videos.length;
    const pageOffset = (page - 1) * 100;

    const header = panel.querySelector('.pl-panel-header');
    header.innerHTML = `
      <div class="pl-panel-label-row">
        ${PLAYLIST_SVG}
        <span>再生リスト</span>
        <a class="pl-panel-all-link" href="/playlist?list=${encodeURIComponent(playlistId)}">全て見る</a>
      </div>
      <div class="pl-panel-title">${escapeHtml(data.title || '')}</div>
      <div class="pl-panel-progress">${globalIndex >= 0 ? `${globalIndex + 1} / ${totalVideos}` : `${totalVideos}本の動画`}</div>
    `;

    renderPanelItems(panel, videos, indexOnPage, (video, i) =>
      `/watch?v=${video.videoId}&list=${encodeURIComponent(playlistId)}&index=${pageOffset + i}`
    );

  } catch (e) {
    console.error('playlist panel error:', e);
    panel.innerHTML = `<div class="pl-panel-error">再生リストの取得に失敗しました</div>`;
  }
}

let streamExcludeList = [];
let reloadAllInProgress = false;
let streamAltBarReady = false;

async function reloadAll(videoId) {
  if (reloadAllInProgress) return;
  reloadAllInProgress = true;

  const reloadAllBtn = document.getElementById('reloadAllBtn');
  if (reloadAllBtn) reloadAllBtn.disabled = true;

  streamExcludeList = [];
  streamAltBarReady = false;
  lastStreamSrc = '';
  lastNormalStreamSrc = '';
  streamOnlyMode = 'normal';
  streamBestAudioUrl = '';
  streamAudioFormats = [];
  streamVideoFormats = [];
  const _resetPw = document.getElementById('playerWrap');
  if (_resetPw) _resetPw.classList.remove('stream-audio-only');
  const _resetAtb = document.getElementById('audioTrackBar');
  if (_resetAtb) _resetAtb.setAttribute('hidden', '');
  const _resetVtb = document.getElementById('videoTrackBar');
  if (_resetVtb) _resetVtb.setAttribute('hidden', '');
  cachedInvInstance = null;
  setInstanceLabel(null);
  document.getElementById('streamAltBtn').setAttribute('hidden', '');

  teardownHQ();

  const player = document.getElementById('videoPlayer');
  const nocookiePlayer = document.getElementById('nocookiePlayer');
  const skeleton = document.getElementById('playerSkeleton');
  const errorEl = document.getElementById('playerError');
  const reloadBtn = document.getElementById('reloadBtn');
  const modeStream = document.getElementById('modeStream');
  const modeNocookie = document.getElementById('modeNocookie');
  const modeHQ = document.getElementById('modeHQ');

  player.pause();
  player.src = '';
  player.setAttribute('hidden', '');
  nocookiePlayer.src = 'about:blank';
  nocookiePlayer.setAttribute('hidden', '');
  modeStream.classList.add('active');
  modeNocookie.classList.remove('active');
  if (modeHQ) modeHQ.classList.remove('active');
  skeleton.removeAttribute('hidden');
  errorEl.hidden = true;
  reloadBtn.hidden = true;

  const qualityBtns = document.getElementById('qualityBtns');
  qualityBtns.innerHTML = '<span id="qualityLoading" class="quality-loading">読み込み中...</span>';

  const altStatus = document.getElementById('streamAltStatus');
  if (altStatus) { altStatus.textContent = ''; altStatus.className = 'pc-alt-status'; }
  const altBtn = document.getElementById('streamAltBtn');
  if (altBtn) { altBtn.disabled = false; altBtn.setAttribute('hidden', ''); }

  document.getElementById('infoSkeleton').hidden = false;
  document.getElementById('videoInfo').setAttribute('hidden', '');

  const relatedList = document.getElementById('relatedList');
  relatedList.innerHTML = '';
  for (let i = 0; i < 8; i++) relatedList.appendChild(createRelatedSkeleton());

  currentSortBy = 'top';
  currentContinuation = null;
  commentsLoading = false;
  document.getElementById('commentCount').textContent = '';
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === 'top'));
  document.getElementById('commentsList').innerHTML = '';
  loadComments(videoId, currentSortBy);

  transcriptTracks = [];
  currentLang = null;
  activeTranscriptLine = null;
  const transcriptSection = document.getElementById('transcriptSection');
  transcriptSection.setAttribute('hidden', '');
  document.getElementById('transcriptBody').setAttribute('hidden', '');
  document.querySelector('.transcript-chevron')?.classList.remove('open');
  document.getElementById('transcriptLangs').innerHTML = '';
  document.getElementById('transcriptContent').innerHTML = '';

  try {
    const [streamResult, metaData] = await Promise.all([
      withRetry(() => fetchStream(`/api/stream/${videoId}`)),
      withRetry(() => fetchMain(`/api/videos/${videoId}`))
    ]);

    const { data: streamData, instanceUrl } = streamResult;
    const invInstance = instanceUrl || streamData._invidious_instance || null;
    streamExcludeList = invInstance ? [invInstance] : [];
    cachedInvInstance = invInstance;
    streamAltBarReady = true;
    if (isStreamModeActive()) {
      document.getElementById('streamAltBtn').removeAttribute('hidden');
      setInstanceLabel(invInstance);
    }
    setHQInstanceLabel(invInstance);

    setupPlayer(streamData, videoId);
    renderVideoInfo(metaData, videoId);
    renderRelated(metaData.recommendedVideos || []);
  } catch (e) {
    console.error(e);
  }

  initTranscript(videoId);

  reloadAllInProgress = false;
  if (reloadAllBtn) reloadAllBtn.disabled = false;
}

function instanceHostname(invInstance) {
  if (!invInstance) return '';
  try { return new URL(invInstance).hostname; } catch { return invInstance; }
}

function setInstanceLabel(invInstance) {
  const label = document.getElementById('streamInstanceLabel');
  if (!label) return;
  label.textContent = instanceHostname(invInstance);
}

function setHQInstanceLabel(invInstance) {
  const label = document.getElementById('hqInstanceLabel');
  if (!label) return;
  label.textContent = instanceHostname(invInstance);
}

async function doStreamAlt(videoId, restoreTime = 0) {
  const btn = document.getElementById('streamAltBtn');
  const status = document.getElementById('streamAltStatus');
  const shouldShowStatus = () => isStreamModeActive();

  if (btn) btn.disabled = true;
  if (status && shouldShowStatus()) { status.textContent = '読み込み中...'; status.className = 'pc-alt-status'; }

  try {
    const excludeParam = streamExcludeList.length
      ? '?exclude=' + encodeURIComponent(streamExcludeList.join(','))
      : '';
    const result = await fetchStream(`/api/stream/${videoId}${excludeParam}`);

    const { data: newStreamData, instanceUrl: newInstanceUrl } = result;

    const newInvInstance = newInstanceUrl || newStreamData._invidious_instance || null;
    if (newInvInstance && !streamExcludeList.includes(newInvInstance)) {
      streamExcludeList.push(newInvInstance);
    }

    if (!isStreamModeActive()) return;

    const player = document.getElementById('videoPlayer');
    const skeleton = document.getElementById('playerSkeleton');
    const errorEl = document.getElementById('playerError');
    const qualityBtns = document.getElementById('qualityBtns');

    skeleton.hidden = true;
    errorEl.hidden = true;

    qualityBtns.innerHTML = '';

    const formats = newStreamData.formatStreams || [];
    if (formats.length === 0) {
      if (isStreamModeActive()) {
        errorEl.hidden = false;
        document.getElementById('playerErrorMsg').textContent = 'このAPIではストリームURLが取得できませんでした。';
        if (status) { status.textContent = 'ストリームURLなし'; status.className = 'pc-alt-status stream-alt-fail'; }
      }
    } else {
      setInstanceLabel(newInvInstance);
      streamOnlyMode = 'normal';
      const _dsPw = document.getElementById('playerWrap');
      if (_dsPw) _dsPw.classList.remove('stream-audio-only');
      const _dsAtb = document.getElementById('audioTrackBar');
      if (_dsAtb) _dsAtb.setAttribute('hidden', '');
      const _dsVtb = document.getElementById('videoTrackBar');
      if (_dsVtb) _dsVtb.setAttribute('hidden', '');
      const bestFormat = setupQualities(formats);
      if (bestFormat) {
        lastNormalStreamSrc = bestFormat.url;
        player.src = bestFormat.url;
        player.muted = volState.muted;
        if (restoreTime > 0) player.currentTime = restoreTime;
        const vcQualBtn2 = document.getElementById('vcQualBtn');
        if (vcQualBtn2) vcQualBtn2.textContent = bestFormat.qualityLabel || bestFormat.quality || '画質';
        const firstOpt2 = document.querySelector('#vcQualOpts .vctrls-dd-opt');
        if (firstOpt2) firstOpt2.classList.add('active');
        document.querySelectorAll('#qualityBtns .quality-btn-track[data-track-mode="normal"]').forEach(b => b.classList.add('active'));
        if (isStreamModeActive()) {
          player.removeAttribute('hidden');
          tryAutoplay(player, null);
        }
      }
      setupStreamOnlyBtns();
      if (status && isStreamModeActive()) {
        status.textContent = '読み込み完了';
        status.className = 'pc-alt-status stream-alt-ok';
        setTimeout(() => { status.textContent = ''; status.className = 'pc-alt-status'; }, 2500);
      }
    }
  } catch (e) {
    if (status && shouldShowStatus()) { status.textContent = '取得に失敗しました'; status.className = 'pc-alt-status stream-alt-fail'; }
    throw e;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function initStreamAltBtn(videoId) {
  const btn = document.getElementById('streamAltBtn');
  if (!btn) return;
  btn.addEventListener('click', () => doStreamAlt(videoId));
}

function fmtTime(s) {
  s = Math.floor(s) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function setSliderfill(el) {
  const pct = ((parseFloat(el.value) - parseFloat(el.min)) / (parseFloat(el.max) - parseFloat(el.min)) * 100).toFixed(2) + '%';
  el.style.setProperty('--pct', pct);
}

function initCustomControls() {
  const player      = document.getElementById('videoPlayer');
  const playerWrap  = document.getElementById('playerWrap');
  const vctrls      = document.getElementById('vctrls');
  const vcPlay      = document.getElementById('vcPlay');
  const vcMute      = document.getElementById('vcMute');
  const vcVol       = document.getElementById('vcVol');
  const vcSeek      = document.getElementById('vcSeek');
  const vcBuf       = document.getElementById('vcBuf');
  const vcTime      = document.getElementById('vcTime');
  const vcFs        = document.getElementById('vcFs');
  const vcSkipBack  = document.getElementById('vcSkipBack');
  const vcSkipFwd   = document.getElementById('vcSkipFwd');
  const vcCenterPlay  = document.getElementById('vcCenterPlay');
  const vcCenterIcon  = document.getElementById('vcCenterIcon');
  const vcSpeedWrap   = document.getElementById('vcSpeedWrap');
  const vcSpeedBtn    = document.getElementById('vcSpeedBtn');
  const vcSpeedPanel  = document.getElementById('vcSpeedPanel');
  const vcQualWrap    = document.getElementById('vcQualWrap');
  const vcHQVidWrap   = document.getElementById('vcHQVidWrap');
  const vcHQAudWrap   = document.getElementById('vcHQAudWrap');
  const kbBackdrop    = document.getElementById('kbModalBackdrop');
  const kbClose       = document.getElementById('kbModalClose');

  const IC = {
    play:    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><polygon points="5,3 19,12 5,21"/></svg>`,
    pause:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><rect x="6" y="3" width="4" height="18"/><rect x="14" y="3" width="4" height="18"/></svg>`,
    play_lg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="32" height="32"><polygon points="5,3 19,12 5,21"/></svg>`,
    pause_lg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><rect x="6" y="3" width="4" height="18"/><rect x="14" y="3" width="4" height="18"/></svg>`,
    volOn:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
    volLow:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
    volOff:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
    fsOn:    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`,
    fsOff:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`,
  };

  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];

  function audioEl() {
    return (hqActive && document.getElementById('hqAudio')) || player;
  }

  // ── Show / hide controls ──
  let hideTimer;
  let playerHovered = false;

  function isIframeMode() {
    const nc = document.getElementById('modeNocookie');
    const ed = document.getElementById('modeEdu');
    return (nc && nc.classList.contains('active')) || (ed && ed.classList.contains('active'));
  }

  function showCtrls() {
    if (isIframeMode()) return;
    vctrls.classList.add('vctrls-show');
    clearTimeout(hideTimer);
    if (!player.paused) {
      hideTimer = setTimeout(() => {
        if (!player.paused) {
          vctrls.classList.remove('vctrls-show');
          playerWrap.classList.add('ctrls-playing-hidden');
        }
      }, 3000);
    }
  }
  function keepCtrls() {
    if (isIframeMode()) return;
    vctrls.classList.add('vctrls-show');
    playerWrap.classList.remove('ctrls-playing-hidden');
    clearTimeout(hideTimer);
  }

  playerWrap.addEventListener('mousemove', () => { playerHovered = true; showCtrls(); });
  playerWrap.addEventListener('mouseenter', () => { playerHovered = true; showCtrls(); updateCenterShow(); });
  playerWrap.addEventListener('mouseleave', () => {
    playerHovered = false;
    vcCenterPlay.classList.remove('vctrls-center-show');
    if (!player.paused) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        vctrls.classList.remove('vctrls-show');
        playerWrap.classList.add('ctrls-playing-hidden');
      }, 800);
    }
  });
  vctrls.addEventListener('mouseenter', keepCtrls);
  vctrls.addEventListener('mousemove', keepCtrls);

  // ── Center play overlay (hover-only) ──
  function updateCenterIcon() {
    vcCenterIcon.innerHTML = player.paused ? IC.play_lg : IC.pause_lg;
  }
  function updateCenterShow() {
    if (isIframeMode() || !playerHovered || !player.paused) {
      vcCenterPlay.classList.remove('vctrls-center-show');
    } else {
      updateCenterIcon();
      vcCenterPlay.classList.add('vctrls-center-show');
    }
  }
  vcCenterIcon.addEventListener('click', () => {
    if (isIframeMode()) return;
    if (player.paused) player.play().catch(() => {});
    else player.pause();
  });

  // ── Skip flash indicator ──
  function makeFlash(side, sec) {
    const el = document.createElement('div');
    el.className = `vctrls-skip-flash flash-${side}`;
    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="22" height="22">${side === 'left'
      ? '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.54"/>'
      : '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-3.54"/>'
    }</svg><span>${sec}秒</span>`;
    playerWrap.appendChild(el);
    requestAnimationFrame(() => {
      el.classList.add('flashing');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    });
  }

  // ── Play / Pause ──
  function updatePlayBtn() {
    vcPlay.innerHTML = player.paused ? IC.play : IC.pause;
  }
  player.addEventListener('play', () => {
    updatePlayBtn();
    updateCenterShow();
    showCtrls();
  });
  player.addEventListener('pause', () => {
    updatePlayBtn();
    updateCenterShow();
    keepCtrls();
  });
  vcPlay.addEventListener('click', () => {
    if (player.paused) player.play().catch(() => {});
    else player.pause();
  });
  player.addEventListener('click', (e) => {
    if (e.target === player) vcPlay.click();
  });
  player.addEventListener('dblclick', (e) => {
    if (e.target === player) vcFs.click();
  });

  // ── Skip ──
  function doSkip(sec) {
    if (player.duration) {
      player.currentTime = Math.max(0, Math.min(player.duration, player.currentTime + sec));
      const audio = document.getElementById('hqAudio');
      if (hqActive && audio) audio.currentTime = player.currentTime;
    }
    makeFlash(sec < 0 ? 'left' : 'right', Math.abs(sec));
    showCtrls();
  }
  vcSkipBack.addEventListener('click', () => doSkip(-10));
  vcSkipFwd.addEventListener('click',  () => doSkip(10));

  // ── Volume ──
  function updateVolUI() {
    const ae = audioEl();
    const isMuted = ae.muted || ae.volume === 0;
    if (isMuted) vcMute.innerHTML = IC.volOff;
    else if (ae.volume < 0.5) vcMute.innerHTML = IC.volLow;
    else vcMute.innerHTML = IC.volOn;
    const displayVal = isMuted ? 0 : ae.volume;
    vcVol.value = displayVal;
    setSliderfill(vcVol);
  }
  vcMute.addEventListener('click', () => {
    const ae = audioEl();
    ae.muted = !ae.muted;
    if (!hqActive) player.muted = ae.muted;
    volState.muted = ae.muted;
    updateVolUI();
  });
  vcVol.addEventListener('input', () => {
    const val = parseFloat(vcVol.value);
    const ae = audioEl();
    ae.volume = val;
    ae.muted = val === 0;
    if (!hqActive) { player.volume = val; player.muted = val === 0; }
    volState.vol = val;
    volState.muted = val === 0;
    setSliderfill(vcVol);
    updateVolUI();
  });
  player.addEventListener('volumechange', () => { if (!hqActive) updateVolUI(); });

  player.addEventListener('autoplay-muted', (e) => {
    const ae = audioEl();
    ae.muted = true;
    if (!hqActive) player.muted = true;
    volState.muted = true;
    updateVolUI();
  });

  // ── Seek ──
  let isSeeking = false;
  function updateSeek() {
    if (isSeeking || !player.duration) return;
    const pct = player.currentTime / player.duration;
    vcSeek.value = Math.round(pct * 1000);
    setSliderfill(vcSeek);
    vcTime.textContent = `${fmtTime(player.currentTime)} / ${fmtTime(player.duration)}`;
    if (vcBuf && player.buffered.length) {
      const bufEnd = player.buffered.end(player.buffered.length - 1);
      vcBuf.style.width = ((bufEnd / player.duration) * 100).toFixed(2) + '%';
    }
  }
  player.addEventListener('timeupdate', updateSeek);
  player.addEventListener('progress', updateSeek);
  player.addEventListener('loadedmetadata', () => {
    vcSeek.max = 1000;
    updateSeek();
    vctrls.classList.add('vctrls-show');
    showCtrls();
  });
  vcSeek.addEventListener('mousedown', () => { isSeeking = true; });
  vcSeek.addEventListener('input', () => {
    setSliderfill(vcSeek);
    const pct = vcSeek.value / 1000;
    if (player.duration) vcTime.textContent = `${fmtTime(pct * player.duration)} / ${fmtTime(player.duration)}`;
  });
  vcSeek.addEventListener('change', () => {
    isSeeking = false;
    const pct = vcSeek.value / 1000;
    if (player.duration) {
      player.currentTime = pct * player.duration;
      const audio = document.getElementById('hqAudio');
      if (hqActive && audio) audio.currentTime = player.currentTime;
    }
  });

  // ── Generic dropdown helper ──
  function initDropdown(wrap) {
    const btn = wrap.querySelector('.vctrls-dd-btn');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = wrap.classList.contains('dd-open');
      closeAllDropdowns();
      if (!isOpen) wrap.classList.add('dd-open');
    });
  }
  function closeAllDropdowns() {
    document.querySelectorAll('.vctrls-dd-wrap.dd-open').forEach(w => w.classList.remove('dd-open'));
  }
  document.addEventListener('click', closeAllDropdowns);
  vctrls.addEventListener('click', (e) => e.stopPropagation());

  initDropdown(vcSpeedWrap);
  if (vcQualWrap) initDropdown(vcQualWrap);
  if (vcHQVidWrap) initDropdown(vcHQVidWrap);
  if (vcHQAudWrap) initDropdown(vcHQAudWrap);

  // ── Speed ──
  let currentSpeed = 1;
  function setSpeed(s) {
    currentSpeed = parseFloat(s);
    player.playbackRate = currentSpeed;
    const audio = document.getElementById('hqAudio');
    if (hqActive && audio) audio.playbackRate = currentSpeed;
    vcSpeedBtn.textContent = currentSpeed === 1 ? '1x' : currentSpeed + 'x';
    vcSpeedPanel.querySelectorAll('.vctrls-dd-opt').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.speed) === currentSpeed);
    });
    vcSpeedWrap.classList.remove('dd-open');
  }
  vcSpeedPanel.querySelectorAll('.vctrls-dd-opt').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); setSpeed(btn.dataset.speed); });
  });

  // Apply settings: default speed + loop + volume
  const _initSettings = getSettings();
  if (_initSettings.defaultSpeed !== 1) setSpeed(_initSettings.defaultSpeed);
  player.loop = listParam ? false : !!_initSettings.loop;

  // ── 再生設定アコーディオン + トグル ──
  {
    const PB_OPEN_KEY = 'choco_pb_settings_open';

    // アコーディオン要素
    const pbHeader = document.getElementById('playbackInfoHeader');
    const pbBody   = document.getElementById('playbackInfoBody');
    const pbToggle = document.getElementById('playbackInfoToggle');

    // 開閉状態を localStorage から復元
    let pbOpen = localStorage.getItem(PB_OPEN_KEY) === '1';
    function _pbApplyOpen(open) {
      pbOpen = open;
      if (pbBody)   { if (open) pbBody.removeAttribute('hidden'); else pbBody.setAttribute('hidden', ''); }
      if (pbToggle)  pbToggle.textContent = open ? '－' : '＋';
      if (pbHeader)  pbHeader.setAttribute('aria-expanded', open ? 'true' : 'false');
      try { localStorage.setItem(PB_OPEN_KEY, open ? '1' : '0'); } catch (_) {}
    }
    _pbApplyOpen(pbOpen);

    if (pbHeader) pbHeader.addEventListener('click', () => _pbApplyOpen(!pbOpen));

    // スイッチ状態ヘルパー
    function _pbSetState(btn, checked) {
      if (!btn) return;
      btn.setAttribute('aria-checked', checked ? 'true' : 'false');
      btn.setAttribute('data-state', checked ? 'checked' : 'unchecked');
      const thumb = btn.querySelector('.switch-thumb');
      if (thumb) thumb.setAttribute('data-state', checked ? 'checked' : 'unchecked');
    }

    const pbLoop        = document.getElementById('pbLoopToggle');
    const pbAutoplay    = document.getElementById('pbAutoplayToggle');
    const pbSavePos     = document.getElementById('pbSavePositionToggle');
    const pbAutoNext    = document.getElementById('pbAutoNextToggle');
    const pbLoopRow     = document.getElementById('pbLoopRow');
    const pbAutoNextRow = document.getElementById('pbAutoNextRow');

    // 初期値を反映
    const _ps = getSettings();
    _pbSetState(pbLoop,     !listParam && !!_ps.loop);
    _pbSetState(pbAutoplay, _ps.autoplay !== false);
    _pbSetState(pbSavePos,  !!_ps.savePosition);
    _pbSetState(pbAutoNext, !!_ps.autoplayNext);

    // プレイリスト中はループ・次へ自動を無効表示
    if (listParam) {
      if (pbLoopRow)     pbLoopRow.classList.add('disabled');
      if (pbAutoNextRow) pbAutoNextRow.classList.add('disabled');
    }

    // 設定保存ヘルパー
    function _pbPersist(updates) {
      saveSettings(Object.assign({}, getSettings(), updates));
    }

    // ループトグル
    if (pbLoop) pbLoop.addEventListener('click', () => {
      if (listParam) return;
      const next = pbLoop.getAttribute('data-state') !== 'checked';
      _pbSetState(pbLoop, next);
      player.loop = next;
      if (next) {
        _pbSetState(pbAutoNext, false);
        _pbPersist({ loop: true, autoplayNext: false });
      } else {
        _pbPersist({ loop: false });
      }
    });

    // 自動再生トグル
    if (pbAutoplay) pbAutoplay.addEventListener('click', () => {
      const next = pbAutoplay.getAttribute('data-state') !== 'checked';
      _pbSetState(pbAutoplay, next);
      _pbPersist({ autoplay: next });
    });

    // 位置保存トグル
    if (pbSavePos) pbSavePos.addEventListener('click', () => {
      const next = pbSavePos.getAttribute('data-state') !== 'checked';
      _pbSetState(pbSavePos, next);
      _pbPersist({ savePosition: next });
    });

    // 次へ自動トグル
    if (pbAutoNext) pbAutoNext.addEventListener('click', () => {
      if (listParam) return;
      const next = pbAutoNext.getAttribute('data-state') !== 'checked';
      _pbSetState(pbAutoNext, next);
      if (next) {
        _pbSetState(pbLoop, false);
        player.loop = false;
        _pbPersist({ autoplayNext: true, loop: false });
      } else {
        _pbPersist({ autoplayNext: false });
      }
    });
  }

  // ── 再生区間 (clip range) ──
  {
    const clipStartInput  = document.getElementById('clipStartInput');
    const clipEndInput    = document.getElementById('clipEndInput');
    const clipStartError  = document.getElementById('clipStartError');
    const clipEndError    = document.getElementById('clipEndError');
    const clipApplyBtn    = document.getElementById('clipApplyBtn');
    const clipClearBtn    = document.getElementById('clipClearBtn');
    const clipActiveLabel = document.getElementById('clipActiveLabel');

    function _clipUpdateActive() {
      if (!clipActiveLabel) return;
      if (_clipStartSec >= 0 || _clipEndSec >= 0) {
        const parts = [];
        if (_clipStartSec >= 0) parts.push('開始:' + _clipStartSec + 's');
        if (_clipEndSec >= 0)   parts.push('終了:' + _clipEndSec + 's');
        clipActiveLabel.textContent = '✓ ' + parts.join(' / ');
        clipActiveLabel.removeAttribute('hidden');
        if (clipClearBtn) clipClearBtn.removeAttribute('hidden');
      } else {
        clipActiveLabel.setAttribute('hidden', '');
        if (clipClearBtn) clipClearBtn.setAttribute('hidden', '');
      }
    }

    function _validateClipInputs() {
      let valid = true;
      if (clipStartInput && clipStartError) {
        const v = parseTimeSec(clipStartInput.value);
        const hasErr = clipStartInput.value !== '' && v < 0;
        if (hasErr) { clipStartError.removeAttribute('hidden'); valid = false; }
        else           clipStartError.setAttribute('hidden', '');
      }
      if (clipEndInput && clipEndError) {
        const v = parseTimeSec(clipEndInput.value);
        const hasErr = clipEndInput.value !== '' && v < 0;
        if (hasErr) { clipEndError.removeAttribute('hidden'); valid = false; }
        else           clipEndError.setAttribute('hidden', '');
      }
      return valid;
    }

    if (clipStartInput) clipStartInput.addEventListener('input', _validateClipInputs);
    if (clipEndInput)   clipEndInput.addEventListener('input',   _validateClipInputs);

    if (clipApplyBtn) clipApplyBtn.addEventListener('click', () => {
      if (!_validateClipInputs()) return;
      _clipStartSec = clipStartInput ? parseTimeSec(clipStartInput.value) : -1;
      _clipEndSec   = clipEndInput   ? parseTimeSec(clipEndInput.value)   : -1;
      const seekSec = _clipStartSec >= 0 ? _clipStartSec : 0;

      if (isExternalEmbedModeActive()) {
        // iframe モード: seekTo postMessage
        _sendIframeCmd('seekTo', [seekSec, true]);
      } else if (!player.hidden) {
        // ネイティブプレイヤー
        player.currentTime = seekSec;
        if (getSettings().autoplay) player.play().catch(() => {});
      }
      _clipUpdateActive();
    });

    if (clipClearBtn) clipClearBtn.addEventListener('click', () => {
      _clipStartSec = -1;
      _clipEndSec   = -1;
      if (clipStartInput) clipStartInput.value = '';
      if (clipEndInput)   clipEndInput.value   = '';
      if (clipStartError) clipStartError.setAttribute('hidden', '');
      if (clipEndError)   clipEndError.setAttribute('hidden', '');
      _clipUpdateActive();
    });

    // ネイティブプレイヤー: timeupdate で終了位置チェック
    player.addEventListener('timeupdate', function _clipTimeUpdate() {
      if (_clipEndSec >= 0 && player.currentTime >= _clipEndSec) {
        const _s = getSettings();
        const restartSec = _clipStartSec >= 0 ? _clipStartSec : 0;
        if (_s.loop && !player.loop) {
          // ループ設定ON・HTMLループOFF時はJS制御でループ
          player.currentTime = restartSec;
          player.play().catch(() => {});
        } else if (!_s.loop) {
          player.pause();
          player.currentTime = _clipEndSec;
        }
      }
    });
  }

  {
    const initVol = Math.max(0, Math.min(1, (_initSettings.defaultVolume ?? 100) / 100));
    const ae = audioEl();
    ae.volume = initVol;
    ae.muted = initVol === 0;
    player.volume = initVol;
    player.muted = initVol === 0;
    volState.vol = initVol;
    volState.muted = initVol === 0;
    vcVol.value = initVol;
    setSliderfill(vcVol);
    updateVolUI();
  }

  // ── Fullscreen ──
  function updateFsBtn() {
    vcFs.innerHTML = document.fullscreenElement ? IC.fsOff : IC.fsOn;
  }
  vcFs.addEventListener('click', () => {
    if (!document.fullscreenElement) playerWrap.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    updateFsBtn();
    if (document.fullscreenElement) showCtrls();
  });

  // ── Theater mode ──
  function toggleTheater() {
    document.body.classList.toggle('theater-mode');
  }

  // ── Picture-in-Picture ──
  function togglePiP() {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    } else if (player && !player.hidden) {
      player.requestPictureInPicture().catch(() => {});
    }
  }

  // ── Shortcut help modal ──
  function showKbModal() {
    if (kbBackdrop) kbBackdrop.removeAttribute('hidden');
  }
  function hideKbModal() {
    if (kbBackdrop) kbBackdrop.setAttribute('hidden', '');
  }
  const vcKbBtn = document.getElementById('vcKbBtn');
  if (vcKbBtn) vcKbBtn.addEventListener('click', showKbModal);
  if (kbClose) kbClose.addEventListener('click', hideKbModal);
  if (kbBackdrop) kbBackdrop.addEventListener('click', (e) => {
    if (e.target === kbBackdrop) hideKbModal();
  });

  // ── Keyboard shortcuts ──
  const FPS = 1 / 30;
  document.addEventListener('keydown', (e) => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (e.target.isContentEditable) return;
    if (kbBackdrop && !kbBackdrop.hidden) {
      if (e.key === 'Escape' || e.key === '?') { hideKbModal(); e.preventDefault(); }
      return;
    }
    if (player.hidden) return;

    switch (e.key) {
      case ' ':
      case 'k': case 'K':
        e.preventDefault();
        vcPlay.click();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        doSkip(e.shiftKey ? -10 : -5);
        break;
      case 'j': case 'J':
        e.preventDefault();
        doSkip(e.shiftKey ? -10 : -5);
        break;
      case 'ArrowRight':
        e.preventDefault();
        doSkip(e.shiftKey ? 10 : 5);
        break;
      case 'l': case 'L':
        e.preventDefault();
        doSkip(e.shiftKey ? 10 : 5);
        break;
      case 'ArrowUp':
        e.preventDefault();
        vcVol.value = Math.min(1, parseFloat(vcVol.value) + 0.1).toFixed(2);
        vcVol.dispatchEvent(new Event('input'));
        showCtrls();
        break;
      case 'ArrowDown':
        e.preventDefault();
        vcVol.value = Math.max(0, parseFloat(vcVol.value) - 0.1).toFixed(2);
        vcVol.dispatchEvent(new Event('input'));
        showCtrls();
        break;
      case 'm': case 'M':
        vcMute.click();
        showCtrls();
        break;
      case 'f': case 'F':
        vcFs.click();
        break;
      case 't': case 'T':
        toggleTheater();
        break;
      case 'p': case 'P':
        togglePiP();
        break;
      case ',':
        e.preventDefault();
        player.pause();
        player.currentTime = Math.max(0, player.currentTime - FPS);
        break;
      case '.':
        e.preventDefault();
        player.pause();
        player.currentTime = Math.min(player.duration || 0, player.currentTime + FPS);
        break;
      case '<':
        e.preventDefault();
        { const idx = SPEEDS.indexOf(currentSpeed);
          if (idx > 0) setSpeed(SPEEDS[idx - 1]); }
        break;
      case '>':
        e.preventDefault();
        { const idx = SPEEDS.indexOf(currentSpeed);
          if (idx < SPEEDS.length - 1) setSpeed(SPEEDS[idx + 1]); }
        break;
      case '?':
        e.preventDefault();
        showKbModal();
        break;
      default:
        if (e.key >= '0' && e.key <= '9' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          const pct = parseInt(e.key) / 10;
          if (player.duration) {
            player.currentTime = player.duration * pct;
            const audio = document.getElementById('hqAudio');
            if (hqActive && audio) audio.currentTime = player.currentTime;
          }
          showCtrls();
        }
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape' && kbBackdrop && !kbBackdrop.hidden) hideKbModal();
  });

  // ── Init ──
  updatePlayBtn();
  updateVolUI();
  updateFsBtn();
  updateCenterIcon();
  setSliderfill(vcVol);
  setSliderfill(vcSeek);
}

async function initWatch(videoId) {
  const relatedList = document.getElementById('relatedList');
  for (let i = 0; i < 8; i++) relatedList.appendChild(createRelatedSkeleton());

  const player = document.getElementById('videoPlayer');
  player.poster = getThumbnailUrl(videoId);

  initModeBar(videoId);
  initCustomControls();
  initComments(videoId);
  if (listParam) initPlaylistPanel(listParam, indexParam);

  let _homeVideoQueue = null;
  let _homeVideoQueueIdx = -1;
  if (!listParam) {
    try {
      const raw = sessionStorage.getItem('chHomeVideoQueue');
      if (raw) {
        const ids = JSON.parse(raw);
        if (Array.isArray(ids) && ids.length > 1) {
          const idx = ids.indexOf(videoId);
          if (idx >= 0) {
            _homeVideoQueue = ids;
            _homeVideoQueueIdx = idx;
          } else {
            sessionStorage.removeItem('chHomeVideoQueue');
          }
        }
      }
    } catch (_) {}
  }

  document.getElementById('reloadAllBtn').addEventListener('click', () => reloadAll(videoId));

  try {
    const [streamResult, metaData] = await Promise.all([
      withRetry(() => fetchStream(`/api/stream/${videoId}`)),
      withRetry(() => fetchMain(`/api/videos/${videoId}`))
    ]);

    const { data: streamData, instanceUrl } = streamResult;

    const invInstance = instanceUrl || streamData._invidious_instance || null;
    streamExcludeList = invInstance ? [invInstance] : [];
    cachedInvInstance = invInstance;
    streamAltBarReady = true;
    initStreamAltBtn(videoId);

    // Only show stream-specific UI if stream mode is currently active
    const isStreamModeActive = document.getElementById('modeStream').classList.contains('active');
    if (isStreamModeActive) {
      document.getElementById('streamAltBtn').removeAttribute('hidden');
      setInstanceLabel(invInstance);
    }
    setHQInstanceLabel(invInstance);

    setupPlayer(streamData, videoId);

    // ── 再生位置の復元と保存 ──
    {
      const _posPlayer = document.getElementById('videoPlayer');
      const _savedPos = getSavedPosition(videoId);
      if (getSettings().savePosition && _savedPos > 5) {
        _posPlayer.addEventListener('canplay', () => {
          if (_posPlayer.currentTime < 1) _posPlayer.currentTime = _savedPos;
        }, { once: true });
      }
      let _lastPosSave = 0;
      _posPlayer.addEventListener('timeupdate', () => {
        if (!getSettings().savePosition) return;
        const now = Date.now();
        if (now - _lastPosSave < 5000) return;
        _lastPosSave = now;
        const t = _posPlayer.currentTime;
        const dur = _posPlayer.duration;
        if (t > 5) {
          const durKnown = dur && isFinite(dur);
          if (!durKnown || t < dur - 5) {
            savePosition(videoId, t);
          } else {
            clearSavedPosition(videoId);
          }
        }
      });
      _posPlayer.addEventListener('ended', () => clearSavedPosition(videoId), { once: true });
    }

    renderVideoInfo(metaData, videoId);
    const _related = metaData.recommendedVideos || [];
    _relatedVideos = _related;
    renderRelated(_related);

    // Autoplay next (settings) — skip if in playlist/mix context
    if (!listParam) {
      const _player = document.getElementById('videoPlayer');
      _player.addEventListener('ended', () => {
        const _currentSettings = getSettings();
        if (_player.loop) return;
        if (!_currentSettings.autoplayNext) return;
        if (_homeVideoQueue && _homeVideoQueueIdx >= 0 && _homeVideoQueueIdx < _homeVideoQueue.length - 1) {
          window.location.href = `/watch?v=${encodeURIComponent(_homeVideoQueue[_homeVideoQueueIdx + 1])}`;
        } else if (_related.length > 0) {
          sessionStorage.removeItem('chHomeVideoQueue');
          window.location.href = `/watch?v=${_related[0].videoId}`;
        }
      });
    }

  } catch (e) {
    console.error(e);
    showWatchError('動画情報の取得に失敗しました。しばらく経ってから再試行してください。', false);
  }

  initTranscript(videoId);
}
})();
