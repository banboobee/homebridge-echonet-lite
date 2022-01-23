// -*- js-indent-level : 2 -*-

const util = require('util')
const Bobolink = require('bobolink')
const EchonetLite = require('echonet-lite-more')
const fs = require('fs');
let el
let ix = 0

// Wrapper that provide promisified methods.
class PromisifiedEchonetLite {
  constructor(arg) {
    //this.el = new EchonetLite(arg);
    if (!el) {
      el = new EchonetLite(arg)
    }
    this.el = el;
    this.ix = ix++
    this.setQueue = new Bobolink({
      scheduleMode: Bobolink.SCHEDULE_MODE_FREQUENCY,
      timeScale: 1,
      countPerTimeScale: 1,
      retryPrior: true,
      concurrency: 1,
      retry: 0,
      timeout: 2000
    })
//  this.getQueue = new Bobolink({concurrency: 9})
    this.getQueue = new Bobolink({
      // concurrency: 1,
      // retry: 1,
      // timeout: 1000
      scheduleMode: Bobolink.SCHEDULE_MODE_FREQUENCY,
      timeScale: 1,
      countPerTimeScale: 2,
      retryPrior: true,
      concurrency: 1,
      retry: 1,
      timeout: 2000
    })
  }
}

const LOG = '/tmp/echonet.log'
async function log(s) {
  let date = new Date()
  let time = `${date.getFullYear()}-${('0' + (date.getMonth() + 1)).slice(-2)}-${('0' + date.getDate()).slice(-2)} ${('0' + date.getHours()).slice(-2)}:${('0' + date.getMinutes()).slice(-2)}:${('0' + date.getSeconds()).slice(-2)}.${(date.getMilliseconds() + '000').slice(0,3)}`
  fs.writeFileSync(LOG, time + ' ' + s + '\n', {flag: 'a'});
}

// Populate methods.
const callbackMethods = [
  'init', 'getPropertyMaps', 'getPropertyValue', 'setPropertyValue',
  'send', 'close',
]
for (const method in EchonetLite.prototype) {
  if (method.startsWith('_'))  // private method
    continue
  const old = EchonetLite.prototype[method]
  if (typeof old === 'function') {
      if (callbackMethods.includes(method)) {
        if (method === 'getPropertyValue')
	  PromisifiedEchonetLite.prototype[method] = function getPropertyValue(...args) {
	    return this.getQueue.put(() => {
	      //log(`queue${this.ix}: get: ${JSON.stringify(args)}`)
	      return util.promisify(old).apply(this.el, args)
	    }).then(ts => {
	      //log(`deque${this.ix}: get: ${JSON.stringify(args)}`)
	      if (ts.err) {
		throw(`err:${ts.err}, retry:${ts.retry}, wait:${ts.waitingTime}ms, elaps:${ts.runTime}ms, #runnings:${this.getQueue.runningTasksCount}, #waitings:${this.getQueue.queueTaskSize}`)
	      } else {
		return ts.res
	      }
	    })
	  }
        else if (method === 'setPropertyValue')
	  PromisifiedEchonetLite.prototype[method] = function setPropertyValue(...args) {
	    return this.setQueue.put(() => {
	      //log(`queue${this.ix}: set: ${JSON.stringify(args)}`)
	      return util.promisify(old).apply(this.el, args)
	    }).then(ts => {
	      //log(`deque${this.ix}: set: ${JSON.stringify(args)}`)
	      if (ts.err) {
		throw(`err:${ts.err}, retry:${ts.retry}, wait:${ts.waitingTime}ms, elaps:${ts.runTime}ms, #runnings:${this.getQueue.runningTasksCount}, #waitings:${this.getQueue.queueTaskSize}`)
	      } else {
		return ts.res
	      }
	    })
	  }
        else
	  PromisifiedEchonetLite.prototype[method] = function (...args) {
	    return util.promisify(old).apply(this.el, args)
	  }
      } else {
	PromisifiedEchonetLite.prototype[method] = function (...args) {
          return old.apply(this.el, args)
	}
      }
  }
}

//module.exports = new PromisifiedEchonetLite({lang: 'ja', type: 'lan'})
module.exports = PromisifiedEchonetLite
