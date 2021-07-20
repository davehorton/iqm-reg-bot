const assert = require('assert');
const short = require('short-uuid');
const CHECKIN_INTERVAL = 60000;
const CHANNEL_PREFIX = 'bot:';
const BOT_CONTROLLER_CHANNEL = 'reg-bot-controller';
const Reseller = require('./reseller');

const waitFor = async(ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

class Controller {
  constructor(logger, srf, client) {
    this.srf = srf;
    this.client = client;
    this.channelName = `${CHANNEL_PREFIX}${short().new()}`;
    this.logger = logger.child({bot: this.channelName});
    this.resellers = new Map();
    this.users = [];
  }

  async initialize() {
    this._initPubSub();
    this.logger.info('initialized');
  }

  _register() {
    this.logger.debug('registering');
    this.publisher.publish(BOT_CONTROLLER_CHANNEL, JSON.stringify({
      action: 'register',
      channel: this.channelName
    }));
  }

  run() {
    this._register();
    setInterval(this._register.bind(this), CHECKIN_INTERVAL);
  }

  _initPubSub() {
    assert(!this.subscriber);
    assert(!this.publisher);

    this.subscriber = this.client.duplicate();
    this.publisher = this.client.duplicate();

    this.subscriber.subscribe(this.channelName);
    this.subscriber.on('message', this._botMessage.bind(this));
  }

  _botMessage(channel, message) {
    this.logger.debug({channel, message}, '_botMessage');
    try {
      const {action, users} = JSON.parse(message);
      switch (action) {
        case 'assign':
          this._startTasks(users);
          break;
        default:
          this.logger.info({action}, '_botMessage: invalid or missing action');
      }
    } catch (err) {
      this.logger.error({err}, `Error parsing message from channel ${channel}: ${message}`);
    }
  }

  async _startTasks(users) {
    this.logger.info({users}, `Start registering for ${users.length} users`);

    /* clear anything currently running */
    for (const u of this.users) {
      if (u.regTimer) {
        clearTimeout(u.regTimer);
        u.regTimer = null;
      }
    }

    /* get list of unique reseller domains */
    const domains = [...new Set(users.map((u) => u.sip_hostname))];
    this.logger.debug({domains}, 'starting registering for these domains');
    for (const domain of domains) {
      if (!this.resellers.has(domain)) {
        this.logger.info(`adding reseller ${domain}`);
        const reseller = new Reseller(this.logger, domain);
        try {
          await reseller.resolve();
          this.resellers.set(domain, reseller);
        } catch (err) {
          this.logger.info(`Unable to resolve domain for reseller ${domain}; wont reg`);
        }
      }
    }

    this.users = users.map((u) => {
      const reseller = this.resellers.get(u.sip_hostname);
      const proxy = reseller ? reseller.getNextTarget() : null;
      return {
        ...u,
        proxy: proxy ? `sip:${proxy.name}` : null
      };
    });

    /* start registering, with a delay / spread to avoid slamming the reseller's SBC */
    let idx = 0;
    const MAX_PER_CYCLE = process.env.MAX_PER_CYCLE || 5;
    const DELAY_BETWEEN_CYCLE = process.env.DELAY_BETWEEN_CYCLE || 100;
    this.logger.info(`_startTasks: initializing at a rate of ${MAX_PER_CYCLE} per ${DELAY_BETWEEN_CYCLE}ms`);
    for (const user of this.users) {
      if (user.proxy) {
        result = await this.client.setAsync(user.msisdn, JSON.stringify(user));
        this.logger.debug({result}, `added proxy to ${user.msisdn}`);
      }
      if (0 === (idx++ % MAX_PER_CYCLE)) await waitFor(DELAY_BETWEEN_CYCLE);
      this._registerOneUser(user);
    }
  }

  async _registerOneUser(user) {
    try {
      this.logger.debug({user}, '_registerOneUser');
      const req = await this.srf.request({
        uri: `sip:${user.sip_username}@${user.sip_hostname}`,
        method: 'REGISTER',
        headers: {
          user_agent: 'IQMobile',
          contact: `<sip:${user.sip_username}@localhost>;expires=3600`
        },
        auth: {
          username: user.auth_username || user.sip_username,
          password: user.sip_password
        }
      });
      req.once('response', (response) => {
        if (200 === response.status) {
          const contact = response.getParsedHeader('Contact');
          let expires;
          if (Array.isArray(contact) && contact.length && contact[0].params.expires) {
            expires = parseInt(contact[0].params.expires);
          }
          else if (response.has('Expires')) {
            expires = parseInt(response.get('Expires'));
          }
          else throw new Error('_registerOneUser: reseller 200 OK to register with no expires');
          this.logger.debug({user}, `200 OK to REGISTER with expires ${expires}`);
          user.regTimer = setTimeout(this._registerOneUser.bind(this, user), 1000 * (expires - 15));
        }
        else {
          this.logger.info({user, status: response.status}, '_registerOneUser: reseller failed register');
          user.regTimer = setTimeout(this._registerOneUser.bind(this, user), 300000);
        }
      });
    } catch (err) {
      this.logger.error({err}, 'Error sending register/unregister upstream');
      user.regTimer = setTimeout(this._registerOneUser.bind(this, user), 300000);
    }
  }
}

module.exports = Controller;
