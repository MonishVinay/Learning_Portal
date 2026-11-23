import { Prisma } from '@prisma/client';
import { db } from './db';
import { dayKey, occurrenceDates } from './domain';
export async function runMaintenance(force = false) {
  return db.$transaction(async tx => {
    // A database lock and durable throttle prevent duplicate work across replicas.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(913407)`;
    const now = new Date();
    const previous = await tx.loginBucket.findUnique({where: {id: 'system-maintenance'}});
    if (!force && previous && previous.resetsAt > now) return {skipped: true};
    await tx.loginBucket.upsert({where: {id: 'system-maintenance'}, create: {id: 'system-maintenance', resetsAt: new Date(Date.now() + 300000)}, update: {resetsAt: new Date(Date.now() + 300000)}});
    const roots = await tx.assignment.findMany({where: {recurrence: {not: 'NONE'}, isTemplate: false, releaseAt: {lte: now}}, include: {students: true, files: {where: {ready: true}}}});
    let created = 0;
    for (const root of roots) {
      const last = await tx.assignment.findFirst({where: {parentId: root.id}, orderBy: {occurrenceAt: 'desc'}});
      for (const date of occurrenceDates(last?.occurrenceAt ?? root.releaseAt, root.recurrence as 'DAILY' | 'WEEKLY', now).slice(0, 15)) {
        const found = await tx.assignment.findUnique({where: {parentId_occurrenceAt: {parentId: root.id, occurrenceAt: date}}});
        if (found) continue;
        await tx.assignment.create({data: {
          title: root.title, description: root.description, subject: root.subject, priority: root.priority,
          authorId: root.authorId, releaseAt: date, dueAt: new Date(date.getTime() + root.dueAt.getTime() - root.releaseAt.getTime()),
          parentId: root.id, occurrenceAt: date,
          students: {create: root.students.map(s => ({studentId: s.studentId}))},
          files: {create: root.files.map(f => ({objectKey: f.objectKey, name: f.name, mime: f.mime, size: f.size, purpose: f.purpose, ownerId: f.ownerId, ready: true}))},
        }});
        created++;
      }
    }
    const students = await tx.user.findMany({where: {role: 'STUDENT', active: true}, select: {id: true, timezone: true}});
    for (const student of students) {
      const today = dayKey(now, student.timezone);
      const hour = Number(new Intl.DateTimeFormat('en-GB', {timeZone: student.timezone, hour: '2-digit', hourCycle: 'h23'}).format(now));
      const brief = await tx.brief.findUnique({where: {studentId_date: {studentId: student.id, date: today}}});
      if (hour >= 16 && !brief) await notify(tx, student.id, 'Your afternoon brief is waiting', 'Set today’s goals and share your study plan.', '/briefs', `afternoon:${student.id}:${today}`);
      if (hour >= 21 && !brief?.eveningAt) await notify(tx, student.id, 'Time to reflect', 'Complete your end-of-day brief, even if some goals are unfinished.', '/briefs', `evening:${student.id}:${today}`);
      const assigned = await tx.assignment.findMany({where: {isTemplate: false, students: {some: {studentId: student.id}}, releaseAt: {lte: now}}, select: {id: true, title: true, dueAt: true, createdAt: true, submissions: {where: {studentId: student.id}, take: 1, orderBy: {version: 'desc'}}}});
      for (const a of assigned) {
        await notify(tx, student.id, 'Assignment available', a.title, `/assignments?open=${a.id}`, `assignment:${a.id}:${student.id}`);
        if (!a.submissions.length && a.dueAt < new Date(Date.now() + 86400000)) await notify(tx, student.id, a.dueAt < now ? 'Assignment overdue' : 'Deadline approaching', a.title, `/assignments?open=${a.id}`, `due:${a.id}:${student.id}:${today}`);
      }
      const revisions = await tx.mistake.findMany({where: {studentId: student.id, mastered: false, revisionAt: {lte: now}}, take: 100});
      for (const r of revisions) await notify(tx, student.id, 'Revision due', `${r.subject}: ${r.topic}`, '/revision', `revision:${r.id}:${today}`);
    }
    await tx.session.deleteMany({where: {expiresAt: {lt: now}}});
    await tx.loginBucket.deleteMany({where: {resetsAt: {lt: new Date(Date.now() - 86400000)}, id: {not: 'system-maintenance'}}});
    return {created};
  }, {timeout: 60000, maxWait: 10000});
}
async function notify(tx: Prisma.TransactionClient, userId: string, title: string, message: string, href: string, dedupeKey: string) {
  await tx.notification.upsert({where: {dedupeKey}, create: {userId, title, message, href, dedupeKey}, update: {}});
}
