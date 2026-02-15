import { getDatabase, saveDatabase } from '../database/init.js'
import { withLocks } from '../utils/locks.js'
import { getXianyuConfig } from './xianyu-orders.js'
import { fetchAccountUsersList, deleteAccountUser, AccountSyncError } from './account-sync.js'
import { getGptAccountsRefreshSettings } from '../utils/gpt-accounts-refresh-settings.js'
import { resolveProxyForAccount } from './proxy-pool.js'

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const DEFAULT_WARRANTY_DAYS = 30
const DEFAULT_GRACE_MINUTES = 10
const MAX_GRACE_MINUTES = 24 * 60
const SQLITE_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/
const SHANGHAI_DATETIME_REGEX = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}(?::\d{2})?$/

let offboardTimer = null

const pad2 = (value) => String(value).padStart(2, '0')

const toShanghaiDate = (input) => {
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return null
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS)
}

const formatShanghaiDateTime = (input) => {
  const shanghai = toShanghaiDate(input)
  if (!shanghai) return null
  const y = shanghai.getUTCFullYear()
  const m = pad2(shanghai.getUTCMonth() + 1)
  const d = pad2(shanghai.getUTCDate())
  const hh = pad2(shanghai.getUTCHours())
  const mm = pad2(shanghai.getUTCMinutes())
  const ss = pad2(shanghai.getUTCSeconds())
  return `${y}/${m}/${d} ${hh}:${mm}:${ss}`
}

const parseShanghaiDateTime = (value) => {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] || '0')
  if ([year, month, day, hour, minute, second].some(n => !Number.isFinite(n))) return null
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - SHANGHAI_OFFSET_MS)
}

const addDaysShanghai = (value, days) => {
  const base = parseShanghaiDateTime(value)
  if (!base) return null
  return formatShanghaiDateTime(base.getTime() + Number(days || 0) * 24 * 60 * 60 * 1000)
}

const addMinutesShanghai = (value, minutes) => {
  const base = parseShanghaiDateTime(value)
  if (!base) return null
  return formatShanghaiDateTime(base.getTime() + Number(minutes || 0) * 60 * 1000)
}

const nowShanghai = () => formatShanghaiDateTime(new Date())

const normalizeLifecycleDateTimeToShanghai = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (SHANGHAI_DATETIME_REGEX.test(raw)) return raw
  if (SQLITE_DATETIME_REGEX.test(raw)) {
    const utcLike = new Date(raw.replace(' ', 'T') + 'Z')
    if (!Number.isNaN(utcLike.getTime())) return formatShanghaiDateTime(utcLike)
  }
  const parsedShanghai = parseShanghaiDateTime(raw)
  if (parsedShanghai) return formatShanghaiDateTime(parsedShanghai)
  const fallback = new Date(raw)
  if (!Number.isNaN(fallback.getTime())) return formatShanghaiDateTime(fallback)
  return raw
}

const parseAmount = (value) => {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const normalized = String(value).trim()
  if (!normalized) return null
  const cleaned = normalized.replace(/[^\d.-]/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

const normalizeAmountToYuan = (amount) => {
  const paid = parseAmount(amount)
  if (paid == null) return null
  const asYuan = paid
  const asCentToYuan = paid / 100
  const plausibleCent = asCentToYuan >= 0.5 && asCentToYuan <= 10000
  if (!plausibleCent) return asYuan
  const deltaYuan = Math.abs(asYuan - Math.round(asYuan))
  const deltaCent = Math.abs(asCentToYuan - Math.round(asCentToYuan))
  return deltaCent < deltaYuan ? asCentToYuan : asYuan
}

const normalizeGraceMinutes = (value, fallback = DEFAULT_GRACE_MINUTES) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(MAX_GRACE_MINUTES, Math.max(0, Math.floor(parsed)))
}

const normalizeWarrantyDays = (value, fallback = DEFAULT_WARRANTY_DAYS) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.floor(parsed))
}

const sanitizeRules = (rules = []) =>
  (Array.isArray(rules) ? rules : [])
    .map((item, idx) => {
      const minAmount = Number(item?.minAmount)
      const maxAmount = Number(item?.maxAmount)
      const warrantyDays = normalizeWarrantyDays(item?.warrantyDays, 0)
      const enabled = item?.enabled === undefined ? true : Boolean(item?.enabled)
      const sortOrder = Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : (idx + 1) * 10
      if (!Number.isFinite(minAmount) || !Number.isFinite(maxAmount) || minAmount > maxAmount || warrantyDays <= 0) return null
      return { minAmount, maxAmount, warrantyDays, enabled, sortOrder }
    })
    .filter(Boolean)

const generateRedemptionCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 12; i += 1) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
    if (i === 3 || i === 7) code += '-'
  }
  return code
}

const findXianyuOrderByOrderId = (db, orderId) => {
  const result = db.exec(
    `SELECT id, order_id, user_email, assigned_code_id, assigned_code, is_used FROM xianyu_orders WHERE order_id = ? LIMIT 1`,
    [orderId]
  )
  const row = result[0]?.values?.[0]
  if (!row) return null
  return {
    id: Number(row[0]),
    orderId: String(row[1]),
    userEmail: row[2] ? String(row[2]) : null,
    assignedCodeId: row[3] != null ? Number(row[3]) : null,
    assignedCode: row[4] ? String(row[4]) : null,
    isUsed: Number(row[5] || 0) === 1
  }
}

export const listXianyuWarrantyRules = async (db) => {
  const database = db || await getDatabase()
  const result = database.exec(
    `SELECT id, min_amount, max_amount, warranty_days, enabled, sort_order, created_at, updated_at
     FROM xianyu_warranty_rules
     ORDER BY sort_order ASC, id ASC`
  )
  return (result[0]?.values || []).map(row => ({
    id: Number(row[0]),
    minAmount: Number(row[1]),
    maxAmount: Number(row[2]),
    warrantyDays: Number(row[3]),
    enabled: Number(row[4] || 0) === 1,
    sortOrder: Number(row[5] || 0),
    createdAt: row[6] || null,
    updatedAt: row[7] || null
  }))
}

export const replaceXianyuWarrantyRules = async (rules, db) => {
  const normalized = sanitizeRules(rules)
  if (!normalized.length) {
    throw new Error('至少需要一条有效质保规则')
  }
  const database = db || await getDatabase()
  database.run('DELETE FROM xianyu_warranty_rules')
  normalized.forEach((rule) => {
    database.run(
      `INSERT INTO xianyu_warranty_rules (min_amount, max_amount, warranty_days, enabled, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))`,
      [rule.minAmount, rule.maxAmount, rule.warrantyDays, rule.enabled ? 1 : 0, rule.sortOrder]
    )
  })
  await saveDatabase()
  await scheduleNextXianyuOffboardJob()
  return await listXianyuWarrantyRules(database)
}

export const resolveXianyuWarrantyByAmount = async (actualPaid, db) => {
  const amount = normalizeAmountToYuan(actualPaid)
  const rules = await listXianyuWarrantyRules(db)
  const enabledRules = rules.filter(rule => rule.enabled)
  if (amount == null || enabledRules.length === 0) {
    return { warrantyDays: DEFAULT_WARRANTY_DAYS, amountYuan: amount, matchedRuleId: null }
  }
  const matched = enabledRules.find(rule => amount >= rule.minAmount && amount <= rule.maxAmount)
  if (!matched) {
    return { warrantyDays: DEFAULT_WARRANTY_DAYS, amountYuan: amount, matchedRuleId: null }
  }
  return { warrantyDays: normalizeWarrantyDays(matched.warrantyDays), amountYuan: amount, matchedRuleId: matched.id }
}

const insertReplacementCode = (db, accountEmail) => {
  for (let i = 0; i < 6; i += 1) {
    const code = generateRedemptionCode()
    try {
      db.run(
        `INSERT INTO redemption_codes (code, account_email, channel, channel_name, order_type, created_at, updated_at)
         VALUES (?, ?, 'xianyu', '闲鱼渠道', 'warranty', DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))`,
        [code, accountEmail]
      )
      const idResult = db.exec('SELECT id FROM redemption_codes WHERE code = ? LIMIT 1', [code])
      const codeId = Number(idResult[0]?.values?.[0]?.[0] || 0)
      return { codeId: codeId || null, code }
    } catch {
      // retry on duplicate
    }
  }
  throw new Error('生成新兑换码失败，请稍后重试')
}

const resolveProxyForLifecycle = async (accountId, db) => {
  const settings = await getGptAccountsRefreshSettings(db)
  if (!settings.useProxy) return false
  const resolved = await resolveProxyForAccount(accountId, { useProxy: true }, db)
  if (resolved?.disabled) throw new AccountSyncError('代理池未启用', 400)
  if (resolved?.empty || !resolved?.proxyUrl) throw new AccountSyncError('代理池中没有可用代理', 400)
  return resolved.proxyUrl
}

const processLifecycleInternal = async (lifecycleId, { force = false } = {}, db) => {
  const database = db || await getDatabase()
  const result = database.exec(
    `SELECT id, order_id, code_id, code, target_email, account_id, account_email, redeemed_at, warranty_days, expires_at, grace_minutes, execute_at, status
     FROM xianyu_offboard_lifecycle
     WHERE id = ?
     LIMIT 1`,
    [lifecycleId]
  )
  const row = result[0]?.values?.[0]
  if (!row) return { ok: false, error: '生命周期记录不存在' }
  const lifecycle = {
    id: Number(row[0]),
    orderId: String(row[1] || ''),
    codeId: row[2] != null ? Number(row[2]) : null,
    code: row[3] ? String(row[3]) : null,
    targetEmail: String(row[4] || '').trim().toLowerCase(),
    accountId: row[5] != null ? Number(row[5]) : null,
    accountEmail: row[6] ? String(row[6]) : null,
    redeemedAt: String(row[7] || ''),
    warrantyDays: Number(row[8] || 0),
    expiresAt: String(row[9] || ''),
    graceMinutes: Number(row[10] || DEFAULT_GRACE_MINUTES),
    executeAt: String(row[11] || ''),
    status: String(row[12] || 'active')
  }

  if (!['active', 'failed'].includes(lifecycle.status)) {
    return { ok: true, skipped: true, reason: 'already_processed' }
  }
  if (!force) {
    const executeTime = parseShanghaiDateTime(lifecycle.executeAt)
    if (executeTime && executeTime.getTime() > Date.now()) {
      return { ok: true, skipped: true, reason: 'not_due' }
    }
  }
  if (!lifecycle.accountId || !lifecycle.targetEmail) {
    return { ok: false, error: '生命周期记录缺少账号或邮箱信息' }
  }

  let proxy = false
  try {
    proxy = await resolveProxyForLifecycle(lifecycle.accountId, database)

    const userList = await fetchAccountUsersList(lifecycle.accountId, {
      userListParams: { offset: 0, limit: 50, query: lifecycle.targetEmail },
      proxy
    })
    const matched = (userList.items || []).find(item => String(item?.email || '').trim().toLowerCase() === lifecycle.targetEmail)

    if (matched?.id) {
      await deleteAccountUser(lifecycle.accountId, String(matched.id), {
        userListParams: { offset: 0, limit: 1, query: '' },
        proxy
      })
    }

    const replacement = insertReplacementCode(database, lifecycle.accountEmail || null)
    const offboardedAt = nowShanghai()
    database.run(
      `UPDATE xianyu_offboard_lifecycle
       SET status = 'offboarded',
           offboarded_at = ?,
           replacement_code_id = ?,
           replacement_code = ?,
           error_message = NULL,
           updated_at = DATETIME('now', 'localtime')
       WHERE id = ?`,
      [offboardedAt, replacement.codeId, replacement.code, lifecycle.id]
    )
    await saveDatabase()
    return { ok: true, lifecycleId: lifecycle.id, offboardedAt, replacementCode: replacement.code }
  } catch (error) {
    database.run(
      `UPDATE xianyu_offboard_lifecycle
       SET status = 'failed',
           error_message = ?,
           updated_at = DATETIME('now', 'localtime')
       WHERE id = ?`,
      [error?.message || String(error), lifecycle.id]
    )
    await saveDatabase()
    return { ok: false, error: error?.message || String(error), lifecycleId: lifecycle.id }
  }
}

const clearOffboardTimer = () => {
  if (offboardTimer) {
    clearTimeout(offboardTimer)
    offboardTimer = null
  }
}

export const scheduleNextXianyuOffboardJob = async () => {
  clearOffboardTimer()
  const db = await getDatabase()
  const config = await getXianyuConfig()
  if (config?.offboardEnabled === false) return

  const result = db.exec(
    `SELECT id, execute_at
     FROM xianyu_offboard_lifecycle
     WHERE status = 'active'
     ORDER BY execute_at ASC, id ASC
     LIMIT 1`
  )
  const row = result[0]?.values?.[0]
  if (!row) return

  const lifecycleId = Number(row[0])
  const executeAt = String(row[1] || '')
  const executeDate = parseShanghaiDateTime(executeAt)
  if (!executeDate) return

  const delayMs = Math.max(0, executeDate.getTime() - Date.now())
  const safeDelay = Math.min(delayMs, 2_147_000_000)
  offboardTimer = setTimeout(async () => {
    try {
      await withLocks([`xianyu-offboard:${lifecycleId}`], async () => {
        await processLifecycleInternal(lifecycleId, { force: false }, db)
      })
    } catch (error) {
      console.error('[XianyuOffboard] execute failed', { lifecycleId, message: error?.message || String(error) })
    } finally {
      scheduleNextXianyuOffboardJob().catch(() => {})
    }
  }, safeDelay)
  offboardTimer.unref?.()
}

export const startXianyuOffboardScheduler = () => {
  scheduleNextXianyuOffboardJob().catch(error => {
    console.error('[XianyuOffboard] scheduler start failed:', error)
  })
}

export const upsertXianyuOffboardLifecycle = async ({
  orderId,
  codeId,
  code,
  targetEmail,
  accountEmail,
  redeemedAt,
  warrantyDays,
  graceMinutes
}) => {
  const db = await getDatabase()
  const config = await getXianyuConfig()
  const safeGrace = normalizeGraceMinutes(graceMinutes ?? config?.offboardGraceMinutes ?? DEFAULT_GRACE_MINUTES)
  const safeWarrantyDays = normalizeWarrantyDays(warrantyDays, DEFAULT_WARRANTY_DAYS)
  const normalizedRedeemedAt = formatShanghaiDateTime(parseShanghaiDateTime(redeemedAt) || new Date()) || nowShanghai()
  const expiresAt = addDaysShanghai(normalizedRedeemedAt, safeWarrantyDays) || normalizedRedeemedAt
  const executeAt = addMinutesShanghai(expiresAt, safeGrace) || expiresAt

  const accountResult = db.exec('SELECT id FROM gpt_accounts WHERE lower(email) = lower(?) LIMIT 1', [accountEmail || ''])
  const accountId = Number(accountResult[0]?.values?.[0]?.[0] || 0) || null

  const existing = codeId
    ? db.exec('SELECT id FROM xianyu_offboard_lifecycle WHERE code_id = ? LIMIT 1', [codeId])[0]?.values?.[0]?.[0]
    : null
  if (existing) {
    db.run(
      `UPDATE xianyu_offboard_lifecycle
       SET order_id = ?, code = ?, target_email = ?, account_id = ?, account_email = ?,
           redeemed_at = ?, warranty_days = ?, expires_at = ?, grace_minutes = ?, execute_at = ?,
           status = 'active', offboarded_at = NULL, replacement_code_id = NULL, replacement_code = NULL, error_message = NULL,
           updated_at = DATETIME('now', 'localtime')
       WHERE id = ?`,
      [orderId, code || null, targetEmail, accountId, accountEmail || null, normalizedRedeemedAt, safeWarrantyDays, expiresAt, safeGrace, executeAt, existing]
    )
  } else {
    db.run(
      `INSERT INTO xianyu_offboard_lifecycle (
         order_id, code_id, code, target_email, account_id, account_email,
         redeemed_at, warranty_days, expires_at, grace_minutes, execute_at, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))`,
      [orderId, codeId || null, code || null, targetEmail, accountId, accountEmail || null, normalizedRedeemedAt, safeWarrantyDays, expiresAt, safeGrace, executeAt]
    )
  }
  await saveDatabase()
  await scheduleNextXianyuOffboardJob()
  return { warrantyDays: safeWarrantyDays, graceMinutes: safeGrace, redeemedAt: normalizedRedeemedAt, expiresAt, executeAt }
}

export const listXianyuOffboardLifecycle = async ({
  limit = 100,
  offset = 0,
  status,
  targetEmail,
  accountEmail,
  orderId,
  excludeXianyuOrders,
  source
} = {}, db) => {
  const database = db || await getDatabase()
  const parsedLimit = Math.min(500, Math.max(1, Number(limit) || 100))
  const parsedOffset = Math.max(0, Number(offset) || 0)
  const normalizedStatus = typeof status === 'string' ? status.trim() : ''
  const normalizedTargetEmail = typeof targetEmail === 'string' ? targetEmail.trim().toLowerCase() : ''
  const normalizedAccountEmail = typeof accountEmail === 'string' ? accountEmail.trim().toLowerCase() : ''
  const normalizedOrderId = typeof orderId === 'string' ? orderId.trim() : ''
  const normalizedSource = typeof source === 'string' ? source.trim().toLowerCase() : ''
  const conditions = []
  const params = []
  if (normalizedStatus) {
    conditions.push('l.status = ?')
    params.push(normalizedStatus)
  }
  if (normalizedTargetEmail) {
    conditions.push('lower(l.target_email) LIKE ?')
    params.push(`%${normalizedTargetEmail}%`)
  }
  if (normalizedAccountEmail) {
    conditions.push('lower(l.account_email) LIKE ?')
    params.push(`%${normalizedAccountEmail}%`)
  }
  if (normalizedOrderId) {
    conditions.push('l.order_id LIKE ?')
    params.push(`%${normalizedOrderId}%`)
  }
  if (excludeXianyuOrders === true) {
    conditions.push('NOT EXISTS (SELECT 1 FROM xianyu_orders xo WHERE xo.order_id = l.order_id)')
  }
  if (normalizedSource === 'xianyu') {
    conditions.push(`lower(COALESCE(rc.channel, '')) = 'xianyu'`)
  } else if (normalizedSource === 'non_xianyu') {
    conditions.push(`lower(COALESCE(rc.channel, '')) != 'xianyu'`)
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const countResult = database.exec(
    `SELECT COUNT(*)
     FROM xianyu_offboard_lifecycle l
     LEFT JOIN redemption_codes rc ON rc.id = l.code_id
     ${whereClause}`,
    params
  )
  const total = Number(countResult[0]?.values?.[0]?.[0] || 0)
  const dataResult = database.exec(
    `SELECT l.id, l.order_id, l.code_id, l.code, l.target_email, l.account_id, l.account_email,
            l.redeemed_at, l.warranty_days, l.expires_at, l.grace_minutes, l.execute_at, l.status,
            l.offboarded_at, l.replacement_code_id, l.replacement_code, l.error_message, l.created_at, l.updated_at,
            rc.channel,
            xo.nickname, xo.user_email
     FROM xianyu_offboard_lifecycle l
     LEFT JOIN redemption_codes rc ON rc.id = l.code_id
     LEFT JOIN xianyu_orders xo ON xo.order_id = l.order_id
     ${whereClause}
     ORDER BY l.id DESC
     LIMIT ? OFFSET ?`,
    [...params, parsedLimit, parsedOffset]
  )
  const nowMs = Date.now()
  const rows = (dataResult[0]?.values || []).map(row => {
    const redeemedAt = normalizeLifecycleDateTimeToShanghai(row[7])
    const expiresAt = normalizeLifecycleDateTimeToShanghai(row[9])
    const executeAt = normalizeLifecycleDateTimeToShanghai(row[11])
    const offboardedAt = normalizeLifecycleDateTimeToShanghai(row[13])
    const createdAt = normalizeLifecycleDateTimeToShanghai(row[17])
    const updatedAt = normalizeLifecycleDateTimeToShanghai(row[18])
    const endAt = offboardedAt
    const startMs = parseShanghaiDateTime(redeemedAt)?.getTime() || null
    const endMs = parseShanghaiDateTime(endAt)?.getTime() || nowMs
    const usedHours = startMs != null ? Math.max(0, Math.floor((endMs - startMs) / (60 * 60 * 1000))) : null
    return {
      id: Number(row[0]),
      orderId: row[1] ? String(row[1]) : '',
      codeId: row[2] != null ? Number(row[2]) : null,
      code: row[3] ? String(row[3]) : null,
      targetEmail: row[4] ? String(row[4]) : '',
      accountId: row[5] != null ? Number(row[5]) : null,
      accountEmail: row[6] ? String(row[6]) : null,
      redeemedAt,
      warrantyDays: Number(row[8] || 0),
      expiresAt,
      graceMinutes: Number(row[10] || 0),
      executeAt,
      status: row[12] ? String(row[12]) : 'active',
      offboardedAt,
      replacementCodeId: row[14] != null ? Number(row[14]) : null,
      replacementCode: row[15] ? String(row[15]) : null,
      errorMessage: row[16] ? String(row[16]) : null,
      createdAt,
      updatedAt,
      channel: row[19] ? String(row[19]) : null,
      xianyuUserNickname: row[20] ? String(row[20]) : null,
      xianyuUserEmail: row[21] ? String(row[21]) : null,
      usedHours
    }
  })
  return { total, items: rows }
}

export const normalizeXianyuOffboardLifecycleTimezone = async (db) => {
  const database = db || await getDatabase()
  const result = database.exec(
    `SELECT id, redeemed_at, expires_at, execute_at, offboarded_at, created_at, updated_at
     FROM xianyu_offboard_lifecycle`
  )
  const rows = result?.[0]?.values || []
  let updated = 0
  for (const row of rows) {
    const id = Number(row[0])
    const nextRedeemedAt = normalizeLifecycleDateTimeToShanghai(row[1])
    const nextExpiresAt = normalizeLifecycleDateTimeToShanghai(row[2])
    const nextExecuteAt = normalizeLifecycleDateTimeToShanghai(row[3])
    const nextOffboardedAt = normalizeLifecycleDateTimeToShanghai(row[4])
    const nextCreatedAt = normalizeLifecycleDateTimeToShanghai(row[5])
    const nextUpdatedAt = normalizeLifecycleDateTimeToShanghai(row[6])
    const current = {
      redeemedAt: row[1] ? String(row[1]) : null,
      expiresAt: row[2] ? String(row[2]) : null,
      executeAt: row[3] ? String(row[3]) : null,
      offboardedAt: row[4] ? String(row[4]) : null,
      createdAt: row[5] ? String(row[5]) : null,
      updatedAt: row[6] ? String(row[6]) : null,
    }
    const changed =
      current.redeemedAt !== nextRedeemedAt ||
      current.expiresAt !== nextExpiresAt ||
      current.executeAt !== nextExecuteAt ||
      current.offboardedAt !== nextOffboardedAt ||
      current.createdAt !== nextCreatedAt ||
      current.updatedAt !== nextUpdatedAt
    if (!changed) continue
    database.run(
      `UPDATE xianyu_offboard_lifecycle
       SET redeemed_at = ?, expires_at = ?, execute_at = ?, offboarded_at = ?, created_at = ?, updated_at = ?
       WHERE id = ?`,
      [nextRedeemedAt, nextExpiresAt, nextExecuteAt, nextOffboardedAt, nextCreatedAt, nextUpdatedAt, id]
    )
    updated += 1
  }
  if (updated > 0) {
    await saveDatabase()
  }
  return { total: rows.length, updated }
}

export const manualRunXianyuOffboard = async (lifecycleId, db) => {
  const database = db || await getDatabase()
  const outcome = await withLocks([`xianyu-offboard:${lifecycleId}`], async () => (
    processLifecycleInternal(lifecycleId, { force: true }, database)
  ))
  await scheduleNextXianyuOffboardJob()
  return outcome
}
