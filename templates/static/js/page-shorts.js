;(() => {
  if (!document.body.classList.contains('page-shorts')) return;

  document.addEventListener('DOMContentLoaded', () => {
    initHeaderSearch();
    initShortsPage();
  });

  const EDU_KEYS = [
    { label: 'choco-1', url: 'https://raw.githubusercontent.com/choco-1515/About-youtube/refs/heads/main/edu/key1.json' },
    { label: 'choco-2', url: 'https://raw.githubusercontent.com/choco-1515/About-youtube/refs/heads/main/edu/key2.json' },
    { label: 'choco-3', url: 'https://raw.githubusercontent.com/choco-1515/About-youtube/refs/heads/main/edu/key3.json' },
  ];

  let eduParams = [];
  let queue = [];
  let queueIdx = 0;
  let isFetchingMore = false;
  let channelMode = false;
  let channelId = null;
  let channelContinuation = null;
  let searchMode = false;
  let searchQueryStr = null;
  let searchContinuation = null;
  let searchShortPage1 = 1;
  let searchShortPage2 = 0;
  let searchExhausted = false;
  let searchEmptyStreak = 0;

  // ===== EDU PARAMS =====
  function getParamIdx() {
    const sel = document.getElementById('sfParamSelect');
    return sel ? parseInt(sel.value, 10) : 0;
  }

  function getEduSrc(videoId) {
    const idx = getParamIdx();
    let param = (eduParams[idx] && eduParams[idx].value) ? eduParams[idx].value : '?autoplay=1';
    const sep = param.includes('?') ? '&' : '?';
    if (!param.includes('loop=')) {
      param += `${sep}loop=1&playlist=${videoId}`;
    }
    return `https://www.youtubeeducation.com/embed/${videoId}${param}`;
  }

  async function fetchEduParams() {
    try {
      const res = await fetch('/api/edu-params');
      const data = await res.json();
      if (!Array.isArray(data)) return;
      eduParams = data;
      const sel = document.getElementById('sfParamSelect');
      if (sel) {
        sel.innerHTML = '';
        eduParams.forEach((p, i) => {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = p.label;
          sel.appendChild(opt);
        });
        sel.selectedIndex = 0;
      }
    } catch (_) {}
  }

  // ===== PLAYER =====
  function loadPlayer(videoId) {
    const iframe = document.getElementById('sfIframe');
    const skeleton = document.getElementById('sfSkeleton');
    if (!iframe) return;
    if (skeleton) skeleton.style.display = '';
    iframe.src = getEduSrc(videoId);
    iframe.onload = () => { if (skeleton) skeleton.style.display = 'none'; };
    const watchBtn = document.getElementById('sfWatchBtn');
    const ytBtn = document.getElementById('sfYtBtn');
    if (watchBtn) watchBtn.href = `/watch?v=${videoId}`;
    if (ytBtn) ytBtn.href = `https://www.youtube.com/shorts/${videoId}`;
    const shareBtn = document.getElementById('sfShareBtn');
    const sharePanel = document.getElementById('sfSharePanel');
    if (shareBtn && sharePanel) {
      shareBtn.dataset.sfCurrentVideoId = videoId;
      if (!shareBtn.dataset.shareInit) {
        shareBtn.dataset.shareInit = '1';
        setupSharePanel(shareBtn, sharePanel, () => {
          const vid = shareBtn.dataset.sfCurrentVideoId || videoId;
          return {
            videoId: vid,
            ytUrl: `https://www.youtube.com/shorts/${vid}`,
            appUrl: `${location.origin}/shorts/${vid}`,
            title: document.title,
          };
        });
      }
    }
  }

  function renderOverlay(data, videoId) {
    const titleEl = document.getElementById('sfOverlayTitle');
    const metaEl = document.getElementById('sfOverlayMeta');
    const chLink = document.getElementById('sfChLink');
    const chAvatar = document.getElementById('sfChAvatar');
    const chName = document.getElementById('sfChName');
    if (titleEl) titleEl.textContent = data.title || '';
    document.title = (data.title ? data.title + ' - ' : '') + 'Choco-tube-plus Shorts';
    const parts = [];
    if (data.viewCount) parts.push(formatViews(data.viewCount) + ' 回視聴');
    if (data.publishedText) parts.push(data.publishedText);
    if (metaEl) metaEl.textContent = parts.join(' · ');
    if (chLink && data.authorId) chLink.href = `/channel?id=${encodeURIComponent(data.authorId)}`;
    if (chName) chName.textContent = data.author || '';
    const thumb = getChannelIconUrl(data.authorThumbnails || []);
    if (thumb && chAvatar) { chAvatar.src = thumb; chAvatar.style.display = ''; }
    const watchBtn = document.getElementById('sfWatchBtn');
    const ytBtn = document.getElementById('sfYtBtn');
    if (watchBtn) watchBtn.href = `/watch?v=${videoId}`;
    if (ytBtn) ytBtn.href = `https://www.youtube.com/shorts/${videoId}`;
    // ショート視聴履歴に保存
    if (typeof addShortsHistory === 'function') {
      addShortsHistory({
        videoId,
        title: data.title || '',
        author: data.author || '',
        authorId: data.authorId || '',
        authorThumbnails: data.authorThumbnails || [],
        videoThumbnails: data.videoThumbnails || [],
      });
    }
  }

  function updateNavBtns() {
    const prevBtn = document.getElementById('sfPrevBtn');
    const nextBtn = document.getElementById('sfNextBtn');
    if (prevBtn) prevBtn.disabled = queueIdx <= 0;
    const hasMoreFetchable = (channelMode && channelContinuation) ||
                             (searchMode && searchContinuation) ||
                             (searchMode && searchQueryStr && !searchExhausted);
    if (nextBtn) nextBtn.disabled = queueIdx >= queue.length - 1 && !hasMoreFetchable;
  }

  // ===== QUEUE / CHANNEL CONTEXT =====
  async function fetchChannelShortsPage(chId, continuation) {
    let url = `/api/channels/${encodeURIComponent(chId)}/shorts`;
    if (continuation) url += `?continuation=${encodeURIComponent(continuation)}`;
    return fetchMain(url);
  }

  async function buildChannelQueue(chId, startId) {
    try {
      let allVideos = [];
      let cont = null;
      let page = 0;
      const MAX_PAGES = 4;
      do {
        const data = await fetchChannelShortsPage(chId, cont);
        const vids = data.videos || data.shorts || [];
        allVideos.push(...vids);
        cont = data.continuation || null;
        page++;
        if (allVideos.some(v => v.videoId === startId)) break;
      } while (cont && page < MAX_PAGES);

      channelContinuation = cont;
      const existing = new Set();
      const items = allVideos.filter(v => {
        if (!v.videoId || existing.has(v.videoId)) return false;
        existing.add(v.videoId);
        return true;
      }).map(v => ({ videoId: v.videoId, meta: v }));

      if (!items.length) return false;

      const startIdx = items.findIndex(v => v.videoId === startId);
      if (startIdx >= 0) {
        queue = items;
        queueIdx = startIdx;
      } else {
        queue = [{ videoId: startId, meta: null }, ...items];
        queueIdx = 0;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async function fetchAndQueueMeta(idx) {
    const item = queue[idx];
    if (!item || item.meta) return;
    try {
      const data = await withRetry(() => fetchMain(`/api/videos/${item.videoId}`));
      queue[idx] = { ...item, meta: data };
      if (idx === queueIdx) renderOverlay(data, item.videoId);
    } catch (_) {}
  }

  async function prefetchMoreRecs(videoId, data) {
    if (isFetchingMore) return;
    isFetchingMore = true;
    try {
      const src = data || await fetchMain(`/api/videos/${videoId}`);
      const recs = (src.recommendedVideos || []).filter(v => isShortVideo(v));
      const existing = new Set(queue.map(q => q.videoId));
      const newItems = recs.filter(v => !existing.has(v.videoId)).slice(0, 12)
        .map(v => ({ videoId: v.videoId, meta: v }));
      if (newItems.length) { queue.push(...newItems); updateNavBtns(); }
    } catch (_) {}
    isFetchingMore = false;
  }

  async function prefetchMoreChannel() {
    if (!channelMode || !channelId || !channelContinuation || isFetchingMore) return;
    isFetchingMore = true;
    try {
      const data = await fetchChannelShortsPage(channelId, channelContinuation);
      const vids = data.videos || data.shorts || [];
      channelContinuation = data.continuation || null;
      const existing = new Set(queue.map(q => q.videoId));
      const newItems = vids.filter(v => v.videoId && !existing.has(v.videoId))
        .map(v => ({ videoId: v.videoId, meta: v }));
      if (newItems.length) { queue.push(...newItems); updateNavBtns(); }
    } catch (_) {}
    isFetchingMore = false;
  }

  async function fetchSearchShortsPage(q, continuation) {
    let url = `/api/search?q=${encodeURIComponent(q)}&type=video`;
    if (continuation) url += `&continuation=${encodeURIComponent(continuation)}`;
    return fetchMain(url);
  }

  async function fetchShortPage(searchQ, page) {
    try {
      const pageParam = page > 1 ? `&page=${page}` : '';
      const url = `/api/search?q=${encodeURIComponent(searchQ)}${pageParam}`;
      const raw = await fetchMain(url);
      const items = Array.isArray(raw) ? raw : (raw.results || []);
      return items.filter(v => v.type !== 'channel' && v.type !== 'playlist' && isShortVideo(v));
    } catch (_) {
      return [];
    }
  }

  async function buildSearchQueue(q, startId, preList) {
    try {
      searchQueryStr = q;
      searchShortPage1 = 1;
      searchShortPage2 = 0;
      if (preList && preList.length) {
        const existing = new Set();
        const items = preList.filter(id => {
          if (!id || existing.has(id)) return false;
          existing.add(id);
          return true;
        }).map(id => ({ videoId: id, meta: null }));
        const startIdx = items.findIndex(v => v.videoId === startId);
        if (startIdx >= 0) {
          queue = items;
          queueIdx = startIdx;
          updateNavBtns();
          return true;
        }
      }
      const data = await fetchSearchShortsPage(q, null);
      const results = data.results || [];
      const vids = results.filter(v => v.type !== 'channel' && v.type !== 'playlist' && isShortVideo(v));
      searchContinuation = data.continuation || null;
      const existing = new Set();
      const items = vids.filter(v => {
        if (!v.videoId || existing.has(v.videoId)) return false;
        existing.add(v.videoId);
        return true;
      }).map(v => ({ videoId: v.videoId, meta: v }));
      if (!items.length) return false;
      const startIdx = items.findIndex(v => v.videoId === startId);
      if (startIdx >= 0) {
        queue = items;
        queueIdx = startIdx;
      } else {
        queue = [{ videoId: startId, meta: null }, ...items];
        queueIdx = 0;
      }
      updateNavBtns();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function prefetchMoreSearch() {
    if (!searchMode || !searchQueryStr || isFetchingMore) return;
    isFetchingMore = true;
    try {
      const existing = new Set(queue.map(item => item.videoId));
      const tasks = [];

      searchShortPage1++;
      tasks.push(fetchShortPage(searchQueryStr + ' ショート', searchShortPage1));

      if (searchShortPage1 >= 3 || searchShortPage2 > 0) {
        searchShortPage2++;
        tasks.push(fetchShortPage(searchQueryStr + ' #shorts', searchShortPage2));
      }

      const results = await Promise.all(tasks);
      const newItems = [];
      results.flat().forEach(v => {
        if (v.videoId && !existing.has(v.videoId)) {
          existing.add(v.videoId);
          newItems.push({ videoId: v.videoId, meta: v });
        }
      });
      if (newItems.length) {
        searchEmptyStreak = 0;
        queue.push(...newItems);
        updateNavBtns();
      } else {
        searchEmptyStreak++;
        if (searchEmptyStreak >= 2) searchExhausted = true;
        updateNavBtns();
      }
    } catch (_) {}
    isFetchingMore = false;
  }

  function navigateTo(idx) {
    if (idx < 0 || idx >= queue.length) return;
    queueIdx = idx;
    const item = queue[queueIdx];
    let url;
    if (channelMode && channelId) {
      url = `/shorts/${item.videoId}?channel=${encodeURIComponent(channelId)}`;
    } else if (searchMode && searchQueryStr) {
      url = `/shorts/${item.videoId}?q=${encodeURIComponent(searchQueryStr)}`;
    } else {
      url = `/shorts/${item.videoId}`;
    }
    history.pushState(null, '', url);
    loadPlayer(item.videoId);
    if (item.meta) {
      renderOverlay(item.meta, item.videoId);
    } else {
      const chName = document.getElementById('sfChName');
      if (chName) chName.textContent = '読み込み中...';
      const titleEl = document.getElementById('sfOverlayTitle');
      if (titleEl) titleEl.textContent = '';
      fetchAndQueueMeta(queueIdx);
    }
    updateNavBtns();
    if (queueIdx >= queue.length - 3) {
      if (channelMode) prefetchMoreChannel();
      else if (searchMode) prefetchMoreSearch();
      else prefetchMoreRecs(item.videoId, item.meta);
    }
    closeSfComments();
  }

  // ===== COMMENTS =====
  let sfCommentsContinuation = null;
  let sfCommentsLoading = false;
  let sfCommentsSortBy = 'top';
  let sfCommentsVideoId = null;

  function openSfComments(videoId) {
    const panel = document.getElementById('sfCommentsPanel');
    if (!panel) return;
    const btn = document.getElementById('sfCommentBtn');
    if (btn) btn.classList.add('active');
    panel.hidden = false;
    if (sfCommentsVideoId !== videoId) {
      sfCommentsVideoId = videoId;
      sfCommentsContinuation = null;
      loadSfComments(false);
    }
  }

  function closeSfComments() {
    const panel = document.getElementById('sfCommentsPanel');
    if (!panel) return;
    panel.hidden = true;
    const btn = document.getElementById('sfCommentBtn');
    if (btn) btn.classList.remove('active');
  }

  function toggleSfComments() {
    const panel = document.getElementById('sfCommentsPanel');
    if (!panel) return;
    if (panel.hidden) {
      const vid = queue[queueIdx]?.videoId;
      if (vid) openSfComments(vid);
    } else {
      closeSfComments();
    }
  }

  async function loadSfComments(append = false) {
    if (sfCommentsLoading) return;
    sfCommentsLoading = true;
    const list = document.getElementById('sfCpList');
    const moreWrap = document.getElementById('sfCpMore');
    const moreBtn = document.getElementById('sfCpMoreBtn');
    if (moreBtn) moreBtn.disabled = true;

    if (!append && list) {
      list.innerHTML = '<p style="color:#e2e8f0;font-size:.82rem;padding:0.75rem 0.25rem;opacity:0.7;">読み込み中...</p>';
    }

    try {
      let url = `/api/comments/${sfCommentsVideoId}?sort_by=${sfCommentsSortBy}`;
      if (append && sfCommentsContinuation) url += `&continuation=${encodeURIComponent(sfCommentsContinuation)}`;
      const data = await withRetry(() => fetchMain(url), 3);

      if (!append && list) list.innerHTML = '';

      const comments = Array.isArray(data.comments) ? data.comments : [];
      if (!append && !comments.length) {
        if (list) list.innerHTML = '<p style="color:#94a3b8;font-size:.82rem;padding:0.5rem 0.25rem;">コメントはありません。</p>';
      } else {
        if (list) {
          comments.forEach((c, idx) => {
            try {
              list.appendChild(createCommentItem(c));
            } catch (itemErr) {
              console.error('createCommentItem[' + idx + '] error:', itemErr, c);
            }
          });
        }
      }
      sfCommentsContinuation = data.continuation || null;
      if (moreWrap) moreWrap.hidden = !sfCommentsContinuation;
      if (moreBtn) moreBtn.disabled = false;
    } catch (e) {
      console.error('sf comments error:', e);
      const msg = (e && (e.message || String(e))) || '不明なエラー';
      if (!append && list) list.innerHTML = '<p style="color:#f87171;font-size:.82rem;padding:0.5rem 0.25rem;">エラー: ' + escapeHtml(msg) + '</p>';
    }
    sfCommentsLoading = false;
  }

  function initSfComments() {
    document.getElementById('sfCommentBtn')?.addEventListener('click', toggleSfComments);
    document.getElementById('sfCpClose')?.addEventListener('click', closeSfComments);
    document.getElementById('sfCpMoreBtn')?.addEventListener('click', () => loadSfComments(true));

    document.querySelectorAll('.sf-cp-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sf-cp-sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sfCommentsSortBy = btn.dataset.sort || 'top';
        sfCommentsContinuation = null;
        loadSfComments(false);
      });
    });
  }

  // ===== INIT =====
  function initShortsPage() {
    const pathParts = window.location.pathname.split('/');
    const startId = pathParts[pathParts.length - 1];
    if (!startId) return;

    const urlParams = new URLSearchParams(window.location.search);
    channelId = urlParams.get('channel') || null;
    channelMode = !!channelId;
    const sqParam = urlParams.get('q') || null;
    const listParam = urlParams.get('list') || null;
    searchMode = !!sqParam;

    queue = [{ videoId: startId, meta: null }];
    queueIdx = 0;

    try {
      const homeQueueRaw = sessionStorage.getItem('chHomeShortQueue');
      if (homeQueueRaw) {
        sessionStorage.removeItem('chHomeShortQueue');
        const homeIds = JSON.parse(homeQueueRaw);
        if (Array.isArray(homeIds) && homeIds.length > 1) {
          const items = homeIds.map(id => ({ videoId: id, meta: null }));
          const startIdx = items.findIndex(v => v.videoId === startId);
          if (startIdx >= 0) {
            queue = items;
            queueIdx = startIdx;
            channelMode = false;
            searchMode = false;
          }
        }
      }
    } catch (_) {}

    document.getElementById('sfParamSelect')?.addEventListener('change', () => {
      if (queue[queueIdx]) loadPlayer(queue[queueIdx].videoId);
    });
    document.getElementById('sfPrevBtn')?.addEventListener('click', () => navigateTo(queueIdx - 1));
    document.getElementById('sfNextBtn')?.addEventListener('click', () => navigateTo(queueIdx + 1));
    document.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp')   { e.preventDefault(); navigateTo(queueIdx - 1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); navigateTo(queueIdx + 1); }
    });

    initSfComments();

    (async () => {
      const [, metaResult] = await Promise.all([
        fetchEduParams(),
        (async () => {
          try { return await withRetry(() => fetchMain(`/api/videos/${startId}`)); } catch { return null; }
        })(),
      ]);

      loadPlayer(startId);

      if (metaResult) {
        queue[0].meta = metaResult;
        renderOverlay(metaResult, startId);
      }

      if (channelMode && channelId) {
        const ok = await buildChannelQueue(channelId, startId);
        if (!ok) {
          channelMode = false;
          if (metaResult) prefetchMoreRecs(startId, metaResult);
        }
      } else if (searchMode && sqParam) {
        const preList = listParam ? listParam.split(',').filter(Boolean) : null;
        const ok = await buildSearchQueue(sqParam, startId, preList);
        if (!ok) {
          searchMode = false;
          if (metaResult) prefetchMoreRecs(startId, metaResult);
        } else if (queueIdx >= queue.length - 3) {
          prefetchMoreSearch();
        }
      } else if (metaResult) {
        prefetchMoreRecs(startId, metaResult);
      }

      updateNavBtns();
    })();
  }
})();
