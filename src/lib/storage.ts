import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpError } from './http';
import { fileSignature, safeFilename } from './domain';
import type { FileAsset } from '@prisma/client';
export function storage() {
  const {R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET} = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) throw new HttpError(503, 'Private file storage is not configured. Contact your teacher.');
  return {client: new S3Client({region: 'auto', endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: {accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY}, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED'}), bucket: R2_BUCKET};
}
export async function uploadUrl(file: FileAsset) {
  const {client, bucket} = storage();
  return getSignedUrl(client, new PutObjectCommand({Bucket: bucket, Key: file.objectKey, ContentType: file.mime, ContentLength: file.size, IfNoneMatch: '*'}), {expiresIn: 600});
}
export async function verifyUpload(file: FileAsset) {
  const {client, bucket} = storage();
  const head = await client.send(new HeadObjectCommand({Bucket: bucket, Key: file.objectKey}));
  if (head.ContentLength !== file.size || head.ContentType !== file.mime) throw new HttpError(400, 'The uploaded file does not match its expected size or type. Upload it again.');
  const object = await client.send(new GetObjectCommand({Bucket: bucket, Key: file.objectKey, Range: 'bytes=0-511'}));
  if (!object.Body || !fileSignature(await object.Body.transformToByteArray(), file.mime)) throw new HttpError(400, 'File content does not match the selected file type.');
}
export async function downloadUrl(file: FileAsset, inline = false) {
  const {client, bucket} = storage();
  const name = safeFilename(file.name).replace(/[^\x20-\x7e]/g, '_');
  return getSignedUrl(client, new GetObjectCommand({Bucket: bucket, Key: file.objectKey, ResponseContentType: file.mime, ResponseContentDisposition: `${inline && ['application/pdf', 'image/png', 'image/jpeg'].includes(file.mime) ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(safeFilename(file.name))}`}), {expiresIn: 120});
}
export async function fileBody(key: string) {
  const {client, bucket} = storage();
  const result = await client.send(new GetObjectCommand({Bucket: bucket, Key: key}));
  if (!result.Body) throw new HttpError(502, 'A stored file is temporarily unavailable.');
  return result.Body;
}
