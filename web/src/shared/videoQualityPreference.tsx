export const VIDEO_QUALITY_PREFERENCES = [
  'fps-10', 'fps-30', 'fps-60', 'fps-90',
  'resolution-360', 'resolution-480', 'resolution-720',
  'resolution-1080', 'resolution-1440', 'resolution-2160'
] as const

export type VideoQualityPreference = (typeof VIDEO_QUALITY_PREFERENCES)[number]
export const DEFAULT_VIDEO_QUALITY_PREFERENCE: VideoQualityPreference = 'fps-30'

export interface VideoQualityProfile {
  mode: 'frame-rate' | 'resolution'
  value: number
}

export function getVideoQualityProfile(preference: VideoQualityPreference): VideoQualityProfile {
  const [kind, rawValue] = preference.split('-')
  return {
    mode: kind === 'fps' ? 'frame-rate' : 'resolution',
    value: Number(rawValue)
  }
}

interface VideoQualityPreferenceToolbarProps {
  idPrefix: string
  value: VideoQualityPreference
  disabled?: boolean
  onChange: (preference: VideoQualityPreference) => void
}

export function VideoQualityPreferenceToolbar({
  idPrefix,
  value,
  disabled,
  onChange
}: VideoQualityPreferenceToolbarProps) {
  return (
    <div className="camera-switch video-quality-switch">
      <label htmlFor={`${idPrefix}-video-quality`}>帧数分辨率</label>
      <select
        id={`${idPrefix}-video-quality`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as VideoQualityPreference)}
      >
        <optgroup label="帧数优先">
          <option value="fps-10">帧数 10</option>
          <option value="fps-30">帧数 30</option>
          <option value="fps-60">帧数 60</option>
          <option value="fps-90">帧数 90</option>
        </optgroup>
        <optgroup label="分辨率优先">
          <option value="resolution-360">低清 360p</option>
          <option value="resolution-480">标清 480p</option>
          <option value="resolution-720">高清 720p</option>
          <option value="resolution-1080">超清 1080p</option>
          <option value="resolution-1440">2K 1440p</option>
          <option value="resolution-2160">4K 2160p</option>
        </optgroup>
      </select>
    </div>
  )
}
