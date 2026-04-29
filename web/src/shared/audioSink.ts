import { useCallback, useEffect, useState } from 'react'

/** Chromium / Edge 等对 HTMLMediaElement.setSinkId 的实现；Safari / Firefox 可能不可用 */
export function supportsAudioOutputSelection(): boolean {
  return typeof HTMLMediaElement.prototype.setSinkId === 'function'
}

export async function enumerateAudioOutputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'audiooutput')
}

/**
 * 将播放路由到指定输出设备；空字符串表示系统默认输出。
 * 需 HTTPS；失败时静默忽略。
 */
export async function applyAudioSinkToMedia(
  media: HTMLMediaElement,
  deviceId: string
): Promise<void> {
  if (!supportsAudioOutputSelection()) {
    return
  }

  try {
    await media.setSinkId(deviceId)
  } catch {
    // 权限、设备已拔出或不支持该 sink 时忽略
  }
}

export function useAudioOutputDevices(): {
  devices: MediaDeviceInfo[]
  refresh: () => Promise<void>
} {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  const refresh = useCallback(async () => {
    try {
      const list = await enumerateAudioOutputDevices()
      setDevices(list)
    } catch {
      setDevices([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh)
  }, [refresh])

  return { devices, refresh }
}

/** 本端扬声器下拉：所选 deviceId 与其它状态解耦，便于页面持久化到本地 state */
export function useSpeakerOutputSelection(): {
  devices: MediaDeviceInfo[]
  selectedDeviceId: string
  setSelectedDeviceId: (deviceId: string) => void
  refresh: () => Promise<void>
  supportsSelection: boolean
} {
  const { devices, refresh } = useAudioOutputDevices()
  const [selectedDeviceId, setSelectedDeviceId] = useState('')

  useEffect(() => {
    if (!selectedDeviceId) {
      return
    }
    if (!devices.some((d) => d.deviceId === selectedDeviceId)) {
      setSelectedDeviceId('')
    }
  }, [devices, selectedDeviceId])

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    refresh,
    supportsSelection: supportsAudioOutputSelection()
  }
}