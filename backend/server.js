require('dotenv').config();

const express = require('express');
const cors = require('cors');
const routes = require('./routes');

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.text({ type: ['application/sdp', 'text/plain'] }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', assistant: 'Orby is ready to help!' });
});

app.use('/', routes);

app.listen(port, '0.0.0.0', () => {
  console.log(`Orby backend listening on http://0.0.0.0:${port}`);
});
