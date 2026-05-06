type FaceTrackingRadiosProps = {
  idPrefix: string
  enabled: boolean
  onChange: (enabled: boolean) => void
}

/** 扬声器下方：人脸检测总开关（仅「移动活体」确认的轨迹计为人脸，两端共用） */
export function FaceTrackingRadios({ idPrefix, enabled, onChange }: FaceTrackingRadiosProps) {
  const name = `${idPrefix}-face-tracking`
  const legendId = `${idPrefix}-face-tracking-legend`
  return (
    <fieldset className="face-tracking-fieldset" aria-labelledby={legendId}>
      <div className="face-tracking-row">
        <span id={legendId} className="face-tracking-field-label">
          人脸检测
        </span>
        <div className="face-tracking-options">
          <label htmlFor={`${idPrefix}-face-tracking-on`}>
            <input
              id={`${idPrefix}-face-tracking-on`}
              type="radio"
              name={name}
              checked={enabled}
              onChange={() => onChange(true)}
            />
            开启
          </label>
          <label htmlFor={`${idPrefix}-face-tracking-off`}>
            <input
              id={`${idPrefix}-face-tracking-off`}
              type="radio"
              name={name}
              checked={!enabled}
              onChange={() => onChange(false)}
            />
            关闭
          </label>
        </div>
      </div>
    </fieldset>
  )
}
