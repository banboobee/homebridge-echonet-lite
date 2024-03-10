const util = require('util')
const Bobolink = require('bobolink')
const EchonetLite = require('echonet-lite-more')
let el = null
let ix = 0

// Wrapper that provide promisified methods.
class PromisifiedEchonetLite {
  constructor(arg) {
    el ??= new EchonetLite(arg)		// arg is evaluated only once.
    this.el ??= el			// shared by all instances
    this.ix = ix++			// instance ID
    this.setQueue = new Bobolink({	// Use Queuing mode
      scheduleMode: Bobolink.SCHEDULE_MODE_FREQUENCY,
      timeScale: 1,
      countPerTimeScale: 1,
      retryPrior: true,
      concurrency: 1,
      retry: 0,
      timeout: 2000
    })
    this.getQueue = new Bobolink({
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
        if (method === 'getPropertyValue')	// promisify with Bobolink wrapping
	  PromisifiedEchonetLite.prototype[method] = function getPropertyValue(...args) {
	    return this.getQueue.put(() => {
	      return util.promisify(old).apply(this.el, args)
	    }).then(ts => {
	      if (ts.err) {			// catch Bobolink error
		throw(`${ts.err}: retry:${ts.retry}, wait:${ts.waitingTime}ms, elaps:${ts.runTime}ms, #runnings:${this.getQueue.runningTasksCount}, #waitings:${this.getQueue.queueTaskSize}`)
	      } else {
		return ts.res
	      }
	    })
	  }
        else if (method === 'setPropertyValue')	// promisify with Bobolink wrapping
	  PromisifiedEchonetLite.prototype[method] = function setPropertyValue(...args) {
	    return this.setQueue.put(() => {
	      return util.promisify(old).apply(this.el, args)
	    }).then(ts => {
	      if (ts.err) {			// catch Bobolink error
		throw(`err:${ts.err}, retry:${ts.retry}, wait:${ts.waitingTime}ms, elaps:${ts.runTime}ms, #runnings:${this.getQueue.runningTasksCount}, #waitings:${this.getQueue.queueTaskSize}`)
	      } else {
		return ts.res
	      }
	    })
	  }
        else					// promisify other callbackMethods
	  PromisifiedEchonetLite.prototype[method] = function (...args) {
	    return util.promisify(old).apply(this.el, args)
	  }
      } else {					//  keep remaining methods
	PromisifiedEchonetLite.prototype[method] = function (...args) {
          return old.apply(this.el, args)
	}
      }
  }
}

//module.exports = new PromisifiedEchonetLite({lang: 'ja', type: 'lan'})
module.exports = PromisifiedEchonetLite
