function createVideoCard(video, { forceShorts = false } = {}) {
  const hasVideoId = !!video.videoId;
  const thumb = hasVideoId ? getThumbnailUrl(video.videoId) : null;
  const duration = formatDuration(video.lengthSeconds);
  const views = formatViews(video.viewCount);
  const channelIcon = getChannelIconUrl(video.authorThumbnails);

  const isShort = forceShorts || isShortVideo(video);

  const el = hasVideoId ? document.createElement('a') : document.createElement('div');
  el.className = 'video-card' + (hasVideoId ? '' : ' video-card--no-id');
  if (hasVideoId) {
    el.href = isShort ? `/shorts/${video.videoId}` : `/watch?v=${video.videoId}`;
  }

  const badges = [];
  const isLive = video.liveNow || video.publishedText === '0 seconds ago';
  if (isLive) badges.push('<span class="badge-live">LIVE</span>');
  if (isShort && !isLive) badges.push('<span class="badge-shorts">Shorts</span>');
  if (video.is4k) badges.push('<span class="badge-tag">4K</span>');
  if (video.isVr360) badges.push('<span class="badge-tag">360°</span>');
  if (video.hasCaptions) badges.push('<span class="badge-tag">CC</span>');

  const channelUrl = video.authorId ? `/channel?id=${encodeURIComponent(video.authorId)}` : null;

  el.innerHTML = `
    <div class="thumb-wrap">
      ${thumb
        ? `<img class="thumb-img" src="${thumb}" alt="${escapeHtml(video.title)}" loading="lazy" onload="this.classList.add('loaded')" />`
        : `<div class="thumb-img thumb-placeholder"><span class="thumb-placeholder-icon">▶</span></div>`
      }
      ${duration ? `<span class="duration-badge">${duration}</span>` : ''}
      ${badges.length ? `<div class="thumb-badges">${badges.join('')}</div>` : ''}
    </div>
    <div class="card-info">
      <div class="card-title">${escapeHtml(video.title)}</div>
      <div class="card-meta">
        <div class="card-channel-row">
          ${channelIcon
            ? `<img class="channel-icon" src="${channelIcon}" alt="${escapeHtml(video.author)}" loading="lazy" />`
            : `<div class="channel-icon-placeholder"></div>`
          }
          ${channelUrl
            ? `<a class="card-channel card-channel-link" href="${channelUrl}" onclick="event.stopPropagation()">${escapeHtml(video.author || '')}</a>`
            : `<span class="card-channel">${escapeHtml(video.author || '')}</span>`
          }
        </div>
        <div class="card-stats">
          ${views ? `<span>${views}</span>` : ''}
          ${video.publishedText ? `<span>${escapeHtml(video.publishedText)}</span>` : ''}
        </div>
      </div>
    </div>
  `;

  if (channelUrl) {
    const iconEl = el.querySelector('.channel-icon, .channel-icon-placeholder');
    if (iconEl) {
      iconEl.style.cursor = 'pointer';
      iconEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.location.href = channelUrl;
      });
    }
  }

  return el;
}

function createChannelCard(item) {
  const icon = getChannelIconUrl(item.authorThumbnails);
  const subs = formatSubs(item.subCount);

  const a = document.createElement('a');
  a.className = 'channel-card';
  a.href = item.authorId ? `/channel?id=${encodeURIComponent(item.authorId)}` : `https://www.youtube.com/channel/${item.authorId}`;

  a.innerHTML = `
    <div class="channel-card-inner">
      ${icon
        ? `<img class="channel-card-icon" src="${icon}" alt="${escapeHtml(item.author)}" loading="lazy" onload="this.classList.add('loaded')" />`
        : `<div class="channel-card-icon-placeholder"></div>`
      }
      <div class="channel-card-info">
        <div class="channel-card-name">
          ${escapeHtml(item.author || '')}
          ${item.authorVerified ? '<span class="verified-badge" title="認証済み">✓</span>' : ''}
        </div>
        ${subs ? `<div class="channel-card-subs">登録者 ${subs}</div>` : ''}
        ${item.description ? `<div class="channel-card-desc">${escapeHtml(item.description)}</div>` : ''}
      </div>
    </div>
  `;
  return a;
}

function createPlaylistCard(item) {
  const thumb = item.playlistThumbnail
    ? wsrv(item.playlistThumbnail, 480)
    : (item.videos && item.videos[0]?.videoId ? getThumbnailUrl(item.videos[0].videoId) : '');

  const isMix = item.playlistId && item.playlistId.startsWith('RD');
  const a = document.createElement('a');
  a.className = 'video-card';
  a.href = isMix
    ? `/mix?id=${encodeURIComponent(item.playlistId)}`
    : `/playlist?list=${encodeURIComponent(item.playlistId)}`;

  a.innerHTML = `
    <div class="thumb-wrap playlist-thumb-wrap">
      ${thumb ? `<img class="thumb-img" src="${thumb}" alt="${escapeHtml(item.title)}" loading="lazy" onload="this.classList.add('loaded')" />` : ''}
      <div class="playlist-count-badge">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        ${item.videoCount != null ? item.videoCount + '本' : '再生リスト'}
      </div>
    </div>
    <div class="card-info">
      <div class="card-title">${escapeHtml(item.title)}</div>
      <div class="card-meta">
        <div class="card-channel-row">
          <div class="channel-icon-placeholder"></div>
          <span class="card-channel">${escapeHtml(item.author || '')}</span>
        </div>
      </div>
    </div>
  `;
  return a;
}

function createResultCard(item) {
  switch (item.type) {
    case 'channel': return createChannelCard(item);
    case 'playlist': return createPlaylistCard(item);
    default: {
      if (isShortVideo(item)) return createShortsCard(item);
      return createVideoCard(item);
    }
  }
}

function createShortsCard(video, { channelId = null, searchQuery = null, shortsList = null } = {}) {
  const a = document.createElement('a');
  a.className = 'short-card';
  const base = `/shorts/${video.videoId}`;
  let href = base;
  if (channelId) {
    href = `${base}?channel=${encodeURIComponent(channelId)}`;
  } else if (searchQuery) {
    const p = new URLSearchParams({ q: searchQuery });
    if (shortsList) p.set('list', shortsList);
    href = `${base}?${p}`;
  }
  a.href = href;
  const oarThumb = wsrv(`https://i.ytimg.com/vi/${video.videoId}/oar2.jpg`, 480);
  const hqThumb  = wsrv(`https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`, 480);
  const duration = formatDuration(video.lengthSeconds);
  const views = formatViews(video.viewCount);
  a.innerHTML = `
    <div class="short-card-thumb">
      <img src="${oarThumb}" alt="${escapeHtml(video.title || '')}" loading="lazy"
        onload="this.classList.add('loaded')"
        onerror="this.onerror=null;this.src='${hqThumb}'" />
      ${duration ? `<span class="short-card-dur">${duration}</span>` : ''}
    </div>
    <div class="short-card-title">${escapeHtml(video.title || '')}</div>
    ${views ? `<div class="short-card-views">${views} 回視聴</div>` : ''}
  `;
  return a;
}

function createShortsShelf(shorts, { searchQuery = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'shorts-shelf';
  const header = document.createElement('div');
  header.className = 'shorts-shelf-header';
  header.innerHTML = `
    <div class="shorts-shelf-icon">
      <svg viewBox="0 0 24 24"><path d="M9 8l6 4-6 4V8z"/></svg>
    </div>
    <span class="shorts-shelf-title">ショート</span>
    <span class="shorts-shelf-count">${shorts.length}件</span>
  `;
  const scroll = document.createElement('div');
  scroll.className = 'shorts-shelf-scroll';
  const shortsList = searchQuery ? shorts.map(v => v.videoId).join(',') : null;
  shorts.forEach(v => scroll.appendChild(createShortsCard(v, { searchQuery, shortsList })));
  wrap.appendChild(header);
  wrap.appendChild(scroll);
  return wrap;
}

function appendShortsToShelf(shelfEl, newShorts, allShorts, searchQuery) {
  if (!shelfEl) return;
  const scroll = shelfEl.querySelector('.shorts-shelf-scroll');
  const countEl = shelfEl.querySelector('.shorts-shelf-count');
  if (!scroll) return;
  const spinner = shelfEl.querySelector('.shorts-shelf-spinner');
  if (spinner) spinner.remove();
  const shortsList = searchQuery ? allShorts.map(v => v.videoId).join(',') : null;
  newShorts.forEach(v => scroll.appendChild(createShortsCard(v, { searchQuery, shortsList })));
  if (countEl) countEl.textContent = `${allShorts.length}件`;
}

function createSkeletonCard() {
  const div = document.createElement('div');
  div.className = 'skeleton-card';
  div.innerHTML = `
    <div class="skeleton-thumb"></div>
    <div class="skeleton-info">
      <div class="skeleton-line skeleton-title"></div>
      <div class="skeleton-line skeleton-title-short"></div>
      <div class="skeleton-channel-row">
        <div class="skeleton-avatar"></div>
        <div class="skeleton-line skeleton-channel"></div>
      </div>
      <div class="skeleton-line skeleton-views"></div>
    </div>
  `;
  return div;
}

const channelAvatarCache = new Map();
const playlistAuthorCache = new Map();

async function fetchChannelAvatar(channelId) {
  if (channelAvatarCache.has(channelId)) return channelAvatarCache.get(channelId);
  try {
    const data = await fetchMain(`/api/channels/${encodeURIComponent(channelId)}`);
    const thumbs = data.authorThumbnails || null;
    if (thumbs) channelAvatarCache.set(channelId, thumbs);
    return thumbs;
  } catch {
    return null;
  }
}

async function fetchPlaylistAuthorThumbs(playlistId) {
  if (playlistAuthorCache.has(playlistId)) return playlistAuthorCache.get(playlistId);
  try {
    const data = await fetchMain(`/api/playlists/${encodeURIComponent(playlistId)}`);
    const result = { thumbs: data.authorThumbnails || null, authorId: data.authorId || null };
    if (result.thumbs || result.authorId) playlistAuthorCache.set(playlistId, result);
    return result;
  } catch {
    return null;
  }
}

function applyIconToPlaceholder(placeholder, thumbs, authorId) {
  const iconUrl = getChannelIconUrl(thumbs);
  if (!iconUrl || !placeholder.isConnected) return;
  const img = document.createElement('img');
  img.className = 'channel-icon';
  img.src = iconUrl;
  img.alt = '';
  img.loading = 'lazy';
  img.onload = () => img.classList.add('loaded');
  if (authorId) {
    img.style.cursor = 'pointer';
    img.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = `/channel?id=${encodeURIComponent(authorId)}`;
    });
  }
  placeholder.replaceWith(img);
}

async function fillMissingIcons(items) {
  const channelItems = items.filter(i => i.authorId);
  const playlistItems = items.filter(i => !i.authorId && i.playlistId);

  // authorId がある場合は並列で即フェッチ（プレイリストページの動画アイコン等）
  if (channelItems.length > 0) {
    const uniqueIds = [...new Set(channelItems.map(i => i.authorId))];
    const results = await Promise.all(uniqueIds.map(id => fetchChannelAvatar(id).then(t => [id, t])));
    const thumbMap = new Map(results);
    channelItems.forEach(({ card, authorId }) => {
      const placeholder = card.querySelector('.channel-icon-placeholder');
      if (placeholder) applyIconToPlaceholder(placeholder, thumbMap.get(authorId), authorId);
    });
  }

  // playlistId しかない場合は IntersectionObserver で表示時にだけフェッチ
  if (playlistItems.length > 0) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const placeholder = entry.target;
        const playlistId = placeholder.dataset.fillPlaylistId;
        if (!playlistId) return;
        observer.unobserve(placeholder);
        delete placeholder.dataset.fillPlaylistId;
        fetchPlaylistAuthorThumbs(playlistId).then(r => {
          if (r && r.thumbs) applyIconToPlaceholder(placeholder, r.thumbs, r.authorId);
        });
      });
    }, { rootMargin: '100px' });

    playlistItems.forEach(({ card, playlistId }) => {
      const placeholder = card.querySelector('.channel-icon-placeholder');
      if (!placeholder) return;
      placeholder.dataset.fillPlaylistId = playlistId;
      observer.observe(placeholder);
    });
  }
}

async function withRetry(fn, maxRetries = Infinity, baseDelay = 1500, maxDelay = 15000) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt++;
      if (maxRetries !== Infinity && attempt >= maxRetries) throw e;
      const delay = Math.min(baseDelay * Math.pow(1.5, attempt - 1), maxDelay);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function fetchMain(apiPath) {
  const url = '/proxy/main' + apiPath;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < 1 && (e.name === 'TimeoutError' || e.name === 'TypeError')) continue;
      throw e;
    }
  }
  throw lastErr;
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

async function fetchStream(apiPath) {
  const url = '/proxy/stream' + apiPath;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const instanceUrl = res.headers.get('X-Instance-Used') || null;
      return { data, instanceUrl };
    } catch (e) {
      lastErr = e;
      if (attempt < 1 && (e.name === 'TimeoutError' || e.name === 'TypeError')) continue;
      throw e;
    }
  }
  throw lastErr;
}

function copyText(text) {
  return navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  });
}

function setupSharePanel(btnEl, panelEl, getInfo) {
  if (!btnEl || !panelEl) return;
  const nativeItem = panelEl.querySelector('[data-action="native"]');
  if (nativeItem && !navigator.share) nativeItem.hidden = true;

  btnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !panelEl.hidden;
    document.querySelectorAll('.share-panel').forEach(p => { p.hidden = true; });
    if (isOpen) return;
    const info = getInfo();

    panelEl.querySelector('[data-action="copy-id"]').onclick = () => {
      copyText(info.videoId);
      showCopyToast('動画IDをコピーしました');
      panelEl.hidden = true;
    };
    panelEl.querySelector('[data-action="copy-yt"]').onclick = () => {
      copyText(info.ytUrl);
      showCopyToast('YouTube URLをコピーしました');
      panelEl.hidden = true;
    };
    panelEl.querySelector('[data-action="copy-app"]').onclick = () => {
      copyText(info.appUrl);
      showCopyToast('URLをコピーしました');
      panelEl.hidden = true;
    };
    if (nativeItem && navigator.share) {
      nativeItem.onclick = () => {
        navigator.share({ title: info.title || '', url: info.appUrl }).catch(() => {});
        panelEl.hidden = true;
      };
    }
    panelEl.hidden = false;
  });

  document.addEventListener('click', (e) => {
    if (!btnEl.contains(e.target) && !panelEl.contains(e.target)) {
      panelEl.hidden = true;
    }
  });
}

function showCopyToast(msg = 'URLをコピーしました') {
  let toast = document.getElementById('_copyToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = '_copyToast';
    toast.className = 'copy-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('copy-toast-show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('copy-toast-show'), 2000);
}

function buildSearchUrl(params) {
  const url = new URL('/search', location.origin);
  if (typeof getSettings === 'function') {
    const s = getSettings();
    if (s.searchSort && s.searchSort !== 'relevance') url.searchParams.set('sort_by', s.searchSort);
    if (s.searchDate)                                  url.searchParams.set('date', s.searchDate);
    if (s.searchDuration)                              url.searchParams.set('duration', s.searchDuration);
    if (s.searchType && s.searchType !== 'all')        url.searchParams.set('type', s.searchType);
    if (s.searchFeatures)                              url.searchParams.set('features', s.searchFeatures);
    if (s.searchRegion && s.searchRegion !== 'JP')     url.searchParams.set('region', s.searchRegion);
  }
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  return url.toString();
}

