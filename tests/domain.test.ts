import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, fileSignature, grade, inferFileMime, occurrenceDates, percentage, safeFilename, validFile, validTimezone } from '../src/lib/domain';
import { zonedISO } from '../src/lib/client';
test('Kolkata dates cross midnight at the correct UTC boundary',()=>{
  assert.equal(dayKey(new Date('2026-11-23T18:29:59Z')),'2026-11-23');
  assert.equal(dayKey(new Date('2026-11-23T18:30:00Z')),'2026-11-24');
  assert.equal(zonedISO('2026-11-24T00:00'),'2026-11-23T18:30:00.000Z');
  assert.equal(zonedISO('2026-07-01T12:00','America/New_York'),'2026-07-01T16:00:00.000Z');
  assert.equal(validTimezone('Asia/Kolkata'),true); assert.equal(validTimezone('made-up'),false);
});
test('grades and weighted percentages honor boundaries and zero maxima',()=>{
  assert.equal(percentage(185,200),92.5); assert.equal(percentage(0,0),0);
  assert.equal(grade(90),'A+');assert.equal(grade(89.9),'A');assert.equal(grade(39),'Needs improvement');
});
test('uploads enforce role-purpose types, MIME and extension, and exact size limits',()=>{
  assert.equal(validFile('answers.pdf','application/pdf',20*1024*1024,'SUBMISSION'),true);
  assert.equal(validFile('answers.pdf','application/pdf',20*1024*1024+1,'SUBMISSION'),false);
  assert.equal(validFile('empty.pdf','application/pdf',0,'SUBMISSION'),false);
  assert.equal(validFile('evil.html','application/pdf',200,'SUBMISSION'),false);
  assert.equal(validFile('photo.JPG','image/jpeg',200,'SUBMISSION'),true);
  assert.equal(validFile('photo.jpg','image/jpeg',200,'ASSIGNMENT'),false);
  assert.equal(validFile('card.doc','application/msword',200,'REPORT'),false);
});
test('magic bytes reject disguised files and allow supported documents',()=>{
  assert.equal(fileSignature(Buffer.from('%PDF-1.7'),'application/pdf'),true);
  assert.equal(fileSignature(Buffer.from('<script>alert(1)</script>'),'application/pdf'),false);
  assert.equal(fileSignature(Buffer.from([137,80,78,71,13,10,26,10]),'image/png'),true);
  assert.equal(fileSignature(Buffer.from([255,216,255,224]),'image/jpeg'),true);
  assert.equal(fileSignature(Buffer.from([80,75,3,4]),'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),true);
  assert.equal(fileSignature(Buffer.from([0,1,2]),'text/plain'),false);
  assert.equal(fileSignature(Buffer.from('Readable text'),'text/plain'),true);
});
test('mobile uploads infer missing MIME metadata without overriding supplied types',()=>{
  assert.equal(inferFileMime('answer.PDF',''),'application/pdf');
  assert.equal(inferFileMime('photo.jpg','application/octet-stream'),'image/jpeg');
  assert.equal(inferFileMime('notes.txt',''),'text/plain');
  assert.equal(inferFileMime('unsafe.exe',''),'application/octet-stream');
  assert.equal(inferFileMime('disguised.pdf','text/html'),'text/html');
});
test('archive filenames cannot traverse directories or inject headers',()=>{
  const value=safeFilename('../../folder\\name\r\n".pdf');
  assert.ok(!/[\/\\\r\n"]/.test(value));assert.ok(value.length<=160);assert.equal(safeFilename(''),'file');
});
test('recurrence catches up without generating future or unbounded tasks',()=>{
  const start=new Date('2026-11-01T08:00:00Z');
  assert.deepEqual(occurrenceDates(start,'WEEKLY',new Date('2026-11-16T08:00:00Z')).map(d=>d.toISOString()),['2026-11-08T08:00:00.000Z','2026-11-15T08:00:00.000Z']);
  assert.equal(occurrenceDates(start,'DAILY',new Date('2027-11-01')).length,60);
  assert.equal(occurrenceDates(start,'DAILY',new Date('2026-11-01T09:00:00Z')).length,0);
});
