type FaceTrackingRadiosProps = {
  idPrefix: string
  enabled: boolean
  onChange: (enabled: boolean) => void
}

/** 扬声器下方：人脸与活体跟踪总开关（两端共用） */
export function FaceTrackingRadios({ idPrefix, enabled, onChange }: FaceTrackingRadiosProps) {
  const name = `${idPrefix}-face-tracking`
  return (
    <fieldset className="face-tracking-fieldset">
      <legend>开启人脸和活体跟踪检测</legend>
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
    </fieldset>
  )
}
