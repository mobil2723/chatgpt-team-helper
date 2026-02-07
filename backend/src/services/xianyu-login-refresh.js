import { getXianyuConfig, refreshXianyuLogin, updateXianyuConfig } from './xianyu-orders.js'
import { getFeatureFlags, isFeatureEnabled } from '../utils/feature-flags.js'

const LABEL = '[XianyuLoginRefresh]'
const DEFAULT_INTERVAL_MINUTES = 30
const MIN_INTERVAL_MINUTES = 5
const MAX_INTERVAL_MINUTES = 24 * 60

let schedulerTimer = null
let jobInProgress = false
let lastResult = null

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue
  }
  if (typeof value === 'boolean') {
    return value
  }
  return ['true', '1', 'yes', 'y', 'on'].includes(String(value).toLowerCase())
}

function parseIntervalMinutes(value, fallback = DEFAULT_INTERVAL_MINUTES) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  const normalized = Number.isFinite(parsed) ? parsed : fallback
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, normalized))
}

async function runRefreshJob(source = 'scheduler') {
  if (jobInProgress) {
    return { success: false, skipped: true, reason: 'job_in_progress' }
  }

  const startedAt = new Date().toISOString()
  jobInProgress = true

  try {
    const features = await getFeatureFlags()
    if (!isFeatureEnabled(features, 'xianyu')) {
      lastResult = {
        success: true,
        skipped: true,
        reason: 'feature_disabled',
        source,
        startedAt,
        finishedAt: new Date().toISOString(),
        cookiesUpdated: false
      }
      return lastResult
    }

    const config = await getXianyuConfig()
    if (!config?.cookies) {
      lastResult = {
        success: false,
        skipped: true,
        reason: 'no_cookies',
        source,
        startedAt,
        finishedAt: new Date().toISOString(),
        cookiesUpdated: false
      }
      return lastResult
    }

    const result = await refreshXianyuLogin({ cookies: config.cookies })

    if (result.cookiesUpdated) {
      await updateXianyuConfig({ cookies: result.cookies })
    }

    lastResult = {
      success: Boolean(result.success),
      cookiesUpdated: Boolean(result.cookiesUpdated),
      tokenRefreshed: Boolean(result.token),
      error: result.error || null,
      source,
      startedAt,
      finishedAt: new Date().toISOString(),
      persisted: Boolean(result.cookiesUpdated)
    }
    return lastResult
  } catch (error) {
    lastResult = {
      success: false,
      error: error?.message || '刷新失败',
      source,
      startedAt,
      finishedAt: new Date().toISOString(),
      cookiesUpdated: false
    }
    return lastResult
  } finally {
    jobInProgress = false
  }
}

function scheduleNextRun(intervalMs) {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer)
    schedulerTimer = null
  }

  schedulerTimer = setTimeout(async () => {
    await runRefreshJob('scheduler')
    scheduleNextRun(intervalMs)
  }, intervalMs)

  schedulerTimer.unref?.()
}

function clearScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer)
    schedulerTimer = null
  }
}

function resolveRefreshConfig(config) {
  const enabled = typeof config?.loginRefreshEnabled === 'boolean'
    ? config.loginRefreshEnabled
    : parseBool(process.env.XIANYU_LOGIN_REFRESH_ENABLED, true)

  const intervalMinutes = parseIntervalMinutes(
    config?.loginRefreshIntervalMinutes ?? process.env.XIANYU_LOGIN_REFRESH_INTERVAL_MINUTES,
    DEFAULT_INTERVAL_MINUTES
  )

  return { enabled, intervalMinutes }
}

export async function applyXianyuLoginRefreshConfig(configOverride = null) {
  clearScheduler()

  const config = configOverride || await getXianyuConfig()
  const { enabled, intervalMinutes } = resolveRefreshConfig(config)

  if (!enabled) {
    console.log(`${LABEL} 自动续期已禁用`)
    return
  }

  const intervalMs = intervalMinutes * 60 * 1000
  console.log(`${LABEL} 自动续期任务已启动，间隔 ${intervalMinutes} 分钟`)
  runRefreshJob('scheduler').catch(() => {})
  scheduleNextRun(intervalMs)
}

export function startXianyuLoginRefreshScheduler() {
  applyXianyuLoginRefreshConfig().catch(() => {})
}

export function getXianyuLoginRefreshState() {
  return {
    jobInProgress,
    lastResult
  }
}

export async function runXianyuLoginRefreshNow() {
  return runRefreshJob('manual')
}
