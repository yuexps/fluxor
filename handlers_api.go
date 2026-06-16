package main

import (
	"io"
	"net/http"
	"strings"
)

// ---------- 仪表盘数据 API ----------

// handleVersion 返回内核版本信息（代理 /version）
func handleVersion(w http.ResponseWriter, r *http.Request) {
	if coreLogger != nil {
		coreLogger.Println("[API] 获取内核版本")
	}
	resp, err := coreRequest("GET", "/version", nil)
	if err != nil {
		if coreLogger != nil {
			coreLogger.Printf("[API][ERROR] 获取版本信息失败: %v\n", err)
		}
		writeJSONError(w, http.StatusBadGateway, "无法获取内核版本: "+err.Error())
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	io.Copy(w, resp.Body)
}

// handleTraffic 返回实时流量信息（代理 /traffic）
func handleTraffic(w http.ResponseWriter, r *http.Request) {
	if coreLogger != nil {
		coreLogger.Println("[API] 获取流量信息")
	}
	resp, err := coreRequest("GET", "/traffic", nil)
	if err != nil {
		if coreLogger != nil {
			coreLogger.Printf("[API][ERROR] 获取流量信息失败: %v\n", err)
		}
		writeJSONError(w, http.StatusBadGateway, "无法获取流量信息: "+err.Error())
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	io.Copy(w, resp.Body)
}

// handleMemory 返回内存使用信息（代理 /memory）
func handleMemory(w http.ResponseWriter, r *http.Request) {
	if coreLogger != nil {
		coreLogger.Println("[API] 获取内存信息")
	}
	resp, err := coreRequest("GET", "/memory", nil)
	if err != nil {
		if coreLogger != nil {
			coreLogger.Printf("[API][ERROR] 获取内存信息失败: %v\n", err)
		}
		writeJSONError(w, http.StatusBadGateway, "无法获取内存信息: "+err.Error())
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	io.Copy(w, resp.Body)
}

// handleConnections 返回连接信息（代理 /connections）
func handleConnections(w http.ResponseWriter, r *http.Request) {
	if coreLogger != nil {
		coreLogger.Println("[API] 获取连接信息")
	}
	resp, err := coreRequest("GET", "/connections", nil)
	if err != nil {
		if coreLogger != nil {
			coreLogger.Printf("[API][ERROR] 获取连接信息失败: %v\n", err)
		}
		writeJSONError(w, http.StatusBadGateway, "无法获取连接信息: "+err.Error())
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	io.Copy(w, resp.Body)
}

// ---------- 配置管理 ----------

// handleConfigsAPI 处理配置的获取、修改和重载
func handleConfigsAPI(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		// 代理内核 GET /configs 获取运行时配置
		if coreLogger != nil {
			coreLogger.Println("[API] 获取配置信息")
		}
		resp, err := coreRequest("GET", "/configs", nil)
		if err != nil {
			if coreLogger != nil {
				coreLogger.Printf("[API][ERROR] 获取配置失败: %v\n", err)
			}
			writeJSONError(w, http.StatusBadGateway, "获取配置失败: "+err.Error())
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Content-Type", "application/json")
		io.Copy(w, resp.Body)

	case http.MethodPatch:
		// 代理内核 PATCH /configs 更新配置
		if coreLogger != nil {
			coreLogger.Println("[API] 修改配置信息")
		}
		resp, err := coreRequest("PATCH", "/configs", r.Body)
		if err != nil {
			if coreLogger != nil {
				coreLogger.Printf("[API][ERROR] 修改配置失败: %v\n", err)
			}
			writeJSONError(w, http.StatusBadGateway, "修改配置失败: "+err.Error())
			return
		}
		defer resp.Body.Close()
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)

	case http.MethodPut:
		// 热重载：PUT /configs?force=true
		if coreLogger != nil {
			coreLogger.Println("[API] 重载配置信息")
		}
		if err := reloadCore(); err != nil {
			if coreLogger != nil {
				coreLogger.Printf("[API][ERROR] 重载配置失败: %v\n", err)
			}
			writeJSONError(w, http.StatusInternalServerError, "重载配置失败: "+err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

// handleRestart 重启内核（POST /restart）
func handleRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "Method Not Allowed")
		return
	}
	if coreLogger != nil {
		coreLogger.Println("[API] 收到内核重启请求")
	}
	resp, err := coreRequest("POST", "/restart", strings.NewReader(`{"path": "", "payload": ""}`))
	if err != nil {
		if coreLogger != nil {
			coreLogger.Printf("[API][ERROR] 重启内核失败: %v\n", err)
		}
		writeJSONError(w, http.StatusBadGateway, "重启内核失败: "+err.Error())
		return
	}
	defer resp.Body.Close()
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// handleConfigsGeo 更新 GEO 数据库（POST /configs/geo）
func handleConfigsGeo(w http.ResponseWriter, r *http.Request) {
	if coreLogger != nil {
		coreLogger.Println("[API] 更新 GEO 数据库")
	}
	resp, err := coreRequest("POST", "/configs/geo", nil)
	if err != nil {
		if coreLogger != nil {
			coreLogger.Printf("[API][ERROR] 更新 GEO 失败: %v\n", err)
		}
		writeJSONError(w, http.StatusBadGateway, "更新 GEO 失败: "+err.Error())
		return
	}
	defer resp.Body.Close()
	w.WriteHeader(resp.StatusCode)
}

// handleProvidersGeo 更新 GEO 数据库（回退接口，POST /providers/geo）
func handleProvidersGeo(w http.ResponseWriter, r *http.Request) {
	if coreLogger != nil {
		coreLogger.Println("[API] 更新 GEO 数据库（回退接口）")
	}
	resp, err := coreRequest("POST", "/providers/geo", nil)
	if err != nil {
		if coreLogger != nil {
			coreLogger.Printf("[API][ERROR] 更新 GEO 失败: %v\n", err)
		}
		writeJSONError(w, http.StatusBadGateway, "更新 GEO 失败: "+err.Error())
		return
	}
	defer resp.Body.Close()
	w.WriteHeader(resp.StatusCode)
}

// handleFlushFakeIP 清空 FakeIP 缓存（POST /cache/fakeip/flush）
func handleFlushFakeIP(w http.ResponseWriter, r *http.Request) {
	if coreLogger != nil {
		coreLogger.Println("[API] 清空 FakeIP 缓存")
	}
	resp, err := coreRequest("POST", "/cache/fakeip/flush", nil)
	if err != nil {
		if coreLogger != nil {
			coreLogger.Printf("[API][ERROR] 清空 FakeIP 失败: %v\n", err)
		}
		writeJSONError(w, http.StatusBadGateway, "清空 FakeIP 失败: "+err.Error())
		return
	}
	defer resp.Body.Close()
	w.WriteHeader(http.StatusOK)
}

// handleFlushDNS 清空 DNS 缓存（POST /cache/dns/flush）
func handleFlushDNS(w http.ResponseWriter, r *http.Request) {
	if coreLogger != nil {
		coreLogger.Println("[API] 清空 DNS 缓存")
	}
	resp, err := coreRequest("POST", "/cache/dns/flush", nil)
	if err != nil {
		if coreLogger != nil {
			coreLogger.Printf("[API][ERROR] 清空 DNS 缓存失败: %v\n", err)
		}
		writeJSONError(w, http.StatusBadGateway, "清空 DNS 缓存失败: "+err.Error())
		return
	}
	defer resp.Body.Close()
	w.WriteHeader(http.StatusOK)
}

// handleDNSQuery 执行 DNS 查询（代理 /dns/query）
func handleDNSQuery(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	qtype := r.URL.Query().Get("type")
	if coreLogger != nil {
		coreLogger.Printf("[API] DNS 查询: name=%s, type=%s\n", name, qtype)
	}
	path := "/dns/query?name=" + name + "&type=" + qtype
	resp, err := coreRequest("GET", path, nil)
	if err != nil {
		if coreLogger != nil {
			coreLogger.Printf("[API][ERROR] DNS 查询失败: %v\n", err)
		}
		writeJSONError(w, http.StatusBadGateway, "DNS 查询失败: "+err.Error())
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	io.Copy(w, resp.Body)
}

// handleConnectionsClose 关闭单个连接或所有连接（DELETE /connections 或 /connections/:id）
func handleConnectionsClose(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	// 从 URL 提取连接 ID（可选）
	id := r.URL.Query().Get("id")
	if coreLogger != nil {
		if id != "" {
			coreLogger.Printf("[API] 关闭连接: %s\n", id)
		} else {
			coreLogger.Println("[API] 关闭所有连接")
		}
	}

	// 调用内核 API 关闭连接
	var path string
	if id != "" {
		path = "/connections?id=" + id
	} else {
		path = "/connections"
	}

	resp, err := coreRequest("DELETE", path, nil)
	if err != nil {
		if coreLogger != nil {
			coreLogger.Printf("[API][ERROR] 关闭连接失败: %v\n", err)
		}
		writeJSONError(w, http.StatusBadGateway, "关闭连接失败: "+err.Error())
		return
	}
	defer resp.Body.Close()
	w.WriteHeader(resp.StatusCode)
}
