// Load the slot's talks into Elasticsearch (index kubeseat-talks).
// Needs ELASTIC_URL and ELASTIC_API_KEY in the environment, e.g.:
//   set -a; source ~/.kubeseat.env; set +a; node scripts/load-talks.js
// Safe to re-run: documents are upserted by talk id.

const path = require('node:path');
const app = path.join(__dirname, '..', 'app');
const elastic = require(path.join(app, 'elastic'));
const { slot, talks, rooms } = require(path.join(app, 'slot'));

(async () => {
  if (!elastic.enabled()) {
    console.error('Set ELASTIC_URL and ELASTIC_API_KEY first.');
    process.exit(1);
  }
  await elastic.loadTalks(slot, talks, rooms, (m) => console.log('  ' + m));
  console.log(`indexed ${talks.length} talks for slot ${slot.id} into ${elastic.INDEX}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
