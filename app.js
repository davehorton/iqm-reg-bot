const Srf = require('drachtio-srf');
const srf = new Srf();
const promisify = require('@jambonz/promisify-redis');
const redis = promisify(require('redis'));
const opts = Object.assign({
  timestamp: () => {return `, "time": "${new Date().toISOString()}"`;}
}, {level: process.env.LOGLEVEL || 'info'});
const logger = require('pino')(opts);
const client = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379
});
['ready', 'connect', 'reconnecting', 'error', 'end', 'warning']
  .forEach((event) => {
    client.on(event, (...args) => logger.info({args}, `redis event ${event}`));
  });

srf.connect({
  host: process.env.DRACHTIO_HOST || '127.0.0.1',
  port: process.env.DRACHTIO_PORT || 9022,
  secret: process.env.DRACHTIO_SECRET || 'cymru'
});
srf.on('connect', (err, hp) => {
  logger.info(`connected to drachtio listening on ${hp}`);
});

const Bot = require('./lib/bot');
const regbot = new Bot(logger, srf, client);

setTimeout(async() => {
  try {
    await regbot.initialize();
    regbot.run();
  } catch (err) {
    logger.error({err}, 'Error initializing reg-bot');
  }
}, 10000);
