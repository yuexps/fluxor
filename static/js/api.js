window.API = (function() {
    const BASE = window.BASE_URL || '';
    
    function withBase(path) {
        if (!BASE || BASE === '/') return path;
        return BASE.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
    }
    
    async function apiFetch(path, options = {}) {
        try {
            const url = withBase(path);
            console.log('[API] 发送请求:', options.method || 'GET', url);
            const resp = await fetch(url, options);
            if (!resp.ok) {
                console.warn('[API] 响应状态:', resp.status, url);
            }
            return resp;
        } catch (err) {
            console.error('[API] 请求失败:', err, path);
            throw new Error('网络错误: ' + err.message);
        }
    }
    
    function wsConnect(path, onMessage, handlers = {}) {
        const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + withBase(path);
        console.log('[WebSocket] 连接:', wsUrl);
        
        const ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('[WebSocket] 已连接:', path);
            if (handlers.onOpen) handlers.onOpen();
        };
        
        ws.onmessage = (e) => {
            try {
                onMessage(e);
            } catch (err) {
                console.error('[WebSocket] 消息处理错误:', err);
            }
        };
        
        ws.onerror = (e) => {
            console.error('[WebSocket] 连接错误:', e);
            if (handlers.onError) handlers.onError(e);
        };
        
        ws.onclose = (e) => {
            console.log('[WebSocket] 连接已关闭:', path);
            if (handlers.onClose) handlers.onClose(e);
        };
        
        return ws;
    }
    
    return { apiFetch, wsConnect };
})();
