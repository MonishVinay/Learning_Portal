import { createHmac, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { db } from './db';
import { HttpError } from './http';
import type { Role } from '@prisma/client';
export const COOKIE = 'scholar_session';
export function tokenHash(token: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new HttpError(503, 'Configure AUTH_SECRET with at least 32 characters.');
  return createHmac('sha256', secret).update(token).digest('hex');
}
export const hashPassword = (value: string) => bcrypt.hash(value, 12);
export const verifyPassword = (value: string, hash: string) => bcrypt.compare(value, hash);
export async function getUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({where: {id: tokenHash(token)}, include: {user: true}});
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  return session.user;
}
export async function requireUser(role?: Role, allowPasswordChange = false) {
  const user = await getUser();
  if (!user) throw new HttpError(401, 'Please sign in to continue.');
  if (role && user.role !== role) throw new HttpError(403, 'You do not have permission for this action.');
  if (user.mustChangePassword && !allowPasswordChange) throw new HttpError(428, 'Change your temporary password before continuing.');
  return user;
}
export async function newSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  await db.session.create({data: {id: tokenHash(token), userId, expiresAt}});
  (await cookies()).set(COOKIE, token, {httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires: expiresAt});
}
export async function clearSession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({where: {id: tokenHash(token)}});
  store.delete(COOKIE);
}
export function publicUser(user: Awaited<ReturnType<typeof requireUser>>) {
  const {id, name, username, role, mustChangePassword, timezone, streaksEnabled, active, createdAt} = user;
  return {id, name, username, role, mustChangePassword, timezone, streaksEnabled, active, createdAt};
}
