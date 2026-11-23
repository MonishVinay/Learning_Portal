// Server-only: Node streams are used by ZIP downloads. Never import into client components.
import { Readable } from 'node:stream';
import { HttpError } from './http';
import { fileSignature, safeFilename } from './domain';
import type { FileAsset } from '@prisma/client';
function storage() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new HttpError(503, 'Private file storage is not configured. Contact your teacher.');
  let project: URL;
  try { project = new URL(SUPABASE_URL); } catch { throw new HttpError(503, 'Configure SUPABASE_URL with your HTTPS project URL.'); }
  if (project.protocol !== 'https:' || project.username || project.password || project.pathname !== '/' || project.search || project.hash) throw new HttpError(503, 'Configure SUPABASE_URL with your HTTPS project URL.');
  return {
    base: `${project.origin}/storage/v1`,
    bucket: process.env.SUPABASE_STORAGE_BUCKET || 'learning-portal-files',
    // Used only for server-to-server requests, never signed URL responses.
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  };
}

function objectPath(bucket: string, key: string) {
  if (!bucket || key.split('/').some(part => !part || part === '.' || part === '..')) throw new HttpError(400, 'Invalid stored file path.');
  return [bucket, ...key.split('/')].map(encodeURIComponent).join('/');
}

async function request(path: string, init: RequestInit = {}) {
  const config = storage();
  let response: Response;
  try {
    response = await fetch(`${config.base}${path}`, {
      ...init,
      headers: { ...config.headers, ...init.headers },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000),
    });
  } catch { throw new HttpError(502, 'Private storage is temporarily unavailable. Please retry.'); }
  if (!response.ok) {
    await response.body?.cancel();
    // Never forward provider errors containing private paths or request details.
    throw new HttpError(response.status === 404 ? 404 : 502, response.status === 404 ? 'The stored file was not found. Retry the upload or contact your teacher.' : 'Private storage could not complete this request. Please retry or check its server configuration.');
  }
  return response;
}

function signedUrl(path: string) {
  const { base } = storage();
  const url = new URL(`${base}${path}`);
  if (!path.startsWith('/object/') || url.origin !== new URL(base).origin || !url.searchParams.get('token')) throw new HttpError(502, 'Storage returned an invalid signed URL. Please retry.');
  return url;
}
export async function uploadUrl(file: FileAsset) {
  const { bucket } = storage();
  const response = await request(`/object/upload/sign/${objectPath(bucket, file.objectKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-upsert': 'false' }, body: '{}',
  });
  const data = await response.json() as { url?: string };
  if (!data.url) throw new HttpError(502, 'Storage could not create an upload link. Please retry.');
  // Supabase upload tokens last two hours, cover one key, and cannot overwrite objects.
  return signedUrl(data.url).toString();
}
export async function verifyUpload(file: FileAsset) {
  const { bucket } = storage();
  const path = `/object/authenticated/${objectPath(bucket, file.objectKey)}`;
  const head = await request(path, { method: 'HEAD' });
  const type = head.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (Number(head.headers.get('content-length')) !== file.size || type !== file.mime) throw new HttpError(400, 'The uploaded file does not match its expected size or type. Upload it again.');
  const response = await request(path, { headers: { Range: 'bytes=0-511' } });
  if (!response.body) throw new HttpError(502, 'The uploaded file could not be verified. Please retry.');
  // Bound memory use even if a storage proxy ignores Range.
  const reader = response.body.getReader();
  const bytes = new Uint8Array(512);
  let length = 0;
  try {
    while (length < bytes.length) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, bytes.length - length);
      bytes.set(chunk, length); length += chunk.length;
    }
  } finally { await reader.cancel(); }
  if (!fileSignature(bytes.subarray(0, length), file.mime)) throw new HttpError(400, 'File content does not match the selected file type.');
}
export async function downloadUrl(file: FileAsset, inline = false) {
  const { bucket } = storage();
  const response = await request(`/object/sign/${objectPath(bucket, file.objectKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 120 }),
  });
  const data = await response.json() as { signedURL?: string };
  if (!data.signedURL) throw new HttpError(502, 'Storage could not create a download link. Please retry.');
  const url = signedUrl(data.signedURL);
  if (!inline || !['application/pdf', 'image/png', 'image/jpeg'].includes(file.mime)) url.searchParams.set('download', safeFilename(file.name));
  return url.toString();
}
export async function fileBody(key: string) {
  const { bucket } = storage();
  const response = await request(`/object/authenticated/${objectPath(bucket, key)}`);
  if (!response.body) throw new HttpError(502, 'A stored file is temporarily unavailable.');
  return Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>);
}
