'use strict';

module.exports = {
  async getData({ homey, query }) {
    const driver = homey.drivers.getDriver('booking');
    if (!driver) {
      throw new Error('Driver not found');
    }

    const devices = driver.getDevices();
    if (!devices || devices.length === 0) {
      throw new Error('No paired booking devices found');
    }

    // Homey.getDeviceIds() in the widget returns Homey-internal UUIDs,
    // but Driver.getDevice() expects the pairing data object — not a UUID.
    // The SDK Device class has no public property exposing the Homey UUID,
    // so we cannot match directly. Try pairing-data lookup first, then
    // fall back to the first available device.
    const { deviceId } = query;
    let device;

    if (deviceId && devices.length > 1) {
      try {
        device = driver.getDevice({ id: deviceId });
      } catch (_) {
        // UUID didn't match pairing data — expected
      }
    }

    if (!device) {
      device = devices[0];
    }

    return {
      measure_time_remaining: device.getCapabilityValue('measure_time_remaining'),
      days_until_departure: device.getCapabilityValue('days_until_departure'),
      departure_time: device.getCapabilityValue('departure_time'),
      ship_name: device.getCapabilityValue('ship_name'),
      route: device.getCapabilityValue('route'),
      booking_status: device.getCapabilityValue('booking_status'),
      arrival_time: device.getCapabilityValue('arrival_time'),
      trip_type: device.getCapabilityValue('trip_type'),
      return_arrival_time: device.getCapabilityValue('return_arrival_time'),
    };
  },
};
