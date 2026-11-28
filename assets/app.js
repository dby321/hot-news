(() => {
  const $ = (sel) => document.querySelector(sel);
  const content = $('#content');
  const bar = $('#platform-bar');
  const input = $('#search-input');
  const clearBtn = $('#search-clear');
  const kbd = $('#search-kbd');
  const banner = $('#banner');
  const historySelect = $('#history-select');
  const updateBadge = $('#update-badge');
  const footerStats = $('#footer-stats');

  const state = {
    index: null,
    files: new Map(),
    historyIndex: null,
    historyDate: '',
    history: null,
    view: 'all',
    query: '',
    loaded: false,
  };

  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const safeUrl = (u) => {
    const s = String(u ?? '');
    return /^https?:\/\//i.test(s) ? esc(s) : '';
  };

  function highlight(text, kws) {
    const s = String(text ?? '');
    if (!kws.length) return esc(s);
    const re = new RegExp('(' + kws.map(escapeReg).join('|') + ')', 'gi');
    return s
      .split(re)
      .map((part, i) => (i % 2 === 1 ? '<mark>' + esc(part) + '</mark>' : esc(part)))
      .join('');
  }

  const fmtHot = (n) => {
    if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
    return String(n);
  };

  const clockFmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const dateFmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const fmtClock = (ms) => clockFmt.format(new Date(ms));
  const fmtDateTime = (ms) => dateFmt.format(new Date(ms));

  function relTime(ms) {
    if (!ms) return '';
    const diff = Date.now() - ms;
    if (diff < 60e3) return '刚刚';
    if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前';
    if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前';
    if (diff < 7 * 86400e3) return Math.floor(diff / 86400e3) + ' 天前';
    return fmtDateTime(ms);
  }

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function loadLatest() {
    const index = await getJSON('data/index.json');
    const files = new Map();
    await Promise.all(
      index.platforms.map(async (p) => {
        try {
          files.set(p.id, await getJSON(`data/${p.id}.json?v=${index.generatedAt}`));
        } catch {
          files.set(p.id, { ...p, ok: false, stale: false, items: [] });
        }
      }),
    );
    state.index = index;
    state.files = files;
    try {
      state.historyIndex = await getJSON('data/history/index.json');
    } catch {
      state.historyIndex = { dates: [] };
    }
    state.loaded = true;
  }

  async function loadHistory(date) {
    const snap = await getJSON(`data/history/${date}.json`);
    const platforms = Object.entries(snap.platforms).map(([id, p]) => ({
      id,
      name: p.name,
      type: p.type,
      link: p.link,
      color: p.color,
      total: p.items.length,
      ok: true,
      stale: false,
      updateTime: p.updateTime,
    }));
    state.history = {
      index: { generatedAt: snap.capturedAt, platforms, totalItems: platforms.reduce((n, p) => n + p.total, 0) },
      files: new Map(Object.entries(snap.platforms).map(([id, p]) => [id, { id, ...p, ok: true, stale: false }])),
    };
  }

  const dataset = () => (state.historyDate && state.history ? state.history : { index: state.index, files: state.files });

  function keywords() {
    return state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  function searchAll(kws) {
    const { index, files } = dataset();
    const out = [];
    for (const p of index.platforms) {
      const f = files.get(p.id);
      if (!f?.items?.length) continue;
      for (const item of f.items) {
        const hay = `${item.title} ${item.desc || ''} ${item.author || ''} ${p.name}`.toLowerCase();
        if (kws.every((k) => hay.includes(k))) out.push({ p, item });
      }
    }
    return out;
  }

  /* ---------- render pieces ---------- */

  function itemRow(p, item, kws, { miniBadge = false, big = false } = {}) {
    const rankCls = item.rank <= 3 ? 'item-rank top' : 'item-rank';
    const meta = [];
    if (miniBadge)
      meta.push(
        `<button class="p-mini-badge" data-goto="${esc(p.id)}" type="button"><i style="background:${esc(p.color)}"></i>${esc(p.name)}</button>`,
      );
    if (item.author) meta.push(`<span>${highlight(item.author, kws)}</span>`);
    const rt = relTime(item.timestamp);
    if (rt) meta.push(`<span>${esc(rt)}</span>`);
    if (item.hot) meta.push(`<span class="item-hot">${esc(fmtHot(item.hot))} 热度</span>`);
    const cover =
      item.cover && big
        ? `<img class="item-cover" src="${safeUrl(item.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
        : '';
    return `<li class="item">
      <span class="${rankCls}">${item.rank}</span>
      <div class="item-main">
        <a class="item-title" href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">${highlight(item.title, kws)}${item.tag ? `<span class="item-tag">${esc(item.tag)}</span>` : ''}</a>
        ${item.desc ? `<p class="item-desc">${highlight(item.desc, kws)}</p>` : ''}
        ${meta.length ? `<div class="item-meta">${meta.join('')}</div>` : ''}
      </div>
      ${cover}
    </li>`;
  }

  function renderChips() {
    const { index } = dataset();
    const chips = [
      `<button class="chip ${state.view === 'all' && !state.query ? 'active' : ''}" data-goto="all" type="button" style="--chip-color:var(--accent)">全部<span class="chip-count">${index.totalItems}</span></button>`,
    ];
    for (const p of index.platforms) {
      if (!p.total) continue;
      chips.push(
        `<button class="chip ${state.view === p.id && !state.query ? 'active' : ''}" data-goto="${esc(p.id)}" type="button" style="--chip-color:${esc(p.color)}"><span class="chip-dot"></span>${esc(p.name)}<span class="chip-count">${p.total}</span></button>`,
      );
    }
    bar.innerHTML = chips.join('');
  }

  function renderOverview(kws) {
    const { index, files } = dataset();
    const cards = [];
    for (const p of index.platforms) {
      const f = files.get(p.id);
      if (!f?.items?.length) continue;
      const rows = f.items.slice(0, 8).map((item) => itemRow(p, item, kws)).join('');
      cards.push(`<section class="p-card">
        <div class="p-card-head" data-goto="${esc(p.id)}">
          <span class="p-badge" style="background:${esc(p.color)}">${esc(p.name[0])}</span>
          <div class="p-card-title">
            <h2>${esc(p.name)} · ${esc(p.type)}</h2>
            <div class="p-card-meta">
              <span>${f.updateTime ? fmtClock(f.updateTime) + ' 更新' : ''}</span>
              ${f.stale ? '<span class="stale-tag">暂用上次数据</span>' : ''}
            </div>
          </div>
          <span class="p-card-more">›</span>
        </div>
        <ul class="p-card-list">${rows}</ul>
        <div class="p-card-foot"><button data-goto="${esc(p.id)}" type="button">查看完整榜单（${f.items.length} 条）→</button></div>
      </section>`);
    }
    if (!cards.length) return emptyState('暂无数据', '所有平台采集失败，请稍后刷新重试');
    return `<div class="overview-grid">${cards.join('')}</div>`;
  }

  function renderPlatform(id, kws) {
    const { files } = dataset();
    const f = files.get(id);
    if (!f?.items?.length) return emptyState('暂无数据', '该平台本次采集失败，稍后会自动重试');
    return `<div class="list-view">
      <div class="list-head">
        <span class="p-badge" style="background:${esc(f.color)}">${esc(f.name[0])}</span>
        <div class="list-head-info">
          <h1>${esc(f.name)} · ${esc(f.type)}</h1>
          <div class="list-head-meta">
            <span>${f.items.length} 条</span>
            ${f.updateTime ? `<span>更新于 ${fmtDateTime(f.updateTime)}</span>` : ''}
            ${f.stale ? '<span class="stale-tag">本次采集失败，暂用上次数据</span>' : ''}
            ${f.link ? `<a href="${safeUrl(f.link)}" target="_blank" rel="noopener noreferrer">查看原榜 ↗</a>` : ''}
          </div>
        </div>
      </div>
      <ul class="list-body">${f.items.map((item) => itemRow(f, item, kws, { big: true })).join('')}</ul>
    </div>`;
  }

  function renderSearch(kws) {
    const { index } = dataset();
    const results = searchAll(kws);
    const summary = `<p class="search-summary">在 ${index.platforms.filter((p) => p.total).length} 个平台中找到 <strong>${results.length}</strong> 条与「${esc(state.query.trim())}」相关的热点</p>`;
    if (!results.length)
      return summary + emptyState('没有找到相关热点', '换个关键词试试，支持空格分隔多个关键词');
    return (
      summary +
      `<ul class="search-results">${results.map(({ p, item }) => itemRow(p, item, kws, { miniBadge: true, big: true })).join('')}</ul>`
    );
  }

  const emptyState = (title, sub) =>
    `<div class="empty-state"><strong>${esc(title)}</strong>${esc(sub)}</div>`;

  function renderBanner() {
    if (state.historyDate) {
      banner.hidden = false;
      banner.innerHTML = `<div class="banner-inner">正在查看 <strong>${esc(state.historyDate)}</strong> 的历史快照（当日最后一次采集）<button class="p-card-more" data-goto-latest type="button">返回最新 →</button></div>`;
    } else {
      banner.hidden = true;
      banner.innerHTML = '';
    }
  }

  function renderUpdateBadge() {
    const { index } = dataset();
    if (!index?.generatedAt) {
      updateBadge.hidden = true;
      return;
    }
    updateBadge.hidden = false;
    if (state.historyDate) {
      updateBadge.textContent = `快照采集于 ${fmtDateTime(index.generatedAt)}`;
      return;
    }
    const next = index.generatedAt + (index.intervalHours || 3) * 3600e3;
    updateBadge.textContent =
      Date.now() < next
        ? `更新于 ${fmtClock(index.generatedAt)} · 下次约 ${fmtClock(next)}`
        : `更新于 ${fmtClock(index.generatedAt)} · 等待下次采集`;
  }

  function renderFooter() {
    const { index } = dataset();
    const ok = index.platforms.filter((p) => p.total > 0).length;
    footerStats.textContent = `覆盖 ${ok} 个平台 · 共 ${index.totalItems} 条热点 · 采集于 ${fmtDateTime(index.generatedAt)}（北京时间）`;
  }

  function renderHistoryOptions() {
    const dates = (state.historyIndex?.dates || []).slice().reverse();
    historySelect.innerHTML =
      '<option value="">最新</option>' +
      dates.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
    historySelect.value = state.historyDate;
  }

  function render() {
    if (!state.loaded) return;
    const kws = keywords();
    renderChips();
    renderBanner();
    renderUpdateBadge();
    renderFooter();
    if (kws.length) content.innerHTML = renderSearch(kws);
    else if (state.view === 'all') content.innerHTML = renderOverview(kws);
    else content.innerHTML = renderPlatform(state.view, kws);
  }

  /* ---------- interactions ---------- */

  function goto(view) {
    state.view = view;
    state.query = '';
    input.value = '';
    clearBtn.hidden = true;
    kbd.hidden = false;
    location.hash = view === 'all' ? '#all' : '#p/' + view;
    render();
  }

  document.addEventListener('click', (e) => {
    const gotoEl = e.target.closest('[data-goto]');
    if (gotoEl) {
      goto(gotoEl.dataset.goto);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (e.target.closest('[data-goto-latest]')) {
      state.historyDate = '';
      state.history = null;
      historySelect.value = '';
      render();
      return;
    }
    if (e.target.closest('[data-retry]')) {
      boot();
    }
  });

  window.addEventListener('hashchange', () => {
    const m = location.hash.match(/^#p\/([\w-]+)$/);
    state.view = m ? m[1] : 'all';
    render();
  });

  let debounce;
  input.addEventListener('input', () => {
    state.query = input.value;
    clearBtn.hidden = !input.value;
    kbd.hidden = !!input.value;
    clearTimeout(debounce);
    debounce = setTimeout(render, 120);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    state.query = '';
    clearBtn.hidden = true;
    kbd.hidden = false;
    input.focus();
    render();
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
    if (e.key === '/' && !typing) {
      e.preventDefault();
      input.focus();
    } else if (e.key === 'Escape' && document.activeElement === input) {
      input.value = '';
      state.query = '';
      clearBtn.hidden = true;
      kbd.hidden = false;
      input.blur();
      render();
    }
  });

  historySelect.addEventListener('change', async () => {
    const date = historySelect.value;
    if (!date) {
      state.historyDate = '';
      state.history = null;
      render();
      return;
    }
    try {
      await loadHistory(date);
      state.historyDate = date;
      render();
    } catch {
      historySelect.value = state.historyDate;
      alert('历史快照加载失败');
    }
  });

  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('hw-theme', next);
  });

  $('#brand').addEventListener('click', () => {
    state.historyDate = '';
    state.history = null;
    historySelect.value = '';
  });

  /* ---------- boot ---------- */

  async function boot() {
    content.innerHTML =
      '<div class="skeleton-grid">' + '<div class="skeleton-card"></div>'.repeat(6) + '</div>';
    try {
      await loadLatest();
      const m = location.hash.match(/^#p\/([\w-]+)$/);
      state.view = m ? m[1] : 'all';
      renderHistoryOptions();
      render();
      setInterval(renderUpdateBadge, 60e3);
    } catch (err) {
      content.innerHTML = `<div class="error-state"><strong>数据加载失败</strong><p>${esc(err.message)}</p><button data-retry type="button">重试</button></div>`;
    }
  }

  boot();
})();