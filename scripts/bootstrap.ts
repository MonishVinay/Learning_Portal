import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const db = new PrismaClient();
async function main() {
  const existing = await db.user.findUnique({where: {username: 'teacher'}});
  if (existing) { console.log('Teacher already exists; credentials and records preserved.'); return; }
  const password = process.env.TEACHER_INITIAL_PASSWORD;
  if (!password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('Set TEACHER_INITIAL_PASSWORD (minimum 12 characters, maximum 72 UTF-8 bytes).');
  await db.user.upsert({where: {username: 'teacher'}, create: {username: 'teacher', name: process.env.TEACHER_NAME || 'Teacher', passwordHash: await bcrypt.hash(password, 12), role: 'TEACHER', mustChangePassword: true}, update: {}});
  console.log('Initial teacher created. A password change is required at first login.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
