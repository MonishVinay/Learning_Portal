import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { sameOrigin, HttpError } from '../src/lib/http';
import { hashPassword, tokenHash, verifyPassword } from '../src/lib/auth';
import { assignmentVisibility } from '../src/lib/queries';
import { reportCard } from '../src/lib/report';
import { PDFDocument } from 'pdf-lib';
test('state changes require exact configured origin',()=>{
  process.env.APP_URL='https://scholar.example';
  assert.doesNotThrow(()=>sameOrigin(new NextRequest('https://internal/api',{headers:{origin:'https://scholar.example'}})));
  assert.throws(()=>sameOrigin(new NextRequest('https://internal/api',{headers:{origin:'https://evil.example'}})),HttpError);
  assert.throws(()=>sameOrigin(new NextRequest('https://internal/api')),HttpError);
});
test('passwords retain spaces and sessions store keyed hashes only',async()=>{
  process.env.AUTH_SECRET='test-only-secret-with-at-least-thirty-two-characters';
  const hash=await hashPassword('temporary password 123');
  assert.notEqual(hash,'temporary password 123');
  assert.equal(await verifyPassword('temporary password 123',hash),true);
  assert.equal(await verifyPassword('temporarypassword123',hash),false);
  const token='opaque-session-token';const h=tokenHash(token);assert.equal(h.length,64);assert.notEqual(h,token);
  process.env.AUTH_SECRET='a-different-test-secret-with-thirty-two-characters';assert.notEqual(tokenHash(token),h);
});
test('student assignment query excludes templates, schedules, and other recipients',()=>{
  const where=assignmentVisibility({id:'student-a',role:'STUDENT'});
  assert.equal(where.isTemplate,false);assert.deepEqual(where.students,{some:{studentId:'student-a'}});
  assert.ok(where.releaseAt?.lte instanceof Date);
  assert.deepEqual(assignmentVisibility({id:'teacher',role:'TEACHER'}),{});
});
test('report cards are real paginated PDFs with valid metadata',async()=>{
  const bytes=await reportCard({title:'Term results',date:new Date('2026-11-23'),published:false,student:{name:'Student',username:'student'},remarks:'A thoughtful effort. '.repeat(80),subjects:Array.from({length:30},(_,i)=>({name:`Subject ${i+1}`,marks:75,maxMarks:100,weakTopics:'Review core concepts and solve targeted questions.'}))});
  assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');
  const pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>1);assert.equal(pdf.getTitle(),'Term results - Student');
});
