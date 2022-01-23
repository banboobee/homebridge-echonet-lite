module.exports = async function(log, api, accessory, el, address, eoj) {
  if ((eoj[0] === 0x02 && eoj[1] === 0x90) ||
      (eoj[0] === 0x02 && eoj[1] === 0x91)) {
    const light = require('./accessory-light').bind(this)
    await light(log, api, accessory, el, address, eoj)
    return true
  } else if (eoj[0] === 0x01 && eoj[1] === 0x30) {
  //const aircon = require('./accessory-aircon').bind(this)
    const aircon = require('./accessory-thermostat').bind(this)
    await aircon(log, api, accessory, el, address, eoj)
    return true
  }
  return false
}
