const dns = require('dns');

const sorter = (a, b) => (a.priority === b.priority ? a.weight - b.weight : a.priority - b.priority);

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
          this.logger.info({err}, `No SRV records found for ${this.domain}, check for A records..`);
          dns.resolve(this.domain, 'A', (err, results) => {
            if (err) {
              this.logger.info({err}, `No A records found for ${this.domain} either`);
              return reject(err);
            }
            this.targets = results
              .map((r) => {
                return {
                  name: r,
                  port: 5060,
                  priority: 1,
                  weight: 1
                };
              });
            this.logger.info({targets: this.targets},  `resolved ${this.domain}`);
            resolve(this.targets);
          });
          return;
        }
        this.targets = results.sort(sorter);
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
