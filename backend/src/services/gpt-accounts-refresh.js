import axios from 'axios'
import { getDatabase, saveDatabase } from '../database/init.js'
import { parseProxyConfig } from '../utils/proxy.js'
import { resolveProxyForAccount } from './proxy-pool.js'
import { getGptAccountsRefreshSettings } from '../utils/gpt-accounts-refresh-settings.js'

const LABEL = '[GptAccountsAutoRefresh]'
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

let schedulerTimer = null
let jobInProgress = false
let lastResult = null

let socksProxyAgentModulePromise = null
const socksAgentCache = new Map()

async function getSocksProxyAgentModule() {
  if (!socksProxyAgentModulePromise) {
    socksProxyAgentModulePromise = import('socks-proxy-agent')
  }
  return socksProxyAgentModulePromise
}

async function getSocksAgent(proxyUrl) {
  const url = String(proxyUrl || '').trim()
  if (!url) return null
  const cached = socksAgentCache.get(url)
  if (cached) return cached

  let module
  try {
    module = await getSocksProxyAgentModule()
  } catch (error) {
    console.error(`${LABEL} SOCKS 代理依赖缺失（socks-proxy-agent）`, { message: error?.message || String(error) })
    throw new Error('SOCKS5 代理需要安装依赖 socks-proxy-agent')
  }

  const SocksProxyAgent = module?.SocksProxyAgent || module?.default
  if (!SocksProxyAgent) {
    throw new Error('SOCKS5 代理依赖 socks-proxy-agent 加载失败')
  }

  const agent = new SocksProxyAgent(url)
  socksAgentCache.set(url, agent)
  return agent
}

const EXPIRE_AT_REGEX = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/

const formatExpireAt = (date) => {
  const pad = (value) => String(value).padStart(2, '0')
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(date)
    const get = (type) => parts.find(p => p.type === type)?.value || ''
    return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
  } catch {
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }
}

const parseExpireAt = (value) => {
  if (!value) return null
  const raw = String(value || '').trim()
  if (!raw) return null
  if (!EXPIRE_AT_REGEX.test(raw)) return null
  const match = raw.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null

  // 以 Asia/Shanghai（UTC+8）解析为 UTC 时间戳
  const utcMs = Date.UTC(year, month - 1, day, hour - 8, minute, second)
  const date = new Date(utcMs)
  return Number.isNaN(date.getTime()) ? null : date
}

const shouldRefresh = (expireAt, refreshBeforeHours) => {
  if (!expireAt) return true
  const parsed = parseExpireAt(expireAt)
  if (!parsed) return true
  const thresholdMs = Date.now() + refreshBeforeHours * 60 * 60 * 1000
  return parsed.getTime() <= thresholdMs
}

const buildAxiosConfig = async (requestData, proxyUrl) => {
  const proxyConfig = proxyUrl ? parseProxyConfig(proxyUrl) : null
  const isSocks = proxyConfig?.protocol?.startsWith('socks')
  const socksAgent = isSocks ? await getSocksAgent(proxyUrl) : null

  return {
    method: 'POST',
    url: 'https://auth.openai.com/oauth/token',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': requestData.length
    },
    data: requestData,
    timeout: 60000,
    proxy: socksAgent ? false : (proxyConfig || false),
    httpAgent: socksAgent || undefined,
    httpsAgent: socksAgent || undefined,
    validateStatus: () => true
  }
}

const refreshAccountToken = async (account, settings, db) => {
  const refreshToken = String(account.refreshToken || '').trim()
  if (!refreshToken) {
    return { success: false, error: 'missing_refresh_token' }
  }

  let proxyUrl = null
  if (settings.useProxy) {
    const resolved = await resolveProxyForAccount(account.id, { useProxy: true }, db)
    if (resolved?.disabled) {
      return { success: false, error: 'proxy_pool_disabled' }
    }
    if (resolved?.empty || !resolved?.proxyUrl) {
      return { success: false, error: 'proxy_pool_empty' }
    }
    proxyUrl = resolved.proxyUrl
  }

  const requestData = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: OPENAI_CLIENT_ID,
    refresh_token: refreshToken,
    scope: 'openid profile email'
  }).toString()

  const axiosConfig = await buildAxiosConfig(requestData, proxyUrl)
  const response = await axios.request(axiosConfig)

  if (response.status !== 200 || !response.data?.access_token) {
    const message = response.data?.error?.message || response.data?.error_description || response.data?.error || 'refresh_failed'
    return { success: false, error: message, status: response.status }
  }

  const resultData = response.data
  const expiresIn = Number(resultData.expires_in || 3600)
  const tokenExpireAt = formatExpireAt(new Date(Date.now() + expiresIn * 1000))

  db.run(
    `UPDATE gpt_accounts SET token = ?, refresh_token = ?, token_expire_at = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
    [resultData.access_token, resultData.refresh_token || refreshToken, tokenExpireAt, account.id]
  )
  saveDatabase()

  return {
    success: true,
    tokenExpireAt,
    accessToken: resultData.access_token,
    refreshToken: resultData.refresh_token || refreshToken,
    expiresIn
  }
}

async function runRefreshJob(source = 'scheduler') {
  if (jobInProgress) {
    return { success: false, skipped: true, reason: 'job_in_progress' }
  }

  const startedAt = new Date().toISOString()
  jobInProgress = true

  try {
    const db = await getDatabase()
    const settings = await getGptAccountsRefreshSettings(db, { forceRefresh: true })

    if (!settings.enabled) {
      lastResult = {
        success: true,
        skipped: true,
        reason: 'disabled',
        source,
        startedAt,
        finishedAt: new Date().toISOString()
      }
      return lastResult
    }

    const rowsResult = db.exec(
      `
        SELECT id, email, refresh_token, token_expire_at
        FROM gpt_accounts
        WHERE refresh_token IS NOT NULL
          AND refresh_token != ''
          AND COALESCE(is_banned, 0) = 0
      `
    )

    const rows = rowsResult[0]?.values || []
    const accounts = rows.map(row => ({
      id: Number(row[0]),
      email: String(row[1] || ''),
      refreshToken: row[2],
      tokenExpireAt: row[3] || null
    })).filter(item => Number.isFinite(item.id))

    const errors = []
    let refreshed = 0
    let skipped = 0

    for (const account of accounts) {
      if (!shouldRefresh(account.tokenExpireAt, settings.refreshBeforeHours)) {
        skipped += 1
        continue
      }

      try {
        const result = await refreshAccountToken(account, settings, db)
        if (result.success) {
          refreshed += 1
        } else {
          errors.push({ id: account.id, email: account.email, error: result.error || 'refresh_failed' })
        }
      } catch (error) {
        errors.push({ id: account.id, email: account.email, error: error?.message || String(error) })
      }
    }

    lastResult = {
      success: errors.length === 0,
      source,
      startedAt,
      finishedAt: new Date().toISOString(),
      total: accounts.length,
      refreshed,
      skipped,
      failed: errors.length,
      errors: errors.slice(0, 20)
    }
    return lastResult
  } catch (error) {
    lastResult = {
      success: false,
      error: error?.message || 'refresh_failed',
      source,
      startedAt,
      finishedAt: new Date().toISOString()
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

export async function applyGptAccountsAutoRefreshConfig(configOverride = null) {
  clearScheduler()

  const settings = configOverride || await getGptAccountsRefreshSettings(null, { forceRefresh: true })
  if (!settings.enabled) {
    console.log(`${LABEL} 自动刷新已禁用`)
    return
  }

  const intervalMs = settings.intervalMinutes * 60 * 1000
  console.log(`${LABEL} 自动刷新任务启动，间隔 ${settings.intervalMinutes} 分钟`)
  runRefreshJob('scheduler').catch(() => {})
  scheduleNextRun(intervalMs)
}

export function startGptAccountsAutoRefreshScheduler() {
  applyGptAccountsAutoRefreshConfig().catch(() => {})
}

export function getGptAccountsAutoRefreshState() {
  return {
    jobInProgress,
    lastResult
  }
}

export async function runGptAccountsAutoRefreshNow() {
  return runRefreshJob('manual')
}
