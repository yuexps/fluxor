// 配置模块：可视化修改核心配置，支持实时保存和操作按钮
window.Config = (function() {
    // 使用全局 API 模块
    const api = window.API;

    // 端口校验（0 或 1025-65535）
    function validateConfig(payload) {
        const ports = ['mixed-port', 'port', 'socks-port', 'redir-port', 'tproxy-port'];
        for (const key of ports) {
            const val = payload[key];
            if (val !== undefined && val !== 0 && (val < 1025 || val > 65535)) {
                console.error(`${key} 端口号必须为 0（禁用）或在 1025-65535 之间`);
                return false;
            }
        }
        const usedPorts = ports.map(k => payload[k]).filter(p => p && p !== 0);
        if (new Set(usedPorts).size !== usedPorts.length) {
            console.error('存在重复的端口配置，请检查');
            return false;
        }
        return true;
    }

    let currentConfig = null;
    let saveTimeout = null;
    let isSaving = false;
    let abortController = null;
    let container = null;

    // 内核状态
    let coreRunning = false;
    let coreStatusTimer = null;

    // 是否正在填充表单（禁止触发保存）
    let _populating = false;

    // 翻译工具
    const t = (key) => (window.i18n && window.i18n.t) ? window.i18n.t(key) : key;

    // ---------- 获取内核配置 ----------
    async function fetchConfig() {
        try {
            const resp = await api.apiFetch('/configs');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            currentConfig = typeof data === 'string' ? JSON.parse(data) : data;
            renderForm();
        } catch (err) {
            console.error('获取配置失败:', err);
            currentConfig = {};
            renderForm();
        }
    }

    // ---------- 收集内核配置表单值 ----------
    function collectCoreFormValues() {
        if (!currentConfig) return null;
        const tun = currentConfig.tun || {};
        return {
            'allow-lan': document.getElementById('cfg-allow-lan').checked,
            'ipv6': document.getElementById('cfg-ipv6').checked,
            mode: document.getElementById('cfg-mode').value,
            'mixed-port': parseInt(document.getElementById('cfg-mixed-port').value) || 7890,
            port: parseInt(document.getElementById('cfg-http-port').value) || 0,
            'socks-port': parseInt(document.getElementById('cfg-socks-port').value) || 0,
            'redir-port': parseInt(document.getElementById('cfg-redir-port').value) || 0,
            'tproxy-port': parseInt(document.getElementById('cfg-tproxy-port').value) || 0,
            'interface-name': document.getElementById('cfg-interface-name').value || null,
            tun: {
                enable: document.getElementById('cfg-tun-enable').checked,
                stack: document.getElementById('cfg-tun-stack').value,
                device: document.getElementById('cfg-tun-device').value || null,
                'auto-route': document.getElementById('cfg-tun-auto-route').checked,
                'dns-hijack': document.getElementById('cfg-tun-dns-hijack').value ?
                    document.getElementById('cfg-tun-dns-hijack').value.split(',').map(s => s.trim()) : null,
                mtu: (() => {
                    const mtuVal = parseInt(document.getElementById('cfg-tun-mtu').value);
                    return isNaN(mtuVal) || mtuVal <= 0 ? undefined : mtuVal;
                })()
            }
        };
    }

    // ---------- 保存内核配置（防抖） ----------
    function saveCoreDebounced() {
        if (_populating) return; // 填充表单时禁止触发保存
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveCore, 500);
    }

    // 立即保存（供弹窗使用）
    async function saveCoreImmediate() {
        if (_populating) return;
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
        }
        await saveCore();
    }

    async function saveCore() {
        if (!currentConfig || isSaving) return;
        const payload = collectCoreFormValues();
        if (!payload || !validateConfig(payload)) return;

        if (abortController) abortController.abort();
        abortController = new AbortController();
        isSaving = true;

        try {
            const resp = await api.apiFetch('/configs', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: abortController.signal
            });
            if (resp.ok) {
                await fetchConfig();
            } else {
                const errText = await resp.text();
                console.error('保存失败响应:', errText);
            }
        } catch (err) {
            if (err.name !== 'AbortError') console.error('保存失败:', err);
        } finally {
            isSaving = false;
            abortController = null;
        }
    }

    // ---------- 内核状态 ----------
    async function fetchCoreStatus() {
        try {
            const resp = await api.apiFetch('/core/status');
            if (!resp.ok) return;
            const data = await resp.json();
            coreRunning = data.running === true;
            updateCoreUI();
        } catch (e) {
            console.warn('[Config] 获取内核状态失败', e);
        }
    }

    function updateCoreUI() {
        const indicator = document.getElementById('core-status-indicator');
        const text = document.getElementById('core-status-text');
        if (indicator) {
            indicator.style.background = coreRunning ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)';
        }
        if (text) {
            text.textContent = coreRunning ? t('config.core_running') : t('config.core_stopped');
        }
        const startBtn = document.getElementById('op-core-start');
        const stopBtn = document.getElementById('op-core-stop');
        if (startBtn) startBtn.disabled = coreRunning;
        if (stopBtn) stopBtn.disabled = !coreRunning;
    }

    function startCoreStatusPolling() {
        if (coreStatusTimer) clearInterval(coreStatusTimer);
        fetchCoreStatus();
        coreStatusTimer = setInterval(fetchCoreStatus, 5000);
    }

    function stopCoreStatusPolling() {
        if (coreStatusTimer) {
            clearInterval(coreStatusTimer);
            coreStatusTimer = null;
        }
    }

    async function startCore() {
        try {
            const resp = await api.apiFetch('/core/start', { method: 'POST' });
            const result = await resp.json();
            if (resp.ok && result.status === 'ok') {
                alert(t('config.core_start_success') || '内核启动成功');
                await fetchCoreStatus();
            } else {
                alert(t('config.core_start_failed') + ': ' + (result.message || result.error || ''));
            }
        } catch (e) {
            alert(t('common.network_error') + ': ' + e.message);
        }
    }

    async function stopCore() {
        if (!confirm(t('config.confirm_stop_core') || '确定要停止内核吗？所有连接将断开。')) return;
        try {
            const resp = await api.apiFetch('/core/stop', { method: 'POST' });
            const result = await resp.json();
            if (resp.ok && result.status === 'ok') {
                alert(t('config.core_stopped_success') || '内核已停止');
                await fetchCoreStatus();
            } else {
                alert(t('config.core_stop_failed') + ': ' + (result.message || result.error || ''));
            }
        } catch (e) {
            alert(t('common.network_error') + ': ' + e.message);
        }
    }

    // ---------- 操作按钮 ----------
    async function reloadConfig() {
        try {
            const resp = await api.apiFetch('/configs', { method: 'PUT' });
            if (resp.ok) {
                await fetchConfig();
                alert(t('config.reload_success') || '配置已热重载');
            } else {
                throw new Error(t('config.reload_failed') || '重载失败');
            }
        } catch (e) {
            alert((t('config.reload_failed') || '重载失败') + ': ' + e.message);
        }
    }

    async function restartCore() {
        if (!confirm(t('config.confirm_restart') || '确定要重启内核吗？所有连接将断开。')) return;
        try {
            const resp = await api.apiFetch('/restart', { method: 'POST' });
            if (!resp.ok) throw new Error(t('config.restart_failed') || '重启失败');
            alert(t('config.restart_sent') || '重启指令已发送');
        } catch (e) {
            alert((t('config.restart_failed') || '重启失败') + ': ' + e.message);
        }
    }

    async function flushFakeIP() {
        try {
            await api.apiFetch('/cache/fakeip/flush', { method: 'POST' });
            alert(t('config.flush_fakeip_success') || 'FakeIP 缓存已清空');
        } catch (e) { alert((t('common.operation_failed') || '操作失败') + ': ' + e.message); }
    }

    async function flushDNSCache() {
        try {
            await api.apiFetch('/cache/dns/flush', { method: 'POST' });
            alert(t('config.flush_dns_success') || 'DNS 缓存已清空');
        } catch (e) { alert((t('common.operation_failed') || '操作失败') + ': ' + e.message); }
    }

    async function updateGeoDB() {
        try {
            let resp = await api.apiFetch('/providers/geo', { method: 'POST' });
            if (!resp.ok) {
                resp = await api.apiFetch('/configs/geo', { method: 'POST' });
            }
            if (resp.ok) {
                alert(t('config.update_geo_sent') || 'GEO 数据库更新请求已发送');
            } else {
                throw new Error(t('config.update_geo_failed') || '更新失败');
            }
        } catch (e) {
            alert((t('config.update_geo_failed') || '更新失败') + ': ' + e.message);
        }
    }

    async function dnsQuery() {
        const domain = document.getElementById('dns-domain').value.trim();
        const type = document.getElementById('dns-type').value;
        if (!domain) return;
        const resultDiv = document.getElementById('dns-result');
        resultDiv.innerText = t('config.dns_querying') || '查询中...';
        try {
            const resp = await api.apiFetch(`/dns/query?name=${encodeURIComponent(domain)}&type=${type}`);
            const data = await resp.json();
            if (data.Status === 0 && data.Answer) {
                resultDiv.innerText = data.Answer.map(a => a.data).join('\n');
            } else {
                resultDiv.innerText = (t('config.dns_query_failed') || '查询失败') + ': ' + (data.message || t('config.dns_no_record') || '无记录');
            }
        } catch (e) {
            resultDiv.innerText = (t('config.dns_query_failed') || '查询失败') + ': ' + e.message;
        }
    }

    // ---------- 语言和主题切换（移动端专用） ----------
    function updateLangButton() {
        const btn = document.getElementById('config-lang-toggle');
        if (!btn) return;
        btn.textContent = t('config.lang_toggle');
    }

    function updateThemeButton() {
        const btn = document.getElementById('config-theme-toggle');
        if (!btn) return;
        btn.textContent = t('config.theme_toggle');
    }

    function toggleLanguage() {
        if (!window.i18n) return;
        const newLang = window.i18n.getLanguage() === 'zh' ? 'en' : 'zh';
        window.i18n.setLanguage(newLang);
        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang: newLang } }));
        // 刷新当前配置页面以应用新语言
        fetchConfig();
        // 同时更新侧边栏语言指示（如有）
        const langToggle = document.getElementById('langToggle');
        if (langToggle) {
            const span = langToggle.querySelector('#currentLang');
            if (span) span.textContent = newLang === 'zh' ? '简' : 'EN';
        }
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const newTheme = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('fluxor-theme', newTheme);
        const moonIcon = document.querySelector('.icon-moon');
        const sunIcon = document.querySelector('.icon-sun');
        if (moonIcon && sunIcon) {
            moonIcon.style.display = newTheme === 'dark' ? 'block' : 'none';
            sunIcon.style.display = newTheme === 'dark' ? 'none' : 'block';
        }
        updateThemeButton();
    }

    // ---------- TUN 设置弹窗 ----------
    function openTunModal() {
        // 从主表单读取当前 TUN 值填充弹窗
        document.getElementById('modal-tun-stack').value = document.getElementById('cfg-tun-stack').value || 'system';
        document.getElementById('modal-tun-device').value = document.getElementById('cfg-tun-device').value || '';
        document.getElementById('modal-tun-auto-route').checked = document.getElementById('cfg-tun-auto-route').checked || false;
        document.getElementById('modal-tun-dns-hijack').value = document.getElementById('cfg-tun-dns-hijack').value || '';
        document.getElementById('modal-tun-mtu').value = document.getElementById('cfg-tun-mtu').value || '';
        document.getElementById('tun-modal').classList.add('active');
    }

    function closeTunModal() {
        document.getElementById('tun-modal').classList.remove('active');
    }

    function saveTunModal() {
        // 将弹窗中的值写回主表单（隐藏字段）
        document.getElementById('cfg-tun-stack').value = document.getElementById('modal-tun-stack').value;
        document.getElementById('cfg-tun-device').value = document.getElementById('modal-tun-device').value;
        document.getElementById('cfg-tun-auto-route').checked = document.getElementById('modal-tun-auto-route').checked;
        document.getElementById('cfg-tun-dns-hijack').value = document.getElementById('modal-tun-dns-hijack').value;
        document.getElementById('cfg-tun-mtu').value = document.getElementById('modal-tun-mtu').value;
        // 触发保存（立即保存）
        saveCoreImmediate();
        closeTunModal();
    }

    // ---------- 渲染界面 ----------
    function renderForm() {
        if (!container) return;
        const tun = currentConfig?.tun || {};
        container.innerHTML = `
            <!-- 内核设置卡片 -->
            <div class="card">
                <h3>${t('config.core_config')}</h3>
                <div class="config-row">
                    <label>${t('config.allow_lan')}</label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="cfg-allow-lan">
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="config-row">
                    <label>IPv6</label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="cfg-ipv6">
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="config-row">
                    <label>${t('config.mode')}</label>
                    <select id="cfg-mode">
                        <option value="rule">${t('config.mode_rule')}</option>
                        <option value="global">${t('config.mode_global')}</option>
                        <option value="direct">${t('config.mode_direct')}</option>
                    </select>
                </div>
                <div class="config-row">
                    <label>${t('config.interface_name')}</label>
                    <input type="text" id="cfg-interface-name" placeholder="${t('config.interface_name_placeholder')}">
                </div>
                <div class="config-row">
                    <label>${t('config.tun')}</label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="cfg-tun-enable">
                        <span class="slider"></span>
                    </label>
                    <button type="button" class="btn-icon" id="tun-gear" title="${t('config.tun_advanced_title')}" style="background:none;border:none;cursor:pointer;padding:0 4px;color:var(--text-secondary);">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                    </button>
                </div>

                <!-- 隐藏的 TUN 详细字段（用于存储值，不显示） -->
                <div style="display:none;">
                    <select id="cfg-tun-stack"><option value="system">system</option><option value="gvisor">gvisor</option><option value="mixed">mixed</option></select>
                    <input type="text" id="cfg-tun-device">
                    <input type="checkbox" id="cfg-tun-auto-route">
                    <input type="text" id="cfg-tun-dns-hijack">
                    <input type="number" id="cfg-tun-mtu">
                </div>

                <h4>${t('config.port_settings')}</h4>
                <div class="config-row">
                    <label>${t('config.mixed_port')}</label>
                    <input type="number" id="cfg-mixed-port">
                </div>
                <div class="config-row">
                    <label>${t('config.http_port')}</label>
                    <input type="number" id="cfg-http-port">
                </div>
                <div class="config-row">
                    <label>${t('config.socks_port')}</label>
                    <input type="number" id="cfg-socks-port">
                </div>
                <div class="config-row">
                    <label>${t('config.redir_port')}</label>
                    <input type="number" id="cfg-redir-port">
                </div>
                <div class="config-row">
                    <label>${t('config.tproxy_port')}</label>
                    <input type="number" id="cfg-tproxy-port">
                </div>
            </div>

            <!-- 操作卡片 -->
            <div class="card">
                <h3>${t('config.actions')}</h3>
                <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
                    <span id="core-status-indicator" style="display:inline-block; width:12px; height:12px; border-radius:50%; background:var(--text-secondary);"></span>
                    <span id="core-status-text" style="font-size:14px; color:var(--text-secondary);">${t('config.core_checking')}</span>
                </div>
                <div class="button-group">
                    <button id="op-core-start" class="btn btn-success">▶ ${t('config.start_core')}</button>
                    <button id="op-core-stop" class="btn btn-danger">⏹ ${t('config.stop_core')}</button>
                    <button id="op-reload" class="btn btn-secondary">${t('config.reload')}</button>
                    <button id="op-restart" class="btn btn-danger">${t('config.restart')}</button>
                    <button id="op-flush-fakeip" class="btn btn-secondary">${t('config.flush_fakeip')}</button>
                    <button id="op-flush-dns" class="btn btn-secondary">${t('config.flush_dns')}</button>
                    <button id="op-update-geo" class="btn btn-secondary">${t('config.update_geo')}</button>
                </div>
            </div>

            <!-- 界面设置卡片（移动端专用语言和主题切换） -->
            <div class="card">
                <h3>${t('config.interface_settings')}</h3>
                <div style="display:flex; gap:12px; flex-wrap:wrap;">
                    <button id="config-lang-toggle" class="btn" style="background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color);">${t('config.lang_toggle')}</button>
                    <button id="config-theme-toggle" class="btn" style="background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color);">${t('config.theme_toggle')}</button>
                </div>
            </div>

            <!-- DNS查询卡片 -->
            <div class="card">
                <h3>${t('config.dns_query')}</h3>
                <div class="dns-query-box">
                    <input type="text" id="dns-domain" placeholder="${t('config.dns_placeholder')}" class="dns-input">
                    <select id="dns-type">
                        <option value="A">A</option>
                        <option value="AAAA">AAAA</option>
                        <option value="MX">MX</option>
                        <option value="TXT">TXT</option>
                    </select>
                    <button id="dns-query" class="btn">${t('config.dns_query_btn')}</button>
                </div>
                <pre id="dns-result" class="dns-result-pre">${t('config.dns_result_default')}</pre>
            </div>

            <!-- TUN 设置弹窗 -->
            <div class="modal-overlay" id="tun-modal">
                <div class="modal" style="max-width:480px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                        <h2 style="margin:0;">${t('config.tun_advanced_title')}</h2>
                        <button type="button" class="modal-close" style="position:static;font-size:1.5em;background:none;border:none;cursor:pointer;color:var(--text-secondary);">&times;</button>
                    </div>
                    <div class="modal-section">
                        <label>${t('config.tun_stack')}</label>
                        <select id="modal-tun-stack">
                            <option value="system">system</option>
                            <option value="gvisor">gvisor</option>
                            <option value="mixed">mixed</option>
                        </select>
                    </div>
                    <div class="modal-section">
                        <label>${t('config.tun_device')}</label>
                        <input type="text" id="modal-tun-device" placeholder="${t('config.tun_device_auto')}">
                    </div>
                    <div class="modal-section">
                        <label>${t('config.auto_route')}</label>
                        <label class="toggle-switch">
                            <input type="checkbox" id="modal-tun-auto-route">
                            <span class="slider"></span>
                        </label>
                    </div>
                    <div class="modal-section">
                        <label>${t('config.dns_hijack')}</label>
                        <input type="text" id="modal-tun-dns-hijack" placeholder="${t('config.dns_hijack_placeholder')}">
                    </div>
                    <div class="modal-section">
                        <label>${t('config.mtu')}</label>
                        <input type="number" id="modal-tun-mtu" placeholder="${t('config.mtu_default')}">
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-cancel" id="tun-modal-cancel">${t('common.cancel')}</button>
                        <button type="button" class="btn btn-primary" id="tun-modal-save">${t('common.save')}</button>
                    </div>
                </div>
            </div>
        `;

        bindEvents();
        populateForm();
        startCoreStatusPolling();
        updateLangButton();
        updateThemeButton();
    }

    // 填充内核配置到表单（使用 _populating 标志防止触发保存）
    function populateForm() {
        if (!currentConfig) return;
        _populating = true;
        try {
            const cfg = currentConfig;
            const tun = cfg.tun || {};
            document.getElementById('cfg-allow-lan').checked = cfg['allow-lan'] || false;
            document.getElementById('cfg-ipv6').checked = cfg['ipv6'] || false;
            document.getElementById('cfg-mode').value = cfg.mode || 'rule';
            document.getElementById('cfg-interface-name').value = cfg['interface-name'] || '';
            document.getElementById('cfg-tun-enable').checked = tun.enable || false;
            // 隐藏字段
            document.getElementById('cfg-tun-stack').value = tun.stack || 'system';
            document.getElementById('cfg-tun-device').value = tun.device || '';
            document.getElementById('cfg-tun-auto-route').checked = tun['auto-route'] || false;
            document.getElementById('cfg-tun-dns-hijack').value = Array.isArray(tun['dns-hijack']) ? tun['dns-hijack'].join(', ') : '';
            document.getElementById('cfg-tun-mtu').value = tun.mtu || '';
            document.getElementById('cfg-mixed-port').value = cfg['mixed-port'] || '';
            document.getElementById('cfg-http-port').value = cfg.port || '';
            document.getElementById('cfg-socks-port').value = cfg['socks-port'] || '';
            document.getElementById('cfg-redir-port').value = cfg['redir-port'] || '';
            document.getElementById('cfg-tproxy-port').value = cfg['tproxy-port'] || '';
        } finally {
            _populating = false;
        }
    }

    function bindEvents() {
        // 自动保存（仅对可见字段绑定，隐藏字段由弹窗控制）
        ['cfg-allow-lan', 'cfg-ipv6', 'cfg-mode', 'cfg-interface-name', 
         'cfg-mixed-port', 'cfg-http-port', 'cfg-socks-port', 'cfg-redir-port', 'cfg-tproxy-port',
         'cfg-tun-enable' // TUN 开关也保留
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', saveCoreDebounced);
                if (el.tagName === 'INPUT' && el.type !== 'checkbox') {
                    el.addEventListener('input', saveCoreDebounced);
                }
            }
        });

        // 操作按钮
        document.getElementById('op-core-start').onclick = startCore;
        document.getElementById('op-core-stop').onclick = stopCore;
        document.getElementById('op-reload').onclick = reloadConfig;
        document.getElementById('op-restart').onclick = restartCore;
        document.getElementById('op-flush-fakeip').onclick = flushFakeIP;
        document.getElementById('op-flush-dns').onclick = flushDNSCache;
        document.getElementById('op-update-geo').onclick = updateGeoDB;
        document.getElementById('dns-query').onclick = dnsQuery;

        // 语言和主题切换
        document.getElementById('config-lang-toggle').addEventListener('click', toggleLanguage);
        document.getElementById('config-theme-toggle').addEventListener('click', toggleTheme);

        // TUN 齿轮按钮
        const gearBtn = document.getElementById('tun-gear');
        if (gearBtn) gearBtn.addEventListener('click', openTunModal);

        // TUN 弹窗事件
        const modal = document.getElementById('tun-modal');
        if (modal) {
            const closeBtn = modal.querySelector('.modal-close');
            const cancelBtn = document.getElementById('tun-modal-cancel');
            const saveBtn = document.getElementById('tun-modal-save');
            if (closeBtn) closeBtn.addEventListener('click', closeTunModal);
            if (cancelBtn) cancelBtn.addEventListener('click', closeTunModal);
            if (saveBtn) saveBtn.addEventListener('click', saveTunModal);
            modal.addEventListener('click', function(e) {
                if (e.target === this) closeTunModal();
            });
        }

        // 监听全局语言变化事件，更新按钮文字
        window.addEventListener('languageChanged', updateLangButton);
    }

    async function init() {
        container = document.getElementById('config-content');
        if (!container) return;
        await fetchConfig();
    }

    function destroy() {
        if (saveTimeout) clearTimeout(saveTimeout);
        if (abortController) abortController.abort();
        stopCoreStatusPolling();
        window.removeEventListener('languageChanged', updateLangButton);
    }

    return { init, destroy };
})();