module.exports = async (platform, accessory, el, address, eoj) => {
  const log = platform.log
  const api = platform.api
  const hap = api.hap
  const context = accessory.context
  const service = accessory.getService(hap.Service.Thermostat) ||
                  accessory.addService(hap.Service.Thermostat)
  accessory
    .getService(hap.Service.AccessoryInformation)
    .setCharacteristic(hap.Characteristic.Manufacturer, 'node-echonet-lite')
    .setCharacteristic(hap.Characteristic.Model, await el.getClassName(eoj[0], eoj[1]))
    .setCharacteristic(hap.Characteristic.SerialNumber, hap.uuid.generate(accessory.displayName))

  const ELmaxRetry = 5
  const EL = async (func, ...args) => {
    for (let i = 0; i < ELmaxRetry; i++) {
      try {
	const x = await func.apply(el, args)
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

  const mqttpublish = async (topic, message) => {
    if (platform.mqttclient) {
      try {
	await platform.mqttclient.publish(`homebridge-echonet-lite/${address}/${eoj[0]}:${eoj[1]}:${eoj[2]}/Thermostat/${topic}`, `${message}`)
	log.debug(`${accessory.displayName}: topic:Thermostat/${address}/${eoj[0]}:${eoj[1]}:${eoj[2]}/${topic}, message:${message}`)
      } catch (e) {
	log.error(`${accessory.displayName}: Failed to publish MQTT message. ${e}`)
      }
    }
  }

  context.propertyMaps ??= await new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`timed out to connect echonet-lite protocol.`))
    }, 10*1000)
    el.getPropertyMaps(address, eoj)
      .then((x) => {
	resolve(x.message.data)
      }).catch((e) => {
	reject(e)
      }).finally(() => {
	clearTimeout(timeout)
      })
  }).catch((e) => {
    throw e
  })
  const propertyMaps = context.propertyMaps
  log.debug(`${accessory.displayName}: propertyMaps`, propertyMaps)

  context.CurrentHeatingCoolingState ??= hap.Characteristic.CurrentHeatingCoolingState.OFF
  context.TargetHeatingCoolingState ??= hap.Characteristic.TargetHeatingCoolingState.OFF
  context.CurrentTemperature ??= 25
  context.TargetTemperature ??= 30
  if (propertyMaps.get.find((x) => x === 0xBA)) {
    context.CurrentRelativeHumidity ??= 40
  }
  log.debug(`${accessory.displayName}: context ${JSON.stringify(context, null, 2)}`)

  const ELmode2HKstate = [
    undefined,
    hap.Characteristic.TargetHeatingCoolingState.AUTO,
    hap.Characteristic.TargetHeatingCoolingState.COOL,
    hap.Characteristic.TargetHeatingCoolingState.HEAT,
    hap.Characteristic.TargetHeatingCoolingState.COOL,	//Dry
    hap.Characteristic.TargetHeatingCoolingState.COOL	//Wind
  ]
  let tid = -1
  platform.onNotifyHandler[`${context.address}${context.eoj.toString()}`] ??= []
  platform.onNotifyHandler[`${context.address}${context.eoj.toString()}`].push(async (x) => {
    try {
      if (x['esv'] === 'INF') {
	if (tid < parseInt(x['tid'])) {
	  tid = parseInt(x['tid'])
	  const epc = x['prop'][0]['epc']
	  const edt = x['prop'][0]['edt']
	  log(`${accessory.displayName}: Received epc:0x${epc.toString(16).toUpperCase()}, edt:${JSON.stringify(edt)}, tid:${tid} `)
	  switch (epc) {
	  case 0x80:	// Active
	    const {status} = edt
	    if (!status) {
	      await service.updateCharacteristic(hap.Characteristic.TargetHeatingCoolingState, hap.Characteristic.TargetHeatingCoolingState.OFF)
	      context.TargetHeatingCoolingState = hap.Characteristic.TargetHeatingCoolingState.OFF
	    } else {
	      await syncTargetHeatingCoolingState()
	      await syncTargetTemperature()
	    }
	    await updateCurrentHeatingCoolingState()
	    break
	  case 0xB0:	//Target state 
            const {mode} = edt
	    const target = ELmode2HKstate[mode]
	    await service.updateCharacteristic(hap.Characteristic.TargetHeatingCoolingState, target)
	    context.TargetHeatingCoolingState = target
	    await updateCurrentHeatingCoolingState()
	    break
	  case 0xB3:	//Temperature
	    const {temperature} = edt
	    await service.updateCharacteristic(hap.Characteristic.TargetTemperature, temperature)
	    context.TargetTemperature = temperature
	    break
	  default:
	    log.error(`${accessory.displayName}: Not yet implemented. epc:0x${epc.toString(16).toUpperCase()}.`)
	    break
	  }
	  log(`${accessory.displayName}: Target(${TargetHeatingCoolingState[context.TargetHeatingCoolingState]}), Current(${CurrentHeatingCoolingState[context.CurrentHeatingCoolingState]}), TargetTemperature(${context.TargetTemperature})`)
	}
      }
    } catch (e) {
      log.error(`${accessory.displayName}: Failed on onNotify. ${e}`)
    }
  })

  // public static readonly OFF = 0
  // public static readonly HEAT = 1
  // public static readonly COOL = 2
  const CurrentHeatingCoolingState = ['OFF', 'HEAT', 'COOL']
  service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState)
  .on('get', async (callback) => updateCurrentHeatingCoolingState(callback))
  const updateCurrentHeatingCoolingState = async (callback = null) => {
    try {
      let state
      if (context.TargetHeatingCoolingState === hap.Characteristic.TargetHeatingCoolingState.OFF) {
	state = hap.Characteristic.CurrentHeatingCoolingState.OFF
      } else if (context.TargetHeatingCoolingState === hap.Characteristic.TargetHeatingCoolingState.COOL) {
	state = hap.Characteristic.CurrentHeatingCoolingState.COOL
      } else if (context.TargetHeatingCoolingState === hap.Characteristic.TargetHeatingCoolingState.HEAT) {
	state = hap.Characteristic.CurrentHeatingCoolingState.HEAT
      } else if (context.TargetHeatingCoolingState === hap.Characteristic.TargetHeatingCoolingState.AUTO) {
	if (context.CurrentTemperature > context.TargetTemperature) {
	  state = hap.Characteristic.CurrentHeatingCoolingState.HEAT
	} else {
	  state = hap.Characteristic.CurrentHeatingCoolingState.COOL
	}
      }
      context.CurrentHeatingCoolingState = state
      service.updateCharacteristic(hap.Characteristic.CurrentHeatingCoolingState, state)
      callback?.(null, context.CurrentHeatingCoolingState)
      log.debug(`${accessory.displayName}: CurrentHeatingCoolingState ${CurrentHeatingCoolingState[state]}.`)
    } catch (err) {
      callback?.(err)
      log.error(`${accessory.displayName}: Failed to get CurrentHeatingCoolingState. ${err}`)
    }
  }

  // public static readonly OFF = 0
  // public static readonly HEAT = 1
  // public static readonly COOL = 2
  // public static readonly AUTO = 3
  const TargetHeatingCoolingState = ['OFF', 'HEAT', 'COOL', 'AUTO']
  service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState)
  .on('set', async (value, callback) => {
    try {
      if (value !== hap.Characteristic.TargetHeatingCoolingState.OFF) {
        await EL(el.setPropertyValue, address, eoj, 0x80, {status: true})
        let mode = 1
        if (value === hap.Characteristic.TargetHeatingCoolingState.COOL)
          mode = 2
        else if (value === hap.Characteristic.TargetHeatingCoolingState.HEAT)
          mode = 3
        else if (value === hap.Characteristic.TargetHeatingCoolingState.AUTO)
          mode = 1
        await EL(el.setPropertyValue, address, eoj, 0xB0, {mode})
      } else {
        await EL(el.setPropertyValue, address, eoj, 0x80, {status: false})
      }
      callback()
      context.TargetHeatingCoolingState = value
      log.debug(`${accessory.displayName}: set TargetHeatingCoolingState ${TargetHeatingCoolingState[value]}.`)
    } catch (err) {
      callback(err)
      log.error(`${accessory.displayName}: Failed to set TargetHeatingCoolingState. ${err}`)
    }
  })
  .on('change', async (event) => {
    if (event.newValue !== event.oldValue) {
      await mqttpublish('mode', TargetHeatingCoolingState[event.newValue])
      await mqttpublish('TargetTemperature', context.TargetTemperature)
      valveInterval = 1
      clearTimeout(valveTimer)
      updateValveHistory()
    }
  })
  .on('get', async (callback) => syncTargetHeatingCoolingState(callback))
  const syncTargetHeatingCoolingState = async (callback = null) => {
    try {
      callback?.(null, context.TargetHeatingCoolingState)
      const {status} = (await EL(el.getPropertyValue, address, eoj, 0x80)).message.data
      let state = hap.Characteristic.TargetHeatingCoolingState.COOL
      if (status) {
        const {mode} = (await EL(el.getPropertyValue, address, eoj, 0xB0)).message.data
        if (mode === 1)
          state = hap.Characteristic.TargetHeatingCoolingState.AUTO
        else if (mode === 3)
          state = hap.Characteristic.TargetHeatingCoolingState.HEAT
      } else {
        state = hap.Characteristic.TargetHeatingCoolingState.OFF
      }
      context.TargetHeatingCoolingState = state
      service.updateCharacteristic(hap.Characteristic.TargetHeatingCoolingState, state)
      log.debug(`${accessory.displayName}: TargetHeatingCoolingState ${TargetHeatingCoolingState[state]}.`)
    } catch (err) {
      log.error(`${accessory.displayName}: Failed to get TargetHeatingCoolingState. ${err}`)
    }
  }

  service.getCharacteristic(hap.Characteristic.CurrentTemperature)
  .setProps({minValue: -127, maxValue: 125, minStep: 1})
  .on('get', async (callback) => syncCurrentTemperature(callback))
  const syncCurrentTemperature = async (callback = null) => {
    try {
      callback?.(null, context.CurrentTemperature)
      const {temperature} = (await EL(el.getPropertyValue, address, eoj, 0xBB)).message.data
      context.CurrentTemperature = temperature
      service.updateCharacteristic(hap.Characteristic.CurrentTemperature, temperature)
      log.debug(`${accessory.displayName}: CurrentTemperature ${temperature}.`)
    } catch (err) {
      log.error(`${accessory.displayName}: Failed to get CurrentTemperature. ${err}`)
    }
  }

  let syncCurrentRelativeHumidity = null
  if (propertyMaps.get.find((x) => x === 0xBA)) {
    service.addOptionalCharacteristic(hap.Characteristic.CurrentRelativeHumidity)
    service.getCharacteristic(hap.Characteristic.CurrentRelativeHumidity)
    .on('get', async (callback) => syncCurrentRelativeHumidity(callback))
    syncCurrentRelativeHumidity = async (callback = null) => {
      try {
	callback?.(null, context.CurrentRelativeHumidity)
	const {humidity} = (await EL(el.getPropertyValue, address, eoj, 0xBA)).message.data
	context.CurrentRelativeHumidity = humidity
	service.updateCharacteristic(hap.Characteristic.CurrentRelativeHumidity, humidity)
	log.debug(`${accessory.displayName}: CurrentRelativeHumidity ${humidity}.`)
      } catch (err) {
	log.error(`${accessory.displayName}: Failed to get CurrentRelativeHumidity. ${err}`)
      }
    }
  }

  service.getCharacteristic(hap.Characteristic.TargetTemperature)
  .setProps({minValue: 16, maxValue: 30, minStep: 1})
  .on('set', async (value, callback) => {
    try {
      await EL(el.setPropertyValue, address, eoj, 0xB3, {temperature: parseInt(value)})
      context.TargetTemperature = value
      callback()
      log.debug(`${accessory.displayName}: TargetTemperature ${value}.`)
    } catch (err) {
      log.error(`${accessory.displayName}: Failed to set TargetTemperature. ${err}`)
      callback(err)
    }
  })
  .on('change', async (event) => {
    if (event.newValue !== event.oldValue) {
      const entry = {time: Math.round(new Date().valueOf() / 1000)}
      entry['setTemp'] = event.newValue
      await mqttpublish('TargetTemperature', event.newValue)
      if (historyService) {
	log.debug(`${accessory.displayName}: ${JSON.stringify(entry)}`)
	historyService.addEntry(entry)
      }
    }
  })
  .on('get', async (callback) => syncTargetTemperature(callback))
  const syncTargetTemperature = async (callback = null) => {
    try {
      callback?.(null, context.TargetTemperature)
      const {temperature} = (await EL(el.getPropertyValue, address, eoj, 0xB3)).message.data
      if (temperature) {
	context.TargetTemperature = temperature
	service.updateCharacteristic(hap.Characteristic.TargetTemperature, temperature)
      }
      log.debug(`${accessory.displayName}: TargetTemperature ${temperature}(${context.TargetTemperature}).`)
    } catch (err) {
      log.error(`${accessory.displayName}: Failed to get TargetTemperature. ${err}`)
    }
  }

  let valveInterval = 1
  let valveTimer = null
  const getValvePosition = () => {
    const valve = context.TargetHeatingCoolingState ?
	  (context.CurrentTemperature - context.TargetTemperature)/context.TargetTemperature*100*2 + 50 : 0
    return valve < 0 ? 0 : (valve > 100 ? 100 : valve)
  }
  service.addOptionalCharacteristic(platform.eve.Characteristics.ValvePosition)
  service.getCharacteristic(platform.eve.Characteristics.ValvePosition)
  .onGet(async () => {
      return getValvePosition()
  })
  service.addOptionalCharacteristic(platform.eve.Characteristics.ProgramData)
  service.getCharacteristic(platform.eve.Characteristics.ProgramData)
  .onGet(async () => {
    const data  = "ff04f6"
    var buffer = new Buffer.from(('' + data).replace(/[^0-9A-F]/ig, ''), 'hex').toString('base64')
    return buffer
  })
  service.addOptionalCharacteristic(platform.eve.Characteristics.ProgramCommand)
  service.getCharacteristic(platform.eve.Characteristics.ProgramCommand)
  .onSet(async () => {
    return
  })

  const historyService = platform.fakegatoAPI ? new platform.fakegatoAPI('custom', accessory, {log: log, storage: 'fs'}) : null
  const updateHistory = async () => {
    const entry = {time: Math.round(new Date().valueOf() / 1000)}
    syncCurrentTemperature()
    entry['temp'] = context.CurrentTemperature
    await mqttpublish('temperature', context.CurrentTemperature)
    if (syncCurrentRelativeHumidity) {
      syncCurrentRelativeHumidity()
      entry['humidity'] = context.CurrentRelativeHumidity
      await mqttpublish('humidity', context.CurrentRelativeHumidity)
    }
    if (historyService) {
      log.debug(`${accessory.displayName}: ${JSON.stringify(entry)}`)
      historyService.addEntry(entry)
    }
    setTimeout(() => {
      updateHistory()
    }, 3 * 60 * 1000)
  }
  updateHistory()

  const updateValveHistory = async () => {
    const entry = {time: Math.round(new Date().valueOf() / 1000)}
    entry['setTemp'] = context.TargetTemperature
    entry['valvePosition'] = getValvePosition()
    if (historyService) {
      log.debug(`${accessory.displayName}: ${JSON.stringify(entry)}`)
      historyService.addEntry(entry)
    }
    valveInterval = Math.min(valveInterval * 1/0.7, 10)
    valveTimer = setTimeout(() => {
      updateValveHistory()
    }, Math.round(valveInterval * 60 * 1000));
  }
  updateValveHistory()

  return true
}
