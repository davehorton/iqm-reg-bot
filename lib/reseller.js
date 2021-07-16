const dns = require('dns');

class Reseller {
  constructor(logger, domain) {
    this.logger = logger;
    this.domain = domain;
    this._idx = 0;
  }

  async resolve() {
    return new Promise((resolve, reject) => {
      dns.resolve(`_sip._udp.${this.domain}`, 'SRV', (err, results) => {
        if (err) {
          this.logger.error({err}, `Error resolving ${this.domain} SRV`);
          return reject(err);
        }
        this.targets = results.sort((a, b) =>
          (a.priority === b.priority ? a.weight - b.weight : a.priority - b.priority));
        this.logger.info({targets: this.targets},  `resolved ${this.domain}`);
        resolve(this.targets);
      });
    });
  }

  getNextTarget() {
    if (this.targets && this.targets.length) {
      const count = this.targets.length;
      const target = this.targets[this._idx % count];
      this._idx++;
      return target;
    }
  }
}

module.exports = Reseller;
