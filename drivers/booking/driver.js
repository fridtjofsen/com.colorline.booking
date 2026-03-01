'use strict';

const Homey = require('homey');
const ColorLineAPI = require('../../lib/ColorLineAPI');

class BookingDriver extends Homey.Driver {

    async onPair(session) {
        this.log('onPair session started');

        let foundBooking = null;
        let loginCredentials = null;

        session.setHandler('login', async (data) => {
            const username = (data.username || '').trim();
            const password = (data.password || '').trim();

            this.log('Login attempt received');

            if (!username || !password) {
                 throw new Error('Please provide both Last Name and Booking Number.');
            }

            try {
                const api = new ColorLineAPI();
                const result = await api.getBookingURL(username, password);

                if (result && (result.sailingsReference || result.date || result.rawUrl)) {
                    this.log('Login successful, booking found');
                    foundBooking = result;
                    loginCredentials = { username, password };
                    return true;
                } else {
                    this.log('Login failed: No valid booking found in response');
                    throw new Error('Could not find a valid booking with these details.');
                }
            } catch (error) {
                this.error('Login error:', error);
                throw new Error('Invalid Credentials or Booking Not Found'); 
            }
        });

        session.setHandler('list_devices', async () => {
            if (!foundBooking || !loginCredentials) {
                // If the user somehow navigates here without a successful login
                throw new Error('No booking found. Please try logging in again.');
            }

            const deviceId = `booking_${loginCredentials.password}`;
            
            return [
                {
                    name: `Color Line (${foundBooking.route || loginCredentials.password})`,
                    data: {
                        id: deviceId
                    },
                    settings: {
                        lastName: loginCredentials.username,
                        bookingReference: loginCredentials.password,
                        polling_interval: 60
                    }
                }
            ];
        });
    }

}

module.exports = BookingDriver;
