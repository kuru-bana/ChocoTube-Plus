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
        const vcQualBtn2 = document.getElementById('vcQualBtn');
        if (vcQualBtn2) vcQualBtn2.textContent = bestFormat.qualityLabel || bestFormat.quality || '画質';
        const firstOpt2 = document.querySelector('#vcQualOpts .vctrls-dd-opt');
        if (firstOpt2) firstOpt2.classList.add('active');
        document.querySelectorAll('#qualityBtns .quality-btn-track[data-track-mode="normal"]').forEach(b => b.classList.add('active'));
        if (isStreamModeActive()) {
          player.removeAttribute('hidden');
          if (restoreTime > 0) {
            player.addEventListener('loadedmetadata', () => {
              player.currentTime = restoreTime;
              tryAutoplay(player, null);
            }, { once: true });
          } else {
            tryAutoplay(player, null);
          }
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

    // 開閉状態を localStorage から復元（未設定時はデフォルトで開く）
    const _pbStored = localStorage.getItem(PB_OPEN_KEY);
    let pbOpen = _pbStored === null ? true : _pbStored === '1';
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
      // nocookie / edu モードは URL パラメータでループ制御するため iframe を再読み込み
      if (typeof window._reloadEmbedForLoop === 'function' && isExternalEmbedModeActive()) {
        window._reloadEmbedForLoop(next);
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

  // ── Tool panel ──
  function buildPcToolPanel() {
    const panel = document.getElementById('pcToolPanel');
    if (!panel) return;
    panel.innerHTML = '';
    const streamActive = !player.hidden;
    const isIframe = isExternalEmbedModeActive();
    const sections = [
      {
        heading: '再生',
        items: [
          { keys: 'Space / K', label: '再生 / 一時停止', stream: false, fn: () => {
            if (isIframe) { if (_iframePlayerState === 1) _sendIframeCmd('pauseVideo', []); else _sendIframeCmd('playVideo', []); }
            else vcPlay.click();
          }},
          { keys: '← / J',     label: '5秒戻る',  stream: false, fn: () => {
            if (isIframe) _sendIframeCmd('seekTo', [Math.max(0, getIframeCurrentTime() - 5), true]);
            else doSkip(-5);
          }},
          { keys: '→ / L',     label: '5秒進む',  stream: false, fn: () => {
            if (isIframe) _sendIframeCmd('seekTo', [getIframeCurrentTime() + 5, true]);
            else doSkip(5);
          }},
          { keys: 'Shift+←/J', label: '10秒戻る', stream: false, fn: () => {
            if (isIframe) _sendIframeCmd('seekTo', [Math.max(0, getIframeCurrentTime() - 10), true]);
            else doSkip(-10);
          }},
          { keys: 'Shift+→/L', label: '10秒進む', stream: false, fn: () => {
            if (isIframe) _sendIframeCmd('seekTo', [getIframeCurrentTime() + 10, true]);
            else doSkip(10);
          }},
        ],
      },
      {
        heading: '音量',
        items: [
          { keys: '↑', label: '音量を上げる', stream: false, fn: () => {
            if (isIframe) { _iframeVolume = Math.min(100, _iframeVolume + 10); _sendIframeCmd('setVolume', [_iframeVolume]); }
            else { vcVol.value = Math.min(1, parseFloat(vcVol.value) + 0.1).toFixed(2); vcVol.dispatchEvent(new Event('input')); showCtrls(); }
          }},
          { keys: '↓', label: '音量を下げる', stream: false, fn: () => {
            if (isIframe) { _iframeVolume = Math.max(0, _iframeVolume - 10); _sendIframeCmd('setVolume', [_iframeVolume]); }
            else { vcVol.value = Math.max(0, parseFloat(vcVol.value) - 0.1).toFixed(2); vcVol.dispatchEvent(new Event('input')); showCtrls(); }
          }},
          { keys: 'M', label: 'ミュート切替', stream: false, fn: () => {
            if (isIframe) { _iframeMuted = !_iframeMuted; _sendIframeCmd(_iframeMuted ? 'mute' : 'unMute', []); }
            else vcMute.click();
          }},
        ],
      },
      {
        heading: '画面',
        items: [
          { keys: 'F', label: 'フルスクリーン',           stream: true,  fn: () => vcFs.click() },
          { keys: 'T', label: 'シアターモード',           stream: false, fn: () => toggleTheater() },
          { keys: 'P', label: 'ピクチャーインピクチャー', stream: true,  fn: () => togglePiP() },
        ],
      },
      {
        heading: 'フレーム・速度',
        items: [
          { keys: ',', label: '1フレーム戻る',   stream: true,  fn: () => { player.pause(); player.currentTime = Math.max(0, player.currentTime - FPS); } },
          { keys: '.', label: '1フレーム進む',   stream: true,  fn: () => { player.pause(); player.currentTime = Math.min(player.duration || 0, player.currentTime + FPS); } },
          { keys: '<', label: '再生速度を下げる', stream: false, fn: () => {
            if (isIframe) { const ii = SPEEDS.indexOf(_iframeRate); const ni = ii > 0 ? ii - 1 : 0; _iframeRate = SPEEDS[ni]; _sendIframeCmd('setPlaybackRate', [_iframeRate]); }
            else { const i2 = SPEEDS.indexOf(currentSpeed); if (i2 > 0) setSpeed(SPEEDS[i2 - 1]); }
          }},
          { keys: '>', label: '再生速度を上げる', stream: false, fn: () => {
            if (isIframe) { const ii = SPEEDS.indexOf(_iframeRate); const ni = ii < SPEEDS.length - 1 ? ii + 1 : ii; _iframeRate = SPEEDS[ni]; _sendIframeCmd('setPlaybackRate', [_iframeRate]); }
            else { const i2 = SPEEDS.indexOf(currentSpeed); if (i2 < SPEEDS.length - 1) setSpeed(SPEEDS[i2 + 1]); }
          }},
        ],
      },
      {
        heading: 'ジャンプ (0〜9)',
        grid: true,
        items: Array.from({ length: 10 }, (_, n) => ({
          keys: String(n),
          label: `${n * 10}%`,
          stream: false,
          fn: () => {
            if (isIframe) { if (_iframeDuration > 0) _sendIframeCmd('seekTo', [_iframeDuration * (n / 10), true]); }
            else { if (player.duration) { player.currentTime = player.duration * (n / 10); showCtrls(); } }
          },
        })),
      },
    ];
    sections.forEach((sec, si) => {
      if (si > 0) { const d = document.createElement('div'); d.className = 'pc-tool-divider'; panel.appendChild(d); }
      const h = document.createElement('div');
      h.className = 'pc-tool-heading';
      h.textContent = sec.heading;
      panel.appendChild(h);
      if (sec.grid) {
        const grid = document.createElement('div');
        grid.className = 'pc-tool-grid';
        sec.items.forEach(item => {
          const avail = !item.stream || streamActive;
          const btn = document.createElement('button');
          btn.className = 'pc-tool-grid-btn';
          btn.disabled = !avail;
          btn.title = item.label;
          const kbd = document.createElement('kbd'); kbd.className = 'pc-tool-key'; kbd.textContent = item.keys;
          const lbl = document.createElement('span'); lbl.textContent = item.label;
          btn.appendChild(kbd); btn.appendChild(lbl);
          if (avail) btn.addEventListener('click', () => { closePcToolPanel(); item.fn(); });
          grid.appendChild(btn);
        });
        panel.appendChild(grid);
      } else {
        sec.items.forEach(item => {
          const avail = !item.stream || streamActive;
          const btn = document.createElement('button');
          btn.className = 'pc-tool-item';
          btn.disabled = !avail;
          const kbd = document.createElement('kbd'); kbd.className = 'pc-tool-key'; kbd.textContent = item.keys;
          const lbl = document.createElement('span'); lbl.textContent = item.label;
          btn.appendChild(kbd); btn.appendChild(lbl);
          if (avail) btn.addEventListener('click', () => { closePcToolPanel(); item.fn(); });
          panel.appendChild(btn);
        });
      }
    });
  }
  function openPcToolPanel() {
    buildPcToolPanel();
    const panel = document.getElementById('pcToolPanel');
    if (panel) panel.hidden = false;
    document.getElementById('pcToolBtn')?.classList.add('active');
  }
  function closePcToolPanel() {
    const panel = document.getElementById('pcToolPanel');
    if (panel) panel.hidden = true;
    document.getElementById('pcToolBtn')?.classList.remove('active');
  }
  const pcToolBtn = document.getElementById('pcToolBtn');
  if (pcToolBtn) {
    pcToolBtn.addEventListener('click', e => {
      e.stopPropagation();
      const panel = document.getElementById('pcToolPanel');
      if (!panel || panel.hidden) openPcToolPanel(); else closePcToolPanel();
    });
    document.addEventListener('click', e => {
      const wrap = document.getElementById('pcToolWrap');
      if (wrap && !wrap.contains(e.target)) closePcToolPanel();
    });
  }

  // ── Keyboard shortcuts ──
  const FPS = 1 / 30;
  document.addEventListener('keydown', (e) => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (e.target.isContentEditable) return;
    if (kbBackdrop && !kbBackdrop.hidden) {
      if (e.key === 'Escape' || e.key === '?') { hideKbModal(); e.preventDefault(); }
      return;
    }
    if (e.key === 't' || e.key === 'T') { toggleTheater(); return; }

    // ── iframeモード: postMessage 経由で制御 ──
    if (isExternalEmbedModeActive()) {
      switch (e.key) {
        case ' ': case 'k': case 'K':
          e.preventDefault();
          if (_iframePlayerState === 1) _sendIframeCmd('pauseVideo', []); else _sendIframeCmd('playVideo', []);
          break;
        case 'ArrowLeft': case 'j': case 'J':
          e.preventDefault();
          _sendIframeCmd('seekTo', [Math.max(0, getIframeCurrentTime() - (e.shiftKey ? 10 : 5)), true]);
          break;
        case 'ArrowRight': case 'l': case 'L':
          e.preventDefault();
          _sendIframeCmd('seekTo', [getIframeCurrentTime() + (e.shiftKey ? 10 : 5), true]);
          break;
        case 'ArrowUp':
          e.preventDefault();
          _iframeVolume = Math.min(100, _iframeVolume + 10);
          _sendIframeCmd('setVolume', [_iframeVolume]);
          break;
        case 'ArrowDown':
          e.preventDefault();
          _iframeVolume = Math.max(0, _iframeVolume - 10);
          _sendIframeCmd('setVolume', [_iframeVolume]);
          break;
        case 'm': case 'M':
          _iframeMuted = !_iframeMuted;
          _sendIframeCmd(_iframeMuted ? 'mute' : 'unMute', []);
          break;
        case '<':
          e.preventDefault();
          { const ii = SPEEDS.indexOf(_iframeRate); const ni = ii > 0 ? ii - 1 : 0; _iframeRate = SPEEDS[ni]; _sendIframeCmd('setPlaybackRate', [_iframeRate]); }
          break;
        case '>':
          e.preventDefault();
          { const ii = SPEEDS.indexOf(_iframeRate); const ni = ii < SPEEDS.length - 1 ? ii + 1 : ii; _iframeRate = SPEEDS[ni]; _sendIframeCmd('setPlaybackRate', [_iframeRate]); }
          break;
        case '?':
          e.preventDefault();
          showKbModal();
          break;
        default:
          if (e.key >= '0' && e.key <= '9' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            const pct = parseInt(e.key) / 10;
            if (_iframeDuration > 0) _sendIframeCmd('seekTo', [_iframeDuration * pct, true]);
          }
      }
      return;
    }

    if (player.hidden) return;

    // ── ストリーム / HQ モード: 直接制御 ──
    switch (e.key) {
      case ' ': case 'k': case 'K':
        e.preventDefault();
        vcPlay.click();
        break;
      case 'ArrowLeft': case 'j': case 'J':
        e.preventDefault();
        doSkip(e.shiftKey ? -10 : -5);
        break;
      case 'ArrowRight': case 'l': case 'L':
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
        { const idx = SPEEDS.indexOf(currentSpeed); if (idx > 0) setSpeed(SPEEDS[idx - 1]); }
        break;
      case '>':
        e.preventDefault();
        { const idx = SPEEDS.indexOf(currentSpeed); if (idx < SPEEDS.length - 1) setSpeed(SPEEDS[idx + 1]); }
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

function initNarrowSidebar() {
  const btn = document.getElementById('sidebarNarrowToggleBtn');
  const fab = document.getElementById('sidebarFab');
  if (!btn) return;
  const STORAGE_KEY = 'chocotube_sidebar_narrow';

  function updateState(hidden) {
    if (hidden) {
      document.body.classList.add('sidebar-narrow-hidden');
      btn.textContent = '▶ 表示';
      if (fab) fab.hidden = false;
    } else {
      document.body.classList.remove('sidebar-narrow-hidden');
      btn.textContent = '◀ 隠す';
      if (fab) fab.hidden = true;
    }
    try { localStorage.setItem(STORAGE_KEY, hidden ? 'hidden' : 'shown'); } catch {}
  }

  let saved = '';
  try { saved = localStorage.getItem(STORAGE_KEY) || ''; } catch {}
  updateState(saved === 'hidden');

  btn.addEventListener('click', () => {
    updateState(!document.body.classList.contains('sidebar-narrow-hidden'));
  });

  if (fab) {
    fab.addEventListener('click', () => updateState(false));
  }
}

async function initWatch(videoId) {
  const relatedList = document.getElementById('relatedList');
  for (let i = 0; i < 8; i++) relatedList.appendChild(createRelatedSkeleton());

  const player = document.getElementById('videoPlayer');
  player.poster = getThumbnailUrl(videoId);

  initModeBar(videoId);
  initCustomControls();
  initNarrowSidebar();
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
