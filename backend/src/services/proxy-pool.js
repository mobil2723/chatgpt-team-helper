import axios from 'axios'
import { getDatabase, saveDatabase } from '../database/init.js'
import { parseProxyConfig } from '../utils/proxy.js'

const DEFAULTS = {
  enabled: true,
  maxAccountsPerProxy: 2,
  checkIntervalMinutes: 60,
  rotationDays: 10,
  testUrl: 'https://example.com',
  testTimeoutMs: 8000,
  validationScope: 'ok'
}

const SETTINGS_KEYS = {
  enabled: 'proxy_pool_enabled',
  maxAccountsPerProxy: 'proxy_pool_max_accounts_per_proxy',
  checkIntervalMinutes: 'proxy_pool_check_interval_minutes',
  rotationDays: 'proxy_pool_rotation_days',
  testUrl: 'proxy_pool_test_url',
  testTimeoutMs: 'proxy_pool_test_timeout_ms',
  validationScope: 'proxy_pool_validation_scope'
}

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
  const { SocksProxyAgent } = await getSocksProxyAgentModule()
  const agent = new SocksProxyAgent(url)
  socksAgentCache.set(url, agent)
  return agent
}

const normalizeProxyListInput = (value) => {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean)
  }

  const raw = String(value || '').trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map(item => String(item || '').trim()).filter(Boolean)
      }
    } catch {
      // fallthrough
    }
  }

  return raw
    .split(/[\n,;]+/g)
    .map(item => String(item || '').trim())
    .filter(Boolean)
}

const coerceBoolean = (value, fallback) => {
  if (typeof value === 'boolean') return value
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

const coerceNumber = (value, fallback, { min = null, max = null } = {}) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  let next = parsed
  if (typeof min === 'number') next = Math.max(min, next)
  if (typeof max === 'number') next = Math.min(max, next)
  return next
}

const getSystemConfigValue = (db, key) => {
  if (!db || !key) return null
  try {
    const result = db.exec('SELECT config_value FROM system_config WHERE config_key = ? LIMIT 1', [key])
    return result[0]?.values?.[0]?.[0] ?? null
  } catch {
    return null
  }
}

export const getProxyPoolSettings = async (db) => {
  const database = db || await getDatabase()
  const enabledRaw = getSystemConfigValue(database, SETTINGS_KEYS.enabled)
  const maxRaw = getSystemConfigValue(database, SETTINGS_KEYS.maxAccountsPerProxy)
  const intervalRaw = getSystemConfigValue(database, SETTINGS_KEYS.checkIntervalMinutes)
  const rotationRaw = getSystemConfigValue(database, SETTINGS_KEYS.rotationDays)
  const testUrlRaw = getSystemConfigValue(database, SETTINGS_KEYS.testUrl)
  const testTimeoutRaw = getSystemConfigValue(database, SETTINGS_KEYS.testTimeoutMs)
  const validationScopeRaw = getSystemConfigValue(database, SETTINGS_KEYS.validationScope)
  const normalizedScope = String(validationScopeRaw || DEFAULTS.validationScope).trim().toLowerCase()
  const validationScope = normalizedScope === 'all' ? 'all' : 'ok'

  return {
    enabled: coerceBoolean(enabledRaw, DEFAULTS.enabled),
    maxAccountsPerProxy: coerceNumber(maxRaw, DEFAULTS.maxAccountsPerProxy, { min: 1, max: 50 }),
    checkIntervalMinutes: coerceNumber(intervalRaw, DEFAULTS.checkIntervalMinutes, { min: 1, max: 1440 }),
    rotationDays: coerceNumber(rotationRaw, DEFAULTS.rotationDays, { min: 1, max: 365 }),
    testUrl: String(testUrlRaw || DEFAULTS.testUrl).trim(),
    testTimeoutMs: coerceNumber(testTimeoutRaw, DEFAULTS.testTimeoutMs, { min: 2000, max: 60000 }),
    validationScope
  }
}

export const listProxyPool = async (db) => {
  const database = db || await getDatabase()
  const result = database.exec(`
    SELECT p.id, p.proxy_url, p.label, p.status, p.last_check_at, p.last_ok_at, p.last_error, p.fail_count, p.success_count,
           p.created_at, p.updated_at,
           COUNT(a.id) AS assigned_count
    FROM proxy_pool p
    LEFT JOIN proxy_assignments a ON a.proxy_id = p.id
    GROUP BY p.id
    ORDER BY p.id DESC
  `)

  const rows = result[0]?.values || []
  return rows.map(row => ({
    id: row[0],
    proxyUrl: row[1],
    label: row[2],
    status: row[3] || 'unknown',
    lastCheckAt: row[4] || null,
    lastOkAt: row[5] || null,
    lastError: row[6] || null,
    failCount: Number(row[7] || 0),
    successCount: Number(row[8] || 0),
    createdAt: row[9] || null,
    updatedAt: row[10] || null,
    assignedCount: Number(row[11] || 0)
  }))
}

export const getProxyPoolStats = async (db) => {
  const proxies = await listProxyPool(db)
  const stats = {
    total: proxies.length,
    ok: 0,
    bad: 0,
    unknown: 0,
    assigned: 0
  }
  for (const proxy of proxies) {
    if (proxy.status === 'ok') stats.ok += 1
    else if (proxy.status === 'bad') stats.bad += 1
    else stats.unknown += 1
    if (proxy.assignedCount > 0) stats.assigned += 1
  }
  return { stats, proxies }
}

export const upsertProxyPool = async (input, db) => {
  const database = db || await getDatabase()
  const rawList = normalizeProxyListInput(input)
  const normalized = []
  const invalid = []
  const seen = new Set()

  for (const item of rawList) {
    const trimmed = String(item || '').trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    const parsed = parseProxyConfig(trimmed)
    if (!parsed) {
      invalid.push(trimmed)
      continue
    }
    normalized.push(trimmed)
  }

  const existingResult = database.exec('SELECT id, proxy_url FROM proxy_pool')
  const existingRows = existingResult[0]?.values || []
  const existingMap = new Map(existingRows.map(row => [String(row[1]), row[0]]))

  const nextSet = new Set(normalized)

  for (const url of normalized) {
    if (existingMap.has(url)) continue
    database.run(
      `INSERT INTO proxy_pool (proxy_url, status, created_at, updated_at) VALUES (?, 'unknown', DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))`,
      [url]
    )
  }

  for (const [url, id] of existingMap.entries()) {
    if (nextSet.has(url)) continue
    database.run('DELETE FROM proxy_assignments WHERE proxy_id = ?', [id])
    database.run('DELETE FROM proxy_pool WHERE id = ?', [id])
  }

  await saveDatabase()
  return { invalid }
}

const isSocksProtocol = (proxyConfig) => {
  if (!proxyConfig) return false
  const protocol = String(proxyConfig.protocol || '').toLowerCase()
  return protocol === 'socks' || protocol.startsWith('socks')
}

const buildAxiosProxyConfig = (proxyConfig) => {
  if (!proxyConfig) return null
  const auth = proxyConfig.auth && typeof proxyConfig.auth === 'object'
    ? {
        username: proxyConfig.auth.username || '',
        password: proxyConfig.auth.password || ''
      }
    : undefined
  return {
    protocol: String(proxyConfig.protocol || 'http'),
    host: String(proxyConfig.host || ''),
    port: Number(proxyConfig.port || 0),
    ...(auth && auth.username ? { auth } : {})
  }
}

export const probeProxy = async (proxyUrl, settings) => {
  const config = parseProxyConfig(proxyUrl)
  if (!config) {
    return { ok: false, status: 'invalid', error: 'invalid proxy url' }
  }

  const axiosConfig = {
    method: 'GET',
    url: settings.testUrl,
    timeout: settings.testTimeoutMs,
    headers: {
      'user-agent': 'Mozilla/5.0 proxy-check'
    },
    validateStatus: () => true
  }

  const isSocks = isSocksProtocol(config)
  if (isSocks) {
    const agent = await getSocksAgent(proxyUrl)
    axiosConfig.proxy = false
    axiosConfig.httpAgent = agent
    axiosConfig.httpsAgent = agent
  } else {
    axiosConfig.proxy = buildAxiosProxyConfig(config)
  }

  try {
    const response = await axios(axiosConfig)
    const status = response.status
    const ok = status >= 200 && status < 500
    return { ok, status, error: ok ? null : `http ${status}` }
  } catch (error) {
    return { ok: false, status: 'error', error: error?.message || String(error) }
  }
}

export const validateProxyPool = async ({ proxyIds } = {}, db) => {
  const database = db || await getDatabase()
  const settings = await getProxyPoolSettings(database)
  const proxies = await listProxyPool(database)
  const idSet = Array.isArray(proxyIds) && proxyIds.length
    ? new Set(proxyIds.map(id => Number(id)))
    : null

  const targets = idSet ? proxies.filter(p => idSet.has(Number(p.id))) : proxies
  const results = []

  const concurrency = 3
  for (let i = 0; i < targets.length; i += concurrency) {
    const chunk = targets.slice(i, i + concurrency)
    const responses = await Promise.all(chunk.map(async proxy => {
      const outcome = await probeProxy(proxy.proxyUrl, settings)
      const now = "DATETIME('now', 'localtime')"
      const lastOkSql = outcome.ok ? now : 'last_ok_at'
      const statusValue = outcome.ok ? 'ok' : 'bad'
      const failCount = outcome.ok ? proxy.failCount : (proxy.failCount + 1)
      const successCount = outcome.ok ? (proxy.successCount + 1) : proxy.successCount
      const lastError = outcome.ok ? '' : String(outcome.error || '')

      database.run(
        `
        UPDATE proxy_pool
        SET status = ?,
            last_check_at = ${now},
            last_ok_at = ${lastOkSql},
            last_error = ?,
            fail_count = ?,
            success_count = ?,
            updated_at = ${now}
        WHERE id = ?
        `,
        [statusValue, lastError, failCount, successCount, proxy.id]
      )

      return { id: proxy.id, proxyUrl: proxy.proxyUrl, ok: outcome.ok, status: statusValue, error: outcome.error || null }
    }))
    results.push(...responses)
  }

  await saveDatabase()
  const okCount = results.filter(r => r.ok).length
  return {
    total: results.length,
    ok: okCount,
    bad: results.length - okCount,
    results
  }
}

const VALIDATE_CONCURRENCY = 3
const runningValidationJobs = new Set()

const fetchProxiesForValidation = (database, proxyIds, options = {}) => {
  if (Array.isArray(proxyIds) && proxyIds.length) {
    const result = database.exec('SELECT id, proxy_url FROM proxy_pool')
    const rows = result[0]?.values || []
    const proxies = rows.map(row => ({
      id: row[0],
      proxyUrl: row[1]
    }))
    const idSet = new Set(proxyIds.map(id => Number(id)))
    return proxies.filter(item => idSet.has(Number(item.id)))
  }

  const normalizedScope = typeof options.scope === 'string' ? options.scope.trim().toLowerCase() : ''
  const statusFilter = normalizedScope === 'all' ? '' : 'ok'

  const conditions = []
  const params = []
  if (statusFilter) {
    conditions.push('status = ?')
    params.push(statusFilter)
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const query = `
    SELECT id, proxy_url
    FROM proxy_pool
    ${whereClause}
    ORDER BY id DESC
  `

  const result = database.exec(query, params)
  const rows = result[0]?.values || []
  return rows.map(row => ({
    id: row[0],
    proxyUrl: row[1]
  }))
}

const updateProxyPoolFromProbe = (database, proxyId, outcome) => {
  const now = "DATETIME('now', 'localtime')"
  const statusValue = outcome.ok ? 'ok' : 'bad'
  const lastError = outcome.ok ? '' : String(outcome.error || '')
  database.run(
    `
      UPDATE proxy_pool
      SET status = ?,
          last_check_at = ${now},
          last_ok_at = CASE WHEN ? = 1 THEN ${now} ELSE last_ok_at END,
          last_error = ?,
          fail_count = CASE WHEN ? = 1 THEN fail_count ELSE fail_count + 1 END,
          success_count = CASE WHEN ? = 1 THEN success_count + 1 ELSE success_count END,
          updated_at = ${now}
      WHERE id = ?
    `,
    [statusValue, outcome.ok ? 1 : 0, lastError, outcome.ok ? 1 : 0, outcome.ok ? 1 : 0, proxyId]
  )
}

const markValidationItem = (database, itemId, outcome, durationMs) => {
  const now = "DATETIME('now', 'localtime')"
  const statusValue = outcome.ok ? 'ok' : 'bad'
  const errorValue = outcome.ok ? '' : String(outcome.error || '')
  database.run(
    `
      UPDATE proxy_pool_check_items
      SET status = ?, error = ?, duration_ms = ?, checked_at = ${now}
      WHERE id = ?
    `,
    [statusValue, errorValue, Number(durationMs) || 0, itemId]
  )
}

const updateValidationSummary = (database, checkId, okInc, badInc) => {
  const now = "DATETIME('now', 'localtime')"
  database.run(
    `
      UPDATE proxy_pool_checks
      SET ok = ok + ?,
          bad = bad + ?,
          updated_at = ${now}
      WHERE id = ?
    `,
    [okInc, badInc, checkId]
  )
}

const runProxyPoolValidationJob = async (checkId) => {
  const numericId = Number(checkId)
  if (!Number.isFinite(numericId)) return
  if (runningValidationJobs.has(numericId)) return
  runningValidationJobs.add(numericId)

  const database = await getDatabase()
  const now = "DATETIME('now', 'localtime')"
  try {
    database.run(
      `
        UPDATE proxy_pool_checks
        SET status = 'running', started_at = ${now}, updated_at = ${now}
        WHERE id = ?
      `,
      [numericId]
    )
    await saveDatabase()

    const settings = await getProxyPoolSettings(database)
    while (true) {
      const pendingResult = database.exec(
        `
          SELECT id, proxy_id, proxy_url
          FROM proxy_pool_check_items
          WHERE check_id = ? AND status = 'pending'
          ORDER BY id ASC
          LIMIT ?
        `,
        [numericId, VALIDATE_CONCURRENCY]
      )
      const pending = (pendingResult[0]?.values || []).map(row => ({
        id: row[0],
        proxyId: row[1],
        proxyUrl: row[2]
      }))
      if (!pending.length) break

      const outcomes = await Promise.all(
        pending.map(async item => {
          const startedAt = Date.now()
          const outcome = await probeProxy(item.proxyUrl, settings)
          const durationMs = Date.now() - startedAt
          return { item, outcome, durationMs }
        })
      )

      let okInc = 0
      let badInc = 0
      for (const { item, outcome, durationMs } of outcomes) {
        updateProxyPoolFromProbe(database, item.proxyId, outcome)
        markValidationItem(database, item.id, outcome, durationMs)
        if (outcome.ok) okInc += 1
        else badInc += 1
      }
      updateValidationSummary(database, numericId, okInc, badInc)
      await saveDatabase()
    }

    database.run(
      `
        UPDATE proxy_pool_checks
        SET status = 'done', finished_at = ${now}, updated_at = ${now}
        WHERE id = ?
      `,
      [numericId]
    )
    await saveDatabase()
  } catch (error) {
    database.run(
      `
        UPDATE proxy_pool_checks
        SET status = 'failed', last_error = ?, updated_at = ${now}
        WHERE id = ?
      `,
      [error?.message || String(error), numericId]
    )
    await saveDatabase()
    console.error('[ProxyPool] async validation failed:', error?.message || error)
  } finally {
    runningValidationJobs.delete(numericId)
  }
}

export const startProxyPoolValidationJob = async ({ proxyIds } = {}, db) => {
  const database = db || await getDatabase()
  const settings = await getProxyPoolSettings(database)
  const proxies = fetchProxiesForValidation(database, proxyIds, {
    scope: Array.isArray(proxyIds) && proxyIds.length ? 'all' : settings.validationScope
  })
  const total = proxies.length

  database.run(
    `
      INSERT INTO proxy_pool_checks (status, total, ok, bad, created_at, updated_at)
      VALUES ('pending', ?, 0, 0, DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))
    `,
    [total]
  )
  const idResult = database.exec('SELECT last_insert_rowid()')
  const checkId = idResult[0]?.values?.[0]?.[0]

  for (const proxy of proxies) {
    database.run(
      `
        INSERT INTO proxy_pool_check_items (check_id, proxy_id, proxy_url, status, created_at)
        VALUES (?, ?, ?, 'pending', DATETIME('now', 'localtime'))
      `,
      [checkId, proxy.id, proxy.proxyUrl]
    )
  }

  await saveDatabase()
  runProxyPoolValidationJob(checkId).catch(error => {
    console.error('[ProxyPool] start async validation failed:', error?.message || error)
  })

  return { checkId, total }
}

export const getProxyPoolValidationStatus = async ({ checkId, status, limit = 200, offset = 0 } = {}, db) => {
  const database = db || await getDatabase()
  const numericId = Number(checkId)
  if (!Number.isFinite(numericId)) return null

  const jobResult = database.exec(
    `
      SELECT id, status, total, ok, bad, last_error, created_at, started_at, finished_at, updated_at
      FROM proxy_pool_checks
      WHERE id = ?
      LIMIT 1
    `,
    [numericId]
  )
  const jobRow = jobResult[0]?.values?.[0]
  if (!jobRow) return null

  const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : ''
  const conditions = ['check_id = ?']
  const params = [numericId]
  if (['ok', 'bad', 'pending'].includes(normalizedStatus)) {
    conditions.push('status = ?')
    params.push(normalizedStatus)
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const countResult = database.exec(`SELECT COUNT(*) FROM proxy_pool_check_items ${whereClause}`, params)
  const totalItems = countResult[0]?.values?.[0]?.[0] || 0

  const dataResult = database.exec(
    `
      SELECT i.id, i.proxy_id, i.proxy_url, i.status, i.error, i.duration_ms, i.checked_at, i.created_at,
             p.last_check_at, p.last_error,
             COUNT(a.id) AS assigned_count
      FROM proxy_pool_check_items i
      JOIN proxy_pool p ON p.id = i.proxy_id
      LEFT JOIN proxy_assignments a ON a.proxy_id = p.id
      ${whereClause}
      GROUP BY i.id
      ORDER BY i.id DESC
      LIMIT ? OFFSET ?
    `,
    [...params, Math.min(500, Math.max(1, Number(limit) || 200)), Math.max(0, Number(offset) || 0)]
  )
  const items = (dataResult[0]?.values || []).map(row => ({
    id: row[0],
    proxyId: row[1],
    proxyUrl: row[2],
    status: row[3],
    error: row[4] || null,
    durationMs: row[5] ?? null,
    checkedAt: row[6] || null,
    createdAt: row[7] || null,
    lastCheckAt: row[8] || null,
    lastError: row[9] || null,
    assignedCount: Number(row[10] || 0)
  }))

  return {
    job: {
      id: jobRow[0],
      status: jobRow[1],
      total: jobRow[2] || 0,
      ok: jobRow[3] || 0,
      bad: jobRow[4] || 0,
      lastError: jobRow[5] || null,
      createdAt: jobRow[6] || null,
      startedAt: jobRow[7] || null,
      finishedAt: jobRow[8] || null,
      updatedAt: jobRow[9] || null
    },
    itemsTotal: totalItems,
    items: items
  }
}

const parseLocalDate = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

const shouldRotateAssignment = (assignedAt, rotationDays) => {
  const parsed = parseLocalDate(assignedAt)
  if (!parsed) return false
  const ageMs = Date.now() - parsed
  return ageMs > rotationDays * 24 * 60 * 60 * 1000
}

const pickRandom = (items) => {
  if (!items.length) return null
  const index = Math.floor(Math.random() * items.length)
  return items[index] || null
}

export const resolveProxyForAccount = async (accountId, { useProxy } = {}, db) => {
  if (!useProxy) return { proxyUrl: null, proxyId: null }
  const database = db || await getDatabase()
  const settings = await getProxyPoolSettings(database)
  if (!settings.enabled) {
    return { proxyUrl: null, proxyId: null, disabled: true }
  }

  const assignmentResult = database.exec(
    `
    SELECT a.id, a.proxy_id, a.assigned_at, a.last_used_at, p.proxy_url, p.status
    FROM proxy_assignments a
    JOIN proxy_pool p ON p.id = a.proxy_id
    WHERE a.account_id = ?
    LIMIT 1
    `,
    [accountId]
  )
  const assignmentRow = assignmentResult[0]?.values?.[0]

  if (assignmentRow) {
    const assignmentId = assignmentRow[0]
    const proxyId = assignmentRow[1]
    const assignedAt = assignmentRow[2]
    const proxyUrl = assignmentRow[4]
    const status = assignmentRow[5] || 'unknown'

    const needsRotate = shouldRotateAssignment(assignedAt, settings.rotationDays)
    const statusBad = status === 'bad'

    if (!needsRotate && !statusBad) {
      database.run(
        `UPDATE proxy_assignments SET last_used_at = DATETIME('now', 'localtime'), updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
        [assignmentId]
      )
      await saveDatabase()
      return { proxyUrl, proxyId }
    }
  }

  const candidatesResult = database.exec(
    `
    SELECT p.id, p.proxy_url, p.status, COUNT(a.id) AS assigned_count
    FROM proxy_pool p
    LEFT JOIN proxy_assignments a ON a.proxy_id = p.id
    GROUP BY p.id
    `,
    []
  )
  const candidates = (candidatesResult[0]?.values || [])
    .map(row => ({
      id: row[0],
      proxyUrl: row[1],
      status: row[2] || 'unknown',
      assignedCount: Number(row[3] || 0)
    }))
    .filter(item => item.status !== 'bad' && item.assignedCount < settings.maxAccountsPerProxy)

  const selected = pickRandom(candidates)
  if (!selected) {
    return { proxyUrl: null, proxyId: null, empty: true }
  }

  const existingAssign = database.exec('SELECT id FROM proxy_assignments WHERE account_id = ? LIMIT 1', [accountId])
  if (existingAssign[0]?.values?.length) {
    const assignId = existingAssign[0].values[0][0]
    database.run(
      `UPDATE proxy_assignments SET proxy_id = ?, assigned_at = DATETIME('now', 'localtime'), last_used_at = DATETIME('now', 'localtime'), updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
      [selected.id, assignId]
    )
  } else {
    database.run(
      `INSERT INTO proxy_assignments (account_id, proxy_id, assigned_at, last_used_at, updated_at) VALUES (?, ?, DATETIME('now', 'localtime'), DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))`,
      [accountId, selected.id]
    )
  }

  await saveDatabase()
  return { proxyUrl: selected.proxyUrl, proxyId: selected.id }
}

export const clearProxyAssignmentForAccount = async (accountId, db) => {
  const database = db || await getDatabase()
  database.run('DELETE FROM proxy_assignments WHERE account_id = ?', [accountId])
  await saveDatabase()
}

let proxyPoolTimer = null

export const runProxyPoolCheckerOnce = async () => {
  const db = await getDatabase()
  await startProxyPoolValidationJob({}, db)
}

export const startProxyPoolChecker = async () => {
  const scheduleNext = async () => {
    const db = await getDatabase()
    const settings = await getProxyPoolSettings(db)
    if (!settings.enabled || settings.checkIntervalMinutes <= 0) {
      if (proxyPoolTimer) {
        clearTimeout(proxyPoolTimer)
        proxyPoolTimer = null
      }
      return
    }

    const intervalMs = settings.checkIntervalMinutes * 60 * 1000
    proxyPoolTimer = setTimeout(async () => {
      try {
        await runProxyPoolCheckerOnce()
      } catch (error) {
        console.error('[ProxyPool] health check failed:', error?.message || error)
      }
      await scheduleNext()
    }, intervalMs)
    proxyPoolTimer.unref?.()
  }

  try {
    await runProxyPoolCheckerOnce()
  } catch (error) {
    console.error('[ProxyPool] initial health check failed:', error?.message || error)
  }
  await scheduleNext()
}
