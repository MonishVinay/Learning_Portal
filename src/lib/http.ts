import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { Prisma } from '@prisma/client';
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function parse<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  if (Number(req.headers.get('content-length') || 0) > 256000) throw new HttpError(413, 'Request is too large.');
  try { return schema.parse(await req.json()); } catch (e) {
    if (e instanceof ZodError) throw new HttpError(400, e.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    throw new HttpError(400, 'Invalid request body.');
  }
}
export function sameOrigin(req: NextRequest) {
  const expected = process.env.APP_URL;
  if (!expected) throw new HttpError(503, 'APP_URL has not been configured.');
  if (req.headers.get('origin') !== new URL(expected).origin) throw new HttpError(403, 'Request origin is not allowed. Refresh the page and retry.');
}
export function handler(fn: (req: NextRequest, context: { params: Promise<{ path?: string[] }> }) => Promise<Response>) {
  return async (req: NextRequest, context: { params: Promise<{ path?: string[] }> }) => {
    try {
      const response = await fn(req, context);
      response.headers.set('Cache-Control', 'no-store, private');
      return response;
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({error: e.message}, {status: e.status, headers: {'Cache-Control': 'no-store'}});
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return NextResponse.json({error: 'This record already exists. Refresh and retry.'}, {status: 409});
      console.error('API error', e instanceof Error ? e.name : 'UnknownError');
      return NextResponse.json({error: 'The operation could not be completed. Your saved data is safe. Please retry.'}, {status: 500});
    }
  };
}
