// -*- js-indent-level : 2 -*-
const path = require('path')
const fs = require('fs')
let persist
let FakeGatoHistoryService

module.exports = async function(platform, accessory, el, address, eoj) {
  const log = platform.log
  const api = platform.api
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
    
  this.log('Aair-conditioner %s was found under controller #%d', id, el.ix)
  this.log('HeaterCooler service is used for %s.', id)
  this.log(`propertyMaps(${id}):`, this.propertyMaps)

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
    set: async function(target, key, value) {
      if (target[key] != value) {
	target[key] = value
	persist.setItemSync(id, target)
	if (key == 'targetCoolingThresholdTemperature') {
	  await this.mqttpublish('targetCoolingThresholdTemperature', value)
	} else if (key == 'targetHeatingThresholdTemperature') {
	  await this.mqttpublish('targetHeatingThresholdTemperature', value)
	} else if (key == 'currentHeaterCoolerState') {
	  const mode = mqttmode[value]
	  await this.mqttpublish('mode', mode)
	  if (mode === 'heat') {
	    await this.mqttpublish('targetHeatingThresholdTemperature', this.state.targetHeatingThresholdTemperature)
	  } else if (mode === 'cool') {
	    await this.mqttpublish('targetCoolingThresholdTemperature', this.state.targetCoolingThresholdTemperature)
	  }
	}
      }
      return true
    }.bind(this)
  })

  const mqttmode = ['off', 'off', 'heat', 'cool']
  this.mqttpublish = async function(topic, message) {
    if (platform.mqttclient) {
      try {
	let address = this.address;
	let eoj = this.eoj;
	await platform.mqttclient.publish(`${address}/${eoj[0]}:${eoj[1]}:${eoj[2]}/${topic}`, `${message}`)
	this.log.debug(`${this.displayName}: MQTT publish(topic:${address}/${eoj[0]}:${eoj[1]}:${eoj[2]}/${topic}, message:${message})`)
      } catch (e) {
	this.log(`${this.displayName}: Failed to publish MQTT message. ${e}`)
      }
    }
  }

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
      } catch (e) {
	log.debug(`Retrying #${i+1} due to error response(${e}). ${func.name}(${JSON.stringify(args)})`)
      }
      //console.trace()
    }
    throw(`Retrying exceeds maximum attempts. ${func.name}(${JSON.stringify(args)})`)
  }

  {
    let {temperature} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xBB)).message.data
    if (temperature) {
      this.state.currentTemperature = temperature
      this.log('currentTemerature:', this.state.currentTemperature, `(${id})`)
    }
  }

  if(this.propertyMaps.get.find((x) => x == 0xBA)) {
    let {humidity} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xBA)).message.data
    if (humidity) {
      this.state.currentRelativeHumidity = humidity
      this.log('currentRelativeHumidity:', this.state.currentRelativeHumidity, `(${id})`)
    }
  }
  //else {
  //  this.state.currentRelativeHumidity = -1
  //}

  if (!FakeGatoHistoryService) {
    FakeGatoHistoryService = require('fakegato-history')(api)
  }
  this.historyService = new FakeGatoHistoryService('room', this, {storage: 'fs'});
  //this.historyService = new FakeGatoHistoryService('thermo', this, {storage: 'fs'});
  this.services.push(this.historyService)
  this.updateHistory = async function () {
    try {
      if (this.state.currentTemperature) {
	let {temperature} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xBB)).message.data
	if (temperature != undefined) {
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
	   temp: this.state.currentTemperature,
	   humidity: this.state.currentRelativeHumidity})
	await this.mqttpublish('temperature', this.state.currentTemperature)
	await this.mqttpublish('humidity', this.state.currentRelativeHumidity)
      } else {
	this.historyService.addEntry(
	  {time: Math.round(new Date().valueOf()/1000),
	   temp: this.state.currentTemperature})
	await this.mqttpublish('temperature', this.state.currentTemperature)
      }
    } catch (e) {
      log(`Failed in periodic retrieving of CurrentTemperature or CurrentRelativeHumidity. (${e})`)
    }
    
    setTimeout(() => {
      this.updateHistory();
    }, 3 * 60 * 1000);
  }
  this.updateHistory();
  
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
	      const {mode} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xB0)).message.data
	      const {target, current} = mode2hap[mode];
	      s.getCharacteristic(hap.Characteristic.TargetHeaterCoolerState).updateValue(target)
	      this.state.targetHeaterCoolerState = target
	      this.log('\'TargetHeaterCoolerState\' of ', this.displayName, `is ${target}.`)
	      s.getCharacteristic(hap.Characteristic.CurrentHeaterCoolerState).updateValue(current)
	      this.state.currentHeaterCoolerState = current
	      this.log('\'CurrentHeaterCoolerState\' of ', this.displayName, `is ${current}.`)
	      
	      let {temperature} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xB3)).message.data
	      if (target == hap.Characteristic.TargetHeaterCoolerState.COOL) {
		temperature = temperature || this.state.targetCoolingThresholdTemperature
		s.getCharacteristic(hap.Characteristic.CoolingThresholdTemperature).updateValue(temperature)
		this.state.targetCoolingThresholdTemperature = temperature
		this.log('\'targetCoolingThresholdTemperature\' of ', this.displayName, `is ${temperature}.`)
	      } else if (target == hap.Characteristic.TargetHeaterCoolerState.HEAT) {
		temperature = temperature || this.state.targetHeatingThresholdTemperature
		s.getCharacteristic(hap.Characteristic.HeatingThresholdTemperature).updateValue(temperature)
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
	      this.state.targetCoolingThresholdTemperature = temperature
	      this.log('\'targetCoolingThresholdTemperature\' of ', this.displayName, `is ${temperature}.`)
	    } else if (this.state.targetHeaterCoolerState == hap.Characteristic.TargetHeaterCoolerState.HEAT) {
	      temperature = temperature || this.state.targetHeatingThresholdTemperature
	      s.getCharacteristic(hap.Characteristic.HeatingThresholdTemperature).updateValue(temperature)
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
      const {status} = (await EL(el.getPropertyValue, this.address, this.eoj, 0x80)).message.data
      if (!status) {
	current = hap.Characteristic.CurrentHeaterCoolerState.INACTIVE
      } else {
//	const {compressor} = (await el.getPropertyValue(this.address, this.eoj, 0xCD)).message.data
//	if (!compressor) {
//	  current = hap.Characteristic.CurrentHeaterCoolerState.IDLE
//	} else {
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
      const {status} = (await EL(el.getPropertyValue, this.address, this.eoj, 0x80)).message.data
      const {mode} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xB0)).message.data
      this.log.debug('\'Get', this.displayName, 'TargetHeaterCoolerState\' of device reply is', '(status:',status,',mode:',mode,')') 
//    if (status) {
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
    try {
      if (this.state[state]) {
	callback(null, this.state[state])
      }
      let {temperature} = (await EL(el.getPropertyValue, this.address, this.eoj, edt1)).message.data
      this.log.debug('\'Get', this.displayName, `${state}\' of device reply is`, temperature)
      if (mode) {
	//console.log('mode=', mode, 'state=', this.state.targetHeaterCoolerState);
	if (mode == this.state.targetHeaterCoolerState) {
	  temperature = temperature || this.state[state] || initial;
	} else {
	  temperature = this.state[state] || initial;
	}
      }
      if (this.state[state]) {
	//if (temperature != null) characteristic.updateValue(temperature)
	c.updateValue(temperature)
      } else {
	callback(null, temperature)
	this.log.debug('\'Get', this.displayName, `${state}\' of callback was called in sequentially.`, temperature)
      }
      this.state[state] = temperature
      this.log.debug('\'Get', this.displayName, `${state}\' was completed.`, temperature)
    } catch (err) {
      // Some air conditioners do not have temperature sensor, reporting error
      // would make the accessory stop working.
      //console.log(err)
      if (!this.state[state]) {
	callback(null, initial)
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
