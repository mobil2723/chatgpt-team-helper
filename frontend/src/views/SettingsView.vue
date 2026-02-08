<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { authService, userService, adminService, versionService } from '@/services/api'
import type { VersionInfo, LatestVersionInfo, ProxyPoolItem, ProxyPoolStats, ProxyPoolApiLog, ProxyPoolValidationItem } from '@/services/api'
import { useAppConfigStore } from '@/stores/appConfig'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Eye, EyeOff, Sparkles, KeyRound, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-vue-next'

const teleportReady = ref(false)

// 版本检查相关
const versionLoading = ref(false)
const versionDialogOpen = ref(false)
const currentVersion = ref<VersionInfo | null>(null)
const latestVersion = ref<LatestVersionInfo | null>(null)
const versionError = ref('')

const hasNewVersion = computed(() => {
  if (!currentVersion.value || !latestVersion.value) return false
  return currentVersion.value.version !== latestVersion.value.version
})

const checkForUpdates = async () => {
  versionLoading.value = true
  versionError.value = ''
  currentVersion.value = null
  latestVersion.value = null

  try {
    const [current, latest] = await Promise.all([
      versionService.getVersion(),
      versionService.getLatest().catch(err => {
        if (err.response?.status === 404) {
          return null
        }
        throw err
      })
    ])
    currentVersion.value = current
    latestVersion.value = latest
    versionDialogOpen.value = true
  } catch (err: any) {
    versionError.value = err.response?.data?.error || '检查更新失败'
    versionDialogOpen.value = true
  } finally {
    versionLoading.value = false
  }
}

// API密钥相关
const apiKey = ref('')
const apiKeyError = ref('')
const apiKeySuccess = ref('')
const apiKeyLoading = ref(false)
const showApiKey = ref(false) // 控制显示/隐藏API密钥

const isSuperAdmin = computed(() => {
  const user = authService.getCurrentUser()
  return Array.isArray(user?.roles) && user.roles.includes('super_admin')
})

const appConfigStore = useAppConfigStore()

// 功能开关（仅超级管理员）
const featureFlags = ref({
  xhs: true,
  xianyu: true,
  payment: true,
  openAccounts: true
})
const featureFlagsError = ref('')
const featureFlagsSuccess = ref('')
const featureFlagsLoading = ref(false)

// 邮箱后缀白名单
const emailDomainWhitelist = ref('')
const emailDomainWhitelistError = ref('')
const emailDomainWhitelistSuccess = ref('')
const emailDomainWhitelistLoading = ref(false)

// 积分提现设置（仅超级管理员）
const pointsWithdrawRatePoints = ref('1')
const pointsWithdrawRateCashYuan = ref('1.00')
const pointsWithdrawMinCashYuan = ref('10.00')
const pointsWithdrawMinPoints = ref<number | null>(null)
const pointsWithdrawStepPoints = ref<number | null>(null)
const pointsWithdrawError = ref('')
const pointsWithdrawSuccess = ref('')
const pointsWithdrawLoading = ref(false)

// SMTP 邮件告警配置（仅超级管理员）
const smtpHost = ref('')
const smtpPort = ref('465')
const smtpSecure = ref<'true' | 'false'>('true')
const smtpUser = ref('')
const smtpPass = ref('')
const smtpPassSet = ref(false)
const smtpPassStored = ref(false)
const smtpFrom = ref('')
const adminAlertEmail = ref('')
const smtpError = ref('')
const smtpSuccess = ref('')
const smtpLoading = ref(false)
const showSmtpPass = ref(false)

// Linux DO OAuth 配置（仅超级管理员）
const linuxdoClientId = ref('')
const linuxdoClientSecret = ref('')
const linuxdoRedirectUri = ref('')
const linuxdoClientSecretSet = ref(false)
const linuxdoClientSecretStored = ref(false)
const linuxdoOauthError = ref('')
const linuxdoOauthSuccess = ref('')
const linuxdoOauthLoading = ref(false)
const showLinuxdoClientSecret = ref(false)

// Linux DO Credit 配置（仅超级管理员）
const linuxdoCreditPid = ref('')
const linuxdoCreditKey = ref('')
const linuxdoCreditKeySet = ref(false)
const linuxdoCreditKeyStored = ref(false)
const linuxdoCreditError = ref('')
const linuxdoCreditSuccess = ref('')
const linuxdoCreditLoading = ref(false)
const showLinuxdoCreditKey = ref(false)

// ZPAY 支付配置（仅超级管理员）
const zpayBaseUrl = ref('https://zpayz.cn')
const zpayPid = ref('')
const zpayKey = ref('')
const zpayKeySet = ref(false)
const zpayKeyStored = ref(false)
const zpayError = ref('')
const zpaySuccess = ref('')
const zpayLoading = ref(false)
const showZpayKey = ref(false)

// Cloudflare Turnstile 配置（仅超级管理员）
const turnstileSiteKey = ref('')
const turnstileSecretKey = ref('')
const turnstileEnabled = ref(false)
const turnstileSecretSet = ref(false)
const turnstileSecretStored = ref(false)
const turnstileSiteKeyStored = ref(false)
const turnstileError = ref('')
const turnstileSuccess = ref('')
const turnstileLoading = ref(false)
const showTurnstileSecretKey = ref(false)

// Telegram Bot 配置（仅超级管理员）
const telegramAllowedUserIds = ref('')
const telegramAllowedUserIdsStored = ref(false)
const telegramBotToken = ref('')
const telegramTokenSet = ref(false)
const telegramTokenStored = ref(false)
const telegramNotifyEnabled = ref<'true' | 'false'>('true')
const telegramNotifyEnabledStored = ref(false)
const telegramNotifyChatIds = ref('')
const telegramNotifyChatIdsStored = ref(false)
const telegramNotifyTimeoutMs = ref('8000')
const telegramNotifyTimeoutMsStored = ref(false)
const telegramError = ref('')
const telegramSuccess = ref('')
const telegramLoading = ref(false)
const showTelegramBotToken = ref(false)

// 代理池配置（仅超级管理员）
const proxyPoolEnabled = ref(true)
const proxyPoolMaxAccountsPerProxy = ref('2')
const proxyPoolCheckIntervalMinutes = ref('60')
const proxyPoolRotationDays = ref('10')
const proxyPoolTestUrl = ref('https://example.com')
const proxyPoolTestTimeoutMs = ref('8000')
const proxyPoolValidationScope = ref<'ok' | 'all'>('ok')
const proxyPoolInput = ref('')
const proxyPoolList = ref<ProxyPoolItem[]>([])
const proxyPoolStats = ref<ProxyPoolStats | null>(null)
const proxyPoolError = ref('')
const proxyPoolSuccess = ref('')
const proxyPoolLoading = ref(false)
const proxyPoolValidating = ref(false)
const proxyPoolValidationJobId = ref<number | null>(null)
const proxyPoolValidationProgress = ref({ total: 0, ok: 0, bad: 0, status: 'idle' })
let proxyPoolValidationTimer: ReturnType<typeof setInterval> | null = null
const proxyPoolValidationDialogOpen = ref(false)
const proxyPoolValidationItems = ref<ProxyPoolValidationItem[]>([])
const proxyPoolValidationItemsTotal = ref(0)
const proxyPoolValidationItemsLoading = ref(false)
const proxyPoolValidationItemsError = ref('')
const proxyPoolValidationShowAll = ref(false)
const proxyApiLogs = ref<ProxyPoolApiLog[]>([])
const proxyApiLogsTotal = ref(0)
const proxyApiLogsLimit = ref(50)
const proxyApiLogsOffset = ref(0)
const proxyApiLogsLoading = ref(false)
const proxyApiLogsError = ref('')
const proxyApiLogsDialogOpen = ref(false)

onMounted(async () => {
  await nextTick()
  teleportReady.value = !!document.getElementById('header-actions')

  if (!isSuperAdmin.value) return
  await loadApiKey()
  await Promise.all([
    loadFeatureFlags(),
    loadEmailDomainWhitelist(),
    loadPointsWithdrawSettings(),
    loadSmtpSettings(),
    loadLinuxDoOAuthSettings(),
    loadLinuxDoCreditSettings(),
    loadZpaySettings(),
    loadTurnstileSettings(),
    loadTelegramSettings(),
    loadProxyPool(),
  ])
})

onUnmounted(() => {
  teleportReady.value = false
  if (proxyPoolValidationTimer) {
    clearInterval(proxyPoolValidationTimer)
    proxyPoolValidationTimer = null
  }
})

const loadApiKey = async () => {
  try {
    const response = await userService.getApiKey()
    apiKey.value = typeof response.apiKey === 'string' ? response.apiKey : ''
  } catch (err: any) {
    console.error('Load API key error:', err)
  }
}

const loadFeatureFlags = async () => {
  featureFlagsError.value = ''
  featureFlagsSuccess.value = ''
  try {
    const response = await adminService.getFeatureFlags()
    const next = response.features || {}
    featureFlags.value = {
      xhs: next.xhs !== false,
      xianyu: next.xianyu !== false,
      payment: next.payment !== false,
      openAccounts: next.openAccounts !== false
    }
    appConfigStore.features = { ...featureFlags.value }
  } catch (err: any) {
    featureFlagsError.value = err.response?.data?.error || '加载功能开关失败'
  }
}

const saveFeatureFlags = async () => {
  featureFlagsError.value = ''
  featureFlagsSuccess.value = ''
  featureFlagsLoading.value = true
  try {
    const response = await adminService.updateFeatureFlags({
      features: { ...featureFlags.value }
    })
    const next = response.features || {}
    featureFlags.value = {
      xhs: next.xhs !== false,
      xianyu: next.xianyu !== false,
      payment: next.payment !== false,
      openAccounts: next.openAccounts !== false
    }
    appConfigStore.features = { ...featureFlags.value }
    featureFlagsSuccess.value = '已保存'
    setTimeout(() => (featureFlagsSuccess.value = ''), 3000)
  } catch (err: any) {
    featureFlagsError.value = err.response?.data?.error || '保存失败'
  } finally {
    featureFlagsLoading.value = false
  }
}

const handleUpdateApiKey = async () => {
  apiKeyError.value = ''
  apiKeySuccess.value = ''

  // Validation
  if (!apiKey.value) {
    apiKeyError.value = '请输入API密钥'
    return
  }

  if (apiKey.value.length < 16) {
    apiKeyError.value = 'API密钥至少需要 16 个字符以确保安全性'
    return
  }

  apiKeyLoading.value = true

  try {
    await userService.updateApiKey(apiKey.value)
    apiKeySuccess.value = 'API密钥更新成功！请在油猴脚本中使用新密钥'

    // Clear success message after 5 seconds
    setTimeout(() => {
      apiKeySuccess.value = ''
    }, 5000)
  } catch (err: any) {
    apiKeyError.value = err.response?.data?.error || '更新API密钥失败，请重试'
  } finally {
    apiKeyLoading.value = false
  }
}

// 生成随机API密钥
const generateApiKey = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const length = 32
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  apiKey.value = result
  showApiKey.value = true // 生成后自动显示
  apiKeySuccess.value = '✅ 已生成随机密钥，点击"更新 API 密钥"保存'
}

// 切换显示/隐藏API密钥
const toggleShowApiKey = () => {
  showApiKey.value = !showApiKey.value
}

const toggleShowSmtpPass = () => {
  showSmtpPass.value = !showSmtpPass.value
}

const toggleShowLinuxdoClientSecret = () => {
  showLinuxdoClientSecret.value = !showLinuxdoClientSecret.value
}

const toggleShowLinuxdoCreditKey = () => {
  showLinuxdoCreditKey.value = !showLinuxdoCreditKey.value
}

const toggleShowZpayKey = () => {
  showZpayKey.value = !showZpayKey.value
}

const toggleShowTurnstileSecretKey = () => {
  showTurnstileSecretKey.value = !showTurnstileSecretKey.value
}

const toggleShowTelegramBotToken = () => {
  showTelegramBotToken.value = !showTelegramBotToken.value
}

const loadEmailDomainWhitelist = async () => {
  emailDomainWhitelistError.value = ''
  emailDomainWhitelistSuccess.value = ''
  try {
    const response = await adminService.getEmailDomainWhitelist()
    emailDomainWhitelist.value = (response.domains || []).join(',')
  } catch (err: any) {
    emailDomainWhitelistError.value = err.response?.data?.error || '加载邮箱白名单失败'
  }
}

const saveEmailDomainWhitelist = async () => {
  emailDomainWhitelistError.value = ''
  emailDomainWhitelistSuccess.value = ''
  emailDomainWhitelistLoading.value = true
  try {
    const domains = emailDomainWhitelist.value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    await adminService.updateEmailDomainWhitelist(domains)
    emailDomainWhitelistSuccess.value = '已保存'
    setTimeout(() => (emailDomainWhitelistSuccess.value = ''), 3000)
  } catch (err: any) {
    emailDomainWhitelistError.value = err.response?.data?.error || '保存失败'
  } finally {
    emailDomainWhitelistLoading.value = false
  }
}

const loadLinuxDoOAuthSettings = async () => {
  linuxdoOauthError.value = ''
  linuxdoOauthSuccess.value = ''
  try {
    const response = await adminService.getLinuxDoOAuthSettings()
    linuxdoClientId.value = response.oauth?.clientId || ''
    linuxdoRedirectUri.value = response.oauth?.redirectUri || ''
    linuxdoClientSecret.value = ''
    linuxdoClientSecretSet.value = Boolean(response.oauth?.clientSecretSet)
    linuxdoClientSecretStored.value = Boolean(response.oauth?.clientSecretStored)
  } catch (err: any) {
    linuxdoOauthError.value = err.response?.data?.error || '加载 Linux DO OAuth 配置失败'
  }
}

const saveLinuxDoOAuthSettings = async () => {
  linuxdoOauthError.value = ''
  linuxdoOauthSuccess.value = ''

  const clientId = linuxdoClientId.value.trim()
  const redirectUri = linuxdoRedirectUri.value.trim()
  const clientSecretTrimmed = linuxdoClientSecret.value.trim()

  const wantsEnable = Boolean(clientId || redirectUri || clientSecretTrimmed)
  if (wantsEnable) {
    if (!clientId) {
      linuxdoOauthError.value = '请输入 Linux DO Client ID'
      return
    }
    if (!redirectUri) {
      linuxdoOauthError.value = '请输入 Linux DO Redirect URI'
      return
    }
    if (!clientSecretTrimmed && !linuxdoClientSecretSet.value) {
      linuxdoOauthError.value = '请输入 Linux DO Client Secret'
      return
    }

    try {
      const parsed = new URL(redirectUri)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        linuxdoOauthError.value = 'Redirect URI 必须是 http(s)'
        return
      }
    } catch {
      linuxdoOauthError.value = 'Redirect URI 格式不正确'
      return
    }
  }

  linuxdoOauthLoading.value = true
  try {
    const payload: any = {
      oauth: {
        clientId,
        redirectUri,
      },
    }
    if (clientSecretTrimmed) {
      payload.oauth.clientSecret = clientSecretTrimmed
    }

    const response = await adminService.updateLinuxDoOAuthSettings(payload)
    linuxdoClientId.value = response.oauth?.clientId || clientId
    linuxdoRedirectUri.value = response.oauth?.redirectUri || redirectUri
    linuxdoClientSecret.value = ''
    linuxdoClientSecretSet.value = Boolean(response.oauth?.clientSecretSet)
    linuxdoClientSecretStored.value = Boolean(response.oauth?.clientSecretStored)

    linuxdoOauthSuccess.value = '已保存'
    setTimeout(() => (linuxdoOauthSuccess.value = ''), 3000)
  } catch (err: any) {
    linuxdoOauthError.value = err.response?.data?.error || '保存失败'
  } finally {
    linuxdoOauthLoading.value = false
  }
}

const loadLinuxDoCreditSettings = async () => {
  linuxdoCreditError.value = ''
  linuxdoCreditSuccess.value = ''
  try {
    const response = await adminService.getLinuxDoCreditSettings()
    linuxdoCreditPid.value = response.credit?.pid || ''
    linuxdoCreditKey.value = ''
    linuxdoCreditKeySet.value = Boolean(response.credit?.keySet)
    linuxdoCreditKeyStored.value = Boolean(response.credit?.keyStored)
  } catch (err: any) {
    linuxdoCreditError.value = err.response?.data?.error || '加载 Linux DO Credit 配置失败'
  }
}

const saveLinuxDoCreditSettings = async () => {
  linuxdoCreditError.value = ''
  linuxdoCreditSuccess.value = ''

  const pid = linuxdoCreditPid.value.trim()
  const keyTrimmed = linuxdoCreditKey.value.trim()
  const wantsEnable = Boolean(pid || keyTrimmed)

  if (wantsEnable) {
    if (!pid) {
      linuxdoCreditError.value = '请输入 Credit PID'
      return
    }
    if (!keyTrimmed && !linuxdoCreditKeySet.value) {
      linuxdoCreditError.value = '请输入 Credit KEY'
      return
    }
  }

  linuxdoCreditLoading.value = true
  try {
    const payload: any = { credit: { pid } }
    if (keyTrimmed) {
      payload.credit.key = keyTrimmed
    }
    const response = await adminService.updateLinuxDoCreditSettings(payload)
    linuxdoCreditPid.value = response.credit?.pid || pid
    linuxdoCreditKey.value = ''
    linuxdoCreditKeySet.value = Boolean(response.credit?.keySet)
    linuxdoCreditKeyStored.value = Boolean(response.credit?.keyStored)

    linuxdoCreditSuccess.value = '已保存'
    setTimeout(() => (linuxdoCreditSuccess.value = ''), 3000)
  } catch (err: any) {
    linuxdoCreditError.value = err.response?.data?.error || '保存失败'
  } finally {
    linuxdoCreditLoading.value = false
  }
}

const loadZpaySettings = async () => {
  zpayError.value = ''
  zpaySuccess.value = ''
  try {
    const response = await adminService.getZpaySettings()
    zpayBaseUrl.value = response.zpay?.baseUrl || 'https://zpayz.cn'
    zpayPid.value = response.zpay?.pid || ''
    zpayKey.value = ''
    zpayKeySet.value = Boolean(response.zpay?.keySet)
    zpayKeyStored.value = Boolean(response.zpay?.keyStored)
  } catch (err: any) {
    zpayError.value = err.response?.data?.error || '加载 ZPAY 配置失败'
  }
}

const saveZpaySettings = async () => {
  zpayError.value = ''
  zpaySuccess.value = ''

  const baseUrl = zpayBaseUrl.value.trim()
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        zpayError.value = 'ZPAY Base URL 必须是 http(s)'
        return
      }
    } catch {
      zpayError.value = 'ZPAY Base URL 格式不正确'
      return
    }
  }

  const pid = zpayPid.value.trim()
  const keyTrimmed = zpayKey.value.trim()
  if (pid) {
    if (!keyTrimmed && !zpayKeySet.value) {
      zpayError.value = '请输入 ZPAY KEY'
      return
    }
  }

  zpayLoading.value = true
  try {
    const payload: any = { zpay: { baseUrl, pid } }
    if (keyTrimmed) {
      payload.zpay.key = keyTrimmed
    }
    const response = await adminService.updateZpaySettings(payload)
    zpayBaseUrl.value = response.zpay?.baseUrl || baseUrl || 'https://zpayz.cn'
    zpayPid.value = response.zpay?.pid || pid
    zpayKey.value = ''
    zpayKeySet.value = Boolean(response.zpay?.keySet)
    zpayKeyStored.value = Boolean(response.zpay?.keyStored)

    zpaySuccess.value = '已保存'
    setTimeout(() => (zpaySuccess.value = ''), 3000)
  } catch (err: any) {
    zpayError.value = err.response?.data?.error || '保存失败'
  } finally {
    zpayLoading.value = false
  }
}

const loadTurnstileSettings = async () => {
  turnstileError.value = ''
  turnstileSuccess.value = ''
  try {
    const response = await adminService.getTurnstileSettings()
    turnstileSiteKey.value = response.turnstile?.siteKey || ''
    turnstileSecretKey.value = ''
    turnstileEnabled.value = Boolean(response.enabled)
    turnstileSecretSet.value = Boolean(response.turnstile?.secretSet)
    turnstileSecretStored.value = Boolean(response.turnstile?.secretStored)
    turnstileSiteKeyStored.value = Boolean(response.turnstile?.siteKeyStored)
  } catch (err: any) {
    turnstileError.value = err.response?.data?.error || '加载 Turnstile 配置失败'
  }
}

const saveTurnstileSettings = async () => {
  turnstileError.value = ''
  turnstileSuccess.value = ''

  const siteKey = turnstileSiteKey.value.trim()
  const secretTrimmed = turnstileSecretKey.value.trim()

  turnstileLoading.value = true
  try {
    const payload: any = { turnstile: { siteKey } }
    if (secretTrimmed) {
      payload.turnstile.secretKey = secretTrimmed
    }

    const response = await adminService.updateTurnstileSettings(payload)
    turnstileSiteKey.value = response.turnstile?.siteKey || siteKey
    turnstileSecretKey.value = ''
    turnstileEnabled.value = Boolean(response.enabled)
    turnstileSecretSet.value = Boolean(response.turnstile?.secretSet)
    turnstileSecretStored.value = Boolean(response.turnstile?.secretStored)
    turnstileSiteKeyStored.value = Boolean(response.turnstile?.siteKeyStored)

    turnstileSuccess.value = '已保存'
    setTimeout(() => (turnstileSuccess.value = ''), 3000)
  } catch (err: any) {
    turnstileError.value = err.response?.data?.error || '保存失败'
  } finally {
    turnstileLoading.value = false
  }
}

const loadTelegramSettings = async () => {
  telegramError.value = ''
  telegramSuccess.value = ''
  try {
    const response = await adminService.getTelegramSettings()
    telegramAllowedUserIds.value = response.telegram?.allowedUserIds || ''
    telegramAllowedUserIdsStored.value = Boolean(response.telegram?.allowedUserIdsStored)
    telegramBotToken.value = ''
    telegramTokenSet.value = Boolean(response.telegram?.tokenSet)
    telegramTokenStored.value = Boolean(response.telegram?.tokenStored)
    telegramNotifyEnabled.value = response.telegram?.notifyEnabled === false ? 'false' : 'true'
    telegramNotifyEnabledStored.value = Boolean(response.telegram?.notifyEnabledStored)
    telegramNotifyChatIds.value = response.telegram?.notifyChatIds || ''
    telegramNotifyChatIdsStored.value = Boolean(response.telegram?.notifyChatIdsStored)
    telegramNotifyTimeoutMs.value = String(response.telegram?.notifyTimeoutMs ?? 8000)
    telegramNotifyTimeoutMsStored.value = Boolean(response.telegram?.notifyTimeoutMsStored)
  } catch (err: any) {
    telegramError.value = err.response?.data?.error || '加载 Telegram 配置失败'
  }
}

const saveTelegramSettings = async () => {
  telegramError.value = ''
  telegramSuccess.value = ''

  const allowedIdsRaw = telegramAllowedUserIds.value.trim()
  if (allowedIdsRaw) {
    const items = allowedIdsRaw
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
    const invalid = items.find(item => !/^\d+$/.test(item))
    if (invalid) {
      telegramError.value = `允许的用户 ID 格式不正确：${invalid}`
      return
    }
  }

  const notifyChatIdsRaw = telegramNotifyChatIds.value.trim()
  if (notifyChatIdsRaw) {
    const items = notifyChatIdsRaw
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
    const invalid = items.find(item => !/^-?\d+$/.test(item) && !/^@[\w_]{5,32}$/.test(item))
    if (invalid) {
      telegramError.value = `通知 chat_id 格式不正确：${invalid}`
      return
    }
  }

  const notifyTimeoutRaw = telegramNotifyTimeoutMs.value.trim()
  const notifyTimeoutMs = Number.parseInt(notifyTimeoutRaw, 10)
  if (!Number.isFinite(notifyTimeoutMs) || notifyTimeoutMs <= 0) {
    telegramError.value = '通知超时时间需为正整数（毫秒）'
    return
  }

  telegramLoading.value = true
  try {
    const payload: any = { telegram: { allowedUserIds: allowedIdsRaw } }
    const tokenTrimmed = telegramBotToken.value.trim()
    if (tokenTrimmed) {
      payload.telegram.botToken = tokenTrimmed
    }
    payload.telegram.notifyEnabled = telegramNotifyEnabled.value === 'true'
    payload.telegram.notifyChatIds = notifyChatIdsRaw
    payload.telegram.notifyTimeoutMs = notifyTimeoutMs

    const response = await adminService.updateTelegramSettings(payload)
    telegramAllowedUserIds.value = response.telegram?.allowedUserIds || allowedIdsRaw
    telegramAllowedUserIdsStored.value = Boolean(response.telegram?.allowedUserIdsStored)
    telegramBotToken.value = ''
    telegramTokenSet.value = Boolean(response.telegram?.tokenSet)
    telegramTokenStored.value = Boolean(response.telegram?.tokenStored)
    telegramNotifyEnabled.value = response.telegram?.notifyEnabled === false ? 'false' : 'true'
    telegramNotifyEnabledStored.value = Boolean(response.telegram?.notifyEnabledStored)
    telegramNotifyChatIds.value = response.telegram?.notifyChatIds || notifyChatIdsRaw
    telegramNotifyChatIdsStored.value = Boolean(response.telegram?.notifyChatIdsStored)
    telegramNotifyTimeoutMs.value = String(response.telegram?.notifyTimeoutMs ?? notifyTimeoutMs)
    telegramNotifyTimeoutMsStored.value = Boolean(response.telegram?.notifyTimeoutMsStored)

    telegramSuccess.value = '已保存（Bot Token 修改需重启后端生效；通知配置实时生效）'
    setTimeout(() => (telegramSuccess.value = ''), 3000)
  } catch (err: any) {
    telegramError.value = err.response?.data?.error || '保存失败'
  } finally {
    telegramLoading.value = false
  }
}

const applyProxyPoolSettings = (settings: any) => {
  proxyPoolEnabled.value = settings?.enabled !== false
  proxyPoolMaxAccountsPerProxy.value = String(settings?.maxAccountsPerProxy ?? 2)
  proxyPoolCheckIntervalMinutes.value = String(settings?.checkIntervalMinutes ?? 60)
  proxyPoolRotationDays.value = String(settings?.rotationDays ?? 10)
  proxyPoolTestUrl.value = String(settings?.testUrl ?? 'https://example.com')
  proxyPoolTestTimeoutMs.value = String(settings?.testTimeoutMs ?? 8000)
  proxyPoolValidationScope.value = settings?.validationScope === 'all' ? 'all' : 'ok'
}

const loadProxyPool = async () => {
  proxyPoolError.value = ''
  proxyPoolSuccess.value = ''
  try {
    const response = await adminService.getProxyPool()
    applyProxyPoolSettings(response.settings)
    proxyPoolStats.value = response.stats || null
    proxyPoolList.value = Array.isArray(response.proxies) ? response.proxies : []
    proxyPoolInput.value = proxyPoolList.value.map(item => item.proxyUrl).filter(Boolean).join('\n')
  } catch (err: any) {
    proxyPoolError.value = err.response?.data?.error || '加载代理池失败'
  }
}

const loadProxyApiLogs = async (reset = false) => {
  if (reset) {
    proxyApiLogsOffset.value = 0
  }
  proxyApiLogsError.value = ''
  proxyApiLogsLoading.value = true
  try {
    const response = await adminService.getProxyPoolLogs({
      limit: proxyApiLogsLimit.value,
      offset: proxyApiLogsOffset.value
    })
    proxyApiLogs.value = response.logs || []
    proxyApiLogsTotal.value = Number(response.total || 0)
  } catch (err: any) {
    proxyApiLogsError.value = err.response?.data?.error || '加载 API 调用日志失败'
  } finally {
    proxyApiLogsLoading.value = false
  }
}

const openProxyApiLogsDialog = async () => {
  proxyApiLogsDialogOpen.value = true
  await loadProxyApiLogs(true)
}

const saveProxyPoolSettings = async () => {
  proxyPoolError.value = ''
  proxyPoolSuccess.value = ''

  const maxAccounts = Number.parseInt(proxyPoolMaxAccountsPerProxy.value.trim(), 10)
  if (!Number.isFinite(maxAccounts) || maxAccounts < 1 || maxAccounts > 50) {
    proxyPoolError.value = '每个代理绑定账号数需为 1-50 的整数'
    return
  }

  const intervalMinutes = Number.parseInt(proxyPoolCheckIntervalMinutes.value.trim(), 10)
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) {
    proxyPoolError.value = '健康检查间隔需为 1-1440 分钟'
    return
  }

  const rotationDays = Number.parseInt(proxyPoolRotationDays.value.trim(), 10)
  if (!Number.isFinite(rotationDays) || rotationDays < 1 || rotationDays > 365) {
    proxyPoolError.value = '轮换天数需为 1-365'
    return
  }

  const timeoutMs = Number.parseInt(proxyPoolTestTimeoutMs.value.trim(), 10)
  if (!Number.isFinite(timeoutMs) || timeoutMs < 2000 || timeoutMs > 60000) {
    proxyPoolError.value = '检测超时需为 2000-60000 毫秒'
    return
  }

  const validationScope = proxyPoolValidationScope.value === 'all' ? 'all' : 'ok'

  const testUrl = proxyPoolTestUrl.value.trim()
  if (testUrl) {
    try {
      const parsed = new URL(testUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        proxyPoolError.value = '检测 URL 必须为 http/https'
        return
      }
    } catch {
      proxyPoolError.value = '检测 URL 格式不正确'
      return
    }
  }

  proxyPoolLoading.value = true
  try {
    const response = await adminService.updateProxyPoolSettings({
      settings: {
        enabled: proxyPoolEnabled.value,
        maxAccountsPerProxy: maxAccounts,
        checkIntervalMinutes: intervalMinutes,
        rotationDays,
        testUrl,
        testTimeoutMs: timeoutMs,
        validationScope
      }
    })
    applyProxyPoolSettings(response.settings)
    proxyPoolSuccess.value = '代理池设置已保存'
    setTimeout(() => (proxyPoolSuccess.value = ''), 3000)
  } catch (err: any) {
    proxyPoolError.value = err.response?.data?.error || '保存代理池设置失败'
  } finally {
    proxyPoolLoading.value = false
  }
}

const saveProxyPoolList = async () => {
  proxyPoolError.value = ''
  proxyPoolSuccess.value = ''
  proxyPoolLoading.value = true
  try {
    const response = await adminService.updateProxyPool({ proxies: proxyPoolInput.value })
    proxyPoolStats.value = response.stats || null
    proxyPoolList.value = Array.isArray(response.proxies) ? response.proxies : []
    proxyPoolInput.value = proxyPoolList.value.map(item => item.proxyUrl).filter(Boolean).join('\n')
    if (response.invalid?.length) {
      proxyPoolError.value = `以下代理格式无效已忽略：${response.invalid.join(', ')}`
    } else {
      proxyPoolSuccess.value = '代理池已保存'
      setTimeout(() => (proxyPoolSuccess.value = ''), 3000)
    }
  } catch (err: any) {
    proxyPoolError.value = err.response?.data?.error || '保存代理池失败'
  } finally {
    proxyPoolLoading.value = false
  }
}

const stopProxyPoolValidationPolling = () => {
  if (proxyPoolValidationTimer) {
    clearInterval(proxyPoolValidationTimer)
    proxyPoolValidationTimer = null
  }
}

const fetchProxyPoolValidationStatus = async () => {
  if (!proxyPoolValidationJobId.value) return
  const response = await adminService.getProxyPoolValidationStatus({
    id: proxyPoolValidationJobId.value,
    status: 'ok',
    limit: 200
  })
  const job = response.job
  proxyPoolValidationProgress.value = {
    total: job.total || 0,
    ok: job.ok || 0,
    bad: job.bad || 0,
    status: job.status || 'running'
  }

  const doneCount = (job.ok || 0) + (job.bad || 0)
  if (job.status === 'running') {
    proxyPoolSuccess.value = `检测中：已完成 ${doneCount}/${job.total}`
    return
  }

  stopProxyPoolValidationPolling()
  proxyPoolValidating.value = false

  if (job.status === 'done') {
    proxyPoolSuccess.value = `检测完成：可用 ${job.ok}/${job.total}`
    await loadProxyPool()
    setTimeout(() => (proxyPoolSuccess.value = ''), 3000)
  } else {
    proxyPoolError.value = job.lastError || '代理检测失败'
  }
}

const loadProxyPoolValidationItems = async () => {
  if (!proxyPoolValidationJobId.value) return
  proxyPoolValidationItemsError.value = ''
  proxyPoolValidationItemsLoading.value = true
  try {
    const params: any = {
      id: proxyPoolValidationJobId.value,
      limit: 200
    }
    if (!proxyPoolValidationShowAll.value) {
      params.status = 'ok'
    }
    const response = await adminService.getProxyPoolValidationStatus(params)
    proxyPoolValidationItems.value = response.items || []
    proxyPoolValidationItemsTotal.value = Number(response.itemsTotal || 0)
  } catch (err: any) {
    proxyPoolValidationItemsError.value = err.response?.data?.error || '加载检测结果失败'
  } finally {
    proxyPoolValidationItemsLoading.value = false
  }
}

const openProxyPoolValidationDialog = async () => {
  if (!proxyPoolValidationJobId.value) {
    proxyPoolValidationItemsError.value = '请先执行一次检测'
    proxyPoolValidationDialogOpen.value = true
    return
  }
  proxyPoolValidationDialogOpen.value = true
  await loadProxyPoolValidationItems()
}

const validateProxyPoolNow = async () => {
  proxyPoolError.value = ''
  proxyPoolSuccess.value = ''
  proxyPoolValidating.value = true
  try {
    stopProxyPoolValidationPolling()
    const response = await adminService.validateProxyPool()
    proxyPoolValidationJobId.value = response.job?.checkId || null
    if (!proxyPoolValidationJobId.value) {
      throw new Error('未返回检测任务')
    }
    await fetchProxyPoolValidationStatus()
    proxyPoolValidationTimer = setInterval(() => {
      fetchProxyPoolValidationStatus().catch((err: any) => {
        proxyPoolError.value = err?.response?.data?.error || '获取检测进度失败'
        stopProxyPoolValidationPolling()
        proxyPoolValidating.value = false
      })
    }, 2000)
  } catch (err: any) {
    proxyPoolError.value = err.response?.data?.error || '代理池检测失败'
  } finally {
    if (!proxyPoolValidationJobId.value) {
      proxyPoolValidating.value = false
    }
  }
}

const loadSmtpSettings = async () => {
  smtpError.value = ''
  smtpSuccess.value = ''
  try {
    const response = await adminService.getSmtpSettings()
    smtpHost.value = response.smtp?.host || ''
    smtpPort.value = String(response.smtp?.port ?? 465)
    smtpSecure.value = response.smtp?.secure ? 'true' : 'false'
    smtpUser.value = response.smtp?.user || ''
    smtpFrom.value = response.smtp?.from || ''
    adminAlertEmail.value = response.adminAlertEmail || ''
    smtpPass.value = ''
    smtpPassSet.value = Boolean(response.smtp?.passSet)
    smtpPassStored.value = Boolean(response.smtp?.passStored)
  } catch (err: any) {
    smtpError.value = err.response?.data?.error || '加载 SMTP 配置失败'
  }
}

const saveSmtpSettings = async () => {
  smtpError.value = ''
  smtpSuccess.value = ''

  const host = smtpHost.value.trim()
  const port = Number.parseInt(smtpPort.value.trim(), 10)
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    smtpError.value = '请输入有效的 SMTP 端口（1-65535）'
    return
  }

  const secure = smtpSecure.value === 'true'
  const user = smtpUser.value.trim()
  const from = smtpFrom.value.trim()
  const recipients = adminAlertEmail.value.trim()

  const passTrimmed = smtpPass.value.trim()

  smtpLoading.value = true
  try {
    const payload: any = {
      smtp: {
        host,
        port,
        secure,
        user,
        from,
      },
      adminAlertEmail: recipients,
    }
    if (passTrimmed) {
      payload.smtp.pass = passTrimmed
    }

    const response = await adminService.updateSmtpSettings(payload)
    smtpHost.value = response.smtp?.host || host
    smtpPort.value = String(response.smtp?.port ?? port)
    smtpSecure.value = response.smtp?.secure ? 'true' : 'false'
    smtpUser.value = response.smtp?.user || user
    smtpFrom.value = response.smtp?.from || from
    adminAlertEmail.value = response.adminAlertEmail || recipients
    smtpPass.value = ''
    smtpPassSet.value = Boolean(response.smtp?.passSet)
    smtpPassStored.value = Boolean(response.smtp?.passStored)
    smtpSuccess.value = '已保存'
    setTimeout(() => (smtpSuccess.value = ''), 3000)
  } catch (err: any) {
    smtpError.value = err.response?.data?.error || '保存失败'
  } finally {
    smtpLoading.value = false
  }
}

const parseYuanToCents = (value: string) => {
  const raw = String(value ?? '').trim()
  if (!raw) return NaN
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(raw)) return NaN

  const parts = raw.split('.')
  const yuan = Number.parseInt(parts[0] || '0', 10)
  const centsText = String(parts[1] || '')
  const cents = Number.parseInt((centsText + '00').slice(0, 2), 10)
  return yuan * 100 + cents
}

const loadPointsWithdrawSettings = async () => {
  pointsWithdrawError.value = ''
  pointsWithdrawSuccess.value = ''
  try {
    const response = await adminService.getPointsWithdrawSettings()
    pointsWithdrawRatePoints.value = String(response.rate?.points ?? 1)
    pointsWithdrawRateCashYuan.value = ((Number(response.rate?.cashCents ?? 100) || 0) / 100).toFixed(2)
    pointsWithdrawMinCashYuan.value = ((Number(response.minCashCents ?? 1000) || 0) / 100).toFixed(2)
    pointsWithdrawMinPoints.value = Number(response.minPoints ?? 0)
    pointsWithdrawStepPoints.value = Number(response.stepPoints ?? 0)
  } catch (err: any) {
    pointsWithdrawError.value = err.response?.data?.error || '加载积分提现设置失败'
  }
}

const savePointsWithdrawSettings = async () => {
  pointsWithdrawError.value = ''
  pointsWithdrawSuccess.value = ''

  const ratePoints = Number.parseInt(pointsWithdrawRatePoints.value.trim(), 10)
  if (!Number.isFinite(ratePoints) || ratePoints <= 0) {
    pointsWithdrawError.value = '请输入有效的积分比例（正整数）'
    return
  }

  const rateCashCents = parseYuanToCents(pointsWithdrawRateCashYuan.value)
  if (!Number.isFinite(rateCashCents) || rateCashCents <= 0) {
    pointsWithdrawError.value = '请输入有效的返现金额（元）'
    return
  }

  const minCashCents = parseYuanToCents(pointsWithdrawMinCashYuan.value)
  if (!Number.isFinite(minCashCents) || minCashCents < 0) {
    pointsWithdrawError.value = '请输入有效的最低提现金额（元）'
    return
  }

  pointsWithdrawLoading.value = true
  try {
    const response = await adminService.updatePointsWithdrawSettings({
      ratePoints,
      rateCashCents,
      minCashCents,
    })
    pointsWithdrawRatePoints.value = String(response.rate?.points ?? ratePoints)
    pointsWithdrawRateCashYuan.value = ((Number(response.rate?.cashCents ?? rateCashCents) || 0) / 100).toFixed(2)
    pointsWithdrawMinCashYuan.value = ((Number(response.minCashCents ?? minCashCents) || 0) / 100).toFixed(2)
    pointsWithdrawMinPoints.value = Number(response.minPoints ?? 0)
    pointsWithdrawStepPoints.value = Number(response.stepPoints ?? 0)
    pointsWithdrawSuccess.value = '已保存'
    setTimeout(() => (pointsWithdrawSuccess.value = ''), 3000)
  } catch (err: any) {
    pointsWithdrawError.value = err.response?.data?.error || '保存失败'
  } finally {
    pointsWithdrawLoading.value = false
  }
}
</script>

<template>
  <div class="space-y-8">
    <!-- Header Actions -->
    <Teleport v-if="teleportReady && isSuperAdmin" to="#header-actions">
      <Button
        variant="outline"
        :disabled="versionLoading"
        class="h-10 px-4 border-gray-200 bg-white hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 rounded-xl transition-all"
        @click="checkForUpdates"
      >
        <RefreshCw v-if="versionLoading" class="w-4 h-4 mr-2 animate-spin" />
        <RefreshCw v-else class="w-4 h-4 mr-2" />
        检查更新
      </Button>
    </Teleport>

    <!-- 版本检查对话框 -->
    <Dialog v-model:open="versionDialogOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle class="text-xl font-bold text-gray-900">版本信息</DialogTitle>
          <DialogDescription class="text-gray-500">
            查看当前版本和最新版本信息
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4 py-4">
          <div v-if="versionError" class="rounded-xl bg-red-50 p-4 text-red-600 border border-red-100 text-sm font-medium">
            {{ versionError }}
          </div>

          <template v-else>
            <div class="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <div class="space-y-1">
                <p class="text-sm text-gray-500">当前版本</p>
                <p class="font-mono font-semibold text-gray-900">{{ currentVersion?.version || '-' }}</p>
              </div>
            </div>

            <div class="flex items-center justify-between p-4 rounded-2xl border" :class="hasNewVersion ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-100'">
              <div class="space-y-1">
                <p class="text-sm" :class="hasNewVersion ? 'text-green-600' : 'text-gray-500'">最新版本</p>
                <p class="font-mono font-semibold" :class="hasNewVersion ? 'text-green-700' : 'text-gray-900'">
                  {{ latestVersion?.version || '尚未发布' }}
                </p>
                <p v-if="latestVersion?.publishedAt" class="text-xs text-gray-400">
                  发布于 {{ new Date(latestVersion.publishedAt).toLocaleDateString('zh-CN') }}
                </p>
              </div>
              <div v-if="hasNewVersion" class="flex items-center gap-2">
                <span class="px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded-full">有新版本</span>
              </div>
            </div>

            <div v-if="hasNewVersion && latestVersion?.htmlUrl" class="pt-2">
              <a
                :href="latestVersion.htmlUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center justify-center w-full h-11 px-4 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-xl transition-colors"
              >
                前往 GitHub 查看新版本
              </a>
            </div>

            <div v-else-if="!hasNewVersion && currentVersion" class="text-center text-sm text-gray-500 py-2">
              已是最新版本
            </div>
          </template>
        </div>
      </DialogContent>
    </Dialog>

    <div class="grid gap-8 lg:grid-cols-2">
      <!-- 非超级管理员提示 -->
      <Card
        v-if="!isSuperAdmin"
        class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col lg:col-span-2"
      >
        <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-6 py-5 sm:px-8 sm:py-6">
          <CardTitle class="text-xl font-bold text-gray-900">系统设置</CardTitle>
          <CardDescription class="text-gray-500">仅超级管理员可查看与修改系统级配置。</CardDescription>
        </CardHeader>
      </Card>

      <!-- API密钥管理 -->
      <Card
        v-if="isSuperAdmin"
        class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col"
      >
        <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-6 py-5 sm:px-8 sm:py-6">
          <div class="flex items-center gap-3 mb-1">
            <div class="w-10 h-10 rounded-2xl bg-purple-50 flex items-center justify-center text-purple-600">
              <KeyRound class="w-5 h-5" />
            </div>
            <CardTitle class="text-xl font-bold text-gray-900">API 密钥</CardTitle>
          </div>
          <CardDescription class="text-gray-500 pl-[52px]">用于外部调用API接口。</CardDescription>
        </CardHeader>
        <CardContent class="p-6 sm:p-8 space-y-6 flex-1">
          <form @submit.prevent="handleUpdateApiKey" class="space-y-5">
            <div class="space-y-2">
              <Label for="apiKey" class="text-xs font-semibold text-gray-500 uppercase tracking-wider">API 密钥</Label>
              <div class="flex flex-col sm:flex-row gap-3">
                <div class="relative w-full sm:flex-1">
                  <Input
                    id="apiKey"
                    v-model="apiKey"
                    :type="showApiKey ? 'text' : 'password'"
                    placeholder="至少 16 个字符"
                    required
                    class="h-11 pr-10 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-100 focus:border-purple-500 transition-all font-mono text-sm"
                  />
                  <button
                    type="button"
                    @click="toggleShowApiKey"
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <EyeOff v-if="showApiKey" class="h-4 w-4" />
                    <Eye v-else class="h-4 w-4" />
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  @click="generateApiKey"
                  class="w-full sm:w-auto h-11 px-4 border-gray-200 hover:bg-purple-50 hover:text-purple-600 hover:border-purple-200 rounded-xl transition-all"
                >
                  <Sparkles class="h-4 w-4 mr-2" />
                  生成
                </Button>
              </div>
              <p class="text-xs text-gray-400">建议使用 32 位随机字符。</p>
            </div>

            <div v-if="apiKeyError" class="rounded-xl bg-red-50 p-4 flex items-center gap-3 text-red-600 border border-red-100">
              <AlertCircle class="w-5 h-5 flex-shrink-0" />
              <span class="text-sm font-medium">{{ apiKeyError }}</span>
            </div>

            <div v-if="apiKeySuccess" class="rounded-xl bg-green-50 p-4 flex items-center gap-3 text-green-600 border border-green-100">
              <CheckCircle2 class="w-5 h-5 flex-shrink-0" />
              <span class="text-sm font-medium">{{ apiKeySuccess }}</span>
            </div>

            <Button
              type="submit"
              :disabled="apiKeyLoading"
              class="w-full h-11 rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-200"
            >
              {{ apiKeyLoading ? '更新中...' : '更新 API 密钥' }}
            </Button>
          </form>

          <div class="rounded-2xl bg-blue-50/50 border border-blue-100 p-5 space-y-2">
            <p class="text-sm font-semibold text-blue-900 flex items-center gap-2">
              <AlertCircle class="w-4 h-4" />
              安全提示
            </p>
            <ul class="list-disc list-inside space-y-1 text-xs text-blue-700/80 pl-1">
              <li>定期轮换密钥可提升安全性。</li>
              <li>请勿将密钥泄露给他人。</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <!-- 邮箱后缀白名单 -->
      <Card v-if="isSuperAdmin" class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col">
        <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-6 py-5 sm:px-8 sm:py-6">
          <CardTitle class="text-xl font-bold text-gray-900">邮箱后缀白名单</CardTitle>
          <CardDescription class="text-gray-500">用于注册时校验邮箱域名（逗号分隔）。留空表示不限制。</CardDescription>
        </CardHeader>
        <CardContent class="p-6 sm:p-8 space-y-5 flex-1">
          <div class="space-y-2">
            <Label for="emailDomainWhitelist" class="text-xs font-semibold text-gray-500 uppercase tracking-wider">允许的域名</Label>
            <Input
              id="emailDomainWhitelist"
              v-model="emailDomainWhitelist"
              type="text"
              placeholder="example.com,company.com"
              class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
            />
            <p class="text-xs text-gray-400">示例：example.com 或 .example.com（允许子域名）</p>
          </div>

          <div v-if="emailDomainWhitelistError" class="rounded-xl bg-red-50 p-4 text-red-600 border border-red-100 text-sm font-medium">
            {{ emailDomainWhitelistError }}
          </div>

          <div v-if="emailDomainWhitelistSuccess" class="rounded-xl bg-green-50 p-4 text-green-600 border border-green-100 text-sm font-medium">
            {{ emailDomainWhitelistSuccess }}
          </div>

          <Button
            type="button"
            :disabled="emailDomainWhitelistLoading"
            class="w-full h-11 rounded-xl bg-black hover:bg-gray-800 text-white shadow-lg shadow-black/5"
            @click="saveEmailDomainWhitelist"
          >
            {{ emailDomainWhitelistLoading ? '保存中...' : '保存白名单' }}
          </Button>
        </CardContent>
      </Card>

      <!-- 功能开关 -->
      <Card v-if="isSuperAdmin" class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col lg:col-span-2">
        <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-6 py-5 sm:px-8 sm:py-6">
          <CardTitle class="text-xl font-bold text-gray-900">功能开关</CardTitle>
          <CardDescription class="text-gray-500">
            用于快速启用/禁用可选模块；禁用后相关页面/API 会返回 403 提示。
          </CardDescription>
        </CardHeader>
        <CardContent class="p-6 sm:p-8 space-y-5 flex-1">
          <div class="space-y-3">
            <div class="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <div class="space-y-1">
                <p class="font-medium text-gray-900">小红书（订单同步/兑换）</p>
              </div>
              <input
                type="checkbox"
                v-model="featureFlags.xhs"
                class="w-6 h-6 rounded-md border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </div>

            <div class="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <div class="space-y-1">
                <p class="font-medium text-gray-900">闲鱼（订单同步/兑换）</p>
              </div>
              <input
                type="checkbox"
                v-model="featureFlags.xianyu"
                class="w-6 h-6 rounded-md border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </div>

            <div class="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <div class="space-y-1">
                <p class="font-medium text-gray-900">支付（ZPAY）</p>
              </div>
              <input
                type="checkbox"
                v-model="featureFlags.payment"
                class="w-6 h-6 rounded-md border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </div>

            <div class="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <div class="space-y-1">
                <p class="font-medium text-gray-900">开放账号（含 Credit 订单）</p>
              </div>
              <input
                type="checkbox"
                v-model="featureFlags.openAccounts"
                class="w-6 h-6 rounded-md border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </div>
          </div>

          <div v-if="featureFlagsError" class="rounded-xl bg-red-50 p-4 text-red-600 border border-red-100 text-sm font-medium">
            {{ featureFlagsError }}
          </div>

          <div v-if="featureFlagsSuccess" class="rounded-xl bg-green-50 p-4 text-green-600 border border-green-100 text-sm font-medium">
            {{ featureFlagsSuccess }}
          </div>

          <div class="flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              variant="outline"
              class="w-full sm:w-auto h-11 px-4 border-gray-200 rounded-xl"
              @click="loadFeatureFlags"
            >
              刷新
            </Button>
            <Button
              type="button"
              :disabled="featureFlagsLoading"
              class="w-full h-11 rounded-xl bg-black hover:bg-gray-800 text-white shadow-lg shadow-black/5"
              @click="saveFeatureFlags"
            >
              {{ featureFlagsLoading ? '保存中...' : '保存功能开关' }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- SMTP / 第三方配置 -->
      <Card v-if="isSuperAdmin" class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col lg:col-span-2">
        <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-6 py-5 sm:px-8 sm:py-6">
          <CardTitle class="text-xl font-bold text-gray-900">SMTP 邮件告警配置</CardTitle>
          <CardDescription class="text-gray-500">用于发送验证码/订单邮件/系统告警邮件（保存后实时生效）。</CardDescription>
        </CardHeader>
        <CardContent class="p-6 sm:p-8 space-y-6 flex-1">
          <div class="grid gap-4 lg:grid-cols-3">
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">SMTP Host</Label>
              <Input
                v-model="smtpHost"
                type="text"
                placeholder="smtp.example.com"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="smtpLoading"
              />
            </div>
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">端口</Label>
              <Input
                v-model="smtpPort"
                type="text"
                placeholder="465"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="smtpLoading"
              />
            </div>
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">安全连接</Label>
              <Select v-model="smtpSecure" :disabled="smtpLoading">
                <SelectTrigger class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all">
                  <SelectValue placeholder="选择" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">启用 TLS/SSL</SelectItem>
                  <SelectItem value="false">不启用 TLS/SSL</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div class="grid gap-4 lg:grid-cols-3">
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">用户名</Label>
              <Input
                v-model="smtpUser"
                type="text"
                placeholder="bot@example.com"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="smtpLoading"
              />
            </div>
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">密码</Label>
              <div class="relative">
                <Input
                  v-model="smtpPass"
                  :type="showSmtpPass ? 'text' : 'password'"
                  placeholder="留空表示不修改"
                  class="h-11 pr-10 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                  :disabled="smtpLoading"
                />
                <button
                  type="button"
                  @click="toggleShowSmtpPass"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <EyeOff v-if="showSmtpPass" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </div>
              <p class="text-xs text-gray-400">
                <template v-if="smtpPassStored">密码已入库；留空表示不修改。</template>
                <template v-else-if="smtpPassSet">当前密码未入库；保存时可自动从 .env 迁移或在此重新填写。</template>
                <template v-else>未设置密码。</template>
              </p>
            </div>
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">发件人 From</Label>
              <Input
                v-model="smtpFrom"
                type="text"
                placeholder="留空则使用 SMTP_USER"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm"
                :disabled="smtpLoading"
              />
            </div>
          </div>

          <div class="space-y-2">
            <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">告警收件人（ADMIN_ALERT_EMAIL）</Label>
            <Input
              v-model="adminAlertEmail"
              type="text"
              placeholder="admin@example.com,ops@example.com"
              class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
              :disabled="smtpLoading"
            />
            <p class="text-xs text-gray-400">多个收件人用逗号分隔；留空则不发送系统告警邮件。</p>
          </div>

          <div v-if="smtpError" class="rounded-xl bg-red-50 p-4 text-red-600 border border-red-100 text-sm font-medium">
            {{ smtpError }}
          </div>

          <div v-if="smtpSuccess" class="rounded-xl bg-green-50 p-4 text-green-600 border border-green-100 text-sm font-medium">
            {{ smtpSuccess }}
          </div>

          <div class="flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              variant="outline"
              class="w-full sm:w-auto h-11 rounded-xl"
              :disabled="smtpLoading"
              @click="loadSmtpSettings"
            >
              刷新
            </Button>
            <Button
              type="button"
              class="w-full sm:flex-1 h-11 rounded-xl bg-black hover:bg-gray-800 text-white shadow-lg shadow-black/5"
              :disabled="smtpLoading"
              @click="saveSmtpSettings"
            >
              {{ smtpLoading ? '保存中...' : '保存 SMTP 配置' }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card v-if="isSuperAdmin" class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col">
        <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-6 py-5 sm:px-8 sm:py-6">
          <CardTitle class="text-xl font-bold text-gray-900">Linux DO OAuth 配置</CardTitle>
          <CardDescription class="text-gray-500">用于 Linux DO 登录/授权（保存后实时生效）。</CardDescription>
        </CardHeader>
        <CardContent class="p-6 sm:p-8 space-y-6 flex-1">
          <div class="grid gap-4">
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Client ID</Label>
              <Input
                v-model="linuxdoClientId"
                type="text"
                placeholder="Linux DO Client ID"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="linuxdoOauthLoading"
              />
            </div>
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Client Secret</Label>
              <div class="relative">
                <Input
                  v-model="linuxdoClientSecret"
                  :type="showLinuxdoClientSecret ? 'text' : 'password'"
                  placeholder="留空表示不修改"
                  class="h-11 pr-10 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                  :disabled="linuxdoOauthLoading"
                />
                <button
                  type="button"
                  @click="toggleShowLinuxdoClientSecret"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <EyeOff v-if="showLinuxdoClientSecret" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </div>
              <p class="text-xs text-gray-400">
                <template v-if="linuxdoClientSecretStored">Client Secret 已入库；留空表示不修改。</template>
                <template v-else-if="linuxdoClientSecretSet">Client Secret 未入库；保存时可从 .env 自动迁移或在此重新填写。</template>
                <template v-else>未设置 Client Secret。</template>
              </p>
            </div>
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Redirect URI</Label>
              <Input
                v-model="linuxdoRedirectUri"
                type="text"
                placeholder="https://example.com/redeem/linux-do"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm font-mono"
                :disabled="linuxdoOauthLoading"
              />
            </div>
          </div>

          <div v-if="linuxdoOauthError" class="rounded-xl bg-red-50 p-4 text-red-600 border border-red-100 text-sm font-medium">
            {{ linuxdoOauthError }}
          </div>

          <div v-if="linuxdoOauthSuccess" class="rounded-xl bg-green-50 p-4 text-green-600 border border-green-100 text-sm font-medium">
            {{ linuxdoOauthSuccess }}
          </div>

          <div class="flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              variant="outline"
              class="w-full sm:w-auto h-11 rounded-xl"
              :disabled="linuxdoOauthLoading"
              @click="loadLinuxDoOAuthSettings"
            >
              刷新
            </Button>
            <Button
              type="button"
              class="w-full sm:flex-1 h-11 rounded-xl bg-black hover:bg-gray-800 text-white shadow-lg shadow-black/5"
              :disabled="linuxdoOauthLoading"
              @click="saveLinuxDoOAuthSettings"
            >
              {{ linuxdoOauthLoading ? '保存中...' : '保存 Linux DO OAuth 配置' }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card v-if="isSuperAdmin" class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col">
        <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-6 py-5 sm:px-8 sm:py-6">
          <CardTitle class="text-xl font-bold text-gray-900">Linux DO Credit 配置</CardTitle>
          <CardDescription class="text-gray-500">用于 Credit 积分支付/回调验签（保存后实时生效）。</CardDescription>
        </CardHeader>
        <CardContent class="p-6 sm:p-8 space-y-6 flex-1">
          <div class="grid gap-4 lg:grid-cols-2">
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">PID</Label>
              <Input
                v-model="linuxdoCreditPid"
                type="text"
                placeholder="Credit PID"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="linuxdoCreditLoading"
              />
            </div>
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">KEY</Label>
              <div class="relative">
                <Input
                  v-model="linuxdoCreditKey"
                  :type="showLinuxdoCreditKey ? 'text' : 'password'"
                  placeholder="留空表示不修改"
                  class="h-11 pr-10 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                  :disabled="linuxdoCreditLoading"
                />
                <button
                  type="button"
                  @click="toggleShowLinuxdoCreditKey"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <EyeOff v-if="showLinuxdoCreditKey" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </div>
              <p class="text-xs text-gray-400">
                <template v-if="linuxdoCreditKeyStored">KEY 已入库；留空表示不修改。</template>
                <template v-else-if="linuxdoCreditKeySet">KEY 未入库；保存时可从 .env 自动迁移或在此重新填写。</template>
                <template v-else>未设置 KEY。</template>
              </p>
            </div>
          </div>

          <div v-if="linuxdoCreditError" class="rounded-xl bg-red-50 p-4 text-red-600 border border-red-100 text-sm font-medium">
            {{ linuxdoCreditError }}
          </div>

          <div v-if="linuxdoCreditSuccess" class="rounded-xl bg-green-50 p-4 text-green-600 border border-green-100 text-sm font-medium">
            {{ linuxdoCreditSuccess }}
          </div>

          <div class="flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              variant="outline"
              class="w-full sm:w-auto h-11 rounded-xl"
              :disabled="linuxdoCreditLoading"
              @click="loadLinuxDoCreditSettings"
            >
              刷新
            </Button>
            <Button
              type="button"
              class="w-full sm:flex-1 h-11 rounded-xl bg-black hover:bg-gray-800 text-white shadow-lg shadow-black/5"
              :disabled="linuxdoCreditLoading"
              @click="saveLinuxDoCreditSettings"
            >
              {{ linuxdoCreditLoading ? '保存中...' : '保存 Linux DO Credit 配置' }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card v-if="isSuperAdmin" class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col lg:col-span-2">
        <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-6 py-5 sm:px-8 sm:py-6">
          <CardTitle class="text-xl font-bold text-gray-900">ZPAY 支付配置</CardTitle>
          <CardDescription class="text-gray-500">用于购买下单与回调验签（保存后实时生效）。</CardDescription>
        </CardHeader>
        <CardContent class="p-6 sm:p-8 space-y-6 flex-1">
          <div class="grid gap-4 lg:grid-cols-3">
            <div class="space-y-2 lg:col-span-1">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Base URL</Label>
              <Input
                v-model="zpayBaseUrl"
                type="text"
                placeholder="https://zpayz.cn"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="zpayLoading"
              />
              <p class="text-xs text-gray-400">示例：https://zpayz.cn（无需以 / 结尾）</p>
            </div>
            <div class="space-y-2 lg:col-span-1">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">PID</Label>
              <Input
                v-model="zpayPid"
                type="text"
                placeholder="ZPAY PID"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="zpayLoading"
              />
              <p class="text-xs text-gray-400">留空表示不启用支付。</p>
            </div>
            <div class="space-y-2 lg:col-span-1">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">KEY</Label>
              <div class="relative">
                <Input
                  v-model="zpayKey"
                  :type="showZpayKey ? 'text' : 'password'"
                  placeholder="留空表示不修改"
                  class="h-11 pr-10 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                  :disabled="zpayLoading"
                />
                <button
                  type="button"
                  @click="toggleShowZpayKey"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <EyeOff v-if="showZpayKey" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </div>
              <p class="text-xs text-gray-400">
                <template v-if="zpayKeyStored">KEY 已入库；留空表示不修改。</template>
                <template v-else-if="zpayKeySet">KEY 未入库；保存时可从 .env 自动迁移或在此重新填写。</template>
                <template v-else>未设置 KEY。</template>
              </p>
            </div>
          </div>

          <div v-if="zpayError" class="rounded-xl bg-red-50 p-4 text-red-600 border border-red-100 text-sm font-medium">
            {{ zpayError }}
          </div>

          <div v-if="zpaySuccess" class="rounded-xl bg-green-50 p-4 text-green-600 border border-green-100 text-sm font-medium">
            {{ zpaySuccess }}
          </div>

          <div class="flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              variant="outline"
              class="w-full sm:w-auto h-11 rounded-xl"
              :disabled="zpayLoading"
              @click="loadZpaySettings"
            >
              刷新
            </Button>
            <Button
              type="button"
              class="w-full sm:flex-1 h-11 rounded-xl bg-black hover:bg-gray-800 text-white shadow-lg shadow-black/5"
              :disabled="zpayLoading"
              @click="saveZpaySettings"
            >
              {{ zpayLoading ? '保存中...' : '保存 ZPAY 配置' }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card v-if="isSuperAdmin" class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col lg:col-span-2">
        <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-6 py-5 sm:px-8 sm:py-6">
          <CardTitle class="text-xl font-bold text-gray-900">Cloudflare Turnstile 配置</CardTitle>
          <CardDescription class="text-gray-500">用于候车室加入队列的人机验证（保存后实时生效）。</CardDescription>
        </CardHeader>
        <CardContent class="p-6 sm:p-8 space-y-6 flex-1">
          <div class="text-xs text-gray-500">
            当前状态：<span class="font-semibold">{{ turnstileEnabled ? '已启用' : '未启用' }}</span>
            <span class="text-gray-400">（需同时配置 Site Key + Secret Key）</span>
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Site Key</Label>
              <Input
                v-model="turnstileSiteKey"
                type="text"
                placeholder="0x..."
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="turnstileLoading"
              />
              <p class="text-xs text-gray-400">留空表示禁用人机验证。</p>
            </div>

            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Secret Key</Label>
              <div class="relative">
                <Input
                  v-model="turnstileSecretKey"
                  :type="showTurnstileSecretKey ? 'text' : 'password'"
                  placeholder="留空表示不修改"
                  class="h-11 pr-10 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                  :disabled="turnstileLoading"
                />
                <button
                  type="button"
                  @click="toggleShowTurnstileSecretKey"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <EyeOff v-if="showTurnstileSecretKey" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </div>
              <p class="text-xs text-gray-400">
                <template v-if="turnstileSecretStored">Secret Key 已入库；留空表示不修改。</template>
                <template v-else-if="turnstileSecretSet">Secret Key 未入库；保存时可从 .env 自动迁移或在此重新填写。</template>
                <template v-else>未设置 Secret Key。</template>
              </p>
            </div>
          </div>

          <div v-if="turnstileError" class="rounded-xl bg-red-50 p-4 text-red-600 border border-red-100 text-sm font-medium">
            {{ turnstileError }}
          </div>

          <div v-if="turnstileSuccess" class="rounded-xl bg-green-50 p-4 text-green-600 border border-green-100 text-sm font-medium">
            {{ turnstileSuccess }}
          </div>

          <div class="flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              variant="outline"
              class="w-full sm:w-auto h-11 rounded-xl"
              :disabled="turnstileLoading"
              @click="loadTurnstileSettings"
            >
              刷新
            </Button>
            <Button
              type="button"
              class="w-full sm:flex-1 h-11 rounded-xl bg-black hover:bg-gray-800 text-white shadow-lg shadow-black/5"
              :disabled="turnstileLoading"
              @click="saveTurnstileSettings"
            >
              {{ turnstileLoading ? '保存中...' : '保存 Turnstile 配置' }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card v-if="isSuperAdmin" class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col lg:col-span-2">
        <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-6 py-5 sm:px-8 sm:py-6">
          <CardTitle class="text-xl font-bold text-gray-900">Telegram Bot 配置</CardTitle>
          <CardDescription class="text-gray-500">用于 Telegram 兑换机器人与系统通知。</CardDescription>
        </CardHeader>
        <CardContent class="p-6 sm:p-8 space-y-6 flex-1">
          <div class="grid gap-4 lg:grid-cols-2">
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Bot Token</Label>
              <div class="relative">
                <Input
                  v-model="telegramBotToken"
                  :type="showTelegramBotToken ? 'text' : 'password'"
                  placeholder="留空表示不修改"
                  class="h-11 pr-10 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                  :disabled="telegramLoading"
                />
                <button
                  type="button"
                  @click="toggleShowTelegramBotToken"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <EyeOff v-if="showTelegramBotToken" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </div>
              <p class="text-xs text-gray-400">
                <template v-if="telegramTokenStored">Token 已入库；留空表示不修改。</template>
                <template v-else-if="telegramTokenSet">Token 未入库；保存时可从 .env 自动迁移或在此重新填写。</template>
                <template v-else>未设置 Token。</template>
              </p>
            </div>

            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">允许的用户 ID (可选)</Label>
              <Input
                v-model="telegramAllowedUserIds"
                type="text"
                placeholder="123456,789012"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="telegramLoading"
              />
              <p class="text-xs text-gray-400">留空表示对所有用户开放；填写后仅允许这些 Telegram User ID。</p>
            </div>
          </div>

          <div class="grid gap-4 lg:grid-cols-3">
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">通知开关</Label>
              <Select v-model="telegramNotifyEnabled" :disabled="telegramLoading">
                <SelectTrigger class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all">
                  <SelectValue placeholder="选择" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">启用通知</SelectItem>
                  <SelectItem value="false">禁用通知</SelectItem>
                </SelectContent>
              </Select>
              <p class="text-xs text-gray-400">
                <template v-if="telegramNotifyEnabledStored">已入库。</template>
                <template v-else>未入库（当前值可能来自 .env）。</template>
              </p>
            </div>

            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">通知 chat_id (可选)</Label>
              <Input
                v-model="telegramNotifyChatIds"
                type="text"
                placeholder="-1001234567890,@channelname"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="telegramLoading"
              />
              <p class="text-xs text-gray-400">
                <template v-if="telegramNotifyChatIdsStored">已入库。</template>
                <template v-else>未入库（当前值可能来自 .env）。</template>
                留空则默认发送给「允许的用户 ID」；支持用户ID/群ID（-100...）/频道（@xxx），逗号分隔。
              </p>
            </div>

            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">通知超时（毫秒）</Label>
              <Input
                v-model="telegramNotifyTimeoutMs"
                type="text"
                placeholder="8000"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="telegramLoading"
              />
              <p class="text-xs text-gray-400">
                <template v-if="telegramNotifyTimeoutMsStored">已入库。</template>
                <template v-else>未入库（当前值可能来自 .env）。</template>
              </p>
            </div>
          </div>

          <div v-if="telegramError" class="rounded-xl bg-red-50 p-4 text-red-600 border border-red-100 text-sm font-medium">
            {{ telegramError }}
          </div>

          <div v-if="telegramSuccess" class="rounded-xl bg-green-50 p-4 text-green-600 border border-green-100 text-sm font-medium">
            {{ telegramSuccess }}
          </div>

          <div class="flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              variant="outline"
              class="w-full sm:w-auto h-11 rounded-xl"
              :disabled="telegramLoading"
              @click="loadTelegramSettings"
            >
              刷新
            </Button>
            <Button
              type="button"
              class="w-full sm:flex-1 h-11 rounded-xl bg-black hover:bg-gray-800 text-white shadow-lg shadow-black/5"
              :disabled="telegramLoading"
              @click="saveTelegramSettings"
            >
              {{ telegramLoading ? '保存中...' : '保存 Telegram 配置' }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card v-if="isSuperAdmin" class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col lg:col-span-2">
        <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-6 py-5 sm:px-8 sm:py-6">
          <CardTitle class="text-xl font-bold text-gray-900">代理池</CardTitle>
          <CardDescription class="text-gray-500">用于账号同步与邀请等接口的代理池管理与健康检测。</CardDescription>
        </CardHeader>
        <CardContent class="p-6 sm:p-8 space-y-6 flex-1">
          <div class="grid gap-4 lg:grid-cols-3">
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">启用代理池</Label>
              <label class="flex items-center gap-2 h-11 px-3 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-600">
                <input
                  v-model="proxyPoolEnabled"
                  type="checkbox"
                  class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  :disabled="proxyPoolLoading"
                />
                启用
              </label>
            </div>
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">每个代理绑定账号数</Label>
              <Input
                v-model="proxyPoolMaxAccountsPerProxy"
                type="text"
                placeholder="2"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="proxyPoolLoading"
              />
            </div>
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">健康检查间隔（分钟）</Label>
              <Input
                v-model="proxyPoolCheckIntervalMinutes"
                type="text"
                placeholder="60"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="proxyPoolLoading"
              />
            </div>
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">轮换天数</Label>
              <Input
                v-model="proxyPoolRotationDays"
                type="text"
                placeholder="10"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="proxyPoolLoading"
              />
            </div>
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">检测 URL</Label>
              <Input
                v-model="proxyPoolTestUrl"
                type="text"
                placeholder="https://example.com"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-xs"
                :disabled="proxyPoolLoading"
              />
            </div>
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">检测超时（毫秒）</Label>
              <Input
                v-model="proxyPoolTestTimeoutMs"
                type="text"
                placeholder="8000"
                class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-mono text-sm"
                :disabled="proxyPoolLoading"
              />
            </div>
            <div class="space-y-2">
              <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">检测范围</Label>
              <Select v-model="proxyPoolValidationScope" :disabled="proxyPoolLoading">
                <SelectTrigger class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm">
                  <SelectValue placeholder="选择范围" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ok">仅可用</SelectItem>
                  <SelectItem value="all">全部</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div class="space-y-2">
            <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">代理列表（每行一个 / 逗号分隔）</Label>
            <textarea
              v-model="proxyPoolInput"
              class="w-full h-[180px] rounded-xl bg-gray-50 border-gray-200 p-4 font-mono text-xs text-gray-800 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all resize-none"
              placeholder="socks5h://user:pass@1.2.3.4:1080"
              :disabled="proxyPoolLoading"
            ></textarea>
          </div>

          <div v-if="proxyPoolStats" class="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span class="px-2.5 py-1 rounded-full bg-gray-100">总数 {{ proxyPoolStats.total }}</span>
            <span class="px-2.5 py-1 rounded-full bg-green-50 text-green-700">可用 {{ proxyPoolStats.ok }}</span>
            <span class="px-2.5 py-1 rounded-full bg-red-50 text-red-700">失效 {{ proxyPoolStats.bad }}</span>
            <span class="px-2.5 py-1 rounded-full bg-yellow-50 text-yellow-700">未知 {{ proxyPoolStats.unknown }}</span>
            <span class="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">已分配 {{ proxyPoolStats.assigned }}</span>
          </div>
          <div v-if="proxyPoolValidating" class="text-xs text-blue-600">
            检测中：已完成 {{ proxyPoolValidationProgress.ok + proxyPoolValidationProgress.bad }}/{{ proxyPoolValidationProgress.total }}
          </div>

          <div v-if="proxyPoolError" class="rounded-xl bg-red-50 p-4 text-red-600 border border-red-100 text-sm font-medium">
            {{ proxyPoolError }}
          </div>

          <div v-if="proxyPoolSuccess" class="rounded-xl bg-green-50 p-4 text-green-600 border border-green-100 text-sm font-medium">
            {{ proxyPoolSuccess }}
          </div>

          <div class="flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              variant="outline"
              class="w-full sm:w-auto h-11 rounded-xl"
              :disabled="proxyPoolLoading"
              @click="loadProxyPool"
            >
              刷新
            </Button>
            <Button
              type="button"
              variant="outline"
              class="w-full sm:w-auto h-11 rounded-xl"
              :disabled="proxyPoolValidating"
              @click="validateProxyPoolNow"
            >
              {{ proxyPoolValidating ? '检测中...' : '立即检测' }}
            </Button>
            <Button
              type="button"
              variant="outline"
              class="w-full sm:w-auto h-11 rounded-xl"
              :disabled="proxyPoolValidating && !proxyPoolValidationJobId"
              @click="openProxyPoolValidationDialog"
            >
              检测结果
            </Button>
            <Button
              type="button"
              variant="outline"
              class="w-full sm:w-auto h-11 rounded-xl"
              :disabled="proxyApiLogsLoading"
              @click="openProxyApiLogsDialog"
            >
              API调用日志
            </Button>
            <Button
              type="button"
              variant="outline"
              class="w-full sm:flex-1 h-11 rounded-xl"
              :disabled="proxyPoolLoading"
              @click="saveProxyPoolSettings"
            >
              保存设置
            </Button>
            <Button
              type="button"
              class="w-full sm:flex-1 h-11 rounded-xl bg-black hover:bg-gray-800 text-white shadow-lg shadow-black/5"
              :disabled="proxyPoolLoading"
              @click="saveProxyPoolList"
            >
              {{ proxyPoolLoading ? '保存中...' : '保存代理池' }}
            </Button>
          </div>

          <div class="border border-gray-100 rounded-xl overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th class="px-4 py-3 text-left font-medium">代理地址</th>
                  <th class="px-4 py-3 text-left font-medium">状态</th>
                  <th class="px-4 py-3 text-left font-medium">已分配</th>
                  <th class="px-4 py-3 text-left font-medium">上次检测</th>
                  <th class="px-4 py-3 text-left font-medium">错误</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr v-for="proxy in proxyPoolList" :key="proxy.id">
                  <td class="px-4 py-3 font-mono text-xs text-gray-800">{{ proxy.proxyUrl }}</td>
                  <td class="px-4 py-3 text-xs">
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded-full font-medium"
                      :class="proxy.status === 'ok' ? 'bg-green-50 text-green-700' : proxy.status === 'bad' ? 'bg-red-50 text-red-700' : 'bg-yellow-50 text-yellow-700'"
                    >
                      {{ proxy.status === 'ok' ? '可用' : proxy.status === 'bad' ? '失效' : '未知' }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-xs text-gray-600">{{ proxy.assignedCount ?? 0 }}</td>
                  <td class="px-4 py-3 text-xs text-gray-500">{{ proxy.lastCheckAt || '-' }}</td>
                  <td class="px-4 py-3 text-xs text-gray-400">{{ proxy.lastError || '-' }}</td>
                </tr>
                <tr v-if="!proxyPoolList.length">
                  <td colspan="5" class="px-4 py-8 text-center text-gray-400">暂无代理</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog v-model:open="proxyPoolValidationDialogOpen">
        <DialogContent class="max-w-5xl">
          <DialogHeader>
            <DialogTitle>代理检测结果</DialogTitle>
            <DialogDescription>默认只显示可用代理，可切换查看全部。</DialogDescription>
          </DialogHeader>
          <div class="space-y-4">
            <div class="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="outline"
                class="w-full sm:w-auto h-10 rounded-lg"
                :disabled="proxyPoolValidationItemsLoading"
                @click="loadProxyPoolValidationItems"
              >
                刷新
              </Button>
              <label class="flex items-center gap-2 text-xs text-gray-600">
                <input
                  v-model="proxyPoolValidationShowAll"
                  type="checkbox"
                  class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  @change="loadProxyPoolValidationItems"
                />
                显示全部（未勾选仅显示可用）
              </label>
            </div>

            <div v-if="proxyPoolValidationItemsError" class="rounded-xl bg-red-50 p-4 text-red-600 border border-red-100 text-sm font-medium">
              {{ proxyPoolValidationItemsError }}
            </div>

            <div class="border border-gray-100 rounded-xl overflow-hidden">
              <table class="w-full text-sm">
                <thead class="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th class="px-4 py-3 text-left font-medium">代理</th>
                    <th class="px-4 py-3 text-left font-medium">状态</th>
                    <th class="px-4 py-3 text-left font-medium">耗时</th>
                    <th class="px-4 py-3 text-left font-medium">错误</th>
                    <th class="px-4 py-3 text-left font-medium">时间</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                  <tr v-for="item in proxyPoolValidationItems" :key="item.id">
                    <td class="px-4 py-3 font-mono text-xs text-gray-800">{{ item.proxyUrl }}</td>
                    <td class="px-4 py-3 text-xs">
                      <span
                        class="inline-flex items-center px-2 py-0.5 rounded-full font-medium"
                        :class="item.status === 'ok' ? 'bg-green-50 text-green-700' : item.status === 'bad' ? 'bg-red-50 text-red-700' : 'bg-yellow-50 text-yellow-700'"
                      >
                        {{ item.status === 'ok' ? '可用' : item.status === 'bad' ? '失效' : '等待中' }}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-xs text-gray-600">{{ item.durationMs != null ? `${item.durationMs}ms` : '-' }}</td>
                    <td class="px-4 py-3 text-xs text-gray-500">{{ item.error || '-' }}</td>
                    <td class="px-4 py-3 text-xs text-gray-500">{{ item.checkedAt || '-' }}</td>
                  </tr>
                  <tr v-if="!proxyPoolValidationItems.length">
                    <td colspan="5" class="px-4 py-8 text-center text-gray-400">暂无记录</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="text-xs text-gray-500">记录数：{{ proxyPoolValidationItemsTotal }}</div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog v-model:open="proxyApiLogsDialogOpen">
        <DialogContent class="max-w-5xl">
          <DialogHeader>
            <DialogTitle>代理池 API 调用日志</DialogTitle>
            <DialogDescription>仅记录通过代理访问的 API 调用（最新 {{ proxyApiLogsLimit }} 条）。</DialogDescription>
          </DialogHeader>
          <div class="space-y-4">
            <div class="flex flex-col sm:flex-row gap-3">
              <Button
                type="button"
                variant="outline"
                class="w-full sm:w-auto h-10 rounded-lg"
                :disabled="proxyApiLogsLoading"
                @click="loadProxyApiLogs(true)"
              >
                刷新
              </Button>
            </div>

            <div v-if="proxyApiLogsError" class="rounded-xl bg-red-50 p-4 text-red-600 border border-red-100 text-sm font-medium">
              {{ proxyApiLogsError }}
            </div>

            <div class="border border-gray-100 rounded-xl overflow-hidden">
              <table class="w-full text-sm">
                <thead class="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th class="px-4 py-3 text-left font-medium">时间</th>
                    <th class="px-4 py-3 text-left font-medium">账号ID</th>
                    <th class="px-4 py-3 text-left font-medium">代理</th>
                    <th class="px-4 py-3 text-left font-medium">方法</th>
                    <th class="px-4 py-3 text-left font-medium">状态</th>
                    <th class="px-4 py-3 text-left font-medium">耗时</th>
                    <th class="px-4 py-3 text-left font-medium">API</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                  <tr v-for="log in proxyApiLogs" :key="log.id">
                    <td class="px-4 py-3 text-xs text-gray-600">{{ log.createdAt || '-' }}</td>
                    <td class="px-4 py-3 text-xs text-gray-600">{{ log.accountId ?? '-' }}</td>
                    <td class="px-4 py-3 font-mono text-xs text-gray-800">{{ log.proxyUrl || '-' }}</td>
                    <td class="px-4 py-3 text-xs text-gray-600">{{ log.method || '-' }}</td>
                    <td class="px-4 py-3 text-xs text-gray-600">{{ log.status ?? '-' }}</td>
                    <td class="px-4 py-3 text-xs text-gray-600">{{ log.durationMs != null ? `${log.durationMs}ms` : '-' }}</td>
                    <td class="px-4 py-3 text-xs text-gray-500 truncate max-w-[360px]">{{ log.apiUrl || '-' }}</td>
                  </tr>
                  <tr v-if="!proxyApiLogs.length">
                    <td colspan="7" class="px-4 py-8 text-center text-gray-400">暂无日志</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="text-xs text-gray-500">总记录数：{{ proxyApiLogsTotal }}</div>
          </div>
        </DialogContent>
      </Dialog>

      <!-- 积分提现设置 -->
      <Card v-if="isSuperAdmin" class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col lg:col-span-2">
	          <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-6 py-5 sm:px-8 sm:py-6">
	            <CardTitle class="text-xl font-bold text-gray-900">积分提现设置</CardTitle>
	            <CardDescription class="text-gray-500">配置返现比例与提现门槛（保存后实时生效）。</CardDescription>
	          </CardHeader>
	          <CardContent class="p-6 sm:p-8 space-y-6 flex-1">
	            <div class="grid gap-4 lg:grid-cols-3">
	              <div class="space-y-2">
	                <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">返现比例：积分</Label>
                <Input
                  v-model="pointsWithdrawRatePoints"
                  type="text"
                  placeholder="1"
                  class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all"
                  :disabled="pointsWithdrawLoading"
                />
              </div>
              <div class="space-y-2">
                <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">返现比例：金额（元）</Label>
                <Input
                  v-model="pointsWithdrawRateCashYuan"
                  type="text"
                  placeholder="1.00"
                  class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all"
                  :disabled="pointsWithdrawLoading"
                />
              </div>
              <div class="space-y-2">
                <Label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">最低提现金额（元）</Label>
                <Input
                  v-model="pointsWithdrawMinCashYuan"
                  type="text"
                  placeholder="10.00"
                  class="h-11 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all"
                  :disabled="pointsWithdrawLoading"
                />
              </div>
            </div>

            <div class="text-xs text-gray-500">
              当前规则：{{ pointsWithdrawRatePoints }} 积分 = {{ pointsWithdrawRateCashYuan }} 元；最低提现约 {{ pointsWithdrawMinPoints ?? '-' }} 积分；步进 {{ pointsWithdrawStepPoints ?? '-' }} 积分
            </div>

            <div v-if="pointsWithdrawError" class="rounded-xl bg-red-50 p-4 text-red-600 border border-red-100 text-sm font-medium">
              {{ pointsWithdrawError }}
            </div>

            <div v-if="pointsWithdrawSuccess" class="rounded-xl bg-green-50 p-4 text-green-600 border border-green-100 text-sm font-medium">
              {{ pointsWithdrawSuccess }}
            </div>

	            <div class="flex flex-col sm:flex-row gap-3">
	              <Button
	                type="button"
	                variant="outline"
	                class="w-full sm:w-auto h-11 rounded-xl"
	                :disabled="pointsWithdrawLoading"
	                @click="loadPointsWithdrawSettings"
	              >
	                刷新
	              </Button>
	              <Button
	                type="button"
	                class="w-full sm:flex-1 h-11 rounded-xl bg-black hover:bg-gray-800 text-white shadow-lg shadow-black/5"
	                :disabled="pointsWithdrawLoading"
	                @click="savePointsWithdrawSettings"
	              >
	                {{ pointsWithdrawLoading ? '保存中...' : '保存设置' }}
              </Button>
            </div>
          </CardContent>
      </Card>
    </div>
  </div>
</template>
