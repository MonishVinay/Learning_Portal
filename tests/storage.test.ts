import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { FileAsset } from '@prisma/client';
import { downloadUrl, fileBody, uploadUrl, verifyUpload } from '../src/lib/storage';
import { HttpError } from '../src/lib/http';

const file: FileAsset = {
  id: 'file-1', objectKey: 'uploads/student-1/original-key', name: 'Answer sheet.pdf',
  mime: 'application/pdf', size: 8, purpose: 'SUBMISSION', ready: false,
  ownerId: 'student-1', assignmentId: null, submissionId: null, examId: null, createdAt: new Date(),
};
const key = 'test-only-server-service-role';
function setup(t: TestContext) {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, bucket: process.env.SUPABASE_STORAGE_BUCKET };
  process.env.SUPABASE_URL = 'https://storage-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  delete process.env.SUPABASE_STORAGE_BUCKET;
  t.after(() => {
    for (const [name, value] of Object.entries({ SUPABASE_URL: previous.url, SUPABASE_SERVICE_ROLE_KEY: previous.key, SUPABASE_STORAGE_BUCKET: previous.bucket })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    t.mock.restoreAll();
  });
}

test('signed uploads use the existing bucket, disable overwrites and never expose the server key', async t => {
  setup(t);
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, `https://storage-test.supabase.co/storage/v1/object/upload/sign/learning-portal-files/${file.objectKey}`);
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), `Bearer ${key}`);
    assert.equal(headers.get('apikey'), key);
    assert.equal(headers.get('x-upsert'), 'false');
    assert.equal(init.method, 'POST'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    return Response.json({ url: `/object/upload/sign/learning-portal-files/${file.objectKey}?token=upload-capability` });
  });
  const result = await uploadUrl(file);
  assert.equal(new URL(result).searchParams.get('token'), 'upload-capability');
  assert.ok(!result.includes(key));
});

test('upload verification checks size and MIME before reading bounded signature bytes', async t => {
  setup(t);
  let calls = 0; let cancelled = false;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls++;
    if (init.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': '8', 'Content-Type': 'application/pdf' } });
    assert.equal(new Headers(init.headers).get('range'), 'bytes=0-511');
    return new Response(new ReadableStream({start(controller) {controller.enqueue(Buffer.from('%PDF-1.7'.repeat(1000)));},cancel() {cancelled = true;}}));
  });
  await verifyUpload(file);
  assert.equal(calls, 2); assert.equal(cancelled, true);
});

test('verification rejects mismatched metadata and disguised file content', async t => {
  setup(t);
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { headers: { 'Content-Length': '9', 'Content-Type': 'application/pdf' } }));
  await assert.rejects(verifyUpload(file), (e: unknown) => e instanceof HttpError && e.status === 400);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => init.method === 'HEAD'
    ? new Response(null, { headers: { 'Content-Length': '8', 'Content-Type': 'application/pdf' } })
    : new Response('notapdf!'));
  await assert.rejects(verifyUpload(file), /File content does not match/);
});

test('downloads retain filenames, short expiry and safe preview behavior', async t => {
  setup(t);
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.deepEqual(JSON.parse(init.body as string), { expiresIn: 120 });
    return Response.json({ signedURL: `/object/sign/learning-portal-files/${file.objectKey}?token=read-capability` });
  });
  const download = new URL(await downloadUrl(file));
  assert.equal(download.searchParams.get('download'), file.name);
  assert.equal(new URL(await downloadUrl(file, true)).searchParams.has('download'), false);
  assert.equal(new URL(await downloadUrl({ ...file, mime: 'application/msword', name: 'answers.doc' }, true)).searchParams.get('download'), 'answers.doc');
  assert.ok(!download.toString().includes(key));
});

test('ZIP source stays a Node readable stream without a local file or full-buffer copy', async t => {
  setup(t);
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, `https://storage-test.supabase.co/storage/v1/object/authenticated/learning-portal-files/${file.objectKey}`);
    assert.equal(new Headers(init.headers).get('apikey'), key);
    return new Response('%PDF-1.7');
  });
  const chunks: Buffer[] = [];
  for await (const chunk of await fileBody(file.objectKey)) chunks.push(Buffer.from(chunk));
  assert.equal(Buffer.concat(chunks).toString(), '%PDF-1.7');
});

test('storage errors fail closed without leaking provider details or credentials', async t => {
  setup(t);
  t.mock.method(globalThis, 'fetch', async () => new Response(`private provider error ${key}`, { status: 403 }));
  await assert.rejects(uploadUrl(file), (e: unknown) => e instanceof HttpError && e.status === 502 && !e.message.includes(key));
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  await assert.rejects(uploadUrl(file), (e: unknown) => e instanceof HttpError && e.status === 503);
});
