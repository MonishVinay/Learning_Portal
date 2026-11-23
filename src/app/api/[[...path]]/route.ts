import { NextResponse } from 'next/server';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { clearSession, hashPassword, newSession, publicUser, requireUser, verifyPassword } from '@/lib/auth';
import { handler, HttpError, parse, sameOrigin } from '@/lib/http';
import { dayKey, safeFilename, validFile, validTimezone } from '@/lib/domain';
import { downloadUrl, fileBody, uploadUrl, verifyUpload } from '@/lib/storage';
import { assignmentVisibility, fileSelect, portalData, userSelect } from '@/lib/queries';
import { runMaintenance } from '@/lib/jobs';
import { reportCard } from '@/lib/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const text = (max = 10000) => z.string().trim().max(max);
const id = z.string().min(1).max(100);
const password = z.string().min(12, 'Use at least 12 characters.').max(72, 'Use at most 72 characters.').refine(v => Buffer.byteLength(v, 'utf8') <= 72, 'Password must fit within 72 UTF-8 bytes.');
const fileIds = z.array(id).max(12).default([]);
const dateTime = z.iso.datetime({offset: true}).transform(v => new Date(v));
const assignmentSchema = z.object({title: text(160).min(1), description: text(20000), subject: text(80).min(1), priority: z.enum(['LOW', 'MEDIUM', 'HIGH']), dueAt: dateTime, releaseAt: dateTime, recurrence: z.enum(['NONE', 'DAILY', 'WEEKLY']).default('NONE'), isTemplate: z.boolean().default(false), studentIds: z.array(id).max(500), fileIds}).refine(v => v.dueAt > v.releaseAt, 'Deadline must be after release time.').refine(v => v.isTemplate || v.studentIds.length > 0, 'Select at least one student.');
const examSchema = z.object({studentId: id, title: text(160).min(1), date: dateTime, remarks: text(), published: z.boolean().default(false), fileIds, subjects: z.array(z.object({name: text(80).min(1), marks: z.number().min(0), maxMarks: z.number().positive().max(100000), weakTopics: text(2000).default('')}).refine(v => v.marks <= v.maxMarks, 'Marks cannot exceed maximum marks.')).min(1).max(30)});
const json = (value: unknown, status = 200) => NextResponse.json(value, {status});

async function studentExists(studentId: string) {
  if (!await db.user.findFirst({where: {id: studentId, role: 'STUDENT', active: true}})) throw new HttpError(400, 'Select an active student.');
}
async function claimFiles(tx: Prisma.TransactionClient, ids: string[], ownerId: string, purpose: 'ASSIGNMENT' | 'SUBMISSION' | 'REPORT', target: {assignmentId?: string; submissionId?: string; examId?: string}) {
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Duplicate file selection.');
  const result = await tx.fileAsset.updateMany({where: {id: {in: ids}, ownerId, purpose, ready: true, assignmentId: null, submissionId: null, examId: null}, data: target});
  if (result.count !== ids.length) throw new HttpError(400, 'Some files are not ready or were already attached. Refresh and retry.');
}
async function visibleAssignment(assignmentId: string, user: Awaited<ReturnType<typeof requireUser>>) {
  const assignment = await db.assignment.findFirst({where: {id: assignmentId, ...assignmentVisibility(user)}});
  if (!assignment) throw new HttpError(404, 'Assignment not found.');
  return assignment;
}

export const GET = handler(async (req, context) => {
  const path = (await context.params).path ?? [];
  if (path[0] === 'health') { await db.$queryRaw`SELECT 1`; return json({status: 'ok'}); }
  if (path[0] === 'me') return json({user: publicUser(await requireUser(undefined, true))});
  const user = await requireUser();
  if (path[0] === 'data') {
    // Opportunistic maintenance supports sleeping instances; external cron is recommended.
    await runMaintenance();
    return json(await portalData(user));
  }
  if (path[0] === 'files' && path[1]) {
    const file = await db.fileAsset.findUnique({where: {id: path[1]}, include: {assignment: {include: {students: true}}, submission: {include: {assignment: {include: {students: true}}}}, exam: true}});
    if (!file?.ready) throw new HttpError(404, 'File not found.');
    const assignment = file.assignment ?? file.submission?.assignment;
    const attached = !!(file.assignmentId || file.submissionId || file.examId);
    const canAccess = user.role === 'TEACHER' || (!attached && file.ownerId === user.id)
      || (assignment && !assignment.isTemplate && assignment.releaseAt <= new Date() && assignment.students.some(s => s.studentId === user.id) && (!file.submission || file.submission.studentId === user.id))
      || (file.exam?.studentId === user.id && file.exam.published);
    if (!canAccess) throw new HttpError(403, 'You do not have access to this file.');
    return NextResponse.redirect(await downloadUrl(file, req.nextUrl.searchParams.get('preview') === '1'));
  }
  if (path[0] === 'zip' && path[1] && path[2]) {
    await visibleAssignment(path[1], user);
    if (user.role === 'STUDENT' && path[2] !== user.id) throw new HttpError(403, 'Access denied.');
    const assignment = await db.assignment.findUniqueOrThrow({where: {id: path[1]}, include: {files: {where: {ready: true}}, submissions: {where: {studentId: path[2]}, orderBy: {version: 'asc'}, include: {files: {where: {ready: true}}}}, students: true}});
    if (!assignment.students.some(s => s.studentId === path[2])) throw new HttpError(404, 'Student not assigned.');
    const archive = archiver('zip', {zlib: {level: 5}});
    archive.on('error', () => archive.destroy());
    const body = Readable.toWeb(archive) as ReadableStream<Uint8Array>;
    // Stream private Supabase objects; no files are written to the server disk.
    void (async () => {
      try {
        archive.append(JSON.stringify({assignment: assignment.title, exportedAt: new Date(), versions: assignment.submissions.map(s => ({version: s.version, submittedAt: s.createdAt, status: s.status, score: s.score, maxScore: s.maxScore, feedback: s.feedback, note: s.note}))}, null, 2), {name: 'submission-history.json'});
        for (const f of assignment.files) archive.append(await fileBody(f.objectKey) as Readable, {name: `assignment/${f.id}-${safeFilename(f.name)}`});
        for (const s of assignment.submissions) for (const f of s.files) archive.append(await fileBody(f.objectKey) as Readable, {name: `answers/version-${s.version}/${f.id}-${safeFilename(f.name)}`});
        await archive.finalize();
      } catch (e) { archive.destroy(e instanceof Error ? e : new Error('Archive failed')); }
    })();
    return new Response(body, {headers: {'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="assignment-complete.zip"'}});
  }
  if (path[0] === 'reports' && path[1]) {
    const exam = await db.exam.findFirst({where: {id: path[1], ...(user.role === 'STUDENT' ? {studentId: user.id, published: true} : {})}, include: {student: {select: userSelect}, subjects: true}});
    if (!exam) throw new HttpError(404, 'Report card not found.');
    return new Response(new Uint8Array(await reportCard(exam)), {headers: {'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="report-card.pdf"'}});
  }
  if (path[0] === 'archive') {
    const query = req.nextUrl.searchParams.get('q')?.slice(0, 120) || '';
    const [assignments, exams] = await Promise.all([
      db.assignment.findMany({where: {...assignmentVisibility(user), OR: [{title: {contains: query, mode: 'insensitive'}}, {subject: {contains: query, mode: 'insensitive'}}, {description: {contains: query, mode: 'insensitive'}}]}, include: {files: {where: {ready: true}, select: fileSelect}, submissions: {where: user.role === 'STUDENT' ? {studentId: user.id} : {}, include: {student: {select: userSelect}, files: {select: fileSelect}}, orderBy: {version: 'desc'}}}, orderBy: {createdAt: 'desc'}, take: 100}),
      db.exam.findMany({where: {...(user.role === 'STUDENT' ? {studentId: user.id, published: true} : {}), OR: [{title: {contains: query, mode: 'insensitive'}}, {subjects: {some: {name: {contains: query, mode: 'insensitive'}}}}]}, include: {student: {select: userSelect}, subjects: true, files: {where: {ready: true}, select: fileSelect}}, orderBy: {date: 'desc'}, take: 100}),
    ]);
    return json({assignments, exams});
  }
  if (path[0] === 'export') {
    const data = await portalData(user);
    const files = await db.fileAsset.findMany({where: user.role === 'TEACHER' ? {ready: true} : {ready: true, OR: [{ownerId: user.id}, {assignment: {isTemplate: false, releaseAt: {lte: new Date()}, students: {some: {studentId: user.id}}}}, {exam: {studentId: user.id, published: true}}]}, select: {id: true, objectKey: true, name: true, mime: true, size: true}});
    // Full teacher export is deliberately unbounded; this is a manual metadata backup.
    const full = user.role === 'TEACHER' ? {
      students: await db.user.findMany({where: {role: 'STUDENT'}, select: userSelect}),
      assignments: await db.assignment.findMany({include: {students: true, submissions: {include: {files: {select: fileSelect}}}, doubts: {include: {replies: true}}, files: {select: fileSelect}}}),
      exams: await db.exam.findMany({include: {subjects: true, files: {select: fileSelect}}}),
      briefs: await db.brief.findMany(), mistakes: await db.mistake.findMany(), focus: await db.focusSession.findMany(),
    } : data;
    return new Response(JSON.stringify({format: 'scholar-export-v1', exportedAt: new Date(), data: full, fileManifest: files, note: 'Metadata export and private object manifest. Back up PostgreSQL and R2 independently for full restoration.'}, null, 2), {headers: {'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="scholar-export.json"'}});
  }
  throw new HttpError(404, 'Endpoint not found.');
});

export const POST = handler(async (req, context) => {
  const path = (await context.params).path ?? [];
  if (path[0] === 'jobs') {
    const secret = process.env.CRON_SECRET;
    const given = req.headers.get('authorization') || '';
    const expected = `Bearer ${secret}`;
    const suppliedBytes = Buffer.from(given);
    const expectedBytes = Buffer.from(expected);
    if (!secret || secret.length < 32 || suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) throw new HttpError(401, 'Unauthorized.');
    return json(await runMaintenance(true));
  }
  sameOrigin(req);
  if (path[0] === 'login') {
    const values = await parse(req, z.object({username: text(64).min(1).transform(v => v.toLowerCase()), password: z.string().max(200)}));
    // Account-based throttle cannot be bypassed by spoofing proxy address headers.
    const bucketId = `login:${createHash('sha256').update(values.username).digest('hex')}`;
    const bucket = await db.$transaction(async tx => {
      const current = await tx.loginBucket.upsert({where: {id: bucketId}, create: {id: bucketId, resetsAt: new Date(Date.now() + 900000)}, update: {attempts: {increment: 1}}});
      if (current.resetsAt < new Date()) return tx.loginBucket.update({where: {id: bucketId}, data: {attempts: 1, resetsAt: new Date(Date.now() + 900000)}});
      return current;
    });
    if (bucket.attempts > 10) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
    const user = await db.user.findUnique({where: {username: values.username}});
    // Fixed valid bcrypt hash keeps non-existing usernames on the same expensive path.
    const ok = await verifyPassword(values.password, user?.passwordHash ?? '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxeDzlYG4fF4QMdbQpyF1g2Kq6G');
    if (!user?.active || !ok) throw new HttpError(401, 'Incorrect username or password.');
    await db.loginBucket.deleteMany({where: {id: bucketId}});
    await newSession(user.id);
    return json({user: publicUser(user)});
  }
  const user = await requireUser(undefined, ['logout', 'password', 'settings'].includes(path[0]));
  const teacher = () => { if (user.role !== 'TEACHER') throw new HttpError(403, 'Teacher access required.'); };
  const student = () => { if (user.role !== 'STUDENT') throw new HttpError(403, 'Student access required.'); };
  if (path[0] === 'logout') { await clearSession(); return json({ok: true}); }
  if (path[0] === 'password') {
    const values = await parse(req, z.object({currentPassword: z.string().max(200), newPassword: password}));
    if (!await verifyPassword(values.currentPassword, user.passwordHash)) throw new HttpError(400, 'Current password is incorrect.');
    if (values.currentPassword === values.newPassword) throw new HttpError(400, 'Choose a different password.');
    await db.$transaction([db.user.update({where: {id: user.id}, data: {passwordHash: await hashPassword(values.newPassword), mustChangePassword: false}}), db.session.deleteMany({where: {userId: user.id}})]);
    await newSession(user.id);
    return json({ok: true});
  }
  if (path[0] === 'settings') {
    if (user.mustChangePassword) throw new HttpError(428, 'Change your temporary password first.');
    const values = await parse(req, z.object({name: text(100).min(1), timezone: text(80).refine(validTimezone, 'Invalid timezone.'), streaksEnabled: z.boolean()}));
    return json({user: publicUser(await db.user.update({where: {id: user.id}, data: values}))});
  }
  if (path[0] === 'students') {
    teacher();
    if (!path[1]) {
      const v = await parse(req, z.object({name: text(100).min(1), username: text(40).regex(/^[a-z0-9][a-z0-9._-]{2,39}$/), password}));
      return json(await db.user.create({data: {name: v.name, username: v.username, passwordHash: await hashPassword(v.password), role: 'STUDENT'}, select: userSelect}), 201);
    }
    const target = await db.user.findFirst({where: {id: path[1], role: 'STUDENT'}});
    if (!target) throw new HttpError(404, 'Student not found.');
    const v = await parse(req, z.object({active: z.boolean().optional(), password: password.optional()}));
    await db.$transaction(async tx => {
      await tx.user.update({where: {id: target.id}, data: {...(v.active !== undefined ? {active: v.active} : {}), ...(v.password ? {passwordHash: await hashPassword(v.password), mustChangePassword: true} : {})}});
      await tx.session.deleteMany({where: {userId: target.id}});
    });
    return json({ok: true});
  }
  if (path[0] === 'assignments') {
    teacher();
    if (path[2] === 'duplicate') {
      const original = await db.assignment.findUnique({where: {id: path[1]}, include: {students: true, files: {where: {ready: true}}}});
      if (!original) throw new HttpError(404, 'Assignment not found.');
      const v = await parse(req, z.object({releaseAt: dateTime, dueAt: dateTime, studentIds: z.array(id).min(1).max(500)}).refine(v => v.dueAt > v.releaseAt, 'Deadline must be after release.'));
      for (const sid of v.studentIds) await studentExists(sid);
      return json(await db.assignment.create({data: {title: original.title, description: original.description, subject: original.subject, priority: original.priority, authorId: user.id, releaseAt: v.releaseAt, dueAt: v.dueAt, students: {create: [...new Set(v.studentIds)].map(studentId => ({studentId}))}, files: {create: original.files.map(f => ({objectKey: f.objectKey, name: f.name, size: f.size, mime: f.mime, purpose: f.purpose, ownerId: f.ownerId, ready: true}))}}}), 201);
    }
    const v = await parse(req, assignmentSchema);
    if (new Set(v.studentIds).size !== v.studentIds.length) throw new HttpError(400, 'Duplicate student selection.');
    for (const sid of v.studentIds) await studentExists(sid);
    const {studentIds, fileIds: ids, ...fields} = v;
    const result = await db.$transaction(async tx => {
      if (path[1]) {
        const existing = await tx.assignment.findUnique({where: {id: path[1]}, include: {students: true}});
        if (!existing) throw new HttpError(404, 'Assignment not found.');
        // Retain historical recipients: edits cannot silently hide students' previous work.
        if (existing.students.some(s => !studentIds.includes(s.studentId))) throw new HttpError(400, 'Existing recipients cannot be removed. Their submission history must remain accessible.');
        if (!existing.isTemplate && v.isTemplate) throw new HttpError(400, 'A published assignment cannot become a template. Duplicate it instead.');
        if (!existing.isTemplate && existing.releaseAt <= new Date() && v.releaseAt > new Date()) throw new HttpError(400, 'An already released assignment cannot be hidden by rescheduling.');
        await tx.assignment.update({where: {id: path[1]}, data: fields});
        await tx.assignmentStudent.createMany({data: studentIds.map(studentId => ({assignmentId: path[1], studentId})), skipDuplicates: true});
        await claimFiles(tx, ids, user.id, 'ASSIGNMENT', {assignmentId: path[1]});
        return {id: path[1]};
      }
      const a = await tx.assignment.create({data: {...fields, authorId: user.id, students: {create: studentIds.map(studentId => ({studentId}))}}});
      await claimFiles(tx, ids, user.id, 'ASSIGNMENT', {assignmentId: a.id});
      return a;
    });
    return json(result, path[1] ? 200 : 201);
  }
  if (path[0] === 'submissions' && !path[1]) {
    student();
    const v = await parse(req, z.object({assignmentId: id, note: text(), fileIds: z.array(id).min(1).max(12), idempotencyKey: z.uuid()}));
    await visibleAssignment(v.assignmentId, user);
    const saved = await db.submission.findUnique({where: {studentId_idempotencyKey: {studentId: user.id, idempotencyKey: v.idempotencyKey}}});
    if (saved) return json(saved);
    const submission = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${v.assignmentId}:${user.id}`}))`;
      const retry = await tx.submission.findUnique({where: {studentId_idempotencyKey: {studentId: user.id, idempotencyKey: v.idempotencyKey}}});
      if (retry) return retry;
      const latest = await tx.submission.findFirst({where: {studentId: user.id, assignmentId: v.assignmentId}, orderBy: {version: 'desc'}});
      const result = await tx.submission.create({data: {assignmentId: v.assignmentId, studentId: user.id, version: (latest?.version ?? 0) + 1, idempotencyKey: v.idempotencyKey, note: v.note}});
      await claimFiles(tx, v.fileIds, user.id, 'SUBMISSION', {submissionId: result.id});
      const a = await tx.assignment.findUniqueOrThrow({where: {id: v.assignmentId}});
      await tx.notification.create({data: {userId: a.authorId, title: `${user.name} submitted work`, message: `${a.title} · version ${result.version}`, href: `/assignments?open=${a.id}`}});
      return result;
    });
    return json(submission, 201);
  }
  if (path[0] === 'submissions' && path[1]) {
    teacher();
    const v = await parse(req, z.object({status: z.enum(['CORRECTIONS', 'APPROVED', 'GRADED']), score: z.number().min(0).optional(), maxScore: z.number().positive().max(100000).optional(), feedback: text()}).refine(v => v.status !== 'GRADED' || (v.score !== undefined && v.maxScore !== undefined && v.score <= v.maxScore), 'Provide valid marks and maximum marks.').refine(v => v.status !== 'CORRECTIONS' || !!v.feedback, 'Explain the requested corrections.'));
    const s = await db.submission.findUnique({where: {id: path[1]}, include: {assignment: true}});
    if (!s) throw new HttpError(404, 'Submission not found.');
    await db.$transaction([db.submission.update({where: {id: s.id}, data: {...v, score: v.status === 'GRADED' ? v.score : null, maxScore: v.status === 'GRADED' ? v.maxScore : null, reviewedAt: new Date()}}), db.notification.create({data: {userId: s.studentId, title: v.status === 'CORRECTIONS' ? 'Corrections requested' : 'Your work was reviewed', message: s.assignment.title, href: `/assignments?open=${s.assignmentId}`}})]);
    return json({ok: true});
  }
  if (path[0] === 'exams') {
    teacher();
    if (path[2] === 'publish') {
      const v = await parse(req, z.object({published: z.boolean()}));
      const exam = await db.exam.findUnique({where: {id: path[1]}});
      if (!exam) throw new HttpError(404, 'Result not found.');
      await db.$transaction(async tx => {
        await tx.exam.update({where: {id: exam.id}, data: v});
        if (v.published) await tx.notification.create({data: {userId: exam.studentId, title: 'Results published', message: exam.title, href: '/exams'}});
      });
      return json({ok: true});
    }
    const v = await parse(req, examSchema);
    await studentExists(v.studentId);
    const {subjects, fileIds: ids, ...fields} = v;
    const result = await db.$transaction(async tx => {
      if (path[1]) {
        const existing = await tx.exam.findUnique({where: {id: path[1]}});
        if (!existing || existing.studentId !== v.studentId) throw new HttpError(400, 'The student on an existing result cannot be changed.');
      }
      const exam = path[1] ? await tx.exam.update({where: {id: path[1]}, data: {...fields, subjects: {deleteMany: {}, create: subjects}}}) : await tx.exam.create({data: {...fields, subjects: {create: subjects}}});
      await claimFiles(tx, ids, user.id, 'REPORT', {examId: exam.id});
      if (v.published) await tx.notification.create({data: {userId: exam.studentId, title: 'Results available', message: exam.title, href: '/exams'}});
      return exam;
    });
    return json(result);
  }
  if (path[0] === 'briefs') {
    if (path[2] === 'comment') {
      teacher();
      const v = await parse(req, z.object({teacherComment: text()}));
      const b = await db.brief.update({where: {id: path[1]}, data: v});
      await db.notification.create({data: {userId: b.studentId, title: 'Feedback on your daily brief', message: b.date, href: '/briefs'}});
      return json({ok: true});
    }
    student();
    const base = z.object({date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'Invalid date.').refine(v => v <= dayKey(new Date(), user.timezone), 'Briefs cannot be submitted for future dates.')});
    if (path[1] === 'afternoon') {
      const v = await parse(req, base.extend({goals: z.array(z.object({id: z.uuid(), text: text(500).min(1)})).min(1).max(20), priorities: text(2000), estimatedMinutes: z.number().int().min(0).max(1440), doubts: text(5000)}));
      const {date, ...fields} = v;
      const b = await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`brief:${user.id}:${date}`}))`;
        const existing = await tx.brief.findUnique({where: {studentId_date: {studentId: user.id, date}}});
        if (existing?.eveningAt) throw new HttpError(409, 'The plan is locked after the end-of-day reflection to preserve goal history.');
        return tx.brief.upsert({where: {studentId_date: {studentId: user.id, date}}, create: {...fields, studentId: user.id, date}, update: fields});
      });
      return json(b);
    }
    if (path[1] === 'evening') {
      const v = await parse(req, base.extend({outcomes: z.array(z.object({goalId: z.uuid(), status: z.enum(['COMPLETED', 'PARTIAL', 'UNFINISHED'])})).min(1).max(20), unfinishedReason: text(5000), actualMinutes: z.number().int().min(0).max(1440), reflection: text(10000)}));
      const {date, ...fields} = v;
      return json(await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`brief:${user.id}:${date}`}))`;
        const b = await tx.brief.findUnique({where: {studentId_date: {studentId: user.id, date}}});
        if (!b) throw new HttpError(400, 'Save the afternoon plan first, including for a late brief.');
        const goals = b.goals as {id: string; text: string}[];
        if (v.outcomes.length !== goals.length || new Set(v.outcomes.map(o => o.goalId)).size !== goals.length || v.outcomes.some(o => !goals.some(g => g.id === o.goalId))) throw new HttpError(400, 'Every afternoon goal must have exactly one outcome.');
        if (v.outcomes.some(o => o.status !== 'COMPLETED') && !v.unfinishedReason) throw new HttpError(400, 'Add a reason for unfinished or partially completed goals.');
        return tx.brief.update({where: {id: b.id}, data: {...fields, eveningAt: new Date()}});
      }));
    }
  }
  if (path[0] === 'doubts') {
    if (!path[1]) {
      student();
      const v = await parse(req, z.object({assignmentId: id, message: text(5000).min(1)}));
      const a = await visibleAssignment(v.assignmentId, user);
      const d = await db.doubt.create({data: {...v, studentId: user.id}});
      await db.notification.create({data: {userId: a.authorId, title: `${user.name} has a question`, message: a.title, href: `/assignments?open=${a.id}`}});
      return json(d);
    }
    const d = await db.doubt.findUnique({where: {id: path[1]}, include: {assignment: true}});
    if (!d || (user.role === 'STUDENT' && d.studentId !== user.id)) throw new HttpError(404, 'Question not found.');
    const v = await parse(req, z.object({message: text(5000).optional(), resolved: z.boolean().optional()}));
    if (v.message) await db.doubtReply.create({data: {doubtId: d.id, userId: user.id, message: v.message}});
    if (v.resolved !== undefined) await db.doubt.update({where: {id: d.id}, data: {resolved: v.resolved}});
    if (v.message) await db.notification.create({data: {userId: user.role === 'TEACHER' ? d.studentId : d.assignment.authorId, title: 'New reply to a question', message: d.assignment.title, href: `/assignments?open=${d.assignmentId}`}});
    return json({ok: true});
  }
  if (path[0] === 'mistakes') {
    if (path[1]) {
      const m = await db.mistake.findUnique({where: {id: path[1]}});
      if (!m || (user.role === 'STUDENT' && m.studentId !== user.id)) throw new HttpError(404, 'Revision not found.');
      const v = await parse(req, z.object({mastered: z.boolean(), revisionAt: dateTime.optional(), correction: text().optional(), reviewed: z.boolean().optional()}));
      return json(await db.mistake.update({where: {id: m.id}, data: {mastered: v.mastered, revisionAt: v.revisionAt, correction: v.correction, revisionCount: {increment: v.reviewed ? 1 : 0}}}));
    }
    const v = await parse(req, z.object({studentId: id.optional(), subject: text(80).min(1), topic: text(160).min(1), description: text().min(1), correction: text(), revisionAt: dateTime}));
    const studentId = user.role === 'STUDENT' ? user.id : v.studentId;
    if (!studentId) throw new HttpError(400, 'Select a student.');
    await studentExists(studentId);
    return json(await db.mistake.create({data: {...v, studentId}}), 201);
  }
  if (path[0] === 'notifications') {
    const v = await parse(req, z.object({id: id.optional()}));
    await db.notification.updateMany({where: {userId: user.id, ...(v.id ? {id: v.id} : {})}, data: {read: true}});
    return json({ok: true});
  }
  if (path[0] === 'focus') {
    student();
    const v = await parse(req, z.object({minutes: z.number().int().min(1).max(180), idempotencyKey: z.uuid()}));
    return json(await db.focusSession.upsert({where: {userId_idempotencyKey: {userId: user.id, idempotencyKey: v.idempotencyKey}}, create: {...v, userId: user.id}, update: {}}));
  }
  if (path[0] === 'uploads') {
    if (path[1] && path[2] === 'complete') {
      const f = await db.fileAsset.findFirst({where: {id: path[1], ownerId: user.id}});
      if (!f) throw new HttpError(404, 'Upload not found.');
      if (!f.ready) {
        await verifyUpload(f);
        await db.fileAsset.update({where: {id: f.id}, data: {ready: true}});
      }
      return json({id: f.id, name: f.name, size: f.size, mime: f.mime});
    }
    if (path[1] && path[2] === 'retry') {
      const f = await db.fileAsset.findFirst({where: {id: path[1], ownerId: user.id, ready: false}});
      if (!f) throw new HttpError(404, 'Pending upload not found.');
      return json({id: f.id, url: await uploadUrl(f)});
    }
    const v = await parse(req, z.object({name: text(180).min(1), mime: text(160), size: z.number().int().positive(), purpose: z.enum(['ASSIGNMENT', 'SUBMISSION', 'REPORT'])}));
    if ((v.purpose === 'SUBMISSION' && user.role !== 'STUDENT') || (v.purpose !== 'SUBMISSION' && user.role !== 'TEACHER')) throw new HttpError(403, 'This file purpose is not allowed for your role.');
    if (!validFile(v.name, v.mime, v.size, v.purpose, Number(process.env.MAX_UPLOAD_MB) || 20)) throw new HttpError(400, 'Unsupported file or file too large. Use PDFs for assignments/reports; PDF, JPG, PNG, DOC, DOCX or TXT for answers.');
    const recent = await db.fileAsset.count({where: {ownerId: user.id, createdAt: {gt: new Date(Date.now() - 3600000)}}});
    if (recent >= 100) throw new HttpError(429, 'Hourly upload limit reached. Please try again later.');
    const f = await db.fileAsset.create({data: {...v, name: safeFilename(v.name), objectKey: `uploads/${user.id}/${randomUUID()}`, ownerId: user.id}});
    return json({id: f.id, url: await uploadUrl(f)}, 201);
  }
  throw new HttpError(404, 'Endpoint not found.');
});
