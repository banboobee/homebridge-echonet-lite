module.exports = async (platform, accessory, el, address, eoj) => {
  const log = platform.log
  const api = platform.api
  const hap = api.hap
  const context = accessory.context
  const service = accessory.getService(hap.Service.HeaterCooler) ||
                  accessory.addService(hap.Service.HeaterCooler)
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
	await platform.mqttclient.publish(`homebridge-echonet-lite/${address}/${eoj[0]}:${eoj[1]}:${eoj[2]}/HeaterCooler/${topic}`, `${message}`)
	log.debug(`${accessory.displayName}: topic:HeaterCooler/${address}/${eoj[0]}:${eoj[1]}:${eoj[2]}/${topic}, message:${message}`)
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

  context.Active ??= hap.Characteristic.Active.INACTIVE
  context.CurrentHeaterCoolerState ??= hap.Characteristic.CurrentHeaterCoolerState.INACTIVE
  context.TargetHeaterCoolerState ??= hap.Characteristic.TargetHeaterCoolerState.AUTO
  context.CurrentTemperature ??= 25
  context.CoolingThresholdTemperature ??= 30
  context.HeatingThresholdTemperature ??= 18
  if (propertyMaps.get.find((x) => x === 0xBA)) {
    context.CurrentRelativeHumidity ??= 40
  }
  log.debug(`${accessory.displayName}: context ${JSON.stringify(context, null, 2)}`)

  const ELmode2HKstate = [
    undefined,
    hap.Characteristic.TargetHeaterCoolerState.AUTO,
    hap.Characteristic.TargetHeaterCoolerState.COOL,
    hap.Characteristic.TargetHeaterCoolerState.HEAT,
    hap.Characteristic.TargetHeaterCoolerState.COOL,	//Dry
    hap.Characteristic.TargetHeaterCoolerState.COOL	//Wind
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
	    await service.updateCharacteristic(hap.Characteristic.Active, status)
	    context.Active = status
	    if (context.Active) {
	      await syncTargetHeaterCoolerState()
	      if (context.TargetHeaterCoolerState === hap.Characteristic.TargetHeaterCoolerState.COOL) {
		await syncCoolingThresholdTemperature()
	      } else if (context.TargetHeaterCoolerState === hap.Characteristic.TargetHeaterCoolerState.HEAT) {
		await syncHeatingThresholdTemperature()
	      }
	      await updateCurrentHeaterCoolerState()
	    }
	    break
	  case 0xB0:	//Target state 
            const {mode} = edt
	    const target = ELmode2HKstate[mode]
	    await service.updateCharacteristic(hap.Characteristic.TargetHeaterCoolerState, target)
	    context.TargetHeaterCoolerState = target
	    await updateCurrentHeaterCoolerState()
	    break
	  case 0xB3:	//Temperature
	    const {temperature} = edt
	    if (context.TargetHeaterCoolerState === hap.Characteristic.TargetHeaterCoolerState.COOL) {
	      await service.updateCharacteristic(hap.Characteristic.CoolingThresholdTemperature, temperature)
	      context.CoolingThresholdTemperature = temperature
	    } else if (context.TargetHeaterCoolerState === hap.Characteristic.TargetHeaterCoolerState.HEAT) {
	      await service.updateCharacteristic(hap.Characteristic.HeatingThresholdTemperature, temperature)
	      context.HeatingThresholdTemperature = temperature
	    }
	    break
	  default:
	    log.error(`${accessory.displayName}: Not yet implemented. epc:0x${epc.toString(16).toUpperCase()}.`)
	    break
	  }
	  log(`${accessory.displayName}: Active(${context.Active}), Target(${TargetHeaterCoolerState[context.TargetHeaterCoolerState]}), Current(${CurrentHeaterCoolerState[context.CurrentHeaterCoolerState]}), CoolingThreshold(${context.CoolingThresholdTemperature}), HeatingThreshold(${context.HeatingThresholdTemperature})`)
	}
      }
    } catch (e) {
      log.error(`${accessory.displayName}: Failed on onNotify. ${e}`)
    }
  })

  service.getCharacteristic(hap.Characteristic.Active)
  .on('set', async (value, callback) => {
    try {
      await EL(el.setPropertyValue, address, eoj, 0x80, {status: value != 0})
      context.Active = value
      callback()
      log.debug(`${accessory.displayName}: set Active ${value}.`)
    } catch (err) {
      callback(err)
      log.error(`${accessory.displayName}: Failed to set Active ${value}. ${err}`)
    }
  })
  .on('change', async (event) => {
    if (event.newValue !== event.oldValue) {
      if (event.newValue === hap.Characteristic.Active.INACTIVE) {
	await mqttpublish('mode', 'OFF')
      } else {
	await mqttpublish('mode', TargetHeaterCoolerState[event.newValue])
      }
    }
  })
  .on('get', async (callback = null) => {
    try {
      callback?.(null, context.Active)
      const {status} = (await EL(el.getPropertyValue, address, eoj, 0x80)).message.data
      context.Active = status
      service.updateCharacteristic(hap.Characteristic.Active, status)
      log.debug(`${accessory.displayName}: Active ${status}.`)
    } catch (err) {
      log.error(`${accessory.displayName}: Failed to get Active. ${err}`)
    }
  })

  // public static readonly INACTIVE = 0;
  // public static readonly IDLE = 1;
  // public static readonly HEATING = 2;
  // public static readonly COOLING = 3;
  const CurrentHeaterCoolerState = ['INACTIVE', 'IDLE', 'HEATING', 'COOLING']
  service.getCharacteristic(hap.Characteristic.CurrentHeaterCoolerState)
  .on('get', async (callback) => updateCurrentHeaterCoolerState(callback))
  const updateCurrentHeaterCoolerState = async (callback = null) => {
    try {
      if (!context.Active) {
	state = hap.Characteristic.CurrentHeaterCoolerState.INACTIVE
      } else if (context.TargetHeaterCoolerState === hap.Characteristic.TargetHeaterCoolerState.COOL) {
	state = hap.Characteristic.CurrentHeaterCoolerState.COOLING
      } else if (context.TargetHeaterCoolerState === hap.Characteristic.TargetHeaterCoolerState.HEAT) {
	state = hap.Characteristic.CurrentHeaterCoolerState.HEATING
      } else if (context.TargetHeaterCoolerState === hap.Characteristic.TargetHeaterCoolerState.AUTO) {
	const x = (context.CoolingThresholdTemperature + context.HeatingThresholdTemperature)/2
	if (context.CurrentTemperature < x) {
	  if (context.CurrentTemperature < context.HeatingThresholdTemperature) {
	    state = hap.Characteristic.CurrentHeaterCoolerState.COOLING
	  } else {
	    state = hap.Characteristic.CurrentHeaterCoolerState.HEATING
	  }
	} else {
	  if (context.CurrentTemperature > context.CoolingThresholdTemperature) {
	    state = hap.Characteristic.CurrentHeaterCoolerState.HEATING
	  } else {
	    state = hap.Characteristic.CurrentHeaterCoolerState.COOLING
	  }
	}
      }
      context.CurrentHeaterCoolerState = state
      service.updateCharacteristic(hap.Characteristic.CurrentHeaterCoolerState, state)
      callback?.(null, context.CurrentHeaterCoolerState)
      log.debug(`${accessory.displayName}: CurrentHeaterCoolerState ${CurrentHeaterCoolerState[state]}.`)
    } catch (err) {
      callback?.(err)
      log.error(`${accessory.displayName}: Failed to get CurrentHeaterCoolerState. ${err}`)
    }
  }
  // .on('get', async (callback) => syncCurrentHeaterCoolerState(callback))
  // const syncCurrentHeaterCoolerState = async (callback) => {
  //   try {
  //     callback(null, context.CurrentHeaterCoolerState)
  //     const {status} = (await EL(el.getPropertyValue, address, eoj, 0x80)).message.data
  //     if (!status) {
  // 	state = hap.Characteristic.CurrentHeaterCoolerState.INACTIVE
  //     } else {
  // 	// const {compressor} = (await EL(el.getPropertyValue, address, eoj, 0xCD)).message.data
  // 	// if (!compressor) {
  // 	//   state = hap.Characteristic.CurrentHeaterCoolerState.IDLE
  // 	// } else {
  // 	  const {mode} = (await EL(el.getPropertyValue, address, eoj, 0xB0)).message.data
  // 	  state = mode === 2 ?
  // 	    hap.Characteristic.CurrentHeaterCoolerState.COOLING
  //           : hap.Characteristic.CurrentHeaterCoolerState.HEATING
  // 	// }
  //     }
  //     context.CurrentHeaterCoolerState = state
  //     service.updateCharacteristic(hap.Characteristic.CurrentHeaterCoolerState, state)
  //     log.debug(`${accessory.displayName}: CurrentHeaterCoolerState ${state}.`)
  //   } catch (err) {
  //     log.error(`${accessory.displayName}: Failed to get CurrentHeaterCoolerState. ${err}`)
  //   }
  // }
  // // )

  // public static readonly AUTO = 0;
  // public static readonly HEAT = 1;
  // public static readonly COOL = 2;
  const TargetHeaterCoolerState = ['AUTO', 'HEAT', 'COOL']
  service.getCharacteristic(hap.Characteristic.TargetHeaterCoolerState)
  .on('set', async (value, callback) => {
    try {
      // if (value !== hap.Characteristic.TargetHeaterCoolerState.OFF) {
        let mode = 1
        if (value === hap.Characteristic.TargetHeaterCoolerState.COOL)
          mode = 2
        else if (value === hap.Characteristic.TargetHeaterCoolerState.HEAT)
          mode = 3
        else if (value === hap.Characteristic.TargetHeaterCoolerState.AUTO)
          mode = 0
        await EL(el.setPropertyValue, address, eoj, 0xB0, {mode})
        context.TargetHeaterCoolerState = value
      // } else {
      //   await EL(el.setPropertyValue, address, eoj, 0x80, {status: false})
      // }
      callback()
      log.debug(`${accessory.displayName}: set TargetHeaterCoolerState ${TargetHeaterCoolerState[value]}.`)
    } catch (err) {
      callback(err)
      log.error(`${accessory.displayName}: Failed to set TargetHeaterCoolerState. ${err}`)
    }
  })
  .on('change', async (event) => {
    if (event.newValue !== event.oldValue) {
      if (context.Active === hap.Characteristic.Active.ACTIVE) {
	await mqttpublish('mode', TargetHeaterCoolerState[event.newValue])
	if (event.newValue === hap.Characteristic.TargetHeaterCoolerState.HEAT) {
	  await this.mqttpublish('HeatingThresholdTemperature', context.HeatingThresholdTemperature)
	} else if (event.newValue === hap.Characteristic.TargetHeaterCoolerState.COOL) {
	  await this.mqttpublish('CoolingThresholdTemperature', context.CoolingThresholdTemperature)
	}
      }
    }
  })
  .on('get', async (callback) => syncTargetHeaterCoolerState(callback))
  const syncTargetHeaterCoolerState = async (callback = null) => {
    try {
      callback?.(null, context.TargetHeaterCoolerState)
      let state = hap.Characteristic.TargetHeaterCoolerState.COOL
      // const {status} = (await EL(el.getPropertyValue, address, eoj, 0x80)).message.data
      // if (status) {
        const {mode} = (await EL(el.getPropertyValue, address, eoj, 0xB0)).message.data
        // if (mode === 2)
        //   state = hap.Characteristic.TargetHeaterCoolerState.COOL
        // else if (mode === 3)
        //   state = hap.Characteristic.TargetHeaterCoolerState.HEAT
        if (mode === 1)
          state = hap.Characteristic.TargetHeaterCoolerState.AUTO
        else if (mode === 3)
          state = hap.Characteristic.TargetHeaterCoolerState.HEAT
      // }
      // else {
      //   state = hap.Characteristic.TargetHeaterCoolerState.OFF
      // }
      context.TargetHeaterCoolerState = state
      service.updateCharacteristic(hap.Characteristic.TargetHeaterCoolerState, state)
      log.debug(`${accessory.displayName}: TargetHeaterCoolerState ${TargetHeaterCoolerState[state]}.`)
    } catch (err) {
      log.error(`${accessory.displayName}: Failed to get TargetHeaterCoolerState. ${err}`)
    }
  }

  // const temperatureSetter = async (edt, value, callback) => {
  //   try {
  //     await el.setPropertyValue(address, eoj, edt, {temperature: parseInt(value)})
  //     callback()
  //   } catch (err) {
  //     callback(err)
  //   }
  // }
  // const temperatureGetter = async (edt, callback) => {
  //   try {
  //     const {temperature} = (await el.getPropertyValue(address, eoj, edt)).message.data
  //     callback(null, temperature)
  //   } catch (err) {
  //     // Some air conditioners do not have temperature sensor, reporting error
  //     // would make the accessory stop working.
  //     callback(null, 0)
  //   }
  // }
  // service.getCharacteristic(hap.Characteristic.CurrentTemperature)
  // .setProps({minValue: -127, maxValue: 125, minStep: 1})
  // .on('get', temperatureGetter.bind(null, 0xBB))
  // service.getCharacteristic(hap.Characteristic.CoolingThresholdTemperature)
  // .setProps({minValue: 16, maxValue: 30, minStep: 1})
  // .on('set', temperatureSetter.bind(null, 0xB3))
  // .on('get', temperatureGetter.bind(null, 0xB3))
  // service.getCharacteristic(hap.Characteristic.HeatingThresholdTemperature)
  // .setProps({minValue: 16, maxValue: 30, minStep: 1})
  // .on('set', temperatureSetter.bind(null, 0xB3))
  // .on('get', temperatureGetter.bind(null, 0xB3))

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

  service.getCharacteristic(hap.Characteristic.CoolingThresholdTemperature)
  .setProps({minValue: 16, maxValue: 30, minStep: 1})
  .on('set', async (value, callback) => {
    try {
      const edt = propertyMaps.get.find(x => x === 0xB5) ? 0xB5 : 0xB3
      await EL(el.setPropertyValue, address, eoj, edt, {temperature: parseInt(value)})
      context.CoolingThresholdTemperature = value
      callback()
      log.debug(`${accessory.displayName}: CoolingThresholdTemperature ${value}.`)
    } catch (err) {
      log.error(`${accessory.displayName}: Failed to set CoolingThresholdTemperature. ${err}`)
      callback(err)
    }
  })
  .on('change', async (event) => {
    if (event.newValue !== event.oldValue) {
      await mqttpublish('CoolingThresholdTemperature', event.newValue)
    }
  })
  .on('get', async (callback) => syncCoolingThresholdTemperature(callback))
  const syncCoolingThresholdTemperature = async (callback = null) => {
    try {
      const edt = propertyMaps.get.find(x => x === 0xB5) ? 0xB5 : 0xB3
      callback?.(null, context.CoolingThresholdTemperature)
      const {temperature} = (await EL(el.getPropertyValue, address, eoj, edt)).message.data
      if (temperature && context.TargetHeaterCoolerState === hap.Characteristic.TargetHeaterCoolerState.COOL) {
	context.CoolingThresholdTemperature = temperature
	service.updateCharacteristic(hap.Characteristic.CoolingThresholdTemperature, temperature)
      }
      log.debug(`${accessory.displayName}: CoolingThresholdTemperature ${temperature}(${context.CoolingThresholdTemperature}).`)
    } catch (err) {
      log.error(`${accessory.displayName}: Failed to get CoolingThresholdTemperature. ${err}`)
    }
  }

  service.getCharacteristic(hap.Characteristic.HeatingThresholdTemperature)
  .setProps({minValue: 16, maxValue: 30, minStep: 1})
  .on('set', async (value, callback) => {
    try {
      const edt = propertyMaps.get.find(x => x === 0xB6) ? 0xB6 : 0xB3
      await EL(el.setPropertyValue, address, eoj, edt, {temperature: parseInt(value)})
      context.HeatingThresholdTemperature = value
      callback()
      log.debug(`${accessory.displayName}: set HeatingThresholdTemperature ${value}.`)
    } catch (err) {
      callback(err)
      log.error(`${accessory.displayName}: Failed to set HeatingThresholdTemperature. ${err}`)
    }
  })
  .on('change', async (event) => {
    if (event.newValue !== event.oldValue) {
      await mqttpublish('HeatingThresholdTemperature', event.newValue)
    }
  })
  .on('get', async (callback) => syncHeatingThresholdTemperature(callback))
  const syncHeatingThresholdTemperature = async (callback = null) => {
    try {
      const edt = propertyMaps.get.find(x => x === 0xB6) ? 0xB6 : 0xB3
      callback?.(null, context.HeatingThresholdTemperature)
      const {temperature} = (await EL(el.getPropertyValue, address, eoj, edt)).message.data
      if (temperature && context.TargetHeaterCoolerState === hap.Characteristic.TargetHeaterCoolerState.HEAT) {
	context.HeatingThresholdTemperature = temperature
	service.updateCharacteristic(hap.Characteristic.HeatingThresholdTemperature, temperature)
      }
      log.debug(`${accessory.displayName}: HeatingThresholdTemperature ${temperature}(${context.HeatingThresholdTemperature}).`)
    } catch (err) {
      log.error(`${accessory.displayName}: Failed to get HeatingThresholdTemperature. ${err}`)
    }
  }

  const historyService = platform.fakegatoAPI ? new platform.fakegatoAPI('room', accessory, {log: log, storage: 'fs'}) : null
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

  return true
}
