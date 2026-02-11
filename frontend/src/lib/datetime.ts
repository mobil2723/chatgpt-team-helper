const DEFAULT_LOCALE = 'zh-CN'
const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const formatterCache = new Map<string, Intl.DateTimeFormat>()

const DB_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/
const DB_EXPIRE_AT_REGEX = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}(?::\d{2})?$/

function getFormatter(locale: string, timeZone: string) {
  const cacheKey = `${locale}-${timeZone}`
  let formatter = formatterCache.get(cacheKey)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    formatterCache.set(cacheKey, formatter)
  }
  return formatter
}

function getGlobalTimeZone(): string | null {
  try {
    const value = (globalThis as any).__APP_TIMEZONE__
    const normalized = typeof value === 'string' ? value.trim() : ''
    return normalized || null
  } catch {
    return null
  }
}

function getPartsFromDate(date: Date, timeZone: string) {
  const parts = getFormatter('en-US', timeZone).formatToParts(date)
  const pick = (type: string) => Number(parts.find(part => part.type === type)?.value || 0)
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second')
  }
}

function parseDbDate(value: string, baseTimeZone: string): Date | null {
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] || '0')
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null

  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  const parts = getPartsFromDate(utcGuess, baseTimeZone)
  const tzAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const offsetMs = tzAsUtc - utcGuess.getTime()
  return new Date(utcGuess.getTime() - offsetMs)
}

function parseDate(value: string | number | Date): Date {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  const trimmed = value.trim()
  return new Date(value)
}

export interface DateFormatOptions {
  locale?: string
  timeZone?: string
}

export function formatShanghaiDate(
  value?: string | number | Date | null,
  options?: DateFormatOptions,
): string {
  if (!value) return '-'
  try {
    const baseTimeZone = DEFAULT_TIMEZONE
    const date = typeof value === 'string' && (DB_DATETIME_REGEX.test(value.trim()) || DB_EXPIRE_AT_REGEX.test(value.trim()))
      ? (parseDbDate(value, baseTimeZone) || parseDate(value))
      : parseDate(value)
    if (Number.isNaN(date.getTime())) {
      return '-'
    }
    const locale = options?.locale || DEFAULT_LOCALE
    const timeZone = options?.timeZone || getGlobalTimeZone() || DEFAULT_TIMEZONE
    return getFormatter(locale, timeZone).format(date)
  } catch (error) {
    console.warn('formatShanghaiDate failed:', error)
    return '-'
  }
}
