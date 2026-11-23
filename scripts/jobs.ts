import { runMaintenance } from '../src/lib/jobs';
import { db } from '../src/lib/db';
runMaintenance(true).then(result => console.log('Maintenance complete', result)).catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
