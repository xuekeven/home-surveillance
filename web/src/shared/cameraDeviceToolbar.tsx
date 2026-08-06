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
  const selectValue = activeCameraId || devices[0]?.deviceId || ''

  return (
    <div className="camera-switch">
      <label htmlFor={`${idPrefix}-camera-device`}>{label}</label>
      <select
        id={`${idPrefix}-camera-device`}
        disabled={disabled || switchingCamera || devices.length === 0}
        value={selectValue}
        onChange={(event) => onSelectDevice(event.target.value)}
        aria-busy={switchingCamera}
      >
        {devices.length === 0 ? <option value="">暂无可用摄像头</option> : null}
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
