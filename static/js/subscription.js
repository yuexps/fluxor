// 订阅中心模块
window.Subscription = (function() {
    // ---------- 工具函数 ----------
    function escapeHtml(text) {
        if (!text) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    function t(key) {
        return (window.i18n && window.i18n.t) ? window.i18n.t(key) : key;
    }

    // ---------- 状态变量 ----------
    let currentConfig = { subscriptions: [] };
    let editingIndex = -1;
    let container = null;

    // ---------- API 封装（兼容 window.API 未加载的情况） ----------
    async function apiFetch(path, options = {}) {
        if (window.API && typeof window.API.apiFetch === 'function') {
            return window.API.apiFetch(path, options);
        }
        const BASE = window.BASE_URL || '';
        let url = path;
        if (BASE && BASE !== '/') {
            url = BASE.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
        }
        console.warn('[Subscription] 使用 fallback fetch:', url, options);
        const resp = await fetch(url, options);
        if (!resp.ok) {
            console.warn('[Subscription] fallback fetch 响应状态:', resp.status, url);
        }
        return resp;
    }

    // ---------- 初始化 ----------
    function init() {
        container = document.getElementById('subscription-content');
        console.log('[Subscription] init, container found:', !!container);
        if (!container) return;
        render();
        loadConfig();
    }

    // ---------- 加载配置 ----------
    async function loadConfig() {
        try {
            const resp = await apiFetch('/subscribe/config');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const cfg = await resp.json();
            console.log('[Subscription] 加载到的配置:', cfg);
            currentConfig = cfg;
            // 回填表单
            const proxyPortEl = document.getElementById('subProxyPort');
            const panelPortEl = document.getElementById('subPanelPort');
            const panelSecretEl = document.getElementById('subPanelSecret');
            const ruleGroupEl = document.getElementById('subRuleGroup');
            const prefixSwitchEl = document.getElementById('subPrefixSwitch');
            const uiPanelEl = document.getElementById('subUIPanel');
            const metaBackendEl = document.getElementById('subMetaBackend');
            if (proxyPortEl) proxyPortEl.value = cfg.proxy_port || 7890;
            if (panelPortEl) panelPortEl.value = cfg.panel_port || 9090;
            if (panelSecretEl) panelSecretEl.value = cfg.panel_secret || '';
            if (ruleGroupEl) ruleGroupEl.value = cfg.rule_group || 'none';
            if (prefixSwitchEl) prefixSwitchEl.checked = cfg.prefix_switch || false;
            if (uiPanelEl) uiPanelEl.value = cfg.ui_panel || 'metacubexd';
            if (metaBackendEl) metaBackendEl.value = cfg.meta_backend_url || '';
            togglePrefixMode();
            renderSubList(currentConfig.subscriptions || []);
        } catch (e) {
            console.error('[Subscription] 加载配置失败:', e);
            currentConfig = { subscriptions: [] };
            renderSubList([]);
        }
    }

    // ---------- 渲染主界面 ----------
    function render() {
        if (!container) return;
        container.innerHTML = `
            <div class="card">
                <h3>${t('subscription.title')}</h3>
                <div class="config-row">
                    <label>${t('subscription.proxy_port')}</label>
                    <input type="number" id="subProxyPort" placeholder="例如 7890">
                </div>
                <div class="config-row">
                    <label>${t('subscription.panel_port')}</label>
                    <input type="number" id="subPanelPort" placeholder="例如 9090">
                </div>
                <div class="config-row">
                    <label>${t('subscription.panel_secret')}</label>
                    <div class="password-wrapper" style="position:relative; display:inline-block; width:auto;">
                        <input type="password" id="subPanelSecret" placeholder="${t('subscription.panel_secret')}" style="padding-right:32px;">
                        <button type="button" class="password-toggle" id="toggleSecret" aria-label="显示/隐藏密钥" style="position:absolute; right:4px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; padding:0; color:var(--text-secondary);">
                            <svg class="eye-open" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                            <svg class="eye-closed" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" style="display:none;">
                                <path d="M2 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <line x1="2" y1="2" x2="22" y2="22"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="config-row">
                    <label>${t('subscription.rule_group')}</label>
                    <select id="subRuleGroup">
                        <option value="none" disabled>${t('common.select') || '请选择'}</option>
                        <option value="lite">${t('subscription.rule_group_lite')}</option>
                        <option value="base">${t('subscription.rule_group_base')}</option>
                        <option value="full">${t('subscription.rule_group_full')}</option>
                    </select>
                </div>
                <div class="config-row">
                    <label for="subPrefixSwitch">${t('subscription.prefix_switch')}</label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="subPrefixSwitch">
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="config-row">
                    <label>${t('subscription.ui_panel')}</label>
                    <select id="subUIPanel">
                        <option value="metacubexd">MetaCubeXD</option>
                        <option value="zashboard">Zashboard</option>
                    </select>
                </div>
                <div class="config-row">
                    <label for="subMetaBackend">${t('subscription.meta_backend_url')}</label>
                    <input type="text" id="subMetaBackend" placeholder="http(s)://host:port（留空则不修改）">
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; margin-top: 20px;">
                    <h4>${t('subscription.subscription_list')}</h4>
                    <button class="btn" id="addSubBtn">+ ${t('subscription.add_subscription')}</button>
                </div>
                <div id="subList"></div>

                <div style="margin-top: 20px;">
                    <button class="btn btn-primary" id="saveApplyBtn">${t('subscription.save_and_apply')}</button>
                </div>
            </div>

            <!-- 订阅编辑弹窗 -->
            <div class="modal-overlay" id="subModal">
                <div class="modal">
                    <button type="button" class="modal-close">&times;</button>
                    <h2 id="subModalTitle">${t('subscription.add_modal_title')}</h2>
                    <div class="modal-section">
                        <label>${t('subscription.name')}</label>
                        <input type="text" id="subName" placeholder="${t('subscription.name')}">
                    </div>
                    <div class="modal-section">
                        <label>${t('subscription.url')}</label>
                        <input type="text" id="subUrl" placeholder="https://example.com/sub">
                    </div>
                    <div class="modal-section">
                        <label>${t('subscription.update_interval')}</label>
                        <input type="number" id="subUpdateInterval" placeholder="3600">
                    </div>
                    <div class="modal-section">
                        <label>${t('subscription.health_interval')}</label>
                        <input type="number" id="subHealthInterval" placeholder="300">
                    </div>
                    <div class="modal-section" id="prefixSection" style="display:none;">
                        <label>${t('subscription.prefix')}</label>
                        <input type="text" id="subPrefix" placeholder="[Proxy]">
                    </div>
                    <p class="modal-hint">${t('subscription.modal_hint')}</p>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-cancel">${t('subscription.cancel')}</button>
                        <button type="button" class="btn btn-primary" id="saveSubBtn">${t('subscription.save_to_list')}</button>
                    </div>
                </div>
            </div>
        `;

        // 绑定事件
        bindEvents();
        // 初始化密码可见性（默认隐藏）
        const toggleBtn = document.getElementById('toggleSecret');
        if (toggleBtn) {
            toggleBtn.dataset.visible = 'false';
        }
    }

    // ---------- 事件绑定 ----------
    function bindEvents() {
        document.getElementById('addSubBtn').onclick = () => openSubModal(-1);
        document.getElementById('saveApplyBtn').onclick = saveAndApply;

        const modal = document.getElementById('subModal');
        modal.querySelector('.modal-close').onclick = closeSubModal;
        modal.querySelector('.btn-cancel').onclick = closeSubModal;
        modal.querySelector('#saveSubBtn').onclick = saveSub;

        modal.addEventListener('click', function(e) {
            if (e.target === this) closeSubModal();
        });

        document.getElementById('subPrefixSwitch').addEventListener('change', togglePrefixMode);

        // 密码可见性切换
        const toggleBtn = document.getElementById('toggleSecret');
        const passwordInput = document.getElementById('subPanelSecret');
        if (toggleBtn && passwordInput) {
            toggleBtn.addEventListener('click', function() {
                const isVisible = this.dataset.visible === 'true';
                passwordInput.type = isVisible ? 'password' : 'text';
                this.dataset.visible = isVisible ? 'false' : 'true';
                const openEye = this.querySelector('.eye-open');
                const closedEye = this.querySelector('.eye-closed');
                if (openEye && closedEye) {
                    openEye.style.display = isVisible ? 'block' : 'none';
                    closedEye.style.display = isVisible ? 'none' : 'block';
                }
            });
        }
    }

    // ---------- UI 逻辑 ----------
    function togglePrefixMode() {
        const enabled = document.getElementById('subPrefixSwitch').checked;
        const prefixSection = document.getElementById('prefixSection');
        if (prefixSection) prefixSection.style.display = enabled ? 'block' : 'none';
    }

    function renderSubList(subs) {
        console.log('[Subscription] 渲染订阅列表:', subs);
        const list = document.getElementById('subList');
        if (!list) {
            console.error('[Subscription] #subList 元素不存在');
            return;
        }
        if (!subs || subs.length === 0) {
            list.innerHTML = `<p>${t('subscription.no_subscriptions')}</p>`;
            return;
        }
        const prefixEnabled = document.getElementById('subPrefixSwitch')?.checked || false;
        list.innerHTML = subs.map((sub, idx) => `
            <div class="sub-item">
                <div class="info">
                    <strong>${escapeHtml(sub.name)}</strong><br>
                    <small class="sub-url-container">
                        <button class="sub-url-toggle" data-url="${escapeHtml(sub.url)}" data-hidden="true" style="background:none;border:none;cursor:pointer;padding:0;margin-right:4px;vertical-align:middle;color:var(--text-secondary);">
                            <svg class="eye-open" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="display:block;">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                            <svg class="eye-closed" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="display:none;">
                                <path d="M2 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <line x1="2" y1="2" x2="22" y2="22"/>
                            </svg>
                        </button>
                        <span class="sub-url-display" style="vertical-align:middle;">••••••••</span>
                    </small><br>
                    <small>${t('subscription.update_interval')}: ${sub.update_interval}s</small>
                    <small>${t('subscription.health_interval')}: ${sub.health_interval}s</small>
                    ${prefixEnabled ? `<br><small>${t('subscription.prefix')}: ${escapeHtml(sub.prefix || '')}</small>` : ''}
                </div>
                <div class="actions">
                    <button type="button" class="btn-edit" data-index="${idx}" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text-secondary);">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button type="button" class="btn-delete" data-index="${idx}" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text-secondary);">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');

        document.querySelectorAll('.btn-edit').forEach(btn => {
            btn.onclick = (e) => editSub(parseInt(e.currentTarget.dataset.index));
        });
        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.onclick = (e) => deleteSub(parseInt(e.currentTarget.dataset.index));
        });

        // URL 显示切换（使用 SVG 图标）
        document.querySelectorAll('.sub-url-toggle').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const container = this.closest('.sub-url-container');
                const displaySpan = container.querySelector('.sub-url-display');
                const isHidden = this.dataset.hidden === 'true';
                const openEye = this.querySelector('.eye-open');
                const closedEye = this.querySelector('.eye-closed');
                if (isHidden) {
                    displaySpan.textContent = this.dataset.url;
                    this.dataset.hidden = 'false';
                    openEye.style.display = 'none';
                    closedEye.style.display = 'block';
                } else {
                    displaySpan.textContent = '••••••••';
                    this.dataset.hidden = 'true';
                    openEye.style.display = 'block';
                    closedEye.style.display = 'none';
                }
            });
        });
    }

    function openSubModal(index = -1) {
        editingIndex = index;
        const modal = document.getElementById('subModal');
        if (!modal) return;

        const prefixEnabled = document.getElementById('subPrefixSwitch')?.checked || false;
        const prefixSection = document.getElementById('prefixSection');
        if (prefixSection) prefixSection.style.display = prefixEnabled ? 'block' : 'none';

        if (index >= 0) {
            document.getElementById('subModalTitle').textContent = t('subscription.edit_modal_title');
            const sub = currentConfig.subscriptions[index];
            document.getElementById('subName').value = sub.name || '';
            document.getElementById('subUrl').value = sub.url || '';
            document.getElementById('subUpdateInterval').value = sub.update_interval || 3600;
            document.getElementById('subHealthInterval').value = sub.health_interval || 300;
            document.getElementById('subPrefix').value = sub.prefix || '';
        } else {
            document.getElementById('subModalTitle').textContent = t('subscription.add_modal_title');
            document.getElementById('subName').value = '';
            document.getElementById('subUrl').value = '';
            document.getElementById('subUpdateInterval').value = '';
            document.getElementById('subHealthInterval').value = '';
            document.getElementById('subPrefix').value = '';
        }
        modal.classList.add('active');
    }

    function closeSubModal() {
        document.getElementById('subModal').classList.remove('active');
    }

    function saveSub() {
        const name = document.getElementById('subName').value.trim();
        const url = document.getElementById('subUrl').value.trim();
        if (!name || !url) { alert(t('common.error') + ': ' + t('common.name_required')); return; }

        if (!currentConfig.subscriptions) currentConfig.subscriptions = [];
        const updateInterval = parseInt(document.getElementById('subUpdateInterval').value) || 3600;
        const healthInterval = parseInt(document.getElementById('subHealthInterval').value) || 300;
        const prefix = document.getElementById('subPrefix').value.trim();

        const sub = { name, url, update_interval: updateInterval, health_interval: healthInterval, prefix };
        if (editingIndex >= 0 && editingIndex < currentConfig.subscriptions.length) {
            currentConfig.subscriptions[editingIndex] = sub;
        } else {
            currentConfig.subscriptions.push(sub);
        }
        renderSubList(currentConfig.subscriptions);
        closeSubModal();
    }

    function editSub(index) { openSubModal(index); }
    function deleteSub(index) {
        if (!confirm(t('common.confirm') + ' ' + t('common.delete') + '?')) return;
        currentConfig.subscriptions.splice(index, 1);
        renderSubList(currentConfig.subscriptions);
    }

    // ---------- 持久化 ----------
    async function saveAndApply() {
        if (!validate()) return;
        const payload = {
            proxy_port: parseInt(document.getElementById('subProxyPort').value),
            panel_port: parseInt(document.getElementById('subPanelPort').value),
            panel_secret: document.getElementById('subPanelSecret').value.trim(),
            rule_group: document.getElementById('subRuleGroup').value,
            prefix_switch: document.getElementById('subPrefixSwitch').checked,
            ui_panel: document.getElementById('subUIPanel').value,
            meta_backend_url: document.getElementById('subMetaBackend').value.trim(),
            subscriptions: currentConfig.subscriptions
        };
        try {
            const resp = await apiFetch('/subscribe/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await resp.json();
            if (resp.ok && result.status === 'ok') {
                alert(result.message || t('subscription.apply_success'));
            } else {
                alert(t('subscription.operation_failed') + ': ' + (result.message || result.error || ''));
            }
        } catch (e) {
            alert(t('common.error') + ': ' + e.message);
        }
    }

    function validate() {
        const proxyPort = document.getElementById('subProxyPort').value.trim();
        const panelPort = document.getElementById('subPanelPort').value.trim();
        if (!proxyPort || !panelPort) {
            alert(t('common.error') + ': ' + t('subscription.proxy_port') + ' / ' + t('subscription.panel_port') + ' ' + t('common.required'));
            return false;
        }
        const ruleGroup = document.getElementById('subRuleGroup').value;
        if (ruleGroup === 'none') {
            alert(t('common.error') + ': ' + t('subscription.rule_group') + ' ' + t('common.required'));
            return false;
        }
        return true;
    }

    return { init };
})();