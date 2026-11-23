'use client';
export async function api<T = Record<string, unknown>>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal});
  } catch (e) { if (e instanceof Error && e.name === 'AbortError') throw e; throw new Error('Connection interrupted. Your draft is saved on this device. Reconnect and retry.'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('The server is unavailable. Please retry in a moment.'); }
  if (!response.ok) {
    if (response.status === 401 && path !== 'login') window.location.assign('/login');
    if (response.status === 428) window.location.assign('/settings');
    throw new Error(result.error || 'The request could not be completed.');
  }
  return result;
}
export function formatDate(value: string | Date, timezone = 'Asia/Kolkata', time = false) {
  return new Intl.DateTimeFormat('en-IN', {timeZone: timezone, day: 'numeric', month: 'short', ...(time ? {hour: 'numeric', minute: '2-digit'} : {year: 'numeric'})}).format(new Date(value));
}
export function localDateTime(value: string | Date, timezone = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('sv-SE', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(value));
  return parts.replace(' ', 'T');
}
export function zonedISO(value: string, timezone = 'Asia/Kolkata') {
  const target = Date.parse(`${value}:00Z`);
  if (Number.isNaN(target)) throw new Error('Choose a valid date and time.');
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const local = localDateTime(new Date(guess), timezone);
    guess += target - Date.parse(`${local}:00Z`);
  }
  return new Date(guess).toISOString();
}
