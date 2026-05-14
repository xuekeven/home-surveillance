type FaceTrackingRadiosProps = {
  idPrefix: string
  enabled: boolean
  onChange: (enabled: boolean) => void
}

/** 扬声器下方：陌生人检测（仅观看端展示；默认关闭，需手动开启）。采集端不设此项：人脸链路仅在后台开启「陌生人抓拍和警告」时为开。 */
export function FaceTrackingRadios({ idPrefix, enabled, onChange }: FaceTrackingRadiosProps) {
  const name = `${idPrefix}-face-tracking`
  const legendId = `${idPrefix}-face-tracking-legend`
  return (
    <fieldset className="face-tracking-fieldset" aria-labelledby={legendId}>
      <div className="face-tracking-row">
        <span id={legendId} className="face-tracking-field-label">
          陌生人检测
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
