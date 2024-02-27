const packageJson = require('../package.json')

const fs = require('fs')
const path = require('path')
const EL = require('./echonet-lite')
const el = new EL({lang: 'ja', type: 'lan'})
const buildAccessory = require('./accessory')
const ELcontroller = {}	// distribute the operations controller by controller
const {networkInterfaces} = require('os')

// Lazy-initialized.
let Accessory, hap

// Storage.
// let storagePath = null
// let storage = {accessories: {}}

// Called by homebridge.
module.exports = (homebridge) => {
  Accessory = homebridge.platformAccessory
  hap = homebridge.hap

  // Read settings.
  // try {
  //   storagePath = path.join(homebridge.user.storagePath(), 'persist', 'ELPlatform.json')
  //   storage = JSON.parse(fs.readFileSync(storagePath))
  // } catch {}

  // Register the platform.
  homebridge.registerPlatform(packageJson.name, "ELPlatform", ELPlatform, true)
}

// UUID for the refresh button.
const kRefreshUUID = '076cc8c6-7f72-441b-81cb-d85e27386dc1'

class ELPlatform {
  constructor(log, config, api) {
    this.log = log
    this.config = config
    this.api = api

    if (!this.config)
      return

    this.isDiscovering = false
    this.refreshSwitch = null
    this.onNotifyHandler = {}
    this.mqttclient = null
    this.fakegatoAPI = null
    this.eve = null

    this.accessories = []
    this.api.once('didFinishLaunching', () => this._init())
  }

  configureAccessory(accessory) {
    this.log(`Loading accessory from cache: ${accessory.displayName}`);

    // Prepare or remove the refresh switch.
    if (accessory.UUID === kRefreshUUID) {
      if (this.config.enableRefreshSwitch)
        this.refreshSwitch = accessory
      else
        this.api.unregisterPlatformAccessories(packageJson.name, "ELPlatform", [accessory])
      return
    }

    // Save the accessory and build later.
    this.accessories.push(accessory)
  }

  // configurationRequestHandler(context, request, callback) {
  // }

  async _init() {
    await el.init()
    if (this.config.enableRefreshSwitch)
      await this._buildRefreshAccessory()

    if (this.config.history) {
      const { EveHomeKitTypes } = require('homebridge-lib')
      this.fakegatoAPI = require('fakegato-history')(this.api);
      this.eve = new EveHomeKitTypes(this.api);
    }
    if (this.config.mqttURL) {
      const mqtt = require('async-mqtt')
      try {
	this.mqttclient = await mqtt.connectAsync(this.config.mqttURL);
	this.log(`MQTT connection has been established successfully.`)
      } catch (e) {
	this.mqttclient = null;
	this.log(`Failed to establish MQTT connection. ${e}`)
      }
    }

    if (this.config.device) {
      const builder = {
	'heatercooler':require('./accessory-heatercooler'),
	'thermostat':require('./accessory-thermostat'),
	'thermostat2':async (platform, accessory, el, address, eoj) => await require('./accessory-thermostat')(platform, accessory, el, address, eoj, false),
	'original':require('./accessory')
      }
      for (const device of this.config.device) {
	const address = device.address
	const eoj = device.eoj
	const service = device?.service?.toLowerCase() ?? 'original'
	const model = el.getClassName(eoj[0], eoj[1])
        const uuid = hap.uuid.generate(service + '|' + address + '|' + JSON.stringify(eoj))
	const existingAccessory = this.accessories.find(x => x.UUID === uuid)
        if (!model) {
	  this.log.error(`Unknown device ${address}[${eoj}].`)
	  continue
	}
	if (!ELcontroller[address]) {
	  this.log.debug(`Found controller #${Object.keys(ELcontroller).length + 1}: ${address}`)
	  ELcontroller[address] = new EL()
	}
	
	if (existingAccessory) {
	  await builder[service]?.(this, existingAccessory, ELcontroller[address], address, eoj)
	} else {
	  try {
	    const displayName = device.name ?? `${service}.${address}[${eoj[0]}:${eoj[1]}:${eoj[2]}].${getIpAddress()}`
	    const accessory = new Accessory(displayName, uuid)
	    accessory.context.address = address
	    accessory.context.eoj = eoj

	    if (!await builder[service]?.(this, accessory, ELcontroller[address], address, eoj)) {
	      this.log.error(`Unsupported device ${model} of ${service}.${address}[${eoj}].`)
	      continue
	    }
	    this.api.registerPlatformAccessories(packageJson.name, "ELPlatform", [accessory])
	    this.log(`Found new accessory ${displayName}.`)
	    this.accessories.push(accessory)
	  } catch (e) {
	    this.log.error(`Failed to register accessory ${address}[${eoj}]. ${e}`)
	  }
	}
      }
      for (const accessory of this.accessories) {
	if (accessory.context.reachable !== undefined)	// auto discovered device?
	  continue
	if (!this.config.device.find(device => {
	  const address = device.address
	  const eoj = device.eoj
	  const service = device?.service?.toLowerCase() ?? 'original'
          const uuid = hap.uuid.generate(service + '|' + address + '|' + JSON.stringify(eoj))
	  return accessory.UUID === uuid
	})) {
	  this.log(`Deleteing non-available accessory ${accessory.displayName}`)
          this.api.unregisterPlatformAccessories(packageJson.name, "ELPlatform", [accessory])
	  accessory.context.address = undefined	// Prepare to remove
	  accessory.context.eoj = []
	}
      }
      this.accessories = this.accessories.filter(x => x.context.address !== undefined)
    } else if (this.accessories.length === 0) {
      // If there is no stored information (i.e. first time run) then do
      // discovery.
      await this._startDiscovery()
    } else {
      // Otherwise try to recover old accessories.
      // for (const accessory of this.accessories) {
      //   const info = storage.accessories[accessory.UUID]
      //   if (info) {
      //     this._addAccesory(info.address, info.eoj, accessory.UUID)
      //   } else {
      //     this.api.unregisterPlatformAccessories(packageJson.name, "ELPlatform", [accessory])
      //   }
      // }
      for (const accessory of this.accessories) {
	if (accessory.context.reachable === true) {
	  this._addAccesory(accessory.context.address, accessory.context.eoj, accessory.UUID)
	} else {
	  this.api.unregisterPlatformAccessories(packageJson.name, "ELPlatform", [accessory])
	  accessory.context.address = undefined	// Prepare to remove
	  accessory.context.eoj = []
	}
      }
      this.accessories = this.accessories.filter(x => x.context.address !== undefined)
    }
    el.on('notify', async (x) => {
      this.log.debug(`Notify on ${x.device.address}[${x.message.seoj.toString()}].`, JSON.stringify(x.message))
      this.onNotifyHandler[`${x.device.address}${x.message.seoj.toString()}`]?.forEach(async (handler) =>
	await handler(x.message)
      )})
  }

  async _startDiscovery() {
    if (!this._setIsDiscovering(true))
      return

    // Mark all as unreachable, the reachable ones will be updated later.
    this.accessories.forEach(accessory => {
      // accessory.updateReachability(false)
      if (accessory.context.reachable !== undefined) {
	accessory.context.reachable = false		// auto discovered device
      }
    })

    return new Promise((resolve, reject) => {
      el.startDiscovery(async (err, res) => {
        if (err) {
          this.log(err)
          reject(err)
          return
        }

        const device = res.device
        const address = device.address

        for (const eoj of device.eoj) {
          // Invalid device.
          if (!el.getClassName(eoj[0], eoj[1]))
            continue
	  // controllers
	  if (eoj[0] === 5 && eoj[1] === 255)
	    continue
	  // manually configured device
	  if (this.accessories.find(x =>
	    x.context.reachable === undefined &&
	    x.context.address === address && x.context.eoj.toString() === eoj.toString()))
	    continue

          const uid = address + '|' + JSON.stringify(eoj)
          const uuid = hap.uuid.generate(uid)
          await this._addAccesory(address, eoj, uuid)
        }
      })

      setTimeout(() => {
        this._stopDiscovery()
        resolve()
      }, 7 * 1000)
    })
  }

  async _stopDiscovery() {
    if (!this._setIsDiscovering(false))
      return

    // Removed unreachable accessories.
    this.accessories.forEach(accessory => {
      // if (!accessory.reachable) {
      if (accessory.context.reachable === false) {
        this.log(`Deleteing non-available accessory ${accessory.displayName}`)
        this.api.unregisterPlatformAccessories(packageJson.name, "ELPlatform", [accessory])
	accessory.context.address = undefined	// Prepare to remove
	accessory.context.eoj = []		

        // delete storage.accessories[uuid]
        // writeSettings(this)
      }
    })
    this.accessories = this.accessories.filter(x => x.context.address !== undefined)

    // After stopping discovery, el would listen to broadcast.
    this.log('Finished discovery')
    el.stopDiscovery()
  }

  async _setIsDiscovering(is) {
    if (is == this.isDiscovering)
      return false
    this.isDiscovering = is

    if (this.refreshService)  // update the refresh switch
      this.refreshService.updateCharacteristic(hap.Characteristic.On, is)
    return true
  }

  async _buildRefreshAccessory() {
    if (!this.refreshSwitch) {
      this.refreshSwitch = new Accessory(`Refresh ECHONET Lite ${getIpAddress()}`, kRefreshUUID)
      this.api.registerPlatformAccessories(packageJson.name, "ELPlatform", [this.refreshSwitch])
    }
    this.refreshService = this.refreshSwitch.getService(hap.Service.Switch) ||
                          this.refreshSwitch.addService(hap.Service.Switch)
    this.refreshService.getCharacteristic(hap.Characteristic.On)
    .on('get', (callback) => {
      callback(null, this.isDiscovering)
    })
    .on('set', async (value, callback) => {
      if (value)
        await this._startDiscovery()
      else
        await this._stopDiscovery()
      callback()
    })
  }

  async _addAccesory(address, eoj, uuid) {
    const registered = this.accessories.find(x => x.UUID === uuid)
    const displayName = `${address}[${eoj[0]}:${eoj[1]}:${eoj[2]}].${getIpAddress()}`
    const accessory = registered ?? new Accessory(displayName, uuid)
    accessory.context.address = address
    accessory.context.eoj = eoj

    // The _addAccesory may be called twice due to refreshing. 
    // if (!accessory.alreadyBuilt) {
    if (accessory.context.reachable !== true) {	// undefined or false
      if (!ELcontroller[address]) {
	this.log.debug(`Found controller #${Object.keys(ELcontroller).length + 1}: ${address}`)
	ELcontroller[address] = new EL()
      }

      if (!await buildAccessory(this, accessory, ELcontroller[address], address, eoj))
        return  // unsupported accessory
      // accessory.alreadyBuilt = true
      accessory.context.reachable = true
      // accessory.once('identify', (paired, callback) => callback())
    }

    // accessory.updateReachability(true)
    // accessory.context.reachable = true

    if (!registered) {
      this.log(`Found new accessory: ${accessory.displayName}`)
      this.accessories.push(accessory)
      this.api.registerPlatformAccessories(packageJson.name, "ELPlatform", [accessory])

      // storage.accessories[uuid] = {address, eoj}
      // writeSettings(this)
    }
  }
}

// function writeSettings(platform) {
//   try {
//     fs.writeFileSync(storagePath, JSON.stringify(storage))
//   } catch (e) {
//     platform.log(`Failed to write settings: ${e}`)
//   }
// }

function getIpAddress() {
  const nets = networkInterfaces()
  for (const n of Object.keys(nets)) {
    let ip
    if (ip = nets[n].find((x) => (x.family === 'IPv4' || x.family === 4) && !x.internal)) {
      return ip.address
    }
  }

  return undefined
}
