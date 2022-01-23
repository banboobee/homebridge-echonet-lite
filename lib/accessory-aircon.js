// -*- js-indent-level : 2 -*-

const path = require('path')
const fs = require('fs')
//const homebridgeLib = require('/usr/local/lib/node_modules/homebridge-lib')
let persist
let FakeGatoHistoryService
//let eve

module.exports = async function(log, api, accessory, el, address, eoj) {
  const hap = api.hap
  const service = this.getService(hap.Service.HeaterCooler) ||
                  this.addService(hap.Service.HeaterCooler)
  const id = `${address}.${eoj[0]}.${eoj[1]}.${eoj[2]}`
  const ELmaxRetry = 5
  this.propertyMaps = (await EL(el.getPropertyMaps, address, eoj)).message.data
  //this.state = {}
  this.log = log
  this.address = address
  this.eoj = eoj
  this.el = el
  this.services.push(service)
    
  this.log('Found Aircon %s under controller %d', id, el.ix)
  //this.log('eoj:', eoj)
  this.log(`propertyMaps(${id}):`, this.propertyMaps)

  //this.cacheFile = path.join(api.user.storagePath(), `${this.address}.${this.eoj[0]}.${this.eoj[1]}.${this.eoj[2]}`)
  //console.log('cacheFile:', this.cacheFile)
  if (!persist) {
    persist = require('node-persist')
    persist.initSync(
      {dir: path.join(api.user.storagePath(),
		      'plugin-persist',
		      'homebridge-echonet-lite'),
       forgiveParseErrors: true })
  }
  let state = persist.getItemSync(id) || {}
  this.state = new Proxy(state, {
    set(target, key, value) {
      target[key] = value
      persist.setItemSync(id, target)
      return true
    }
  })

  this.getServices = () => {
    this.log('getServices() is requested.')
    return this.services
  }

  const deviceduration = 8000
  const operatingduration = 1000
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  //await getProperty(el.getPropertyValue, '192.168.1.18', [1,48,1], 0x80)
  async function EL(func, ...args) {
    let x
    for (let i = 0; i < ELmaxRetry; i++) {
      try {
	x = await func.apply(el, args)
	if (x && x.message && x.message.esv &&
	    (x.message.esv === 'Get_Res' || x.message.esv === 'Set_Res')) {
	  //    if (x && x.message && x.message.data) {
	  return x
	}
	log.debug(`Retrying #${i+1} due to incomplete `+
	    (!x ? '(---)' :
	     ((x && !x.message) ? '(x--)' :
	      ((x && x.message && !x.message.esv) ? '(xx-)' :
	       '(SNA)'))) +
	    ` response. ${func.name}(${JSON.stringify(args)})`)
	//await sleep(1000)
      } catch (e) {
	log.debug(`Retrying #${i+1} due to error response(${e}). ${func.name}(${JSON.stringify(args)})`)
      }
      //console.trace()
    }
    throw(`Retrying exceeds maximum attempts. ${func.name}(${JSON.stringify(args)})`)
  }
  // async function _getPropertyValue(a, b, c) {
  //   let x
  //   for (let i = 0; i < ELmaxRetry; i++) {
  //     x = await el.getPropertyValue(a, b, c)
  //     if (x && x.message && x.message.data) {
  // 	return x
  //     }
  //     log(`Retrying #${i+1} due to incomplete response. el.getPropertyValue(${a}, [${b}], 0x${c.toString(16).toUpperCase()})`)
  //   }
  //   throw(`Retrying failed due to exceeding maximum attempts. el.getPropertyValue(${a}, [${b}], 0x${c.toString(16).toUpperCase()})`)
  // }

  // this.updateCache = async function() {
  //   fs.writeFileSync(
  //     this.cacheFile,
  //     (this.state.active != undefined ? `Active:${this.state.active}\n` : '') +
  // 	(this.state.currentHeaterCoolerState != undefined ? `CurrentHeaterCoolerState:${this.state.currentHeaterCoolerState}\n` : '') +
  // 	(this.state.targetHeaterCoolerState != undefined ? `TargetHeaterCoolerState:${this.state.targetHeaterCoolerState}\n` : '') +
  // 	(this.state.currentRelativeHumidity ? `CurrentRelativeHumidity:${this.state.currentRelativeHumidity}\n` : '') +
  // 	//(this.state.currentTemperature.has(0xBB) ? `CurrentTemperature:${this.state.currentTemperature.get(0xBB)}\n` : '') +
  // 	//(this.state.currentTemperature.has(0xB3) ? `ThresholdTemperature:${this.state.currentTemperature.get(0xB3)}\n` : '') +
  // 	//(this.state.currentTemperature.has(0xB5) ? `CoolingThresholdTemperature:${this.state.currentTemperature.get(0xB5)}\n` : '') +
  // 	//(this.state.currentTemperature.has(0xB6) ? `HeatingThresholdTemperature:${this.state.currentTemperature.get(0xB6)}\n` : '') +
  //       (this.state[`currentTemperature0x${0xBB.toString(16)}`] ? 'CurrentTemperature:'+this.state[`currentTemperature0x${0xBB.toString(16)}`]+'\n' : '') +
  // 	(this.state[`currentTemperature0x${0xB3.toString(16)}`] ? 'ThresholdTemperature:'+this.state[`currentTemperature0x${0xB3.toString(16)}`]+'\n' : '') +
  // 	(this.state[`currentTemperature0x${0xB5.toString(16)}`] ? 'CoolingThresholdTemperature:'+this.state[`currentTemperature0x${0xB5.toString(16)}`]+'\n' : '') +
  // 	(this.state[`currentTemperature0x${0xB6.toString(16)}`] ? 'HeatingThresholdTemperature:'+this.state[`currentTemperature0x${0xB6.toString(16)}`]+'\n' : '') +
  // 	`Time:${Date.now()}\n`
  //   )
  // }

  // this.readCache = async function() {
  //   let x
  //   let f = fs.readFileSync(this.cacheFile, 'utf-8')

  //   if (x = f.match(/Active:(true|false)\n/i))
  //     console.log(x[1])
  //   if (x = f.match(/CurrentHeaterCoolerState:(\d+)\n/i))
  //     console.log(x[1])
  //   if (x = f.match(/TargetHeaterCoolerState:(\d+)\n/i))
  //     console.log(x[1])
  //   if (x = f.match(/CurrentRelativeHumidity:(\d+)\n/i))
  //     console.log(x[1])
  //   if (x = f.match(/CurrentTemperature:(\d+)\n/i))
  //     console.log(x[1])
  //   if (x = f.match(/ThresholdTemperature:(\d+)\n/i))
  //     console.log(x[1])
  //   if (x = f.match(/CoolingThresholdTemperature:(\d+)\n/i))
  //     console.log(x[1])
  //   if (x = f.match(/HeatingThresholdTemperature:(\d+)\n/i))
  //     console.log(x[1])
  //   if (x = f.match(/Time:(\d+)\n/i)) {
  //     let d = Date.now() - x[1]
  //     console.log(x[1], d/1000)
  //   }
  // }

  //this.state.currentTemperature = new Map
  {
    let {temperature} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xBB)).message.data
    if (temperature) {
      //this.state.currentTemperature.set(0xBB, temperature)
      //this.state[`currentTemperature0x${0xBB.toString(16)}`] = temperature
      this.state.currentTemperature = temperature
      //this.log('currentTemerature', this.state.currentTemperature.get(0xBB))
      //this.log('currentTemerature:', this.state[`currentTemperature0x${0xBB.toString(16)}`], `(${id})`)
      this.log('currentTemerature:', this.state.currentTemperature, `(${id})`)
    }
  }
  // for (let i = 0; i < 5; i++) {
  //   let x = (await el.getPropertyValue(this.address, this.eoj, 0xBB))
  //   if (x && x.message && x.message.data) {
  //     let {temperature} = x.message.data
  //     if (temperature) {
  // 	//this.state.currentTemperature.set(0xBB, temperature)
  // 	this.state[`currentTemperature0x${0xBB.toString(16)}`] = temperature
  // 	//this.log('currentTemerature', this.state.currentTemperature.get(0xBB))
  // 	this.log('currentTemerature', this.state[`currentTemperature0x${0xBB.toString(16)}`])
  // 	break;
  //     }
  //   }
  //   this.log('Retrying to initialize currentTemerature.')
  //   await sleep(operatingduration)
  // }

  if(this.propertyMaps.get.find((x) => x == 0xBA)) {
    let {humidity} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xBA)).message.data
    if (humidity) {
      this.state.currentRelativeHumidity = humidity
      this.log('currentRelativeHumidity:', this.state.currentRelativeHumidity, `(${id})`)
    }
    // for (let i = 0; i < 5; i++) {
    //   let x = (await el.getPropertyValue(this.address, this.eoj, 0xBA))
    //   if (x && x.message && x.message.data) {
    // 	let {humidity} = x.message.data
    // 	if (humidity) {
    // 	  this.state.currentRelativeHumidity = humidity
    // 	  this.log('currentRelativeHumidity', this.state.currentRelativeHumidity)
    // 	  break;
    // 	}
    //   }
    //   this.log('Retrying to initialize currentRelativeHumidity.')
    //   await sleep(operatingduration)
    // }
  }
  //else {
  //  this.state.currentRelativeHumidity = -1
  //}

  if (!FakeGatoHistoryService) {
    FakeGatoHistoryService = require('fakegato-history')(api)
  }
  // if (!eve) {
  //   eve = new homebridgeLib.EveHomeKitTypes(api)
  // }
  this.historyService = new FakeGatoHistoryService('room', this, {storage: 'fs'});
  //this.historyService = new FakeGatoHistoryService('thermo', this, {storage: 'fs'});
  this.services.push(this.historyService)
  this.updateHistory = async function () {
    try {
      //if (this.state[`currentTemperature0x${0xBB.toString(16)}`]) {
      if (this.state.currentTemperature) {
	let {temperature} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xBB)).message.data
	if (temperature != undefined) {
	  //this.state[`currentTemperature0x${0xBB.toString(16)}`] = temperature
	  this.state.currentTemperature = temperature
	}
      }
      if (this.state.currentRelativeHumidity) {
	let {humidity} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xBA)).message.data
	if (humidity != undefined) {
	  this.state.currentRelativeHumidity = humidity
	}
	this.historyService.addEntry(
	  {time: Math.round(new Date().valueOf()/1000),
	   //temp: this.state[`currentTemperature0x${0xBB.toString(16)}`],
	   temp: this.state.currentTemperature,
	   humidity: this.state.currentRelativeHumidity})
      } else {
	this.historyService.addEntry(
	  {time: Math.round(new Date().valueOf()/1000),
	   //temp: this.state[`currentTemperature0x${0xBB.toString(16)}`]})
	   temp: this.state.currentTemperature})
      }
      // this.historyService.addEntry(
      // 	{time: Math.round(new Date().valueOf()/1000),
      // 	 currentTemp: this.state[`currentTemperature0x${0xBB.toString(16)}`],
      // 	 setTemp: this.state[`currentTemperature0x${0xB3.toString(16)}`] ||
      // 	 this.state[`currentTemperature0x${0xB5.toString(16)}`] ||
      // 	 this.state[`currentTemperature0x${0xB6.toString(16)}`],
      // 	 valvePosition: 50}
      // )
    } catch (e) {
      log(`Failed in periodic retrieving of CurrentTemperature or CurrentRelativeHumidity. (${e})`)
    }
    
    setTimeout(() => {
      this.updateHistory();
    }, 3 * 60 * 1000);
  }
  // if (this.state.currentRelativeHumidity) {
  //   this.historyService.addEntry(
  //     {time: Math.round(new Date().valueOf()/1000),
  //      temp: this.state[`currentTemperature0x${0xBB.toString(16)}`],
  //      humidity: this.state.currentRelativeHumidity})
  // } else {
  //   this.historyService.addEntry(
  //     {time: Math.round(new Date().valueOf()/1000),
  //      temp: this.state[`currentTemperature0x${0xBB.toString(16)}`]})
  // }
  // setInterval(this.updateHistory.bind(this), 3*60*1000)
  this.updateHistory();
  
//[6/30/2021, 8:08:08 AM] [ELPlatform] last:6696 tid:6696 epc:176
//[6/30/2021, 8:08:08 AM] [ELPlatform] { mode: 1, desc: 'Ž©“®' }
//[6/30/2021, 8:08:40 AM] [ELPlatform] last:6697 tid:6697 epc:128
//[6/30/2021, 8:08:40 AM] [ELPlatform] { status: false }
//[6/30/2021, 8:09:40 AM] [ELPlatform] last:6698 tid:6698 epc:128
//[6/30/2021, 8:09:40 AM] [ELPlatform] { status: true }
//[6/30/2021, 8:11:07 AM] [ELPlatform] last:6701 tid:6701 epc:179
//[6/30/2021, 8:11:07 AM] [ELPlatform] { temperature: 25 }

  const mode2hap = [
    {current:hap.Characteristic.CurrentHeaterCoolerState.INACTIVE,target:undefined},
    {current:hap.Characteristic.CurrentHeaterCoolerState.COOLING, target:hap.Characteristic.TargetHeaterCoolerState.AUTO},
    {current:hap.Characteristic.CurrentHeaterCoolerState.COOLING, target:hap.Characteristic.TargetHeaterCoolerState.COOL},
    {current:hap.Characteristic.CurrentHeaterCoolerState.HEATING, target:hap.Characteristic.TargetHeaterCoolerState.HEAT},
    {current:hap.Characteristic.CurrentHeaterCoolerState.COOLING, target:hap.Characteristic.TargetHeaterCoolerState.COOL},	//Dry
    {current:hap.Characteristic.CurrentHeaterCoolerState.COOLING, target:hap.Characteristic.TargetHeaterCoolerState.COOL}	//Wind
  ];

  let tid = -1, epc
  this.onNotify = async (x) => {
    try {
      if (x['esv'] == 'INF') {
	if (tid < parseInt(x['tid'])) {
	  const s = this.getService(hap.Service.HeaterCooler)
	  tid = parseInt(x['tid'])
	  epc = x['prop'][0]['epc']
	  if (epc == 0x80) {
	    let {status} = x['prop'][0]['edt'];
	    s.getCharacteristic(hap.Characteristic.Active).updateValue(status)
	    this.state.active = status
	    this.log('\'Active\' of ', this.displayName, `has been changed to ${status}.`)
	    //this.historyService.addEntry({time: Math.round(new Date().valueOf()/1000), status: this.state.active ? 1 : 0});

	    if (!status) {
	      const current = hap.Characteristic.CurrentHeaterCoolerState.INACTIVE
	      s.getCharacteristic(hap.Characteristic.CurrentHeaterCoolerState).updateValue(current)
	      this.state.currentHeaterCoolerState = current
	      this.log('\'CurrentHeaterCoolerState\' of ', this.displayName, `is ${current}.`)
	    } else {
	      //await sleep(1000)
	      const {mode} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xB0)).message.data
	      const {target, current} = mode2hap[mode];
	      s.getCharacteristic(hap.Characteristic.TargetHeaterCoolerState).updateValue(target)
	      this.state.targetHeaterCoolerState = target
	      this.log('\'TargetHeaterCoolerState\' of ', this.displayName, `is ${target}.`)
	      s.getCharacteristic(hap.Characteristic.CurrentHeaterCoolerState).updateValue(current)
	      this.state.currentHeaterCoolerState = current
	      this.log('\'CurrentHeaterCoolerState\' of ', this.displayName, `is ${current}.`)
	      
	      //await sleep(1000)
	      let {temperature} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xB3)).message.data
	      if (target == hap.Characteristic.TargetHeaterCoolerState.COOL) {
		temperature = temperature || this.state.targetCoolingThresholdTemperature
		s.getCharacteristic(hap.Characteristic.CoolingThresholdTemperature).updateValue(temperature)
		//this.state.currentTemperature.set(0xB3, temperature)
		//this.state[`currentTemperature0x${0xB3.toString(16)}`] = temperature
		this.state.targetCoolingThresholdTemperature = temperature
		this.log('\'targetCoolingThresholdTemperature\' of ', this.displayName, `is ${temperature}.`)
	      } else if (target == hap.Characteristic.TargetHeaterCoolerState.HEAT) {
		temperature = temperature || this.state.targetHeatingThresholdTemperature
		s.getCharacteristic(hap.Characteristic.HeatingThresholdTemperature).updateValue(temperature)
		//this.state.currentTemperature.set(0xB3, temperature)
		//this.state[`currentTemperature0x${0xB3.toString(16)}`] = temperature
		this.state.targetHeatingThresholdTemperature = temperature
		this.log('\'targetHeatingThresholdTemperature\' of ', this.displayName, `is ${temperature}.`)
	      }
	    }
	  } else if (epc == 0xB0) {
	    const {mode} = x['prop'][0]['edt'];
	    const {target, current} = mode2hap[mode];
	    this.log('\'TargetHeaterCoolerState\' of ', this.displayName, `has been changed to ${mode}.`)
	    s.getCharacteristic(hap.Characteristic.TargetHeaterCoolerState).updateValue(target)
	    this.state.targetHeaterCoolerState = target
	    this.log('\'TargetHeaterCoolerState\' of ', this.displayName, `is ${target}.`)
	    if (this.state.active) {
	      s.getCharacteristic(hap.Characteristic.CurrentHeaterCoolerState).updateValue(current)
	      this.state.currentHeaterCoolerState = current
	      this.log('\'CurrentHeaterCoolerState\' of ', this.displayName, `is ${current}.`)
	    }
	  } else if (epc == 0xB3) {
	    let {temperature} = x['prop'][0]['edt'];
	    this.log('\'ThresholdTemperature\' of ', this.displayName, `has been changed to ${temperature}.`)
	    if (this.state.targetHeaterCoolerState == hap.Characteristic.TargetHeaterCoolerState.COOL) {
	      temperature = temperature || this.state.targetCoolingThresholdTemperature
	      s.getCharacteristic(hap.Characteristic.CoolingThresholdTemperature).updateValue(temperature)
	      //this.state.currentTemperature.set(0xB3, temperature)
	      //this.state[`currentTemperature0x${0xB3.toString(16)}`] = temperature
	      this.state.targetCoolingThresholdTemperature = temperature
	      this.log('\'targetCoolingThresholdTemperature\' of ', this.displayName, `is ${temperature}.`)
	    } else if (this.state.targetHeaterCoolerState == hap.Characteristic.TargetHeaterCoolerState.HEAT) {
	      temperature = temperature || this.state.targetHeatingThresholdTemperature
	      s.getCharacteristic(hap.Characteristic.HeatingThresholdTemperature).updateValue(temperature)
	      //this.state.currentTemperature.set(0xB3, temperature)
	      //this.state[`currentTemperature0x${0xB3.toString(16)}`] = temperature
	      this.state.targetHeatingThresholdTemperature = temperature
	      this.log('\'targetHeatingThresholdTemperature\' of ', this.displayName, `is ${temperature}.`)
	    }
	  }
//	  else {
	    this.log('tid:' + x['tid'] + ' epc:' + x['prop'][0]['epc'])
	    this.log(x['prop'][0]['edt']);
//	  }
	}
      }
    } catch (e) {
      this.log('Updating of ', this.displayName, 'has been failed.')
      this.log(e)
    }
    //this.updateCache()
    //persist.setItemSync(`${this.address}.${this.eoj[0]}.${this.eoj[1]}.${this.eoj[2]}`, this.state)
  };
  
  if(this.propertyMaps.get.find((x) => x == 0xBA)) {
    service.getCharacteristic(hap.Characteristic.CurrentRelativeHumidity)
    .on('get', async function(callback) {
      const c = this.getService(hap.Service.HeaterCooler)
	    .getCharacteristic(hap.Characteristic.CurrentRelativeHumidity)
      this.log.debug('\'Get', this.displayName, 'CurrentRelativeHumidity\' was called.') 
      try {
	if (this.state.currentRelativeHumidity != undefined) {
	  callback(null, this.state.currentRelativeHumidity)
	}
	//await sleep(deviceduration * (this.eoj[2] - 1))
	//await sleep(0)
	const {humidity} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xBA)).message.data
	if (this.state.currentRelativeHumidity != undefined) {
	  c.updateValue(humidity)
	} else {
	  callback(null, humidity)
	  this.log.debug('\'Get', this.displayName, 'CurrentRelativeHumidity\' was called in sequentially.', humidity)
	}
	this.state.currentRelativeHumidity = humidity
	this.log.debug('\'Get', this.displayName, 'CurrentRelativeHumidity\' was completed.', humidity)
      } catch (err) {
	if (this.state.currentRelativeHumidity == undefined) {
	  callback(err)
	} 
	this.log('\'Get', this.displayName, 'CurrentRelativeHumidity\' was failed. Keep', this.state.currentRelativeHumidity)
	this.log(err)
      }
    }.bind(this))
  }

  service.getCharacteristic(hap.Characteristic.Active)
  .on('set', async function(value, callback) {
    this.log.debug('\'Set', this.displayName, 'Active\' was called.') 
    try {
      await EL(el.setPropertyValue, this.address, this.eoj, 0x80, {status: value != 0})
      this.log('\'Set', this.displayName, 'Active\' was completed.')
      this.state.active = value;
      callback()
    } catch (err) {
      this.log('\'Set', this.displayName, 'Active\' was failed.', err)
      callback(err)
    }
  }.bind(this))
  .on('get', async function(callback) {
    const c = this.getService(hap.Service.HeaterCooler)
	  .getCharacteristic(hap.Characteristic.Active)
    this.log.debug('\'Get', this.displayName, 'Active\' was called.') 
    try {
      if (this.state.active != undefined) {
	callback(null, this.state.active)
      }
      //await sleep(deviceduration * (this.eoj[2] - 1))
      //await sleep(0)
      const {status} = (await EL(el.getPropertyValue, this.address, this.eoj, 0x80)).message.data
      if (this.state.active != undefined) {
	c.updateValue(status)
      } else {
	callback(null, status)
	this.log.debug('\'Get', this.displayName, 'Active\' was called in sequentially.', status)
      }
      this.state.active = status
      this.log.debug('\'Get', this.displayName, 'Active\' was completed.', status)
    } catch (err) {
      if (this.state.active == undefined) {
	callback(err)
      } 
      this.log('\'Get', this.displayName, 'Active\' was failed. Keep', this.state.active)
      this.log(err)
    }
    //this.updateCache()
    //persist.setItemSync(`${this.address}.${this.eoj[0]}.${this.eoj[1]}.${this.eoj[2]}`, this.state)
    
    //this.historyService.addEntry({time: Math.round(new Date().valueOf()/1000), status: this.state.active ? 1 : 0});
  }.bind(this))

  service.getCharacteristic(hap.Characteristic.CurrentHeaterCoolerState)
  .on('get', async function(callback) {
    let current
    const c = this.getService(hap.Service.HeaterCooler)
	  .getCharacteristic(hap.Characteristic.CurrentHeaterCoolerState)
    this.log.debug('\'Get', this.displayName, 'CurrentHeaterCoolerState\' was called.') 
    try {
      if (this.state.currentHeaterCoolerState != undefined) {
	callback(null, this.state.currentHeaterCoolerState)
      }
      //await sleep(deviceduration * (this.eoj[2] - 1))
      //await sleep(1000)
      const {status} = (await EL(el.getPropertyValue, this.address, this.eoj, 0x80)).message.data
      if (!status) {
	current = hap.Characteristic.CurrentHeaterCoolerState.INACTIVE
      } else {
//	await sleep(1000)
//	const {compressor} = (await el.getPropertyValue(this.address, this.eoj, 0xCD)).message.data
//	if (!compressor) {
//	  current = hap.Characteristic.CurrentHeaterCoolerState.IDLE
//	} else {
	  //await sleep(1000)
	  const {mode} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xB0)).message.data
	  current = mode2hap[mode].current
//	}
      }
      if (this.state.currentHeaterCoolerState != undefined) {
	c.updateValue(current)
      } else {
	callback(null, current)
	this.log.debug('\'Get', this.displayName, 'CurrentHeaterCoolerState\' was called in sequentially.', current)
      }
      this.state.currentHeaterCoolerState = current
      this.log.debug('\'Get', this.displayName, 'CurrentHeaterCoolerState\' was completed.', current)
    } catch (err) {
      current = hap.Characteristic.CurrentHeaterCoolerState.IDLE
      this.state.currentHeaterCoolerState = current
      if (this.state.currentHeaterCoolerState == undefined) {
	callback(null, current)
      }
      this.log('\'Get', this.displayName, 'CurrentHeaterCoolerState\' was failed. Keep', this.state.currentHeaterCoolerState)
      this.log(err)
    }
  }.bind(this))

  service.getCharacteristic(hap.Characteristic.TargetHeaterCoolerState)
  .on('set', async function(value, callback) {
    this.log.debug('\'Set', this.displayName, `TargetHeaterCoolerState(${value})\' was called.`) 
    try {
//    if (value !== hap.Characteristic.TargetHeaterCoolerState.OFF) {
        let mode = 1
        if (value === hap.Characteristic.TargetHeaterCoolerState.COOL)
          mode = 2
        else if (value === hap.Characteristic.TargetHeaterCoolerState.HEAT)
          mode = 3
        await EL(el.setPropertyValue, this.address, this.eoj, 0xB0, {mode: mode})
//    } else {
//      await EL(el.setPropertyValue, this.address, this.eoj, 0x80, {status: false})
//    }
      this.state.targetHeaterCoolerState = value
      this.log('\'Set', this.displayName, `TargetHeaterCoolerState(${value})\' was completed.`) 
      callback()
    } catch (err) {
      this.log('\'Set', this.displayName, `TargetHeaterCoolerState(${value})\' was failed. ${err}`) 
      callback(err)
    }
  }.bind(this))
  .on('get', async function(callback) {
    const c = this.getService(hap.Service.HeaterCooler)
	  .getCharacteristic(hap.Characteristic.TargetHeaterCoolerState)
    this.log.debug('\'Get', this.displayName, 'TargetHeaterCoolerState\' was called.') 
    try {
      if (this.state.targetHeaterCoolerState != undefined) {
	callback(null, this.state.targetHeaterCoolerState)
      }
      let state = hap.Characteristic.TargetHeaterCoolerState.AUTO
      //await sleep(deviceduration * (this.eoj[2] - 1))
      //await sleep(3000)
      const {status} = (await EL(el.getPropertyValue, this.address, this.eoj, 0x80)).message.data
      const {mode} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xB0)).message.data
      this.log.debug('\'Get', this.displayName, 'TargetHeaterCoolerState\' of device reply is', '(status:',status,',mode:',mode,')') 
//    if (status) {
	//await sleep(1000)
        //const {mode} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xB0)).message.data
	state = mode2hap[mode].target
//    }
//    else {
//      state = hap.Characteristic.TargetHeaterCoolerState.OFF
//    }
      if (this.state.targetHeaterCoolerState != undefined) {
	c.updateValue(state)
      } else {
	callback(null, state)
	this.log.debug('\'Get', this.displayName, 'TargetHeaterCoolerState\' was called in sequentially.', state)
      }
      this.state.targetHeaterCoolerState = state
      this.log.debug('\'Get', this.displayName, 'TargetHeaterCoolerState\' was completed.', state)
    } catch (err) {
      if (this.state.targetHeaterCoolerState == undefined) {
	callback(err)
      }
      this.log('\'Get', this.displayName, 'TargetHeaterCoolerState\' was failed. Keep', this.state.targetHeaterCoolerState)
      this.log(err)
    }
  }.bind(this))

  const CurrentTemperature = 0;
  const CoolingThresholdTemperature = 1;
  const HeatingThresholdTemperature = 2;
  const hap2edt = [
    {target: hap.Characteristic.CurrentTemperature,
     mode: null,
     state: 'currentTemperature',
     edt0: 0xBB,
     initial: 25,
     ms: 5000},
    {target: hap.Characteristic.CoolingThresholdTemperature,
     mode: hap.Characteristic.TargetHeaterCoolerState.COOL,
     state: 'targetCoolingThresholdTemperature',
     edt0: 0xB5,
     initial: 30,
     ms: 6000},
    {target: hap.Characteristic.HeatingThresholdTemperature,
     mode: hap.Characteristic.TargetHeaterCoolerState.HEAT,
     state: 'targetHeatingThresholdTemperature',
     edt0: 0xB6,
     initial: 16,
     ms: 7000}
  ];

  const temperatureSetter = async function(type, value, callback) {
    const {edt0, state} = hap2edt[type];
    const edt1 = this.propertyMaps.get.find((x) => x == edt0) ? edt0 : 0xB3;

    this.log('\'Set', this.displayName, `${state}(${value})\' was called.`) 
    try {
      await EL(el.setPropertyValue, this.address, this.eoj, edt1, {temperature: parseInt(value)})
      this.log('\'Set', this.displayName, `$state(${value})\' was completed.`) 
      //this.state[`currentTemperature0x${edt1.toString(16)}`] = value;
      this.state[state] = value;
      callback()
    } catch (err) {
      this.log('\'Set', this.displayName, `${state}(${value})\' was failed. ${err}`) 
      callback(err)
    }
  }
  const temperatureGetter = async function(type, callback) {
    const {target, mode, state, edt0, initial, ms} = hap2edt[type];
    const edt1 = (edt0 == 0xBB ? 0xBB : (this.propertyMaps.get.find((x) => x == edt0) ? edt0 : 0xB3));
    const c = this.getService(hap.Service.HeaterCooler).getCharacteristic(target)
    this.log.debug('\'Get', this.displayName, `${state}\' was called.`)
    // if (!this.state.currentTemperature) {
    //   this.state.currentTemperature = new Map
    // }
    try {
      //if (this.state.currentTemperature.has(edt1)) {
      //if (this.state[`currentTemperature0x${edt1.toString(16)}`]) {
      if (this.state[state]) {
	//callback(null, this.state.currentTemperature.get(edt1))
	//callback(null, this.state[`currentTemperature0x${edt1.toString(16)}`])
	callback(null, this.state[state])
      }
      //await sleep(deviceduration * (this.eoj[2] - 1))
      //await sleep(ms)
      let {temperature} = (await EL(el.getPropertyValue, this.address, this.eoj, edt1)).message.data
      this.log.debug('\'Get', this.displayName, `${state}\' of device reply is`, temperature)
      //if (temperature == null && this.state.currentTemperature.has(0xBB)) {
      //if (temperature == null && this.state[`currentTemperature0x${0xBB.toString(16)}`]) {
	//temperature = this.state.currentTemperature.get(0xBB)
	//temperature = this.state[`currentTemperature0x${0xBB.toString(16)}`]
      // if (temperature == null) {
      // 	temperature = initial;
      // }
      //temperature = temperature || this.state[`currentTemperature0x${edt1.toString(16)}`] || initial;
      if (mode) {
	//console.log('mode=', mode, 'state=', this.state.targetHeaterCoolerState);
	if (mode == this.state.targetHeaterCoolerState) {
	  temperature = temperature || this.state[state] || initial;
	} else {
	  temperature = this.state[state] || initial;
	}
      }
      //if (this.state.currentTemperature.has(edt1)) {
      //if (this.state[`currentTemperature0x${edt1.toString(16)}`]) {
      if (this.state[state]) {
	//if (temperature != null) characteristic.updateValue(temperature)
	c.updateValue(temperature)
      } else {
	callback(null, temperature)
	this.log.debug('\'Get', this.displayName, `${state}\' of callback was called in sequentially.`, temperature)
      }
      //if (temperature != null) this.state.currentTemperature.set(edt1, temperature)
      //if (temperature != null) this.state[`currentTemperature0x${edt1.toString(16)}`] = temperature
      //this.state[`currentTemperature0x${edt1.toString(16)}`] = temperature
      this.state[state] = temperature
      this.log.debug('\'Get', this.displayName, `${state}\' was completed.`, temperature)
    } catch (err) {
      // Some air conditioners do not have temperature sensor, reporting error
      // would make the accessory stop working.
      //console.log(err)
      //if (!this.state.currentTemperature.has(edt1)) {
      //if (!this.state[`currentTemperature0x${edt1.toString(16)}`]) {
      if (!this.state[state]) {
	callback(null, initial)
	//this.state.currentTemperature.set(edt1, initial)
	//this.state[`currentTemperature0x${edt1.toString(16)}`] = initial
	this.state[state] = initial
      }
      //this.log('\'Get', this.displayName, edt0 == 0xBB ? 'currentTemperture' : 'thresholdTemperature', 'was failed. Keep', this.state.currentTemperature.get(edt0))
      this.log('\'Get', this.displayName, `${state}\' was failed. Keep`, this.state[state])
      this.log(err)
    }
  }

  service.getCharacteristic(hap.Characteristic.CurrentTemperature)
    .setProps({minValue: -127, maxValue: 125, minStep: 1})
    .on('get', temperatureGetter.bind(this, CurrentTemperature))
  service.getCharacteristic(hap.Characteristic.CoolingThresholdTemperature)
    .setProps({minValue: 16, maxValue: 30, minStep: 1})
    .on('set', temperatureSetter.bind(this, CoolingThresholdTemperature))
    .on('get', temperatureGetter.bind(this, CoolingThresholdTemperature))
  service.getCharacteristic(hap.Characteristic.HeatingThresholdTemperature)
    .setProps({minValue: 16, maxValue: 30, minStep: 1})
    .on('set', temperatureSetter.bind(this, HeatingThresholdTemperature))
    .on('get', temperatureGetter.bind(this, HeatingThresholdTemperature))
}
