declare global {
  interface Window {
    HomeSurveillanceNative?: {
      getDeviceTemperatureC?: () => number | null | Promise<number | null>
    }
  }
}

const MIN_DEVICE_TEMPERATURE_C = -50
const MAX_DEVICE_TEMPERATURE_C = 150

/** 普通浏览器没有设备温度 API；原生壳可通过此桥接返回真实摄氏度。 */
export async function readDeviceTemperatureC(): Promise<number | null> {
  const bridge = window.HomeSurveillanceNative
  const reader = bridge?.getDeviceTemperatureC
  if (!reader) {
    return null
  }

  try {
    const value = await reader.call(bridge)
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < MIN_DEVICE_TEMPERATURE_C ||
      value > MAX_DEVICE_TEMPERATURE_C
    ) {
      return null
    }
    return Math.round(value * 10) / 10
  } catch {
    return null
  }
}

export function formatDeviceTemperature(value: number | null | undefined): string {
  if (value === undefined) {
    return '读取中'
  }
  if (value === null) {
    return '浏览器不支持'
  }
  return `${value.toFixed(1)} °C`
}
