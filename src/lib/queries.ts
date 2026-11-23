import { db } from './db';
import type { User } from '@prisma/client';
export const userSelect = {id: true, name: true, username: true, role: true, active: true, mustChangePassword: true, createdAt: true} as const;
export const fileSelect = {id: true, name: true, size: true, mime: true, createdAt: true} as const;
export function assignmentVisibility(user: Pick<User, 'id' | 'role'>) {
  return user.role === 'TEACHER' ? {} : {isTemplate: false, releaseAt: {lte: new Date()}, students: {some: {studentId: user.id}}};
}
export async function portalData(user: User) {
  const teacher = user.role === 'TEACHER';
  const [students, assignments, exams, briefs, mistakes, notifications, focus] = await Promise.all([
    teacher ? db.user.findMany({where: {role: 'STUDENT'}, select: userSelect, orderBy: {name: 'asc'}}) : [],
    db.assignment.findMany({where: assignmentVisibility(user), orderBy: {createdAt: 'desc'}, take: 500, include: {
      students: {where: teacher ? {} : {studentId: user.id}, select: {student: {select: userSelect}}}, files: {where: {ready: true}, select: fileSelect},
      submissions: {where: teacher ? {} : {studentId: user.id}, orderBy: {version: 'desc'}, include: {student: {select: userSelect}, files: {select: fileSelect}}},
      doubts: {where: teacher ? {} : {studentId: user.id}, include: {student: {select: userSelect}, replies: {include: {user: {select: {id: true, name: true, role: true}}}, orderBy: {createdAt: 'asc'}}}, orderBy: {createdAt: 'asc'}},
    }}),
    db.exam.findMany({where: teacher ? {} : {studentId: user.id, published: true}, include: {student: {select: userSelect}, subjects: true, files: {where: {ready: true}, select: fileSelect}}, orderBy: {date: 'desc'}, take: 500}),
    db.brief.findMany({where: teacher ? {} : {studentId: user.id}, include: {student: {select: userSelect}}, orderBy: [{date: 'desc'}, {afternoonAt: 'desc'}], take: 500}),
    db.mistake.findMany({where: teacher ? {} : {studentId: user.id}, include: {student: {select: userSelect}}, orderBy: {revisionAt: 'asc'}, take: 500}),
    db.notification.findMany({where: {userId: user.id}, orderBy: {createdAt: 'desc'}, take: 100}),
    db.focusSession.findMany({where: teacher ? {} : {userId: user.id}, orderBy: {createdAt: 'desc'}, take: 500}),
  ]);
  return {students, assignments, exams, briefs, mistakes, notifications, focus};
}
