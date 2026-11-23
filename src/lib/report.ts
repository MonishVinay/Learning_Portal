import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { grade, percentage } from './domain';
type Report = {title: string; date: Date; published: boolean; remarks: string; student: {name: string; username: string}; subjects: {name: string; marks: number; maxMarks: number; weakTopics: string}[]};
export async function reportCard(exam: Report) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const clean = (s: string) => s.replace(/[^\x20-\x7e\n]/g, '?');
  function line(value: string, size = 11, strong = false, color = rgb(.16,.21,.30)) {
    const font = strong ? bold : regular;
    const words = clean(value).split(/\s+/);
    let buffer = '';
    for (const word of words) {
      const parts = word.length > 65 ? word.match(/.{1,65}/g)! : [word];
      for (const part of parts) {
        if (font.widthOfTextAtSize(`${buffer} ${part}`, size) > 480 && buffer) { draw(buffer); buffer = part; } else buffer += `${buffer ? ' ' : ''}${part}`;
      }
    }
    if (buffer) draw(buffer);
    function draw(s: string) {
      if (y < 70) { page = pdf.addPage([595.28,841.89]); y = 790; }
      page.drawText(s, {x: 48, y, size, font, color}); y -= size + 9;
    }
  }
  page.drawRectangle({x: 0, y: 715, width: 595.28, height: 127, color: rgb(.07,.13,.24)});
  line('SCHOLAR / ACADEMIC REPORT', 12, true, rgb(.65,.76,.95));
  line(exam.title, 25, true, rgb(1,1,1));
  line(exam.published ? 'PUBLISHED RESULT' : 'DRAFT - NOT PUBLISHED', 10, false, rgb(.75,.82,.94));
  y = 680;
  line(`Student: ${exam.student.name}`, 14, true);
  line(`Student ID: ${exam.student.username}    Exam date: ${exam.date.toISOString().slice(0,10)}`);
  y -= 15;
  line('SUBJECT PERFORMANCE', 12, true);
  for (const subject of exam.subjects) {
    const p = percentage(subject.marks, subject.maxMarks);
    line(`${subject.name}    ${subject.marks} / ${subject.maxMarks}    ${p}%    ${grade(p)}`, 12, true);
    if (subject.weakTopics) line(`Revision focus: ${subject.weakTopics}`, 10);
    y -= 8;
  }
  const marks = exam.subjects.reduce((a,s) => a + s.marks, 0);
  const max = exam.subjects.reduce((a,s) => a + s.maxMarks, 0);
  y -= 15;
  line(`TOTAL: ${marks} / ${max}     ${percentage(marks,max)}%     GRADE: ${grade(percentage(marks,max))}`, 14, true);
  if (exam.remarks) { y -= 12; line('TEACHER REMARKS', 11, true); line(exam.remarks); }
  for (const p of pdf.getPages()) p.drawText('Scholar | External examinations record | Generated report', {x: 48, y: 35, size: 9, font: regular, color: rgb(.45,.49,.55)});
  pdf.setTitle(`${exam.title} - ${exam.student.name}`);
  return pdf.save();
}
