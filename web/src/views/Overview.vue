<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '../utils/api'
import { OpenOutline, RadioOutline } from '@vicons/ionicons5'
import { storeToRefs } from 'pinia'
import { useOverviewStore } from '../store/overview'
import { useConnectionsStore } from '../store/connections'
import { useGlobalStore } from '../store/global'

const { t } = useI18n()

const overviewStore = useOverviewStore()
const { stats, uiPanel, uploadHistory, downloadHistory } = storeToRefs(overviewStore)
const globalStore = useGlobalStore()

const connectionsStore = useConnectionsStore()
const { connectionsCount, uploadTotal, downloadTotal } = storeToRefs(connectionsStore)

const coreVersionDisplay = computed(() => {
  if (stats.value.coreVersion === '加载中...') return t('common.loading')
  if (stats.value.coreVersion === '未知') return t('common.unknown')
  return stats.value.coreVersion
})

const currentNodeDisplay = computed(() => {
  if (stats.value.currentNode === '加载中...') return t('common.loading')
  if (stats.value.currentNode === '内核未启动') return t('config.core_stopped')
  if (stats.value.currentNode === '暂无选择') return t('proxies.empty')
  return stats.value.currentNode
})

const base = window.BASE_URL || ''

// 流量数据点 (最多60个)
const maxPoints = 60
let cachedMaxY = 1024

// Canvas 引用与上下文
const canvasRef = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let dpr = window.devicePixelRatio || 1
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null

// 字节格式转换
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(Math.abs(bytes) || 1) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 获取图表样式色彩
const getChartColors = () => {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light'
  return {
    grid: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.06)',
    upload: '#3b82f6',
    download: '#10b981',
    uploadFill: isDark ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.05)',
    downloadFill: isDark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.05)',
    text: isDark ? '#94a3b8' : '#64748b'
  }
}

// Canvas 绘制折线图
const drawChart = () => {
  if (!ctx || !canvasRef.value) return
  const canvas = canvasRef.value
  const w = canvas.width / dpr
  const h = canvas.height / dpr

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(dpr, dpr)

  if (uploadHistory.value.length < 2 && downloadHistory.value.length < 2) {
    ctx.restore()
    return
  }

  // 动态计算 Y 轴最大值
  let currentMax = 1024
  uploadHistory.value.forEach(v => { if (v > currentMax) currentMax = v })
  downloadHistory.value.forEach(v => { if (v > currentMax) currentMax = v })
  cachedMaxY = Math.max(currentMax, cachedMaxY * 0.95)

  const stepX = w / (maxPoints - 1)
  const colors = getChartColors()
  const chartH = h * 0.9
  const offsetX = (maxPoints - uploadHistory.value.length) * stepX

  // 绘制网格线与 Y 轴刻度
  ctx.strokeStyle = colors.grid
  ctx.lineWidth = 1
  ctx.font = '10px monospace'
  ctx.textAlign = 'right'
  ctx.fillStyle = colors.text
  for (let i = 0; i <= 4; i++) {
    const y = (i / 4) * h
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
    ctx.fillText(formatBytes(cachedMaxY * (1 - i / 4)), w - 4, y - 3)
  }

  // 绘制面积折线
  const drawArea = (data: number[], strokeColor: string, fillColor: string) => {
    if (data.length < 2) return
    if (!ctx) return
    ctx.beginPath()
    for (let i = 0; i < data.length; i++) {
      const x = offsetX + i * stepX
      const y = h - (data[i] / cachedMaxY) * chartH
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 2
    ctx.stroke()

    const lastX = offsetX + (data.length - 1) * stepX
    ctx.lineTo(lastX, h)
    ctx.lineTo(offsetX, h)
    ctx.closePath()
    ctx.fillStyle = fillColor
    ctx.fill()
  }

  drawArea(uploadHistory.value, colors.upload, colors.uploadFill)
  drawArea(downloadHistory.value, colors.download, colors.downloadFill)

  ctx.restore()
}

// 监听历史队列自动重绘
watch(uploadHistory, () => {
  drawChart()
}, { deep: true })

// 获取基础设置（面板和订阅配置相关）
const fetchSubscribeConfig = async () => {
  try {
    const resp = await apiFetch('/subscribe/config')
    if (resp.ok) {
      const cfg = await resp.json()
      uiPanel.value = cfg.ui_panel || 'metacubexd'
    }
  } catch (e) {
    console.warn('获取配置失败，使用默认面板', e)
  }
}

// 初始化 Canvas
const initCanvas = () => {
  const canvas = canvasRef.value
  if (!canvas) return
  ctx = canvas.getContext('2d')
  dpr = window.devicePixelRatio || 1

  const resize = () => {
    const parent = canvas.parentElement
    if (!parent) return
    const w = parent.clientWidth
    if (w === 0) return // 宽度为0说明DOM尚未就绪，拦截改变，避免Canvas被强设为0清空
    const h = 260
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    canvas.width = w * dpr
    canvas.height = h * dpr
    drawChart()
  }

  if (resizeObserver) resizeObserver.disconnect()
  resizeObserver = new ResizeObserver(resize)
  if (canvas.parentElement) {
    resizeObserver.observe(canvas.parentElement)
  }
  resize()
}

// 监听主题变化
const observeTheme = () => {
  if (themeObserver) themeObserver.disconnect()
  themeObserver = new MutationObserver(() => {
    drawChart()
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}

onMounted(() => {
  nextTick(() => {
    fetchSubscribeConfig()
    initCanvas()
    observeTheme()

    // 订阅数据流与状态轮询
    overviewStore.subscribeStatus()
    overviewStore.subscribeTraffic()
    overviewStore.subscribeMemory()
    connectionsStore.subscribe()
  })
})

onUnmounted(() => {
  // 取消订阅
  overviewStore.unsubscribeStatus()
  overviewStore.unsubscribeTraffic()
  overviewStore.unsubscribeMemory()
  connectionsStore.unsubscribe()

  if (resizeObserver) resizeObserver.disconnect()
  if (themeObserver) themeObserver.disconnect()
})
</script>

<template>
  <div class="space-y-6">
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="bg-white dark:bg-[#1e293b] p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all">
        <div class="text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400">{{ t('overview.upload_speed') }}</div>
        <div class="text-sm sm:text-base font-bold text-blue-500 mt-1 select-all">{{ formatBytes(stats.uploadSpeed) }}/s</div>
      </div>
      <div class="bg-white dark:bg-[#1e293b] p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all">
        <div class="text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400">{{ t('overview.download_speed') }}</div>
        <div class="text-sm sm:text-base font-bold text-success mt-1 select-all">{{ formatBytes(stats.downloadSpeed) }}/s</div>
      </div>
      <div class="bg-white dark:bg-[#1e293b] p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all">
        <div class="text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400">{{ t('overview.upload_total') }}</div>
        <div class="text-sm sm:text-base font-bold mt-1 select-all">{{ formatBytes(uploadTotal) }}</div>
      </div>
      <div class="bg-white dark:bg-[#1e293b] p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all">
        <div class="text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400">{{ t('overview.download_total') }}</div>
        <div class="text-sm sm:text-base font-bold mt-1 select-all">{{ formatBytes(downloadTotal) }}</div>
      </div>
      <div class="bg-white dark:bg-[#1e293b] p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all">
        <div class="text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400">{{ t('overview.memory_usage') }}</div>
        <div class="text-sm sm:text-base font-bold mt-1 select-all">{{ stats.memory > 0 ? formatBytes(stats.memory) : 'N/A' }}</div>
      </div>
      <div @click="globalStore.activeTab = 'connections'" class="bg-white dark:bg-[#1e293b] p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all cursor-pointer hover:border-accent/40 hover:shadow-md active:scale-[0.98]">
        <div class="text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400">{{ t('overview.active_connections') }}</div>
        <div class="text-sm sm:text-base font-bold mt-1 select-all">{{ connectionsCount }}</div>
      </div>
      <div class="bg-white dark:bg-[#1e293b] p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all">
        <div class="text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400">{{ t('overview.core_version') }}</div>
        <div class="text-sm sm:text-base font-bold mt-1 select-all truncate" :title="coreVersionDisplay">{{ coreVersionDisplay }}</div>
      </div>
      <div class="bg-white dark:bg-[#1e293b] p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all">
        <a :href="`${base}${uiPanel === 'zashboard' ? '/zash/' : '/meta/'}`" target="_blank" class="block text-slate-800 dark:text-slate-100 decoration-transparent">
          <div class="flex justify-between items-center">
            <span class="text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400">{{ t('overview.external_control') }}</span>
            <OpenOutline class="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div class="text-sm sm:text-base font-bold text-accent mt-1 select-none">{{ uiPanel === 'zashboard' ? 'Zashboard' : 'MetaCubeXD' }}</div>
        </a>
      </div>
    </div>

    <div class="bg-white dark:bg-[#1e293b] p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all flex items-center justify-between gap-4">
      <div class="flex items-center gap-2">
        <RadioOutline class="w-5 h-5 text-accent" />
        <span class="text-xs font-bold text-slate-700 dark:text-slate-300">{{ t('overview.current_node') }}</span>
      </div>
      <div class="text-sm font-semibold text-accent break-all select-all">{{ currentNodeDisplay }}</div>
    </div>

    <div class="bg-white dark:bg-[#1e293b] p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all space-y-4">
      <div class="flex justify-between items-center">
        <h4 class="font-bold text-sm">{{ t('overview.traffic_trend') }}</h4>
        <div class="flex gap-4 text-xs font-semibold">
          <span class="flex items-center gap-1.5 text-blue-500">
            <span class="w-3 h-3 bg-blue-500/20 border border-blue-500/40 rounded"></span> {{ t('overview.upload') }}
          </span>
          <span class="flex items-center gap-1.5 text-success">
            <span class="w-3 h-3 bg-success/20 border border-success/40 rounded"></span> {{ t('overview.download') }}
          </span>
        </div>
      </div>
      <div>
        <canvas ref="canvasRef"></canvas>
      </div>
    </div>
  </div>
</template>
