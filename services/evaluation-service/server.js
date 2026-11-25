// Runs evaluation-service on your PC (npm run dev / scripts/local-up.js). Lambda uses lambda.js instead.
const app = require('./app');

const port = Number(process.env.PORT || 4004);
app.listen(port, () => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', service: 'evaluation-service', event: 'listening', port })));
