// -*- js-indent-level : 2 -*-
module.exports = async function(platform, accessory, el, address, eoj) {
  if ((eoj[0] === 0x02 && eoj[1] === 0x90) ||
      (eoj[0] === 0x02 && eoj[1] === 0x91)) {
    const light = require('./accessory-light').bind(this)
    await light(platform, accessory, el, address, eoj)
    return true
  } else if (eoj[0] === 0x01 && eoj[1] === 0x30) {
    let aircon;
    if (platform.config.airConditionerService === 'Thermostat') {
      aircon = require('./accessory-thermostat').bind(this)
    } else {
      aircon = require('./accessory-aircon').bind(this)
    }
    await aircon(platform, accessory, el, address, eoj)
    return true
  }
  return false
}
