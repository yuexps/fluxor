window.Connections = (function() {
    let container = null;
    let wsConn = null;
    let reconnectTimer = null;
    let reconnectDelay = 1000;
    const MAX_RECONNECT_DELAY = 30000;
    const MIN_RENDER_INTERVAL = 200;

    let connMap = new Map();
    let prevSnapshot = new Map();
    let sortBy = 'downloadSpeed';
    let sortAsc = false;
    let filterText = '';
    
    let rafPending = false;
    let isPaused = false;
    let lastRenderTime = 0;
    let pendingRenderTimer = null;

    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[m]);
    }

    function getHost(meta) {
        return meta?.host || meta?.destinationIP || meta?.sourceIP || '?';
    }

    function t(key) {
        return (window.i18n && window.i18n.t) ? window.i18n.t(key) : key;
    }

    function scheduleRender(force = false) {
        if (isPaused && !force) return;
        
        const now = Date.now();
        const elapsed = now - lastRenderTime;
        
        if (elapsed >= MIN_RENDER_INTERVAL || force) {
            if (rafPending) cancelAnimationFrame(rafPending);
            rafPending = requestAnimationFrame(() => {
                rafPending = false;
                lastRenderTime = Date.now();
                renderTable();
            });
        } else if (!pendingRenderTimer) {
            pendingRenderTimer = setTimeout(() => {
                pendingRenderTimer = null;
                scheduleRender(force);
            }, MIN_RENDER_INTERVAL - elapsed);
        }
    }

    function renderTable() {
        const tbody = document.getElementById('connections-tbody');
        const countEl = document.getElementById('conn-count');
        const pauseBtn = document.getElementById('toggle-pause');
        if (!tbody) return;

        if (pauseBtn) {
            pauseBtn.textContent = isPaused ? '▶ ' + t('connections.resume') : '⏸ ' + t('connections.pause');
            pauseBtn.classList.toggle('paused', isPaused);
        }

        let rows = Array.from(connMap.values());
        if (filterText) {
            const lower = filterText.toLowerCase();
            rows = rows.filter(c =>
                getHost(c.meta).toLowerCase().includes(lower) ||
                (c.rule || '').toLowerCase().includes(lower) ||
                (c.chain || []).some(p => p.toLowerCase().includes(lower))
            );
        }

        rows.sort((a, b) => {
            let aVal = a[sortBy] ?? getHost(a.meta);
            let bVal = b[sortBy] ?? getHost(b.meta);
            if (typeof aVal === 'string') { aVal = aVal.toLowerCase(); bVal = bVal.toLowerCase(); }
            if (aVal < bVal) return sortAsc ? -1 : 1;
            if (aVal > bVal) return sortAsc ? 1 : -1;
            return 0;
        });

        if (countEl) countEl.textContent = rows.length;

        const existingRows = new Map();
        tbody.querySelectorAll('tr[data-id]').forEach(tr => existingRows.set(tr.dataset.id, tr));
        const fragment = document.createDocumentFragment();
        const activeIds = new Set();

        for (const conn of rows) {
            activeIds.add(conn.id);
            let tr = existingRows.get(conn.id);
            const host = getHost(conn.meta);
            const port = conn.meta?.destinationPort || '';
            const rule = conn.rule || 'DIRECT';
            const chain = (conn.chain || []).join(' → ') || '-';
            const upSpeed = formatBytes(conn.speedUp || 0) + '/s';
            const downSpeed = formatBytes(conn.speedDown || 0) + '/s';

            if (!tr) {
                tr = document.createElement('tr');
                tr.dataset.id = conn.id;
                tr.innerHTML = `
                    <td class="cell-host" title="${escapeHtml(host)}">${escapeHtml(host)}</td>
                    <td class="cell-port">${escapeHtml(port)}</td>
                    <td class="cell-rule">${escapeHtml(rule)}</td>
                    <td class="cell-chain" title="${escapeHtml(chain)}">${escapeHtml(chain)}</td>
                    <td class="cell-up">${upSpeed}</td>
                    <td class="cell-down">${downSpeed}</td>
                    <td><button class="close-conn-btn" data-id="${escapeHtml(conn.id)}">${t('connections.close')}</button></td>
                `;
                tr.querySelector('.close-conn-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    closeConnection(e.currentTarget.dataset.id);
                });
                fragment.appendChild(tr);
            } else {
                const cells = tr.children;
                if (cells[0].textContent !== host) cells[0].textContent = host;
                if (cells[1].textContent !== port) cells[1].textContent = port;
                if (cells[2].textContent !== rule) cells[2].textContent = rule;
                if (cells[3].textContent !== chain) { cells[3].textContent = chain; cells[3].title = chain; }
                if (cells[4].textContent !== upSpeed) cells[4].textContent = upSpeed;
                if (cells[5].textContent !== downSpeed) cells[5].textContent = downSpeed;
            }
        }

        existingRows.forEach((tr, id) => { if (!activeIds.has(id)) tr.remove(); });
        if (fragment.childNodes.length > 0) tbody.appendChild(fragment);

        let emptyRow = tbody.querySelector('.empty-row');
        if (rows.length === 0 && !emptyRow) {
            emptyRow = document.createElement('tr');
            emptyRow.className = 'empty-row';
            emptyRow.innerHTML = `<td colspan="7" style="text-align:center;padding:40px;color:var(--text-secondary);">${t('connections.empty')}</td>`;
            tbody.appendChild(emptyRow);
        } else if (rows.length > 0 && emptyRow) {
            emptyRow.remove();
        }
    }

    function processConnections(data) {
        const now = Date.now();
        const newSnapshot = new Map();
        const connectionsList = data.connections || [];

        for (const conn of connectionsList) {
            const prev = prevSnapshot.get(conn.id);
            let speedUp = 0, speedDown = 0;
            if (prev) {
                const timeDiff = (now - prev.timestamp) / 1000;
                if (timeDiff > 0) {
                    speedUp = Math.max(0, (conn.upload - prev.upload) / timeDiff);
                    speedDown = Math.max(0, (conn.download - prev.download) / timeDiff);
                }
            }
            newSnapshot.set(conn.id, {
                id: conn.id, meta: conn.metadata,
                upload: conn.upload, download: conn.download,
                speedUp, speedDown, rule: conn.rule, chain: conn.chains, timestamp: now
            });
        }

        connMap = newSnapshot;
        prevSnapshot.clear();
        for (const conn of connectionsList) {
            prevSnapshot.set(conn.id, { upload: conn.upload, download: conn.download, timestamp: now });
        }
        scheduleRender();
    }

    async function closeConnection(id) {
        connMap.delete(id);
        prevSnapshot.delete(id);
        scheduleRender(true);

        try {
            await window.API.apiFetch(`/connections?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        } catch (err) {
            console.error('断开连接失败:', err);
            showToast(t('connections.close_failed') + ': ' + err.message, 'error');
        }
    }

    async function closeAllConnections() {
        if (!confirm(t('connections.confirm_close_all'))) return;
        
        connMap.clear();
        prevSnapshot.clear();
        scheduleRender(true);

        try {
            await window.API.apiFetch('/connections', { method: 'DELETE' });
            showToast(t('connections.close_all_success'), 'success');
        } catch (err) {
            console.error('断开所有连接失败:', err);
            showToast(t('connections.close_all_failed'), 'error');
        }
    }

    function showToast(msg, type = 'info') {
        let toast = document.getElementById('conn-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'conn-toast';
            toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;padding:12px 20px;border-radius:8px;font-size:14px;color:#fff;transition:opacity 0.3s;pointer-events:none;';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#3b82f6';
        toast.style.opacity = '1';
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
    }

    function startWebSocket() {
        if (wsConn) { wsConn.close(); wsConn = null; }
        wsConn = window.API.wsConnect('/connections', (e) => {
            try {
                processConnections(JSON.parse(e.data));
                reconnectDelay = 1000;
            } catch (err) { console.warn('连接数据解析错误', err); }
        });
        const origClose = wsConn.onclose;
        wsConn.onclose = (e) => {
            if (origClose) origClose(e);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(startWebSocket, reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
        };
    }

    function setSort(column) {
        if (sortBy === column) sortAsc = !sortAsc;
        else { sortBy = column; sortAsc = false; }
        document.querySelectorAll('.sortable').forEach(th => {
            th.classList.toggle('active', th.dataset.sort === sortBy);
            th.setAttribute('data-order', th.dataset.sort === sortBy ? (sortAsc ? 'asc' : 'desc') : '');
        });
        scheduleRender(true);
    }

    function render() {
        if (!container) return;
        container.innerHTML = `
            <style>
                .conn-toolbar { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px; }
                .conn-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
                .badge { background:var(--primary-color,#3b82f6); color:#fff; padding:2px 8px; border-radius:10px; font-size:12px; margin-left:8px; }
                .btn { padding:6px 14px; border:none; border-radius:6px; cursor:pointer; font-size:13px; transition:all 0.2s; display:inline-flex; align-items:center; gap:4px; }
                .btn-pause { background:var(--bg-secondary,#f1f5f9); color:var(--text-primary,#1e293b); }
                .btn-pause.paused { background:var(--warning-color,#f59e0b); color:#fff; }
                .btn-danger { background:var(--danger-color,#ef4444); color:#fff; }
                .btn-danger:hover { opacity:0.85; transform:translateY(-1px); }
                .close-conn-btn { padding:3px 10px; border:1px solid var(--border-color,#e2e8f0); border-radius:4px; background:transparent; color:var(--text-secondary,#64748b); cursor:pointer; font-size:12px; transition:all 0.15s; }
                .close-conn-btn:hover { border-color:var(--danger-color,#ef4444); color:var(--danger-color,#ef4444); background:rgba(239,68,68,0.06); }
                .search-box { padding:6px 12px; border:1px solid var(--border-color,#e2e8f0); border-radius:6px; background:var(--bg-primary,#fff); color:var(--text-primary); font-size:13px; min-width:180px; }
            </style>
            <div class="card">
                <div class="conn-toolbar">
                    <h3>${t('connections.title')}<span id="conn-count" class="badge">0</span></h3>
                    <div class="conn-actions">
                        <input type="text" id="conn-filter" class="search-box" placeholder="${t('connections.search_placeholder')}">
                        <button id="toggle-pause" class="btn btn-pause">⏸ ${t('connections.pause')}</button>
                        <button id="close-all-connections" class="btn btn-danger">🗑 ${t('connections.close_all')}</button>
                    </div>
                </div>
                <div class="table-responsive">
                    <table class="connections-table">
                        <thead><tr>
                            <th class="sortable" data-sort="host">${t('connections.host')}</th>
                            <th class="sortable" data-sort="port">${t('connections.port')}</th>
                            <th class="sortable" data-sort="rule">${t('connections.rule')}</th>
                            <th class="sortable" data-sort="chain">${t('connections.chain')}</th>
                            <th class="sortable active" data-sort="uploadSpeed" data-order="desc">↑ ${t('connections.upload_speed')}</th>
                            <th class="sortable" data-sort="downloadSpeed">↓ ${t('connections.download_speed')}</th>
                            <th width="80">${t('connections.action')}</th>
                        </tr></thead>
                        <tbody id="connections-tbody">
                            <tr class="empty-row"><td colspan="7" style="text-align:center;padding:40px;">${t('connections.loading')}</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        document.querySelectorAll('.sortable').forEach(th => th.addEventListener('click', () => setSort(th.dataset.sort)));
        document.getElementById('close-all-connections').addEventListener('click', closeAllConnections);
        document.getElementById('toggle-pause').addEventListener('click', () => {
            isPaused = !isPaused;
            if (!isPaused) scheduleRender(true);
            else renderTable();
        });
        document.getElementById('conn-filter').addEventListener('input', (e) => {
            filterText = e.target.value.trim();
            scheduleRender(true);
        });
        startWebSocket();
    }

    async function init() {
        container = document.getElementById('connections-content');
        if (!container) return;
        render();
    }

    function destroy() {
        if (wsConn) wsConn.close();
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (pendingRenderTimer) clearTimeout(pendingRenderTimer);
        if (rafPending) cancelAnimationFrame(rafPending);
        connMap.clear(); prevSnapshot.clear();
        rafPending = false; isPaused = false;
        reconnectDelay = 1000; lastRenderTime = 0;
    }

    return { init, destroy };
})();
