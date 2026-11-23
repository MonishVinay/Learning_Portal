export function grade(percent: number) {
  return percent >= 90 ? 'A+' : percent >= 80 ? 'A' : percent >= 70 ? 'B+' : percent >= 60 ? 'B' : percent >= 50 ? 'C' : percent >= 40 ? 'D' : 'Needs improvement';
}
export function percentage(marks: number, maximum: number) {
  return maximum > 0 ? Math.round((marks / maximum) * 1000) / 10 : 0;
}
export function dayKey(date = new Date(), timezone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
}
export function validTimezone(value: string) {
  try { new Intl.DateTimeFormat('en', {timeZone: value}); return true; } catch { return false; }
}
export const allowedMime: Record<string, string[]> = {
  'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'],
  'application/msword': ['doc'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'text/plain': ['txt'],
};
export function inferFileMime(name: string, provided: string) {
  if (provided && provided !== 'application/octet-stream') return provided;
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return Object.entries(allowedMime).find(([, extensions]) => extensions.includes(extension))?.[0] ?? 'application/octet-stream';
}
export function validFile(name: string, mime: string, size: number, purpose: string, maxMB = 20) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return size > 0 && size <= maxMB * 1024 * 1024 && !!allowedMime[mime]?.includes(ext)
    && (purpose === 'SUBMISSION' || mime === 'application/pdf');
}
export function fileSignature(bytes: Uint8Array, mime: string) {
  const b = Buffer.from(bytes);
  if (mime === 'application/pdf') return b.subarray(0, 5).toString() === '%PDF-';
  if (mime === 'image/png') return b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/jpeg') return b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (mime.includes('wordprocessingml')) return b[0] === 80 && b[1] === 75 && b[2] === 3 && b[3] === 4;
  if (mime === 'application/msword') return b.subarray(0, 8).equals(Buffer.from([208,207,17,224,161,177,26,225]));
  return mime === 'text/plain' && !b.includes(0) && !b.toString('utf8').includes('\uFFFD');
}
export function safeFilename(name: string) {
  return name.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').slice(0, 160) || 'file';
}
export function occurrenceDates(releaseAt: Date, cadence: 'DAILY' | 'WEEKLY', now: Date) {
  const step = cadence === 'DAILY' ? 86400000 : 7 * 86400000;
  const dates: Date[] = [];
  // A bounded batch makes delayed cron safe; subsequent invocations catch up.
  for (let t = releaseAt.getTime() + step; t <= now.getTime() && dates.length < 60; t += step) dates.push(new Date(t));
  return dates;
}
