module.exports = {
  async getBookingData({ homey, query }) {
    const { deviceId } = query;
    if (!deviceId) {
      throw new Error('No deviceId provided');
    }

    const driver = homey.drivers.getDriver('booking');
    if (!driver) {
        throw new Error('Driver not found');
    }

    const device = driver.getDevice(deviceId);
    if (!device) {
      throw new Error('Device not found');
    }

    return {
      measure_time_remaining: device.getCapabilityValue('measure_time_remaining'),
      days_until_departure: device.getCapabilityValue('days_until_departure'),
      departure_time: device.getCapabilityValue('departure_time'),
      ship_name: device.getCapabilityValue('ship_name'),
      route: device.getCapabilityValue('route'),
      booking_status: device.getCapabilityValue('booking_status'),
      arrival_time: device.getCapabilityValue('arrival_time')
    };
  }
};
