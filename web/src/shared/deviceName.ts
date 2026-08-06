interface NavigatorUserAgentData {
  platform?: string
  mobile?: boolean
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platform?: string }>
}

function browserName(userAgent: string): string {
  if (/Edg\//i.test(userAgent)) return 'Edge'
  if (/OPR\//i.test(userAgent)) return 'Opera'
  if (/CriOS\//i.test(userAgent)) return 'Chrome'
  if (/FxiOS\//i.test(userAgent)) return 'Firefox'
  if (/Chrome\//i.test(userAgent)) return 'Chrome'
  if (/Firefox\//i.test(userAgent)) return 'Firefox'
  if (/Safari\//i.test(userAgent)) return 'Safari'
  return '浏览器'
}

function androidModelFromUserAgent(userAgent: string): string | undefined {
  const match = userAgent.match(/Android[^;)]*;\s*([^;)]+?)(?:\s+Build\/|[;)])/i)
  const model = match?.[1]?.replace(/^zh-cn;\s*/i, '').trim()
  if (!model || /^(wv|mobile)$/i.test(model)) return undefined
  return model
}

function genericDeviceName(userAgent: string, platform?: string, mobile?: boolean): string {
  if (/iPhone/i.test(userAgent)) return 'iPhone'
  if (/iPad/i.test(userAgent) || (platform === 'macOS' && mobile)) return 'iPad'
  if (/Android/i.test(userAgent)) return androidModelFromUserAgent(userAgent) ?? 'Android 手机'
  if (/Macintosh|Mac OS X/i.test(userAgent) || platform === 'macOS') return 'Mac'
  if (/Windows/i.test(userAgent) || platform === 'Windows') return 'Windows 电脑'
  if (/Linux/i.test(userAgent) || platform === 'Linux') return 'Linux 电脑'
  return mobile ? '手机' : '电脑'
}

/**
 * 返回浏览器允许网页读取的设备名称。苹果浏览器不会暴露具体硬件型号，
 * Android Chromium 则可能通过 User-Agent Client Hints 提供型号。
 */
export async function getViewerDeviceName(): Promise<string> {
  const userAgent = navigator.userAgent
  const userAgentData = (navigator as Navigator & { userAgentData?: NavigatorUserAgentData }).userAgentData
  let model = ''
  let platform = userAgentData?.platform

  try {
    const values = await userAgentData?.getHighEntropyValues?.(['model', 'platform'])
    model = values?.model?.trim() ?? ''
    platform = values?.platform ?? platform
  } catch {
    // 浏览器拒绝高熵 Client Hints 时继续使用 User-Agent 的可靠部分。
  }

  const device = model || genericDeviceName(userAgent, platform, userAgentData?.mobile)
  return `${device} · ${browserName(userAgent)}`.slice(0, 80)
}
