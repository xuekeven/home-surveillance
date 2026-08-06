type FaceTrackingRadiosProps = {
  idPrefix: string
  enabled: boolean
  onChange: (enabled: boolean) => void
}

/** 陌生人检测下拉框（仅观看端展示；默认关闭，需手动开启）。 */
export function FaceTrackingRadios({ idPrefix, enabled, onChange }: FaceTrackingRadiosProps) {
  const selectId = idPrefix + '-face-tracking'

  return (
    <div className='camera-switch face-tracking-select'>
      <label htmlFor={selectId}>陌生人检测</label>
      <select
        id={selectId}
        value={enabled ? 'on' : 'off'}
        onChange={(event) => onChange(event.target.value === 'on')}
      >
        <option value='on'>开启</option>
        <option value='off'>关闭</option>
      </select>
    </div>
  )
}
