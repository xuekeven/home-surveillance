import { supportsAudioOutputSelection } from './audioSink'

interface SpeakerOutputToolbarProps {
  idPrefix: string
  devices: MediaDeviceInfo[]
  selectedDeviceId: string
  disabled?: boolean
  onSelectDevice: (deviceId: string) => void
}

export function SpeakerOutputToolbar({
  idPrefix,
  devices,
  selectedDeviceId,
  disabled,
  onSelectDevice
}: SpeakerOutputToolbarProps) {
  if (!supportsAudioOutputSelection()) {
    return (
      <p className="muted speaker-unavailable-hint">
        当前浏览器不支持手动选择扬声器（需 Chromium 内核且为 HTTPS；Firefox / Safari 通常不可用）。
      </p>
    )
  }

  return (
    <div className="camera-switch speaker-switch">
      <label htmlFor={`${idPrefix}-speaker`}>扬声器</label>
      <select
        id={`${idPrefix}-speaker`}
        disabled={disabled}
        value={selectedDeviceId}
        onChange={(event) => onSelectDevice(event.target.value)}
      >
        <option value="">系统默认</option>
        {devices
          .filter((device) => device.deviceId)
          .map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label.trim() || `扬声器 ${index + 1}`}
            </option>
          ))}
      </select>
    </div>
  )
}
