// Runs order-service on your PC (npm run dev / scripts/local-up.js). Lambda uses lambda.js instead.
const app = require('./app');

const port = Number(process.env.PORT || 4003);
app.listen(port, () => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', service: 'order-service', event: 'listening', port })));
