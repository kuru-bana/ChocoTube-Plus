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
      // playerState を補完（YouTube は infoDelivery にも playerState を含む）
      const _ps = data.info && data.info.playerState;
      if (typeof _ps === 'number' && _ps >= 0) _iframePlayerState = _ps;
    } else if (data.event === 'onStateChange') {
      const _state = data.info;
      _iframePlayerState = _state;
      // info=0: 自然終了 / info=2: 一時停止（終端付近でYouTubeがpauseを送る場合あり）
      if (_state === 0 || _state === 2) {
        const isEnded = _state === 0;
        const isNearEnd = _state === 2 && _iframeDuration > 0 && _iframeCurrentTime > 0 &&
          (_iframeDuration - _iframeCurrentTime) <= 5;
        if (isEnded || isNearEnd) {
          const _s = getSettings();
          const restartSec = _clipStartSec >= 0 ? _clipStartSec : 0;
          if (!listParam && _s.loop) {
            // ループ: seekTo + playVideo の方が loadVideoById より確実（エンドスクリーン後も動作する）
            _sendIframeCmd('seekTo', [restartSec, true]);
            _sendIframeCmd('playVideo', []);
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
        _sendIframeCmd('seekTo', [restartSec, true]);
        _sendIframeCmd('playVideo', []);
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
  _iframeDuration    = 0;
  _iframePlayerState = -1;
  _iframeVolume      = 100;
  _iframeMuted       = false;
  _iframeRate        = 1;
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

