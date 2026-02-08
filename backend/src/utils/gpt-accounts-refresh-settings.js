import { getDatabase } from '../database/init.js'

const CONFIG_KEYS = [
  'gpt_accounts_auto_refresh_enabled',
  'gpt_accounts_auto_refresh_interval_minutes',
  'gpt_accounts_auto_refresh_before_hours',
  'gpt_accounts_auto_refresh_use_proxy'
]

const CACHE_TTL_MS = 60 * 1000
let cachedSettings = null
let cachedAt = 0

const parseBool = (value, fallback = true) => {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (!normalized) return fallback
  return ['true', '1', 'yes', 'y', 'on'].includes(normalized)
}

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const clampInteger = (value, { min, max, fallback }) => {
  const parsed = toInt(value, fallback)
  const normalized = Number.isFinite(parsed) ? parsed : fallback
  return Math.min(max, Math.max(min, normalized))
}

const loadSystemConfigMap = (database, keys) => {
  if (!database) return new Map()
  const list = Array.isArray(keys) && keys.length ? keys : CONFIG_KEYS
  const placeholders = list.map(() => '?').join(',')
  const result = database.exec(
    `SELECT config_key, config_value FROM system_config WHERE config_key IN (${placeholders})`,
    list
  )
  const map = new Map()
  const rows = result[0]?.values || []
  for (const row of rows) {
    map.set(String(row?.[0] ?? ''), String(row?.[1] ?? ''))
  }
  return map
}

export const getGptAccountsRefreshSettingsFromEnv = () => ({
  enabled: parseBool(process.env.GPT_ACCOUNTS_AUTO_REFRESH_ENABLED, true),
  intervalMinutes: clampInteger(process.env.GPT_ACCOUNTS_AUTO_REFRESH_INTERVAL_MINUTES, {
    min: 5,
    max: 1440,
    fallback: 60
  }),
  refreshBeforeHours: clampInteger(process.env.GPT_ACCOUNTS_AUTO_REFRESH_BEFORE_HOURS, {
    min: 1,
    max: 720,
    fallback: 24
  }),
  useProxy: parseBool(process.env.GPT_ACCOUNTS_AUTO_REFRESH_USE_PROXY, true)
})

export const invalidateGptAccountsRefreshSettingsCache = () => {
  cachedSettings = null
  cachedAt = 0
}

export async function getGptAccountsRefreshSettings(db, { forceRefresh = false } = {}) {
  const now = Date.now()
  if (!forceRefresh && cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings
  }

  const database = db || await getDatabase()
  const stored = loadSystemConfigMap(database, CONFIG_KEYS)
  const env = getGptAccountsRefreshSettingsFromEnv()

  const resolveString = (key, fallback) => {
    if (!stored.has(key)) return fallback
    return String(stored.get(key) ?? '')
  }

  const enabled = parseBool(resolveString('gpt_accounts_auto_refresh_enabled', env.enabled), env.enabled)
  const intervalMinutes = clampInteger(resolveString('gpt_accounts_auto_refresh_interval_minutes', env.intervalMinutes), {
    min: 5,
    max: 1440,
    fallback: env.intervalMinutes
  })
  const refreshBeforeHours = clampInteger(resolveString('gpt_accounts_auto_refresh_before_hours', env.refreshBeforeHours), {
    min: 1,
    max: 720,
    fallback: env.refreshBeforeHours
  })
  const useProxy = parseBool(resolveString('gpt_accounts_auto_refresh_use_proxy', env.useProxy), env.useProxy)

  cachedSettings = {
    enabled,
    intervalMinutes,
    refreshBeforeHours,
    useProxy,
    stored: {
      enabled: stored.has('gpt_accounts_auto_refresh_enabled'),
      intervalMinutes: stored.has('gpt_accounts_auto_refresh_interval_minutes'),
      refreshBeforeHours: stored.has('gpt_accounts_auto_refresh_before_hours'),
      useProxy: stored.has('gpt_accounts_auto_refresh_use_proxy')
    }
  }
  cachedAt = now
  return cachedSettings
}
