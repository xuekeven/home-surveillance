/** 用于文件名：`2026年5月6日18点20分30秒`（上海墙钟） */
export function formatStrangerSnapshotBaseLabel(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  }).formatToParts(date)

  const n = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0')

  return `${n('year')}年${n('month')}月${n('day')}日${n('hour')}点${n('minute')}分${n('second')}秒`
}
