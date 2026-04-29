export interface CameraDeviceOption {
  deviceId: string
  label: string
}

interface CameraDeviceToolbarProps {
  idPrefix: string
  /** 表单标签文案，默认「摄像头」 */
  label?: string
  devices: CameraDeviceOption[]
  activeCameraId: string
  switchingCamera: boolean
  disabled?: boolean
  onSelectDevice: (deviceId: string) => void
}

export function CameraDeviceToolbar({
  idPrefix,
  label = '摄像头',
  devices,
  activeCameraId,
  switchingCamera,
  disabled,
  onSelectDevice
}: CameraDeviceToolbarProps) {
  if (devices.length <= 1) {
    return null
  }

  const selectValue = activeCameraId || devices[0]?.deviceId || ''

  return (
    <div className="camera-switch">
      <label htmlFor={`${idPrefix}-camera-device`}>{label}</label>
      <select
        id={`${idPrefix}-camera-device`}
        disabled={disabled || switchingCamera}
        value={selectValue}
        onChange={(event) => onSelectDevice(event.target.value)}
        aria-busy={switchingCamera}
      >
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label}
          </option>
        ))}
      </select>
      {switchingCamera ? <span className="muted">切换中…</span> : null}
    </div>
  )
}
