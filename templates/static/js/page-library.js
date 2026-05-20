;(() => {
  if (!document.body.classList.contains('page-library')) return;
document.addEventListener('DOMContentLoaded', () => {
  initHeaderSearch();
  renderTabs();
  renderSubs();
  renderHistory();
  renderPlaylistList();
  renderFavorites();
  initImportExport();
  initNewPlaylistModal();
});

/* ===== TABS ===== */
function renderTabs() {
  document.querySelectorAll('.lib-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.lib-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('subsPanel').hidden = tab !== 'subs';
      document.getElementById('histPanel').hidden = tab !== 'history';
      document.getElementById('plPanel').hidden = tab !== 'playlists';
      document.getElementById('favPanel').hidden = tab !== 'favorites';
    });
  });
}

/* ===== SUBSCRIPTIONS ===== */
function renderSubs() {
  const subs = getSubscriptions();
  const grid = document.getElementById('subsGrid');
  const empty = document.getElementById('subsEmpty');
  const count = document.getElementById('subsCount');

  count.textContent = subs.length > 0 ? subs.length : '';

  if (!subs.length) {
    empty.hidden = false;
    grid.innerHTML = '';
    return;
  }
  empty.hidden = true;
  grid.innerHTML = '';

  subs.forEach(ch => {
    const card = document.createElement('div');
    card.className = 'lib-channel-card';

    const iconUrl = ch.authorThumbnails
      ? wsrv((ch.authorThumbnails.find(t => (t.width || 0) >= 88) || ch.authorThumbnails[0])?.url, 88)
      : '';

    const subsText = ch.subCountText
      ? `登録者 ${ch.subCountText}`
      : ch.subCount
        ? `登録者 ${formatSubs(ch.subCount)}`
        : '';

    card.innerHTML = `
      <a class="lib-channel-link" href="/channel?id=${encodeURIComponent(ch.authorId)}">
        ${iconUrl
          ? `<img class="lib-channel-avatar" src="${iconUrl}" alt="${escapeHtml(ch.author || '')}" loading="lazy" onload="this.classList.add('loaded')" />`
          : `<div class="lib-channel-avatar-ph">${escapeHtml((ch.author || '?')[0])}</div>`
        }
        <div class="lib-channel-info">
          <div class="lib-channel-name">${escapeHtml(ch.author || '')}</div>
          ${subsText ? `<div class="lib-channel-subs">${escapeHtml(subsText)}</div>` : ''}
          <div class="lib-channel-date">登録日 ${formatLibDate(ch.subscribedAt)}</div>
        </div>
      </a>
      <button class="lib-unsub-btn" data-id="${escapeHtml(ch.authorId)}">登録解除</button>
    `;

    card.querySelector('.lib-unsub-btn').addEventListener('click', () => {
      toggleSubscription({ authorId: ch.authorId });
      renderSubs();
    });

    grid.appendChild(card);
  });
}

/* ===== HISTORY ===== */
function renderHistory() {
  const hist = getHistory();
  const grid = document.getElementById('histGrid');
  const empty = document.getElementById('histEmpty');
  const count = document.getElementById('histCount');
  const toolbar = document.getElementById('histToolbar');
  const clearBtn = document.getElementById('clearHistBtn');

  count.textContent = hist.length > 0 ? hist.length : '';

  if (!hist.length) {
    empty.hidden = false;
    toolbar.hidden = true;
    grid.innerHTML = '';
    return;
  }
  empty.hidden = true;
  toolbar.hidden = false;
  grid.innerHTML = '';

  const missingIcons = [];
  hist.forEach(v => {
    const card = createVideoCard(v);
    if (card) {
      const dateEl = document.createElement('div');
      dateEl.className = 'lib-hist-date';
      dateEl.textContent = formatLibDate(v.watchedAt);
      card.appendChild(dateEl);
      grid.appendChild(card);
      if (!v.authorThumbnails && v.authorId) {
        missingIcons.push({ card, authorId: v.authorId });
      }
    }
  });
  if (missingIcons.length > 0) fillMissingIcons(missingIcons);

  clearBtn.onclick = () => {
    if (confirm('視聴履歴をすべて削除しますか？')) {
      clearHistory();
      renderHistory();
    }
  };
}

/* ===== PLAYLISTS ===== */
let currentPlId = null;

function renderPlaylistList() {
  const pls = getPlaylists();
  const grid = document.getElementById('plGrid');
  const empty = document.getElementById('plEmpty');
  const count = document.getElementById('plCount');

  count.textContent = pls.length > 0 ? pls.length : '';

  document.getElementById('plListView').hidden = false;
  document.getElementById('plDetailView').hidden = true;

  if (!pls.length) {
    empty.hidden = false;
    grid.innerHTML = '';
    return;
  }
  empty.hidden = true;
  grid.innerHTML = '';

  pls.forEach(pl => {
    const thumb = pl.videos.length > 0 ? getThumbnailUrl(pl.videos[0].videoId) : null;
    const card = document.createElement('div');
    card.className = 'lib-pl-card';
    card.innerHTML = `
      <div class="lib-pl-card-thumb">
        ${thumb
          ? `<img src="${thumb}" alt="" loading="lazy" onload="this.classList.add('loaded')" />`
          : `<div class="lib-pl-card-thumb-empty"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div>`
        }
        <div class="lib-pl-card-count">${pl.videos.length}本</div>
      </div>
      <div class="lib-pl-card-info">
        <div class="lib-pl-card-name">${escapeHtml(pl.name)}</div>
        <div class="lib-pl-card-date">作成日 ${formatLibDate(pl.createdAt)}</div>
      </div>
    `;
    card.addEventListener('click', () => openPlaylistDetail(pl.id));
    grid.appendChild(card);
  });
}

function openPlaylistDetail(id) {
  currentPlId = id;
  const pl = getPlaylist(id);
  if (!pl) return;

  document.getElementById('plListView').hidden = true;
  document.getElementById('plDetailView').hidden = false;
  document.getElementById('plDetailName').textContent = pl.name;
  document.getElementById('plDetailCount').textContent = `${pl.videos.length}本の動画`;

  document.getElementById('plBackBtn').onclick = () => {
    currentPlId = null;
    renderPlaylistList();
  };

  document.getElementById('plRenameBtn').onclick = () => {
    const newName = prompt('新しいプレイリスト名を入力してください', pl.name);
    if (newName && newName.trim()) {
      renamePlaylist(id, newName.trim());
      document.getElementById('plDetailName').textContent = newName.trim();
      renderPlaylistList();
    }
  };

  document.getElementById('plDeleteBtn').onclick = () => {
    if (confirm(`「${pl.name}」を削除しますか？`)) {
      deletePlaylist(id);
      currentPlId = null;
      renderPlaylistList();
    }
  };

  renderPlaylistDetail(id);
}

function renderPlaylistDetail(id) {
  const pl = getPlaylist(id);
  const listEl = document.getElementById('plDetailList');
  listEl.innerHTML = '';

  if (!pl || !pl.videos.length) {
    listEl.innerHTML = `<div class="lib-empty" style="padding:3rem 0">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      <p>動画がありません</p>
      <p class="lib-empty-hint">動画ページの「＋ プレイリスト」から追加できます</p>
    </div>`;
    document.getElementById('plDetailCount').textContent = '0本の動画';
    return;
  }

  document.getElementById('plDetailCount').textContent = `${pl.videos.length}本の動画`;

  pl.videos.forEach((v, idx) => {
    const thumb = getThumbnailUrl(v.videoId);
    const dur = formatDuration(v.lengthSeconds);
    const item = document.createElement('div');
    item.className = 'lib-pl-item';
    item.innerHTML = `
      <span class="lib-pl-item-num">${idx + 1}</span>
      <a class="lib-pl-item-link" href="/watch?v=${v.videoId}&list=${encodeURIComponent(id)}&index=${idx}">
        <div class="lib-pl-item-thumb-wrap">
          <img class="lib-pl-item-thumb" src="${thumb}" alt="" loading="lazy" onload="this.classList.add('loaded')" />
          ${dur ? `<span class="lib-pl-item-dur">${dur}</span>` : ''}
        </div>
        <div class="lib-pl-item-info">
          <div class="lib-pl-item-title">${escapeHtml(v.title || '')}</div>
          <div class="lib-pl-item-ch">${escapeHtml(v.author || '')}</div>
        </div>
      </a>
      <button class="lib-pl-item-remove" data-vid="${escapeHtml(v.videoId)}" title="プレイリストから削除">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    item.querySelector('.lib-pl-item-remove').addEventListener('click', () => {
      removeVideoFromPlaylist(id, v.videoId);
      renderPlaylistDetail(id);
    });
    listEl.appendChild(item);
  });
}

/* ===== NEW PLAYLIST MODAL ===== */
function initNewPlaylistModal() {
  const modal = document.getElementById('newPlModal');
  const input = document.getElementById('newPlInput');
  const okBtn = document.getElementById('newPlOk');
  const cancelBtn = document.getElementById('newPlCancel');

  document.getElementById('newPlBtn').addEventListener('click', () => {
    input.value = '';
    modal.hidden = false;
    setTimeout(() => input.focus(), 50);
  });

  function closeModal() { modal.hidden = true; }

  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  okBtn.addEventListener('click', () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    createPlaylist(name);
    closeModal();
    renderPlaylistList();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') okBtn.click();
    if (e.key === 'Escape') closeModal();
  });
}

/* ===== IMPORT / EXPORT ===== */
function initImportExport() {
  document.getElementById('exportBtn').addEventListener('click', () => {
    exportLibrary();
  });

  const input = document.getElementById('importInput');
  const msg = document.getElementById('importMsg');

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    msg.textContent = '読み込み中...';
    msg.className = 'lib-import-msg';
    try {
      await importLibrary(file);
      msg.textContent = '読み込み完了！';
      msg.className = 'lib-import-msg lib-import-ok';
      renderSubs();
      renderHistory();
      renderPlaylistList();
      renderFavorites();
    } catch {
      msg.textContent = '読み込みに失敗しました';
      msg.className = 'lib-import-msg lib-import-err';
    }
    input.value = '';
    setTimeout(() => { msg.textContent = ''; msg.className = 'lib-import-msg'; }, 3000);
  });
}

/* ===== FAVORITES ===== */
function renderFavorites() {
  const favs  = getFavorites();
  const grid    = document.getElementById('favGrid');
  const empty   = document.getElementById('favEmpty');
  const count   = document.getElementById('favCount');
  const toolbar = document.getElementById('favToolbar');
  const clearBtn = document.getElementById('clearFavBtn');

  count.textContent = favs.length > 0 ? favs.length : '';

  if (!favs.length) {
    empty.hidden = false;
    toolbar.hidden = true;
    grid.innerHTML = '';
    return;
  }
  empty.hidden = true;
  toolbar.hidden = false;
  grid.innerHTML = '';

  const missingIcons = [];
  favs.forEach(v => {
    const card = createVideoCard(v);
    if (card) {
      const wrap = document.createElement('div');
      wrap.className = 'fav-card-wrap';
      const delBtn = document.createElement('button');
      delBtn.className = 'fav-del-btn';
      delBtn.title = 'お気に入りから削除';
      delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      delBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeFavorite(v.videoId);
        renderFavorites();
      });
      wrap.appendChild(card);
      wrap.appendChild(delBtn);
      grid.appendChild(wrap);
      if (!v.authorThumbnails && v.authorId) {
        missingIcons.push({ card, authorId: v.authorId });
      }
    }
  });
  if (missingIcons.length > 0) fillMissingIcons(missingIcons);

  clearBtn.onclick = () => {
    if (confirm('お気に入りをすべて削除しますか？')) {
      localStorage.removeItem('invtube_favorites');
      renderFavorites();
    }
  };
}

/* ===== HELPERS ===== */
function formatLibDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'たった今';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}時間前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}日前`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
})();
