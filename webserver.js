const express = require('express');
const app = express();

const { getConfig } = require('./src/config/env');
const { createLogger } = require('./src/core/logger');

const config = getConfig();
const logger = createLogger({ level: config.logLevel, prefix: 'web' });

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

// A small health endpoint that never leaks configuration values.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

const PORT = config.port;
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Web server running on port ${PORT}`);
});
