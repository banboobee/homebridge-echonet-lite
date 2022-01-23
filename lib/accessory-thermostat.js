// -*- js-indent-level : 2 -*-

const path = require('path')
const fs = require('fs')
//const homebridgeLib = require('/usr/local/lib/node_modules/homebridge-lib')
let persist
let FakeGatoHistoryService
// let eve

module.exports = async function(log, api, accessory, el, address, eoj) {
  const hap = api.hap
  const service = this.getService(hap.Service.Thermostat) ||
                  this.addService(hap.Service.Thermostat)
  const id = `${address}.${eoj[0]}.${eoj[1]}.${eoj[2]}`
  const ELmaxRetry = 5
  this.propertyMaps = (await EL(el.getPropertyMaps, address, eoj)).message.data
  this.log = log
  this.address = address
  this.eoj = eoj
  this.el = el
  this.services.push(service)
  this.log('Found Aircon %s under controller %d', id, el.ix)
  this.log(`propertyMaps(${id}):`, this.propertyMaps)

  if (!FakeGatoHistoryService) {
    FakeGatoHistoryService = require('fakegato-history')(api)
  }
  // if (!eve) {
  //   eve = new homebridgeLib.EveHomeKitTypes(api)
  // }
  this.historyService = new FakeGatoHistoryService('custom', this, {storage: 'fs'});
  this.services.push(this.historyService)

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
    set: function(target, key, value) {
      if (target[key] != value) {
	target[key] = value
	persist.setItemSync(id, target)
	if (this.historyService) {
	  if (key == `currentTemperature0x${0xB3.toString(16)}`) {
	    this.log.debug(`adding history of currentTemperature0x${0xB3.toString(16)}.`, value, id)
	    this.historyService.addEntry(
	      {time: Math.round(new Date().valueOf()/1000), setTemp: value || 30})
	  } else if (key == 'targetHeatingCoolingState') {
	    this.log.debug(`adding history of targetHeatingCoolingState.`, value * 25, id)
	    this.historyService.addEntry(
	      {time: Math.round(new Date().valueOf()/1000),
	       valvePosition: value * 25})
	  }
	}
      }
      return true
    }.bind(this)
  })

  this.getServices = () => {
    this.log('getServices() is requested.')
    return this.services
  }

  async function EL(func, ...args) {
    let x
    for (let i = 0; i < ELmaxRetry; i++) {
      try {
	x = await func.apply(el, args)
	if (x && x.message && x.message.esv &&
	    (x.message.esv === 'Get_Res' || x.message.esv === 'Set_Res')) {
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
    }
    throw(`Retrying exceeds maximum attempts. ${func.name}(${JSON.stringify(args)})`)
  }
  {
    let {temperature} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xBB)).message.data
    if (temperature) {
      this.state[`currentTemperature0x${0xBB.toString(16)}`] = temperature
      this.log('currentTemerature:', this.state[`currentTemperature0x${0xBB.toString(16)}`], `(${id})`)
    }
  }

  if(this.propertyMaps.get.find((x) => x == 0xBA)) {
    let {humidity} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xBA)).message.data
    if (humidity) {
      this.state.currentRelativeHumidity = humidity
      this.log('currentRelativeHumidity:', this.state.currentRelativeHumidity, `(${id})`)
    }
  }
  
  this.updateHistory3m = async function () {
    try {
      if (this.state[`currentTemperature0x${0xBB.toString(16)}`]) {
	let {temperature} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xBB)).message.data
	if (temperature != undefined) {
	  this.state[`currentTemperature0x${0xBB.toString(16)}`] = temperature
	}
      }
      if (this.state.currentRelativeHumidity) {
	let {humidity} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xBA)).message.data
	if (humidity != undefined) {
	  this.state.currentRelativeHumidity = humidity
	}
	this.historyService.addEntry(
	  {time: Math.round(new Date().valueOf()/1000),
	   temp: this.state[`currentTemperature0x${0xBB.toString(16)}`],
	   humidity: this.state.currentRelativeHumidity})
      } else {
	this.historyService.addEntry(
	  {time: Math.round(new Date().valueOf()/1000),
	   temp: this.state[`currentTemperature0x${0xBB.toString(16)}`]})
      }
    } catch (e) {
      log(`Failed in periodic retrieving of CurrentTemperature or CurrentRelativeHumidity. (${e})`)
    }
    
    setTimeout(() => {
      this.updateHistory3m();
    }, 3 * 60 * 1000);
  }
  this.updateHistory10m = async function () {
    this.historyService.addEntry(
      {time: Math.round(new Date().valueOf()/1000),
       setTemp: this.state[`currentTemperature0x${0xB3.toString(16)}`] || 30,
       valvePosition: this.state.targetHeatingCoolingState * 25})
    
    setTimeout(() => {
      this.updateHistory10m();
    }, 10 * 60 * 1000);
  }
  this.updateHistory3m();
  this.updateHistory10m();
  
  let tid = -1, epc
  this.onNotify = async (x) => {
    try {
      if (x['esv'] == 'INF') {
	if (tid < parseInt(x['tid'])) {
	  const s = this.getService(hap.Service.Thermostat)
	  tid = parseInt(x['tid'])
	  epc = x['prop'][0]['epc']
	  if (epc == 0x80) {
	    let {status} = x['prop'][0]['edt'];
	    this.log('\'Active\' of ', this.displayName, `has been changed to ${status}.`)
	    if (!status) {
	      let mode, c
	      mode = hap.Characteristic.TargetHeatingCoolingState.OFF
	      c = s.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState)
	      c.updateValue(mode)
	      this.state.targetHeatingCoolingState = mode
	      this.log('\'TargetHeatingCoolingState\' of ', this.displayName, `is ${mode}.`)
	      mode = hap.Characteristic.CurrentHeatingCoolingState.OFF
	      c = s.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState)
	      c.updateValue(mode)
	      this.state.currentHeatingCoolingState = mode
	      this.log('\'CurrentHeatingCoolingState\' of ', this.displayName, `is ${mode}.`)
	    } else {
	      let c, state
	      let {mode} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xB0)).message.data
	      state = mode === 1 ? hap.Characteristic.TargetHeatingCoolingState.AUTO : 
		(mode == 3 ? hap.Characteristic.TargetHeatingCoolingState.HEAT :
		 hap.Characteristic.TargetHeatingCoolingState.COOL)
	      c = s.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState)
	      c.updateValue(state)
	      this.state.targetHeatingCoolingState = state
	      this.log('\'TargetHeatingCoolingState\' of ', this.displayName, `is ${state}.`)
	      state = mode === 3 ? hap.Characteristic.CurrentHeatingCoolingState.HEAT :
		hap.Characteristic.CurrentHeatingCoolingState.COOL
	      c = s.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState)
	      c.updateValue(state)
	      this.state.currentHeatingCoolingState = state
	      this.log('\'CurrentHeatingCoolingState\' of ', this.displayName, `is ${state}.`)

	      let {temperature} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xB3)).message.data
	      if (temperature) {
		c = s.getCharacteristic(hap.Characteristic.TargetTemperature)
		c.updateValue(temperature)
		this.state[`currentTemperature0x${0xB3.toString(16)}`] = temperature
	      }
	      this.log('\'ThresholdTemperature\' of ', this.displayName, `is ${temperature}.`)
	    }
	  } else if (epc == 0xB0) {
	    let c, state
	    let {mode} = x['prop'][0]['edt'];
	    this.log('\'TargetHeatingCoolingState\' of ', this.displayName, `has been changed to ${mode}.`)
	    state = mode === 1 ? hap.Characteristic.TargetHeatingCoolingState.AUTO : 
	      (mode == 3 ? hap.Characteristic.TargetHeatingCoolingState.HEAT :
	       hap.Characteristic.TargetHeatingCoolingState.COOL)
	    c = s.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState)
	    c.updateValue(state)
	    this.state.targetHeatingCoolingState = state
	    this.log('\'TargetHeatingCoolingState\' of ', this.displayName, `is ${state}.`)
	    state = mode === 3 ? hap.Characteristic.CurrentHeatingCoolingState.HEAT :
	      hap.Characteristic.CurrentHeatingCoolingState.COOL
	    c = s.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState)
	    c.updateValue(state)
	    this.state.currentHeatingCoolingState = state
	    this.log('\'CurrentHeatingCoolingState\' of ', this.displayName, `is ${state}.`)
	  } else if (epc == 0xB3) {
	    const c = s.getCharacteristic(hap.Characteristic.TargetTemperature)
	    let {temperature} = x['prop'][0]['edt'];
	    this.log('\'ThresholdTemperature\' of ', this.displayName, `has been changed to ${temperature}.`)
	    if (temperature) {
	      c.updateValue(temperature)
	      this.state[`currentTemperature0x${0xB3.toString(16)}`] = temperature
	    }
	    this.log('\'ThresholdTemperature\' of ', this.displayName, `is ${temperature}.`)
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
  };
  
  if(this.propertyMaps.get.find((x) => x == 0xBA)) {
    service.getCharacteristic(hap.Characteristic.CurrentRelativeHumidity)
    .on('get', async function(callback) {
      const c = this.getService(hap.Service.Thermostat)
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

  service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState)
  .on('get', async function(callback) {
    let x
    const c = this.getService(hap.Service.Thermostat)
	  .getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState)
    this.log.debug('\'Get', this.displayName, 'CurrentHeatingCoolingState\' was called.') 
    try {
      if (this.state.currentHeatingCoolingState != undefined) {
	callback(null, this.state.currentHeatingCoolingState)
      }
      const {status} = (await EL(el.getPropertyValue, this.address, this.eoj, 0x80)).message.data
      if (!status) {
	x = hap.Characteristic.CurrentHeatingCoolingState.OFF
      } else {
	const {mode} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xB0)).message.data
	x = mode === 3
	  ? hap.Characteristic.CurrentHeatingCoolingState.HEAT
	  : hap.Characteristic.CurrentHeatingCoolingState.COOL
      }
      if (this.state.currentHeatingCoolingState != undefined) {
	c.updateValue(x)
      } else {
	callback(null, x)
	this.log.debug('\'Get', this.displayName, 'CurrentHeatingCoolingState\' was called in sequentially.', x)
      }
      this.state.currentHeatingCoolingState = x
      this.log.debug('\'Get', this.displayName, 'CurrentHeatingCoolingState\' was completed.', x)
    } catch (err) {
      x = hap.Characteristic.CurrentHeatingCoolingState.OFF
      this.state.currentHeatingCoolingState = x
      if (this.state.currentHeatingCoolingState == undefined) {
	callback(null, x)
      }
      this.log('\'Get', this.displayName, 'CurrentHeatingCoolingState\' was failed. Keep', this.state.currentHeatingCoolingState)
      this.log(err)
    }
  }.bind(this))

  service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState)
  .on('set', async function(value, callback) {
    this.log.debug('\'Set', this.displayName, `TargetHeatingCoolingState(${value})\' was called.`) 
    try {
      if (value !== hap.Characteristic.TargetHeatingCoolingState.OFF) {
	await EL(el.setPropertyValue, this.address, this.eoj, 0x80, {status: value != 0})
        let mode = 1
        if (value === hap.Characteristic.TargetHeatingCoolingState.COOL)
          mode = 2
        else if (value === hap.Characteristic.TargetHeatingCoolingState.HEAT)
          mode = 3
        await EL(el.setPropertyValue, this.address, this.eoj, 0xB0, {mode: mode})
      } else {
        await EL(el.setPropertyValue, this.address, this.eoj, 0x80, {status: false})
      }
      this.state.targetHeatingCoolingState = value
      this.log.debug('\'Set', this.displayName, `TargetHeatingCoolingState(${value})\' was completed.`) 
      callback()
    } catch (err) {
      this.log('\'Set', this.displayName, `TargetHeatingCoolingState(${value})\' was failed. ${err}`) 
      callback(err)
    }
  }.bind(this))
  .on('get', async function(callback) {
    const c = this.getService(hap.Service.Thermostat)
	  .getCharacteristic(hap.Characteristic.TargetHeatingCoolingState)
    this.log.debug('\'Get', this.displayName, 'TargetHeatingCoolingState\' was called.') 
    try {
      if (this.state.targetHeatingCoolingState != undefined) {
	callback(null, this.state.targetHeatingCoolingState)
      }
      let state = hap.Characteristic.TargetHeatingCoolingState.AUTO
      const {status} = (await EL(el.getPropertyValue, this.address, this.eoj, 0x80)).message.data
      if (status) {
        const {mode} = (await EL(el.getPropertyValue, this.address, this.eoj, 0xB0)).message.data
        if (mode === 1)
	  state = hap.Characteristic.TargetHeatingCoolingState.AUTO
        else if (mode === 3)
	  state = hap.Characteristic.TargetHeatingCoolingState.HEAT
        else
	  state = hap.Characteristic.TargetHeatingCoolingState.COOL
      } else {
	state = hap.Characteristic.TargetHeatingCoolingState.OFF
      }
      if (this.state.targetHeatingCoolingState != undefined) {
	c.updateValue(state)
      } else {
	callback(null, state)
	this.log.debug('\'Get', this.displayName, 'TargetHeatingCoolingState\' was called in sequentially.', state)
      }
      this.state.targetHeatingCoolingState = state
      this.log.debug('\'Get', this.displayName, 'TargetHeatingCoolingState\' was completed.', state)
    } catch (err) {
      if (this.state.targetHeatingCoolingState == undefined) {
	callback(err)
      }
      this.log('\'Get', this.displayName, 'TargetHeatingCoolingState\' was failed. Keep', this.state.targetHeatingCoolingState)
      this.log(err)
    }
  }.bind(this))

  const temperatureSetter = async function(edt, value, callback) {
    this.log.debug('\'Set', this.displayName, `thresholdTemperature(${value})\' was called.`) 
    try {
      await EL(el.setPropertyValue, this.address, this.eoj, edt, {temperature: parseInt(value)})
      this.state[`currentTemperature0x${edt.toString(16)}`] = value
      this.log.debug('\'Set', this.displayName, `thresholdTemperature(${value})\' was completed.`) 
      callback()
    } catch (err) {
      this.log('\'Set', this.displayName, `thresholdTemperature(${value})\' was failed. ${err}`) 
      callback(err)
    }
  }
  const temperatureGetter = async function(edt, x, callback) {
    const characteristic = this.getService(hap.Service.Thermostat)
	  .getCharacteristic(edt == 0xBB ?
			     hap.Characteristic.CurrentTemperature :
			     hap.Characteristic.TargetTemperature)
    this.log.debug('\'Get', this.displayName,
		   edt == 0xBB ?
		   'currentTemperture\'(' : 'thresholdTemperature\'(',
		   edt, ') was called.')
    try {
      if (this.state[`currentTemperature0x${edt.toString(16)}`]) {
	callback(null, this.state[`currentTemperature0x${edt.toString(16)}`])
      }
      let {temperature} = (await EL(el.getPropertyValue, this.address, this.eoj, edt)).message.data
      temperature = temperature || this.state[`currentTemperature0x${edt.toString(16)}`] || x
      if (this.state[`currentTemperature0x${edt.toString(16)}`]) {
	characteristic.updateValue(temperature)
      } else {
	callback(null, temperature)
	this.log.debug('\'Get', this.displayName, edt == 0xBB ? 'currentTemperture\'' : 'thresholdTemperature\'(', edt, ') of callback was called in sequentially.', temperature)
      }
      this.state[`currentTemperature0x${edt.toString(16)}`] = temperature
      this.log.debug('\'Get', this.displayName,
		     edt == 0xBB ? 'currentTemperture\'' :
		     'thresholdTemperature\'',
		     'was completed.', temperature)
    } catch (err) {
      // Some air conditioners do not have temperature sensor, reporting error
      // would make the accessory stop working.
      //console.log(err)
      if (!this.state[`currentTemperature0x${edt.toString(16)}`]) {
	callback(null, x)
	this.state[`currentTemperature0x${edt.toString(16)}`] = x
      }
      this.log('\'Get', this.displayName, edt == 0xBB ? 'currentTemperture\'' : 'thresholdTemperature\'', 'was failed. Keep', this.state[`currentTemperature0x${edt.toString(16)}`])
      this.log(err)
    }
  }
  service.getCharacteristic(hap.Characteristic.CurrentTemperature)
    .setProps({minValue: -127, maxValue: 125, minStep: 1})
    .on('get', temperatureGetter.bind(this, 0xBB, 25))
  service.getCharacteristic(hap.Characteristic.TargetTemperature)
    .setProps({minValue: 16, maxValue: 30, minStep: 1})
    .on('set', temperatureSetter.bind(this, 0xB3))
    .on('get', temperatureGetter.bind(this, 0xB3, 30))

  function getValvePosition(callback) {
    // not implemented
    //console.log('getValvePosition() is requested.', this.displayName);
    callback(null, this.state.targetHeatingCoolingState * 25);
  }
  
  function setProgramCommand(value, callback) {
    // not implemented
    //console.log('setProgramCommand() is requested.', value, this.displayName);
    callback();
  }
  
  function getProgramData(callback) {
    // not implemented
    var data  = "ff04f6";
    var buffer = new Buffer.from(('' + data).replace(/[^0-9A-F]/ig, ''), 'hex').toString('base64');
    //console.log('getProgramData() is requested. (%s)', buffer, this.displayName);
    callback(null, buffer);
  }
  
  function localCharacteristic(key, uuid, props) {
    let characteristic = class extends Characteristic {
      constructor() {
	super(key, uuid);
	this.setProps(props);
      }
    }
    characteristic.UUID = uuid;

    return characteristic;
  }

  const ValvePositionCharacteristic = localCharacteristic(
    'ValvePosition', 'E863F12E-079E-48FF-8F27-9C2605A29F52',
    {format: Characteristic.Formats.UINT8,
     unit: Characteristic.Units.PERCENTAGE,
     perms: [
       Characteristic.Perms.READ,
       Characteristic.Perms.NOTIFY
     ]});
  
  const ProgramDataCharacteristic = localCharacteristic(
    'ProgramData', 'E863F12F-079E-48FF-8F27-9C2605A29F52',
    {format: Characteristic.Formats.DATA,
     perms: [
       Characteristic.Perms.READ,
       Characteristic.Perms.NOTIFY
     ]});
  
  const ProgramCommandCharacteristic = localCharacteristic(
    'ProgramCommand', 'E863F12C-079E-48FF-8F27-9C2605A29F52',
    {format: Characteristic.Formats.DATA,
     perms: [
       Characteristic.Perms.WRITE
     ]});
  
  //service.getCharacteristic(eve.Characteristics.ValvePosition)
  //  .on('get', getValvePosition.bind(this))
  // service.getCharacteristic(eve.Characteristics.ProgramCommand)
  //   .on('set', setProgramCommand.bind(this))
  // service.getCharacteristic(eve.Characteristics.ProgramData)
  //   .on('get', getProgramData.bind(this))
  service.getCharacteristic(ValvePositionCharacteristic)
    .on('get', getValvePosition.bind(this))
  service.getCharacteristic(ProgramCommandCharacteristic)
    .on('set', setProgramCommand.bind(this))
  service.getCharacteristic(ProgramDataCharacteristic)
    .on('get', getProgramData.bind(this))
}
