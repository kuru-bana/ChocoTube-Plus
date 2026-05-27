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

