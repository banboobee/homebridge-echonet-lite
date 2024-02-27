module.exports = async (platform, accessory, el, address, eoj) => {
  const log = platform.log
  const api = platform.api
  const hap = api.hap
  const context = accessory.context
  const service = accessory.getService(hap.Service.HeaterCooler) ||
                  accessory.addService(hap.Service.HeaterCooler)

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

  context.Active ??= hap.Characteristic.Active.INACTIVE
  context.CurrentHeaterCoolerState ??= hap.Characteristic.CurrentHeaterCoolerState.INACTIVE
  context.TargetHeaterCoolerState ??= hap.Characteristic.TargetHeaterCoolerState.AUTO
  context.CurrentTemperature ??= 25
  context.CoolingThresholdTemperature ??= 30
  context.HeatingThresholdTemperature ??= 18

  service.getCharacteristic(hap.Characteristic.Active)
  .on('set', async (value, callback) => {
    try {
      await el.setPropertyValue(address, eoj, 0x80, {status: value != 0})
      context.Active = value
      callback()
    } catch (err) {
      callback(err)
    }
  })
  .on('get', async (callback) => {
    try {
      callback(null, context.Active)
      const {status} = (await el.getPropertyValue(address, eoj, 0x80)).message.data
      context.Active = status
      service.updateCharacteristic(hap.Characteristic.Active, status)
    } catch (err) {
      log.error(`${accessory.displayName}: Failed to get Active. ${err}`)
    }
  })

  service.getCharacteristic(hap.Characteristic.CurrentHeaterCoolerState)
  .on('get', async (callback) => {
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
      callback(null, context.CurrentHeaterCoolerState)
      service.updateCharacteristic(hap.Characteristic.CurrentHeaterCoolerState, state)
    } catch (err) {
      callback(null, hap.Characteristic.CurrentHeaterCoolerState.IDLE)
    }
  })
  // .on('get', async (callback) => syncCurrentHeaterCoolerState(callback))
  // const syncCurrentHeaterCoolerState = async (callback) => {
  //   try {
  //     callback(null, context.CurrentHeaterCoolerState)
  //     const {status} = (await el.getPropertyValue(address, eoj, 0x80)).message.data
  //     if (!status) {
  // 	state = hap.Characteristic.CurrentHeaterCoolerState.INACTIVE
  //     } else {
  // 	// const {compressor} = (await el.getPropertyValue(address, eoj, 0xCD)).message.data
  // 	// if (!compressor) {
  // 	//   state = hap.Characteristic.CurrentHeaterCoolerState.IDLE
  // 	// } else {
  // 	  const {mode} = (await el.getPropertyValue(address, eoj, 0xB0)).message.data
  // 	  state = mode === 2 ?
  // 	    hap.Characteristic.CurrentHeaterCoolerState.COOLING
  //           : hap.Characteristic.CurrentHeaterCoolerState.HEATING
  // 	// }
  //     }
  //     context.CurrentHeaterCoolerState = state
  //     service.updateCharacteristic(hap.Characteristic.CurrentHeaterCoolerState, state)
  //   } catch (err) {
  //     log.error(`${accessory.displayName}: Failed to get CurrentHeaterCoolerState. ${err}`)
  //   }
  // }
  // // )

  service.getCharacteristic(hap.Characteristic.TargetHeaterCoolerState)
  .on('set', async (value, callback) => {
    try {
      // if (value !== hap.Characteristic.TargetHeaterCoolerState.OFF) {
        let mode = 2
        if (value === hap.Characteristic.TargetHeaterCoolerState.HEAT)
          mode = 3
        else if (value === hap.Characteristic.TargetHeaterCoolerState.AUTO)
          mode = 1
        await el.setPropertyValue(address, eoj, 0xB0, {mode})
        context.TargetHeaterCoolerState = value
      // } else {
      //   await el.setPropertyValue(address, eoj, 0x80, {status: false})
      // }
      callback()
    } catch (err) {
      callback(err)
    }
  })
  .on('get', async (callback) => {
    try {
      callback(null, context.TargetHeaterCoolerState)
      let state = hap.Characteristic.TargetHeaterCoolerState.COOL
      // const {status} = (await el.getPropertyValue(address, eoj, 0x80)).message.data
      // if (status) {
        const {mode} = (await el.getPropertyValue(address, eoj, 0xB0)).message.data
        if (mode === 1)
          state = hap.Characteristic.TargetHeaterCoolerState.AUTO
        else if (mode === 3)
          state = hap.Characteristic.TargetHeaterCoolerState.HEAT
      // } else {
      //   state = hap.Characteristic.TargetHeaterCoolerState.OFF
      // }
      context.TargetHeaterCoolerState = state
      service.updateCharacteristic(hap.Characteristic.TargetHeaterCoolerState, state)
    } catch (err) {
      log.error(`${accessory.displayName}: Failed to get TargetHeaterCoolerState. ${err}`)
    }
  })

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
  .on('get', async (callback) => {
    try {
      callback(null, context.CurrentTemperature)
      const {temperature} = (await el.getPropertyValue(address, eoj, 0xBB)).message.data
      context.CurrentTemperature = temperature
      service.updateCharacteristic(hap.Characteristic.CurrentTemperature, temperature)
    } catch (err) {
      log.error(`${accessory.displayName}: Failed to get CurrentTemperature. ${err}`)
    }
  })

  service.getCharacteristic(hap.Characteristic.CoolingThresholdTemperature)
  .setProps({minValue: 16, maxValue: 30, minStep: 1})
  .on('set', async (value, callback) => {
    try {
      const edt = propertyMaps.get.find(x => x === 0xB5) ? 0xB5 : 0xB3
      await el.setPropertyValue(address, eoj, edt, {temperature: parseInt(value)})
      context.CoolingThresholdTemperature = value
      callback()
    } catch (err) {
      callback(err)
    }
  })
  .on('get', async (callback) => {
    try {
      callback(null, context.CoolingThresholdTemperature)
      const edt = propertyMaps.get.find(x => x === 0xB5) ? 0xB5 : 0xB3
      const {temperature} = (await el.getPropertyValue(address, eoj, edt)).message.data
      if (temperature && context.TargetHeaterCoolerState === hap.Characteristic.TargetHeaterCoolerState.COOL) {
	context.CoolingThresholdTemperature = temperature
	service.updateCharacteristic(hap.Characteristic.CoolingThresholdTemperature, temperature)
      }
    } catch (err) {
      log.error(`${accessory.displayName}: Failed to get CoolingThresholdTemperature. ${err}`)
    }
  })

  service.getCharacteristic(hap.Characteristic.HeatingThresholdTemperature)
  .setProps({minValue: 16, maxValue: 30, minStep: 1})
  .on('set', async (value, callback) => {
    try {
      const edt = propertyMaps.get.find(x => x === 0xB6) ? 0xB6 : 0xB3
      await el.setPropertyValue(address, eoj, edt, {temperature: parseInt(value)})
      context.HeatingThresholdTemperature = value
      callback()
    } catch (err) {
      callback(err)
    }
  })
  .on('get', async (callback) => {
    try {
      callback(null, context.HeatingThresholdTemperature)
      const edt = propertyMaps.get.find(x => x === 0xB6) ? 0xB6 : 0xB3
      const {temperature} = (await el.getPropertyValue(address, eoj, edt)).message.data
      if (temperature && context.TargetHeaterCoolerState === hap.Characteristic.TargetHeaterCoolerState.HEAT) {
	context.HeatingThresholdTemperature = temperature
	service.updateCharacteristic(hap.Characteristic.HeatingThresholdTemperature, temperature)
      }
    } catch (err) {
      log.error(`${accessory.displayName}: Failed to get HeatingThresholdTemperature. ${err}`)
    }
  })
      
  return true
}
