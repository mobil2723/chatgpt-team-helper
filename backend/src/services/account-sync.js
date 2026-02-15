import { getDatabase, saveDatabase } from '../database/init.js'
import axios from 'axios'
import { loadProxyList, parseProxyConfig } from '../utils/proxy.js'
import { resolveProxyForAccount, rotateProxyForAccount } from './proxy-pool.js'

export class AccountSyncError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.name = 'AccountSyncError'
    this.status = status
  }
}

const DEFAULT_PROXY_CACHE_TTL_MS = 60_000
let defaultProxyCache = { loadedAt: 0, proxies: [] }
let defaultProxyCursor = 0
const stickyProxyByAccount = new Map()
const accountRequestQueues = new Map()

const withAccountRequestLock = async (accountId, runner) => {
  const numericAccountId = Number(accountId)
  if (!Number.isFinite(numericAccountId) || numericAccountId <= 0) {
    return await runner()
  }

  const prev = accountRequestQueues.get(numericAccountId) || Promise.resolve()
  const runPromise = prev
    .catch(() => {})
    .then(() => runner())

  accountRequestQueues.set(
    numericAccountId,
    runPromise.finally(() => {
      if (accountRequestQueues.get(numericAccountId) === runPromise) {
        accountRequestQueues.delete(numericAccountId)
      }
    })
  )

  return await runPromise
}

const getDefaultProxyList = () => {
  const now = Date.now()
  if (defaultProxyCache.loadedAt && (now - defaultProxyCache.loadedAt) < DEFAULT_PROXY_CACHE_TTL_MS) {
    return defaultProxyCache.proxies
  }

  const proxies = loadProxyList()
  defaultProxyCache = { loadedAt: now, proxies }
  return proxies
}

const pickProxyFromList = (proxies = []) => {
  if (!proxies.length) return null
  const index = Math.abs(defaultProxyCursor++) % proxies.length
  return proxies[index] || null
}

const pickProxyFromEnv = () => {
  const candidates = [
    process.env.CHATGPT_PROXY_URL,
    process.env.CHATGPT_PROXY,
    process.env.ALL_PROXY,
    process.env.all_proxy,
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy
  ]

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim()
    if (!normalized) continue
    const config = parseProxyConfig(normalized)
    if (config) {
      return { url: normalized, config }
    }
  }

  return null
}

const resolveRequestProxy = async (proxy, accountId) => {
  if (proxy === false) return false

  const rawString = typeof proxy === 'string' ? String(proxy).trim() : ''
  if (rawString) {
    if (Number.isFinite(Number(accountId))) stickyProxyByAccount.set(Number(accountId), rawString)
    return rawString
  }
  if (proxy && typeof proxy === 'object') {
    if (Number.isFinite(Number(accountId))) stickyProxyByAccount.delete(Number(accountId))
    return proxy
  }

  const numericAccountId = Number(accountId)
  if (Number.isFinite(numericAccountId)) {
    const cached = stickyProxyByAccount.get(numericAccountId)
    if (cached) return cached
    try {
      const resolved = await resolveProxyForAccount(numericAccountId, { useProxy: true })
      if (resolved?.proxyUrl) {
        stickyProxyByAccount.set(numericAccountId, resolved.proxyUrl)
        return resolved.proxyUrl
      }
    } catch (error) {
      console.warn('[AccountSync] resolve proxy failed', { accountId: numericAccountId, message: error?.message || String(error) })
    }
  }

  const entry = pickProxyFromList(getDefaultProxyList()) || pickProxyFromEnv()
  if (entry?.url && Number.isFinite(Number(accountId))) {
    stickyProxyByAccount.set(Number(accountId), entry.url)
  }
  return entry ? entry.url : null
}

function mapRowToAccount(row) {
  return {
    id: row[0],
    email: row[1],
    token: row[2],
    refreshToken: row[3],
    userCount: row[4],
    inviteCount: row[5],
    chatgptAccountId: row[6],
    oaiDeviceId: row[7],
    expireAt: row[8] || null,
    isOpen: Boolean(row[9]),
    isDemoted: Boolean(row[10]),
    isBanned: Boolean(row[11]),
    createdAt: row[12],
    updatedAt: row[13]
  }
}

async function fetchAccountById(db, accountId) {
  const result = db.exec(
    `
    SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
           COALESCE(is_demoted, 0) AS is_demoted,
           COALESCE(is_banned, 0) AS is_banned,
           created_at, updated_at
    FROM gpt_accounts
    WHERE id = ?
  `,
    [accountId]
  )

  if (result.length === 0 || result[0].values.length === 0) {
    return null
  }

  return mapRowToAccount(result[0].values[0])
}

export async function fetchAllAccounts() {
  const db = await getDatabase()
  const result = db.exec(`
    SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
           COALESCE(is_demoted, 0) AS is_demoted,
           COALESCE(is_banned, 0) AS is_banned,
           created_at, updated_at
    FROM gpt_accounts
    ORDER BY created_at DESC
  `)

  if (result.length === 0) {
    return []
  }

  return result[0].values.map(mapRowToAccount)
}

function buildHeaders(account) {
  return {
    accept: '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    authorization: `Bearer ${account.token}`,
    'chatgpt-account-id': account.chatgptAccountId,
    'oai-client-version': 'prod-eddc2f6ff65fee2d0d6439e379eab94fe3047f72',
    'oai-device-id': account.oaiDeviceId || '',
    'oai-language': 'zh-CN',
    referer: 'https://chatgpt.com/admin/members?tab=members',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
  }
}

const normalizeProxyConfig = (proxy) => {
  if (!proxy) return null
  if (typeof proxy === 'string') return parseProxyConfig(proxy)
  if (typeof proxy === 'object' && proxy.host && proxy.port) {
    const protocol = proxy.protocol ? String(proxy.protocol).replace(':', '').toLowerCase() : 'http'
    if (!['http', 'https', 'socks', 'socks4', 'socks4a', 'socks5', 'socks5h'].includes(protocol)) return null
    const port = Number(proxy.port)
    if (!Number.isFinite(port) || port <= 0) return null

    const auth = proxy.auth && typeof proxy.auth === 'object'
      ? {
          username: proxy.auth.username ? String(proxy.auth.username) : '',
          password: proxy.auth.password ? String(proxy.auth.password) : ''
        }
      : undefined

    return {
      protocol,
      host: String(proxy.host),
      port,
      ...(auth && auth.username ? { auth } : {})
    }
  }

  return null
}

const formatProxyConfigForLog = (proxyConfig) => {
  if (!proxyConfig) return null
  return {
    protocol: proxyConfig.protocol,
    host: proxyConfig.host,
    port: proxyConfig.port
  }
}

const isSocksProxyConfig = (proxyConfig) => {
  if (!proxyConfig) return false
  const protocol = String(proxyConfig.protocol || '').toLowerCase()
  return protocol === 'socks' || protocol.startsWith('socks')
}

const buildProxyUrlFromConfig = (proxyConfig) => {
  if (!proxyConfig) return ''
  const protocol = String(proxyConfig.protocol || '').replace(':', '')
  const host = String(proxyConfig.host || '')
  const port = Number(proxyConfig.port || 0)
  if (!protocol || !host || !Number.isFinite(port) || port <= 0) return ''

  const auth = proxyConfig.auth && typeof proxyConfig.auth === 'object'
    ? {
        username: proxyConfig.auth.username ? String(proxyConfig.auth.username) : '',
        password: proxyConfig.auth.password ? String(proxyConfig.auth.password) : ''
      }
    : null

  const authPart = auth && auth.username
    ? `${encodeURIComponent(auth.username)}:${encodeURIComponent(auth.password || '')}@`
    : ''

  return `${protocol}://${authPart}${host}:${port}`
}

const formatProxyForStore = (proxyConfig, rawProxyUrl) => {
  if (proxyConfig && proxyConfig.host && proxyConfig.port) {
    const protocol = String(proxyConfig.protocol || 'http').replace(':', '')
    const host = String(proxyConfig.host || '')
    const port = Number(proxyConfig.port || 0)
    if (protocol && host && Number.isFinite(port) && port > 0) {
      return `${protocol}://${host}:${port}`
    }
  }

  if (!rawProxyUrl) return ''
  try {
    const parsed = new URL(String(rawProxyUrl))
    const protocol = String(parsed.protocol || '').replace(':', '')
    const host = parsed.hostname || ''
    const port = parsed.port ? `:${parsed.port}` : ''
    if (protocol && host) return `${protocol}://${host}${port}`
  } catch {
    // fallback
  }

  return String(rawProxyUrl)
}

const logProxyApiCall = async ({
  accountId,
  proxyUrl,
  proxyConfig,
  apiUrl,
  method,
  status,
  errorMessage,
  durationMs
}) => {
  if (!proxyUrl) return

  try {
    const db = await getDatabase()
    const proxyIdResult = db.exec('SELECT id FROM proxy_pool WHERE proxy_url = ? LIMIT 1', [proxyUrl])
    const proxyId = proxyIdResult[0]?.values?.[0]?.[0] ?? null
    const proxyLabel = formatProxyForStore(proxyConfig, proxyUrl)

    db.run(
      `
        INSERT INTO proxy_api_logs (
          account_id,
          proxy_id,
          proxy_url,
          proxy_host,
          proxy_port,
          proxy_protocol,
          api_url,
          method,
          status,
          error_message,
          duration_ms,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATETIME('now', 'localtime'))
      `,
      [
        Number.isFinite(Number(accountId)) ? Number(accountId) : null,
        proxyId,
        proxyLabel || null,
        proxyConfig?.host || null,
        Number.isFinite(Number(proxyConfig?.port)) ? Number(proxyConfig.port) : null,
        proxyConfig?.protocol || null,
        apiUrl || null,
        method || null,
        Number.isFinite(Number(status)) ? Number(status) : null,
        errorMessage || null,
        Number.isFinite(Number(durationMs)) ? Number(durationMs) : null
      ]
    )

    await saveDatabase()
  } catch (error) {
    console.warn('[ProxyPool] log api call failed', { message: error?.message || String(error) })
  }
}

let socksProxyAgentModulePromise = null
const socksAgentCache = new Map()

async function getSocksProxyAgentModule() {
  if (!socksProxyAgentModulePromise) {
    socksProxyAgentModulePromise = import('socks-proxy-agent')
  }
  return socksProxyAgentModulePromise
}

async function getSocksAgent(proxyUrl, proxyConfigForLog) {
  const url = String(proxyUrl || '').trim()
  if (!url) return null

  const cached = socksAgentCache.get(url)
  if (cached) return cached

  let module
  try {
    module = await getSocksProxyAgentModule()
  } catch (error) {
    console.error('SOCKS 代理依赖缺失（socks-proxy-agent）', {
      proxy: formatProxyConfigForLog(proxyConfigForLog),
      message: error?.message || String(error)
    })
    throw new AccountSyncError('SOCKS5 代理需要安装依赖 socks-proxy-agent（请在 backend 执行 npm i socks-proxy-agent）', 500)
  }

  const SocksProxyAgent = module?.SocksProxyAgent || module?.default
  if (!SocksProxyAgent) {
    throw new AccountSyncError('SOCKS5 代理依赖 socks-proxy-agent 加载失败', 500)
  }

  const agent = new SocksProxyAgent(url)
  socksAgentCache.set(url, agent)
  return agent
}

async function requestChatgptText(apiUrl, { method, headers, data, proxy } = {}, logContext = {}) {
  return await withAccountRequestLock(logContext?.accountId, async () => {
  const isProxyRetryableStatus = (status) => {
    const code = Number(status)
    if (!Number.isFinite(code)) return true
    if (code === 0) return false
    return code === 407 || code === 502 || code === 504
  }

  const shouldRetrySameProxyStatus = (status) => {
    const code = Number(status)
    return code === 400 || code === 503
  }

  const isCloudflareBlocked403 = (status, text) => {
    if (Number(status) !== 403) return false
    const body = String(text || '').toLowerCase()
    if (!body) return false
    const hasCfSignal =
      body.includes('cloudflare') ||
      body.includes('cf-ray') ||
      body.includes('error 1020') ||
      body.includes('attention required')
    if (!hasCfSignal) return false
    return body.includes('<html') || body.includes('forbidden') || body.includes('access denied')
  }

  const isHttpHttpsProxyProtocol = (proxyConfig) => {
    const protocol = String(proxyConfig?.protocol || '').toLowerCase()
    return protocol === 'http' || protocol === 'https'
  }

  const isHttpToHttpsPortMismatch = (status, text) => {
    if (Number(status) !== 400) return false
    const body = String(text || '').toLowerCase()
    return body.includes('the plain http request was sent to https port')
  }

  const toggleProxyProtocol = (proxyConfig) => {
    if (!proxyConfig || !isHttpHttpsProxyProtocol(proxyConfig)) return null
    const current = String(proxyConfig.protocol || '').toLowerCase()
    const next = current === 'https' ? 'http' : 'https'
    return { ...proxyConfig, protocol: next }
  }

  const attemptRequest = async (resolvedProxy, options = {}) => {
    const startTime = Date.now()
    const rawProxyUrl = typeof resolvedProxy === 'string' ? String(resolvedProxy).trim() : ''
    const proxyConfig = options?.forceProxyConfig || normalizeProxyConfig(resolvedProxy)
    const socksProxyUrl = proxyConfig && isSocksProxyConfig(proxyConfig)
      ? (rawProxyUrl || buildProxyUrlFromConfig(proxyConfig))
      : ''
    const socksAgent = socksProxyUrl ? await getSocksAgent(socksProxyUrl, proxyConfig) : null

    let response
    try {
      response = await axios.request({
        url: apiUrl,
        method: method || 'GET',
        headers,
        data,
        timeout: 60000,
        proxy: socksAgent ? false : (proxyConfig || false),
        httpAgent: socksAgent || undefined,
        httpsAgent: socksAgent || undefined,
        responseType: 'text',
        transformResponse: [d => d],
        validateStatus: () => true
      })
    } catch (error) {
      const durationMs = Date.now() - startTime
      const proxyLookupUrl = proxyConfig ? (rawProxyUrl || buildProxyUrlFromConfig(proxyConfig)) : ''
      await logProxyApiCall({
        accountId: logContext?.accountId,
        proxyUrl: proxyLookupUrl,
        proxyConfig,
        apiUrl,
        method,
        status: null,
        errorMessage: error?.message || String(error),
        durationMs
      })
      return { ok: false, error, proxyConfig, rawProxyUrl }
    }

    const durationMs = Date.now() - startTime
    const proxyLookupUrl = proxyConfig ? (rawProxyUrl || buildProxyUrlFromConfig(proxyConfig)) : ''
    await logProxyApiCall({
      accountId: logContext?.accountId,
      proxyUrl: proxyLookupUrl,
      proxyConfig,
      apiUrl,
      method,
      status: response?.status ?? null,
      errorMessage: null,
      durationMs
    })

    const text = typeof response.data === 'string' ? response.data : (response.data == null ? '' : String(response.data))
    return { ok: true, response, text, proxyConfig, rawProxyUrl }
  }

  const attemptWithSameProxyRetries = async (resolvedProxy, maxAttempts = 3) => {
    let latest = null
    let attemptNo = 0
    while (attemptNo < maxAttempts) {
      attemptNo += 1
      const current = await attemptRequest(resolvedProxy)
      latest = current
      if (!current.ok) {
        return latest
      }

      const status = Number(current.response?.status || 0)
      if (status >= 200 && status < 300) {
        return latest
      }

      if (
        current.proxyConfig &&
        isHttpHttpsProxyProtocol(current.proxyConfig) &&
        isHttpToHttpsPortMismatch(status, current.text)
      ) {
        const switched = toggleProxyProtocol(current.proxyConfig)
        if (switched) {
          const switchedAttempt = await attemptRequest(resolvedProxy, { forceProxyConfig: switched })
          latest = switchedAttempt
          const switchedStatus = Number(switchedAttempt.response?.status || 0)
          if (switchedAttempt.ok && switchedStatus >= 200 && switchedStatus < 300) {
            return latest
          }
          if (!(switchedAttempt.ok && shouldRetrySameProxyStatus(switchedStatus))) {
            return latest
          }
          if (attemptNo >= maxAttempts) return latest
          continue
        }
      }

      if (!shouldRetrySameProxyStatus(status) || attemptNo >= maxAttempts) {
        return latest
      }
    }
    return latest
  }

  const resolvedProxy = await resolveRequestProxy(proxy, logContext?.accountId)
  const firstAttempt = await attemptWithSameProxyRetries(resolvedProxy, 3)

  const firstStatus = firstAttempt.response?.status ?? null
  const shouldRetry = Boolean(
    logContext?.accountId &&
    logContext?.retryOnNon200 !== false &&
    (
      !firstAttempt.ok ||
      (firstStatus !== 200 && isProxyRetryableStatus(firstStatus)) ||
      (firstStatus !== 200 && shouldRetrySameProxyStatus(firstStatus)) ||
      (firstAttempt.proxyConfig && isCloudflareBlocked403(firstStatus, firstAttempt.text))
    )
  )

  if (shouldRetry) {
    const accountId = Number(logContext?.accountId)
    if (Number.isFinite(accountId)) {
      const rotated = await rotateProxyForAccount(accountId, { excludeProxyUrl: firstAttempt.rawProxyUrl })
      if (rotated?.proxyUrl) {
        const secondAttempt = await attemptWithSameProxyRetries(rotated.proxyUrl, 3)
        if (secondAttempt.ok) {
          stickyProxyByAccount.set(accountId, rotated.proxyUrl)
          return { status: secondAttempt.response.status, text: secondAttempt.text, proxyConfig: secondAttempt.proxyConfig }
        }
      }
    }
  }

  if (!firstAttempt.ok) {
    console.error('请求 ChatGPT API 网络错误', {
      ...logContext,
      proxy: formatProxyConfigForLog(firstAttempt.proxyConfig),
      code: firstAttempt.error?.code,
      message: firstAttempt.error?.message || String(firstAttempt.error)
    })
    throw new AccountSyncError('无法连接到 ChatGPT API，请检查网络连接', 503)
  }

  return { status: firstAttempt.response.status, text: firstAttempt.text, proxyConfig: firstAttempt.proxyConfig }
  })
}

const parseJsonOrThrow = (text, { logContext, message }) => {
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error(message, logContext, error)
    throw new AccountSyncError(message, 500)
  }
}

export async function fetchOpenAiAccountInfo(token, proxy = null, options = {}) {
  const normalizedToken = String(token || '').trim().replace(/^Bearer\s+/i, '')
  if (!normalizedToken) {
    throw new AccountSyncError('缺少 access token', 400)
  }

  const apiUrl = 'https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27'
  const headers = {
    accept: '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    authorization: `Bearer ${normalizedToken}`,
    'oai-client-version': 'prod-eddc2f6ff65fee2d0d6439e379eab94fe3047f72',
    'oai-language': 'zh-CN',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
  }

  const numericAccountId = Number(options?.accountId)
  const logContext = {
    url: apiUrl,
    ...(Number.isFinite(numericAccountId) && numericAccountId > 0 ? { accountId: numericAccountId } : {})
  }
  const { status, text } = await requestChatgptText(
    apiUrl,
    { method: 'GET', headers, proxy },
    logContext
  )

  if (status < 200 || status >= 300) {
    if (status === 401) {
      throw new AccountSyncError('Token 已过期或无效', 401)
    }
    throw new AccountSyncError(`OpenAI API 请求失败: ${status}`, status || 500)
  }

  const data = parseJsonOrThrow(text, { logContext, message: 'OpenAI 接口返回格式异常' })
  const accountsMap = data?.accounts && typeof data.accounts === 'object' ? data.accounts : {}
  const ordering = Array.isArray(data?.account_ordering) ? data.account_ordering : []

  const orderedIds = ordering
    .filter(id => typeof id === 'string')
    .filter(id => Object.prototype.hasOwnProperty.call(accountsMap, id))

  const fallbackIds = Object.keys(accountsMap).filter(id => !orderedIds.includes(id))
  const accountIds = [...orderedIds, ...fallbackIds].filter(id => id && id !== 'default')

  if (accountIds.length === 0) {
    throw new AccountSyncError('未找到关联的 ChatGPT 账号', 404)
  }

  // Only keep team accounts (for workspace invite/admin operations).
  return accountIds
    .map(id => {
      const acc = accountsMap[id]
      return {
        accountId: id,
        name: acc?.account?.name || 'Unnamed Team',
        planType: acc?.account?.plan_type || null,
        expiresAt: acc?.entitlement?.expires_at || null,
        hasActiveSubscription: !!acc?.entitlement?.has_active_subscription,
        isDemoted: acc?.account?.account_user_role !== 'account-owner'
      }
    })
    .filter(acc => acc.planType === 'team')
}

const throwChatgptApiStatusError = async ({ status, errorText, logContext, label }) => {
  console.error(label, {
    ...logContext,
    status,
    body: String(errorText || '').slice(0, 2000)
  })

  const rawErrorText = String(errorText || '').trim()
  if (rawErrorText) {
    try {
      const parsed = JSON.parse(rawErrorText)
      const code = parsed?.error?.code || parsed?.code
      if (code === 'account_deactivated') {
        const accountId = Number(logContext?.accountId)
        if (Number.isFinite(accountId)) {
          try {
            const db = await getDatabase()
            db.run(
              `
                UPDATE gpt_accounts
                SET is_open = 0,
                    is_banned = 1,
                    ban_processed = 0,
                    updated_at = DATETIME('now', 'localtime')
                WHERE id = ?
              `,
              [accountId]
            )
            await saveDatabase()
            console.warn('[AccountSync] upstream account_deactivated; auto-banned', { accountId })
          } catch (error) {
            console.error('[AccountSync] auto-ban failed', {
              accountId,
              message: error?.message || String(error)
            })
          }
        }

        throw new AccountSyncError('OpenAI 账号已停用（account_deactivated），已自动标记为封号', 401)
      }
    } catch {
      // ignore parse errors
    }
  }

  if (status === 401) {
    throw new AccountSyncError('Token 已过期或无效，请更新账号 token', 401)
  }
  if (status === 404) {
    throw new AccountSyncError('ChatGPT 账号不存在或无权访问', 404)
  }
  if (status === 429) {
    throw new AccountSyncError('API 请求过于频繁，请稍后重试', 429)
  }

  throw new AccountSyncError(`ChatGPT API 请求失败: ${status}`, status || 500)
}

async function requestAccountInvites(account, params = {}, requestOptions = {}) {
  const parsedLimit = Number.parseInt(params.limit, 10)
  const parsedOffset = Number.parseInt(params.offset, 10)
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 25
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0
  const query = typeof params.query === 'string' ? params.query : ''

  const apiUrl = `https://chatgpt.com/backend-api/accounts/${account.chatgptAccountId}/invites?offset=${offset}&limit=${limit}&query=${encodeURIComponent(query)}`
  const logContext = {
    accountId: account.id,
    chatgptAccountId: account.chatgptAccountId,
    limit,
    offset,
    url: apiUrl
  }

  const { status, text } = await requestChatgptText(
    apiUrl,
    {
      method: 'GET',
      headers: {
        ...buildHeaders(account),
        referer: 'https://chatgpt.com/admin/members?tab=invites'
      },
      proxy: requestOptions.proxy
    },
    logContext
  )

  if (status < 200 || status >= 300) {
    await throwChatgptApiStatusError({
      status,
      errorText: text,
      logContext,
      label: 'ChatGPT API 错误: 获取邀请列表失败'
    })
  }

  const data = parseJsonOrThrow(text, { logContext, message: 'ChatGPT 邀请响应 JSON 解析失败' })

  if (typeof data.total !== 'number') {
    console.error('ChatGPT 邀请响应缺少 total 字段', {
      ...logContext,
      responseSample: JSON.stringify(data).slice(0, 500)
    })
    throw new AccountSyncError('ChatGPT API 响应格式异常，缺少 total 字段', 500)
  }

  if (!Array.isArray(data.items)) {
    console.error('ChatGPT 邀请响应 items 字段异常', {
      ...logContext,
      responseSample: JSON.stringify(data).slice(0, 500)
    })
    data.items = []
  }

  return {
    items: data.items.map(item => ({
      id: item.id,
      email_address: item.email_address,
      role: item.role,
      created_time: item.created_time,
      is_scim_managed: item.is_scim_managed
    })),
    total: data.total,
    limit: typeof data.limit === 'number' ? data.limit : limit,
    offset: typeof data.offset === 'number' ? data.offset : offset
  }
}

async function requestDeleteAccountInvite(account, emailAddress, requestOptions = {}) {
  const trimmedEmail = String(emailAddress || '').trim().toLowerCase()
  if (!trimmedEmail) {
    throw new AccountSyncError('请提供邀请邮箱地址', 400)
  }

  const apiUrl = `https://chatgpt.com/backend-api/accounts/${account.chatgptAccountId}/invites`
  const logContext = {
    accountId: account.id,
    chatgptAccountId: account.chatgptAccountId,
    email: trimmedEmail,
    url: apiUrl
  }

  const { status, text } = await requestChatgptText(
    apiUrl,
    {
      method: 'DELETE',
      headers: {
        ...buildHeaders(account),
        'content-type': 'application/json',
        origin: 'https://chatgpt.com',
        referer: 'https://chatgpt.com/admin/members?tab=invites'
      },
      data: { email_address: trimmedEmail },
      proxy: requestOptions.proxy
    },
    logContext
  )

  if (status < 200 || status >= 300) {
    await throwChatgptApiStatusError({
      status,
      errorText: text,
      logContext,
      label: 'ChatGPT API 错误: 删除邀请失败'
    })
  }

  // 上游可能返回空 body
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function requestAccountUsers(account, params = {}, requestOptions = {}) {
  const parsedLimit = Number.parseInt(params.limit, 10)
  const parsedOffset = Number.parseInt(params.offset, 10)
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 25
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0
  const query = typeof params.query === 'string' ? params.query : ''
  const apiUrl = `https://chatgpt.com/backend-api/accounts/${account.chatgptAccountId}/users?offset=${offset}&limit=${limit}&query=${encodeURIComponent(query)}`
  const logContext = {
    accountId: account.id,
    chatgptAccountId: account.chatgptAccountId,
    limit,
    offset,
    query,
    url: apiUrl
  }

  const { status, text } = await requestChatgptText(
    apiUrl,
    {
      method: 'GET',
      headers: buildHeaders(account),
      proxy: requestOptions.proxy
    },
    logContext
  )

  if (status < 200 || status >= 300) {
    await throwChatgptApiStatusError({
      status,
      errorText: text,
      logContext,
      label: 'ChatGPT API 错误: 获取成员失败'
    })
  }

  const data = parseJsonOrThrow(text, { logContext, message: 'ChatGPT 成员响应 JSON 解析失败' })

  if (typeof data.total !== 'number') {
    console.error('ChatGPT 成员响应缺少 total 字段', {
      ...logContext,
      responseSample: JSON.stringify(data).slice(0, 500)
    })
    throw new AccountSyncError('ChatGPT API 响应格式异常，缺少 total 字段', 500)
  }

  if (!Array.isArray(data.items)) {
    console.error('ChatGPT 成员响应 items 字段异常', {
      ...logContext,
      responseSample: JSON.stringify(data).slice(0, 500)
    })
    data.items = []
  }

  return {
    total: data.total,
    limit: typeof data.limit === 'number' ? data.limit : limit,
    offset: typeof data.offset === 'number' ? data.offset : offset,
    items: data.items.map(item => ({
      id: item.id,
      account_user_id: item.account_user_id,
      email: item.email,
      role: item.role,
      name: item.name,
      created_time: item.created_time,
      is_scim_managed: item.is_scim_managed
    }))
  }
}

export async function fetchAccountUsersList(accountId, options = {}) {
  const db = await getDatabase()
  const account =
    options.accountRecord ||
    (await fetchAccountById(db, accountId))

  if (!account) {
    throw new AccountSyncError('账号不存在', 404)
  }

  if (!account.token || !account.chatgptAccountId) {
    throw new AccountSyncError('账号信息不完整，缺少 token 或 chatgpt_account_id', 400)
  }

  const usersData = await requestAccountUsers(account, options.userListParams, { proxy: options.proxy })
  return usersData
}

export async function syncAccountUserCount(accountId, options = {}) {
  const db = await getDatabase()
  const account =
    options.accountRecord ||
    (await fetchAccountById(db, accountId))

  if (!account) {
    throw new AccountSyncError('账号不存在', 404)
  }

  if (!account.token || !account.chatgptAccountId) {
    throw new AccountSyncError('账号信息不完整，缺少 token 或 chatgpt_account_id', 400)
  }

  const usersData = await requestAccountUsers(account, { ...(options.userListParams || {}), query: '' }, { proxy: options.proxy })

  db.run(
    `UPDATE gpt_accounts SET user_count = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
    [usersData.total, account.id]
  )
  await saveDatabase()

  const updatedAccount = await fetchAccountById(db, account.id)

  return {
    account: updatedAccount,
    syncedUserCount: usersData.total,
    users: usersData
  }
}

export async function fetchAccountInvites(accountId, options = {}) {
  const db = await getDatabase()
  const account =
    options.accountRecord ||
    (await fetchAccountById(db, accountId))

  if (!account) {
    throw new AccountSyncError('账号不存在', 404)
  }

  if (!account.token || !account.chatgptAccountId) {
    throw new AccountSyncError('账号信息不完整，缺少 token 或 chatgpt_account_id', 400)
  }

  const invitesData = await requestAccountInvites(account, options.inviteListParams, { proxy: options.proxy })
  return invitesData
}

export async function syncAccountInviteCount(accountId, options = {}) {
  const db = await getDatabase()
  const account =
    options.accountRecord ||
    (await fetchAccountById(db, accountId))

  if (!account) {
    throw new AccountSyncError('账号不存在', 404)
  }

  if (!account.token || !account.chatgptAccountId) {
    throw new AccountSyncError('账号信息不完整，缺少 token 或 chatgpt_account_id', 400)
  }

  const invitesData = await requestAccountInvites(account, options.inviteListParams, { proxy: options.proxy })

  db.run(
    `UPDATE gpt_accounts SET invite_count = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
    [invitesData.total, account.id]
  )
  await saveDatabase()

  const updatedAccount = await fetchAccountById(db, account.id)

  return {
    account: updatedAccount,
    inviteCount: invitesData.total,
    invites: invitesData
  }
}

export async function deleteAccountInvite(accountId, emailAddress, options = {}) {
  const db = await getDatabase()
  const account =
    options.accountRecord ||
    (await fetchAccountById(db, accountId))

  if (!account) {
    throw new AccountSyncError('账号不存在', 404)
  }

  if (!account.token || !account.chatgptAccountId) {
    throw new AccountSyncError('账号信息不完整，缺少 token 或 chatgpt_account_id', 400)
  }

  const trimmedEmail = String(emailAddress || '').trim()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(trimmedEmail)) {
    throw new AccountSyncError('邮箱格式不正确', 400)
  }

  const result = await requestDeleteAccountInvite(account, trimmedEmail, { proxy: options.proxy })
  const synced = await syncAccountInviteCount(account.id, {
    accountRecord: account,
    inviteListParams: { offset: 0, limit: 1, query: '' },
    proxy: options.proxy
  })

  return {
    message: '邀请删除成功',
    result,
    account: synced.account,
    inviteCount: synced.inviteCount
  }
}

export async function deleteAccountUser(accountId, userId, options = {}) {
  if (!userId) {
    throw new AccountSyncError('缺少用户ID', 400)
  }

  const db = await getDatabase()
  const account =
    options.accountRecord ||
    (await fetchAccountById(db, accountId))

  if (!account) {
    throw new AccountSyncError('账号不存在', 404)
  }

  if (!account.token || !account.chatgptAccountId) {
    throw new AccountSyncError('账号信息不完整，缺少 token 或 chatgpt_account_id', 400)
  }

  const normalizedUserId = userId.startsWith('user-') ? userId : `user-${userId}`
  const apiUrl = `https://chatgpt.com/backend-api/accounts/${account.chatgptAccountId}/users/${normalizedUserId}`
  const deleteLogContext = {
    accountId: account.id,
    chatgptAccountId: account.chatgptAccountId,
    userId: normalizedUserId,
    url: apiUrl
  }

  console.info('开始删除 ChatGPT 成员', deleteLogContext)
  const { status, text } = await requestChatgptText(
    apiUrl,
    { method: 'DELETE', headers: buildHeaders(account), proxy: options.proxy },
    deleteLogContext
  )

  if (status < 200 || status >= 300) {
    console.error('删除 ChatGPT 用户错误:', {
      ...deleteLogContext,
      status,
      body: String(text || '').slice(0, 2000)
    })

    if (status === 401) {
      throw new AccountSyncError('Token 已过期或无效，请更新账号 token', 401)
    }
    if (status === 404) {
      throw new AccountSyncError('指定的用户不存在或无权访问', 404)
    }
    if (status === 429) {
      throw new AccountSyncError('API 请求过于频繁，请稍后重试', 429)
    }

    throw new AccountSyncError(`ChatGPT API 请求失败: ${status}`, status)
  }

  const usersData = await requestAccountUsers(account, options.userListParams, { proxy: options.proxy })

  db.run(
    `UPDATE gpt_accounts SET user_count = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
    [usersData.total, account.id]
  )
  await saveDatabase()

  const updatedAccount = await fetchAccountById(db, account.id)

  return {
    account: updatedAccount,
    syncedUserCount: usersData.total,
    users: usersData
  }
}

export async function inviteAccountUser(accountId, email, options = {}) {
  if (!email || typeof email !== 'string') {
    throw new AccountSyncError('请提供邀请邮箱地址', 400)
  }

  const trimmedEmail = email.trim()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(trimmedEmail)) {
    throw new AccountSyncError('邮箱格式不正确', 400)
  }

  const db = await getDatabase()
  const account =
    options.accountRecord ||
    (await fetchAccountById(db, accountId))

  if (!account) {
    throw new AccountSyncError('账号不存在', 404)
  }

  if (!account.token || !account.chatgptAccountId) {
    throw new AccountSyncError('账号信息不完整，缺少 token 或 chatgpt_account_id', 400)
  }

  const apiUrl = `https://chatgpt.com/backend-api/accounts/${account.chatgptAccountId}/invites`
  const payload = {
    email_addresses: [trimmedEmail],
    role: 'standard-user',
    resend_emails: true
  }

  const headers = {
    ...buildHeaders(account),
    'content-type': 'application/json',
    origin: 'https://chatgpt.com',
    referer: 'https://chatgpt.com/admin/members'
  }

  const inviteLogContext = {
    accountId: account.id,
    chatgptAccountId: account.chatgptAccountId,
    email: trimmedEmail,
    url: apiUrl
  }

  const { status, text } = await requestChatgptText(
    apiUrl,
    { method: 'POST', headers, data: payload, proxy: options.proxy },
    inviteLogContext
  )

  if (status < 200 || status >= 300) {
    console.error('发送邀请失败:', status, String(text || '').slice(0, 2000))

    if (status === 401) {
      throw new AccountSyncError('Token 已过期或无效，请更新账号 token', 401)
    }
    if (status === 404) {
      throw new AccountSyncError('ChatGPT 账号不存在或无权访问', 404)
    }
    if (status === 429) {
      throw new AccountSyncError('API 请求过于频繁，请稍后重试', 429)
    }

    throw new AccountSyncError(`ChatGPT API 请求失败: ${status}`, status)
  }

  const data = parseJsonOrThrow(text, { logContext: inviteLogContext, message: '邀请接口返回格式异常，无法解析' })

  return {
    message: '邀请已发送',
    invite: data
  }
}
