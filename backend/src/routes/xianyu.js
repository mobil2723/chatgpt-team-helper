import express from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { requireMenu } from '../middleware/rbac.js'
import {
  getXianyuConfig,
  updateXianyuConfig,
  getXianyuOrderStats,
  getXianyuOrders,
  recordXianyuSyncResult,
  clearXianyuOrders,
  deleteXianyuOrder,
  queryXianyuOrderDetailFromApi,
  transformXianyuApiOrder,
  transformApiOrderForImport,
  importXianyuOrders,
  getXianyuOrderById,
  normalizeXianyuOrderId,
} from '../services/xianyu-orders.js'
import { getXianyuLoginRefreshState, runXianyuLoginRefreshNow, applyXianyuLoginRefreshConfig } from '../services/xianyu-login-refresh.js'
import { getXianyuWsDeliveryState, triggerXianyuWsDelivery } from '../services/xianyu-ws-delivery.js'
import { sendTelegramBotNotification } from '../services/telegram-notifier.js'
import { requireFeatureEnabled } from '../middleware/feature-flags.js'

const router = express.Router()
let lastSyncResult = null
let syncing = false

const isSyncing = () => syncing
const setSyncing = (value) => {
  syncing = Boolean(value)
}

router.use(requireFeatureEnabled('xianyu'))

router.use(authenticateToken, requireMenu('xianyu_orders'))

router.get('/config', async (req, res) => {
  try {
    const config = await getXianyuConfig()
    if (!config) {
      return res.json({ config: null })
    }
    const sanitizedConfig = {
      ...config,
      cookies: undefined,
      cookiesConfigured: Boolean(config.cookies),
    }
    res.json({ config: sanitizedConfig })
  } catch (error) {
    console.error('[Xianyu Config] 获取配置失败:', error)
    res.status(500).json({ error: '获取配置失败' })
  }
})

router.post('/config', async (req, res) => {
  try {
    const {
      cookies,
      syncEnabled,
      syncIntervalHours,
      wsDeliveryEnabled,
      wsDeliveryMessage,
      wsDeliveryDelaySeconds,
      wsDeliveryKeywords,
      wsDeliveryKeywordsRegex,
      wsDeliveryRetryCount,
      wsDeliveryRetryIntervalSeconds,
      loginRefreshEnabled,
      loginRefreshIntervalMinutes,
    } = req.body || {}

    const updated = await updateXianyuConfig({
      cookies,
      syncEnabled,
      syncIntervalHours,
      wsDeliveryEnabled,
      wsDeliveryMessage,
      wsDeliveryDelaySeconds,
      wsDeliveryKeywords,
      wsDeliveryKeywordsRegex,
      wsDeliveryRetryCount,
      wsDeliveryRetryIntervalSeconds,
      loginRefreshEnabled,
      loginRefreshIntervalMinutes,
    })

    await applyXianyuLoginRefreshConfig(updated).catch(() => {})

    res.json({
      message: '配置已更新',
      config: {
        ...updated,
        cookies: undefined,
        cookiesConfigured: Boolean(updated?.cookies),
      },
    })
  } catch (error) {
    console.error('[Xianyu Config] 更新配置失败:', error)
    res.status(500).json({ error: '配置更新失败' })
  }
})

router.post('/sync', async (req, res) => {
  if (isSyncing()) {
    return res.status(409).json({ error: '同步任务正在运行，请稍后再试' })
  }

  const startedAt = new Date().toISOString()
  let orderId = ''

  try {
    orderId = normalizeXianyuOrderId(req.body?.orderId)
    if (!orderId) {
      return res.status(400).json({ error: '请输入有效的闲鱼订单号' })
    }

    const config = await getXianyuConfig()
    if (!config?.cookies) {
      return res.status(400).json({ error: '请先在配置中粘贴有效的 Cookie' })
    }

    const existingOrder = await getXianyuOrderById(orderId)
    if (existingOrder) {
      return res.json({
        message: '订单已同步',
        order: existingOrder,
        synced: false,
      })
    }

    setSyncing(true)

    const apiResult = await queryXianyuOrderDetailFromApi({ orderId, cookies: config.cookies })
    if (apiResult.cookiesUpdated) {
      await updateXianyuConfig({ cookies: apiResult.cookies })
    }

    const order = transformXianyuApiOrder(apiResult.raw, orderId)
    if (!order?.orderId) {
      throw new Error('订单详情解析失败，请检查订单号是否正确')
    }
    const orderForImport = transformApiOrderForImport(order)
    if (!orderForImport?.orderId) {
      throw new Error('订单详情解析失败，无法写入数据库')
    }
    const importResult = await importXianyuOrders(orderForImport ? [orderForImport] : [])

    await recordXianyuSyncResult({ success: true })

    lastSyncResult = {
      success: true,
      ...importResult,
      startedAt,
      finishedAt: new Date().toISOString(),
    }

    await sendTelegramBotNotification(
      [
        '✅ 闲鱼订单同步完成',
        `订单号：${orderId}`,
        `新增：${importResult.created || 0}`,
        `跳过：${importResult.skipped || 0}`,
        `总计：${importResult.total || 0}`,
      ].join('\n')
    ).catch(() => {})

    const syncedOrder = await getXianyuOrderById(orderId)
    if (!syncedOrder) {
      return res.status(404).json({ error: '未找到对应订单，请确认订单号是否正确' })
    }

    res.json({
      message: '订单同步完成',
      result: importResult,
      order: syncedOrder,
      synced: true,
    })
  } catch (error) {
    console.error('[Xianyu Sync] 同步失败:', error)
    await recordXianyuSyncResult({ success: false, error: error.message }).catch(() => {})
    lastSyncResult = {
      success: false,
      error: error.message,
      startedAt,
      finishedAt: new Date().toISOString(),
    }

    await sendTelegramBotNotification(
      [
        '❌ 闲鱼订单同步失败',
        orderId ? `订单号：${orderId}` : null,
        `原因：${error?.message || '未知错误'}`,
      ].filter(Boolean).join('\n')
    ).catch(() => {})

    res.status(500).json({ error: error.message || '同步失败，请检查 Cookie 是否有效' })
  } finally {
    setSyncing(false)
  }
})

router.get('/status', async (req, res) => {
  try {
    const config = await getXianyuConfig()
    const stats = await getXianyuOrderStats()
    const loginRefresh = getXianyuLoginRefreshState()
    const wsDelivery = getXianyuWsDeliveryState()
    res.json({
      status: {
        cookiesConfigured: Boolean(config?.cookies),
        lastSyncAt: config?.lastSyncAt || null,
        lastSuccessAt: config?.lastSuccessAt || null,
        lastError: config?.lastError || null,
        errorCount: config?.errorCount || 0,
        syncEnabled: config?.syncEnabled ?? false,
        syncIntervalHours: config?.syncIntervalHours ?? 6,
        wsDeliveryEnabled: config?.wsDeliveryEnabled ?? true,
        isSyncing: isSyncing(),
        loginRefresh,
        wsDelivery,
        lastSyncResult,
      },
      stats,
    })
  } catch (error) {
    console.error('[Xianyu Status] 获取状态失败:', error)
    res.status(500).json({ error: '获取状态失败' })
  }
})

router.post('/ws-delivery/trigger', async (req, res) => {
  try {
    const { orderId, chatId, content } = req.body || {}
    const result = await triggerXianyuWsDelivery({ orderId, chatId, content })
    res.json({ message: 'ok', result })
  } catch (error) {
    console.error('[XianyuWsDelivery] trigger failed:', error)
    res.status(400).json({ error: error?.message || '触发失败' })
  }
})

router.post('/refresh-login', async (req, res) => {
  try {
    const result = await runXianyuLoginRefreshNow()
    if (result?.skipped && result.reason === 'no_cookies') {
      return res.status(400).json({ error: '请先在配置中粘贴有效的 Cookie', result })
    }
    res.json({
      message: result?.success ? '登录续期已完成' : '登录续期失败',
      result
    })
  } catch (error) {
    console.error('[Xianyu Refresh Login] 续期失败:', error)
    res.status(500).json({ error: '续期失败，请稍后再试' })
  }
})

router.get('/orders', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100
    const offset = Number(req.query.offset) || 0
    const orders = await getXianyuOrders({ limit, offset })
    const stats = await getXianyuOrderStats()
    res.json({ orders, stats })
  } catch (error) {
    console.error('[Xianyu Orders] 获取订单失败:', error)
    res.status(500).json({ error: '获取订单列表失败' })
  }
})

router.post('/orders/clear', async (req, res) => {
  try {
    const result = await clearXianyuOrders()
    lastSyncResult = null
    res.json({ message: `已删除 ${result.cleared} 条订单`, cleared: result.cleared })
  } catch (error) {
    console.error('[Xianyu Orders] 清理订单失败:', error)
    res.status(500).json({ error: '清理订单失败，请稍后再试' })
  }
})

router.delete('/orders/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: '无效的订单ID' })
    }
    const result = await deleteXianyuOrder(id)
    if (!result.deleted) {
      return res.status(404).json({ error: result.reason || '订单不存在' })
    }
    res.json({ message: '订单已删除' })
  } catch (error) {
    console.error('[Xianyu Orders] 删除订单失败:', error)
    res.status(500).json({ error: '删除订单失败，请稍后再试' })
  }
})

router.post('/api-query', async (req, res) => {
  try {
    const { orderId, cookies } = req.body || {}
    if (!orderId) {
      return res.status(400).json({ error: '缺少 orderId 参数' })
    }
    if (!cookies) {
      return res.status(400).json({ error: '缺少 cookies 参数' })
    }

    const apiResult = await queryXianyuOrderDetailFromApi({ orderId, cookies })
    const order = transformXianyuApiOrder(apiResult.raw, orderId)

    res.json({
      success: true,
      data: {
        order,
        raw: apiResult.raw,
      },
    })
  } catch (error) {
    console.error('[Xianyu API Query] 查询失败:', error)
    res.status(500).json({
      success: false,
      error: error.message || '查询闲鱼订单失败',
    })
  }
})

export default router
