'use strict';

const Homey = require('homey');
const ColorLineAPI = require('../../lib/ColorLineAPI');

class BookingDevice extends Homey.Device {

    async onInit() {
        this.log('BookingDevice has been initialized');
        
        // Track previous values for change-detection triggers
        this._previousValues = {
            hoursRemaining: null,
            totalPrice: null,
            shipName: null,
            departureTime: null  // human-readable string for comparison
        };

        try {
            this.api = new ColorLineAPI();
            this.log('ColorLineAPI initialized');
        } catch (error) {
            this.error('Failed to initialize ColorLineAPI:', error);
        }

        // ── Register flow condition cards ────────────────────────
        this._condHoursLessThan = this.homey.flow.getConditionCard('hours_less_than');
        this._condHoursLessThan.registerRunListener(async (args) => {
            const hours = this.getCapabilityValue('measure_time_remaining');
            return hours !== null && hours < args.hours;
        });

        this._condHoursGreaterThan = this.homey.flow.getConditionCard('hours_greater_than');
        this._condHoursGreaterThan.registerRunListener(async (args) => {
            const hours = this.getCapabilityValue('measure_time_remaining');
            return hours !== null && hours > args.hours;
        });

        // ── Register flow trigger cards ─────────────────────────
        this._trigHoursDroppedBelow = this.homey.flow.getTriggerCard('hours_dropped_below');
        this._trigHoursDroppedBelow.registerRunListener(async (args, state) => {
            // Fire only when hours crossed below the threshold
            return state.previousHours >= args.hours && state.currentHours < args.hours;
        });

        this._trigHoursRoseAbove = this.homey.flow.getTriggerCard('hours_rose_above');
        this._trigHoursRoseAbove.registerRunListener(async (args, state) => {
            // Fire only when hours crossed above the threshold
            return state.previousHours <= args.hours && state.currentHours > args.hours;
        });

        this._trigPriceChanged = this.homey.flow.getTriggerCard('price_changed');
        this._trigShipChanged = this.homey.flow.getTriggerCard('ship_changed');
        this._trigDepartureDateChanged = this.homey.flow.getTriggerCard('departure_date_changed');

        // Retrieve polling interval from settings, default to 60 minutes
        const settings = this.getSettings();
        const pollInterval = settings.polling_interval || 60;
        
        // Start polling
        await this.setPollingInterval(pollInterval);
    }
    
    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.log('BookingDevice settings were changed');
        
        let shouldPoll = false;

        // Check if polling interval changed
        if (changedKeys.includes('polling_interval')) {
            const newInterval = newSettings.polling_interval || 60;
            this.log(`Updating polling interval to ${newInterval} minutes`);
            // This sets the interval AND triggers a poll immediately
            await this.setPollingInterval(newInterval);
        } else {
            // If interval didn't change, check if credentials changed
            if (changedKeys.includes('lastName') || changedKeys.includes('bookingReference')) {
                shouldPoll = true;
            }
        }

        if (shouldPoll) {
            this.log('Booking details changed, polling immediately...');
            await this.poll().catch(err => this.error('Error triggering manual poll:', err));
        }
    }
    
    async onDeleted() {
        this.log('BookingDevice has been deleted');
        this.stopPolling();
    }
    
    async onUninit() {
        this.log('BookingDevice is being uninitialized');
        this.stopPolling();
    }
    
    /**
     * Set the polling interval
     * @param {number} intervalMinutes - Interval in minutes
     */
    async setPollingInterval(intervalMinutes) {
        this.stopPolling();
        
        // Ensure a minimum reasonable interval (e.g. 15 min) to avoid spamming
        // but respect user setting if it's reasonable. Default 60.
        const intervalMs = (intervalMinutes || 60) * 60 * 1000;
        
        this.log(`Polling every ${intervalMinutes} minutes`);
        
        // Poll immediately
        await this.poll();
        
        this.pollingInterval = this.homey.setInterval(() => {
            this.poll();
        }, intervalMs);
    }
    
    stopPolling() {
        if (this.pollingInterval) {
            this.homey.clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }
    
    async poll() {
        const settings = this.getSettings();
        const lastName = (settings.lastName || '').trim();
        const bookingRef = (settings.bookingReference || '').trim();
        
        if (!lastName || !bookingRef) {
            this.log('Missing settings (lastName or bookingReference), skipping poll');
            return;
        }
        
        this.log('Polling for booking update...');
        
        try {
            if (!this.api) {
                this.api = new ColorLineAPI();
            }

            const result = await this.api.getBookingURL(lastName, bookingRef);
            
            if (result) {
                this.log('Booking found:', JSON.stringify(result));
                
                // Map route codes to readable strings and default departure times
                let routeName = result.routeName || result.route || 'Unknown';
                let shipName = result.ship || 'Unknown';
                let defaultDepartureHour = null;
                
                // Common Color Line routes
                const routeCode = result.route || '';
                if (routeCode === 'OSLKEL') {
                    routeName = result.routeName || 'Oslo - Kiel';
                    defaultDepartureHour = 14;
                    if (!result.ship) shipName = 'Color Fantasy / Magic';
                } else if (routeCode === 'KELOSL') {
                    routeName = result.routeName || 'Kiel - Oslo';
                    defaultDepartureHour = 14;
                    if (!result.ship) shipName = 'Color Fantasy / Magic';
                } else if (routeCode === 'SANSTR') {
                    routeName = result.routeName || 'Sandefjord - Strömstad';
                    if (!result.ship) shipName = 'Color Hybrid';
                } else if (routeCode === 'STRSAN') {
                    routeName = result.routeName || 'Strömstad - Sandefjord';
                    if (!result.ship) shipName = 'Color Hybrid';
                } else if (routeCode === 'LARHIR') {
                     routeName = result.routeName || 'Larvik - Hirtshals';
                     if (!result.ship) shipName = 'SuperSpeed 2';
                } else if (routeCode === 'HIRLAR') {
                     routeName = result.routeName || 'Hirtshals - Larvik';
                     if (!result.ship) shipName = 'SuperSpeed 2';
                } else if (routeCode === 'KRIHIR') {
                     routeName = result.routeName || 'Kristiansand - Hirtshals';
                     if (!result.ship) shipName = 'SuperSpeed 1';
                } else if (routeCode === 'HIRKRI') {
                     routeName = result.routeName || 'Hirtshals - Kristiansand';
                     if (!result.ship) shipName = 'SuperSpeed 1';
                }

                // Update route capability
                if (this.hasCapability('route')) {
                    await this.setCapabilityValue('route', routeName)
                        .catch(err => this.error('Error setting route:', err));
                }
                
                // Update booking_reference capability
                if (this.hasCapability('booking_reference')) {
                    await this.setCapabilityValue('booking_reference', bookingRef)
                        .catch(err => this.error('Error setting booking_reference:', err));
                }
                
                // Update ship_name capability
                if (this.hasCapability('ship_name')) {
                     await this.setCapabilityValue('ship_name', shipName)
                        .catch(err => this.error('Error setting ship_name:', err));
                }

                // Update time-related capabilities only if we have a date
                if (result.date) {
                    // Use CET-aware date construction since Color Line times are in Europe/Oslo
                    // Fall back to route-specific default departure hour if time not extracted
                    const timeStr = result.time || (defaultDepartureHour !== null ? `${defaultDepartureHour}:00` : null);
                    const departureDate = this.api.createCETDate(result.date, timeStr);

                    const now = new Date();
                    const diffMs = departureDate.getTime() - now.getTime();
                    const hoursRemaining = Math.max(0, Math.round(diffMs / (1000 * 60 * 60)));
                    
                    this.log(`Time calculation: departureDate=${departureDate.toISOString()}, hoursRemaining=${hoursRemaining}`);

                    // measure_time_remaining
                    if (this.hasCapability('measure_time_remaining')) {
                        await this.setCapabilityValue('measure_time_remaining', hoursRemaining)
                            .catch(err => this.error('Error setting measure_time_remaining:', err));
                    }

                    // days_until_departure (hours / 24, 1 decimal)
                    if (this.hasCapability('days_until_departure')) {
                        const daysRemaining = Math.max(0, Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10);
                        await this.setCapabilityValue('days_until_departure', daysRemaining)
                            .catch(err => this.error('Error setting days_until_departure:', err));
                    }
                    
                    // departure_time (human readable, displayed in CET)
                    if (this.hasCapability('departure_time')) {
                        const dateStr = departureDate.toLocaleDateString('nb-NO', { 
                            timeZone: 'Europe/Oslo',
                            weekday: 'long', 
                            year: 'numeric', 
                            month: 'long', 
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        await this.setCapabilityValue('departure_time', dateStr)
                            .catch(err => this.error('Error setting departure_time:', err));
                    }
                } else {
                    this.log('No departure date found in booking data');
                    
                    if (this.hasCapability('departure_time')) {
                        await this.setCapabilityValue('departure_time', 'Unknown')
                            .catch(err => this.error('Error setting departure_time:', err));
                    }
                }

                // ── Arrival time ─────────────────────────────────────────
                if (result.arrivalDate && this.hasCapability('arrival_time')) {
                    const arrivalDate = this.api.createCETDate(result.arrivalDate, result.arrivalTime);
                    const arrStr = arrivalDate.toLocaleDateString('nb-NO', {
                        timeZone: 'Europe/Oslo',
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    await this.setCapabilityValue('arrival_time', arrStr)
                        .catch(err => this.error('Error setting arrival_time:', err));
                }

                // ── Trip duration ────────────────────────────────────────
                if (result.durationFormatted && this.hasCapability('measure_duration')) {
                    await this.setCapabilityValue('measure_duration', result.durationFormatted)
                        .catch(err => this.error('Error setting measure_duration:', err));
                }

                // ── Total price ──────────────────────────────────────────
                if (result.totalPrice && this.hasCapability('total_price')) {
                    let priceDisplay = result.totalPrice;
                    if (result.paymentStatus) {
                        priceDisplay += ` (${result.paymentStatus})`;
                    }
                    await this.setCapabilityValue('total_price', priceDisplay)
                        .catch(err => this.error('Error setting total_price:', err));
                }

                // ── Cabin info (multiple cabins supported) ───────────────
                if (result.cabins && result.cabins.length > 0 && this.hasCapability('cabin_info')) {
                    let cabinDisplay;
                    if (result.cabins.length === 1) {
                        cabinDisplay = result.cabins[0];
                    } else {
                        // Show count + list, e.g. "2x: Color Suite ..., Color Suite ..."
                        // Group identical cabins for readability
                        const cabinCounts = {};
                        for (const c of result.cabins) {
                            cabinCounts[c] = (cabinCounts[c] || 0) + 1;
                        }
                        const parts = Object.entries(cabinCounts).map(([name, count]) => {
                            return count > 1 ? `${count}x ${name}` : name;
                        });
                        cabinDisplay = parts.join(' + ');
                    }
                    await this.setCapabilityValue('cabin_info', cabinDisplay)
                        .catch(err => this.error('Error setting cabin_info:', err));
                }

                // ── Guest count ──────────────────────────────────────────
                if (result.guestCount && this.hasCapability('guest_count')) {
                    await this.setCapabilityValue('guest_count', result.guestCount)
                        .catch(err => this.error('Error setting guest_count:', err));
                }

                // ── Trip type ────────────────────────────────────────────
                if (result.tripType && this.hasCapability('trip_type')) {
                    let tripDisplay = result.tripType;
                    if (result.fullRouteName) {
                        tripDisplay = `${result.tripType} (${result.fullRouteName})`;
                    }
                    await this.setCapabilityValue('trip_type', tripDisplay)
                        .catch(err => this.error('Error setting trip_type:', err));
                }

                // ── Return leg (round trips only) ───────────────────────
                // Return departure time
                if (result.returnDepartureDate && this.hasCapability('return_departure_time')) {
                    const retDepDate = this.api.createCETDate(result.returnDepartureDate, result.returnDepartureTime);
                    const retDepStr = retDepDate.toLocaleDateString('nb-NO', {
                        timeZone: 'Europe/Oslo',
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    await this.setCapabilityValue('return_departure_time', retDepStr)
                        .catch(err => this.error('Error setting return_departure_time:', err));
                }

                // Return arrival time
                if (result.returnArrivalDate && this.hasCapability('return_arrival_time')) {
                    const retArrDate = this.api.createCETDate(result.returnArrivalDate, result.returnArrivalTime);
                    const retArrStr = retArrDate.toLocaleDateString('nb-NO', {
                        timeZone: 'Europe/Oslo',
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    await this.setCapabilityValue('return_arrival_time', retArrStr)
                        .catch(err => this.error('Error setting return_arrival_time:', err));
                }

                // Return trip duration
                if (result.returnDurationFormatted && this.hasCapability('return_duration')) {
                    await this.setCapabilityValue('return_duration', result.returnDurationFormatted)
                        .catch(err => this.error('Error setting return_duration:', err));
                }

                // ── Flow triggers (change detection) ────────────────────
                await this._checkAndFireTriggers(result, shipName).catch(err => {
                    this.error('Error firing flow triggers:', err);
                });

            } else {
                this.log('No valid booking found or response invalid', result);
            }
            
        } catch (error) {
            this.error('Polling error:', error);
        }
    }
    /**
     * Check for value changes and fire flow triggers as needed.
     * @param {Object} result - The booking result from the API
     * @param {string} shipName - The resolved ship name
     */
    async _checkAndFireTriggers(result, shipName) {
        const prev = this._previousValues;
        const currentHours = this.getCapabilityValue('measure_time_remaining');

        // Build current departure string for comparison
        let currentDeparture = null;
        if (result.date) {
            currentDeparture = result.date + (result.time ? ` ${result.time}` : '');
        }

        // Build current price string for comparison
        let currentPrice = null;
        if (result.totalPrice) {
            currentPrice = result.totalPrice;
            if (result.paymentStatus) {
                currentPrice += ` (${result.paymentStatus})`;
            }
        }

        // ── Hours threshold triggers ────────────────────────────
        if (prev.hoursRemaining !== null && currentHours !== null) {
            const state = {
                previousHours: prev.hoursRemaining,
                currentHours: currentHours
            };

            // hours_dropped_below: pass state so registerRunListener can compare
            await this._trigHoursDroppedBelow.trigger(this, {}, state)
                .catch(err => this.error('Error triggering hours_dropped_below:', err));

            // hours_rose_above: pass state so registerRunListener can compare
            await this._trigHoursRoseAbove.trigger(this, {}, state)
                .catch(err => this.error('Error triggering hours_rose_above:', err));
        }

        // ── Price changed trigger ───────────────────────────────
        if (prev.totalPrice !== null && currentPrice !== null && prev.totalPrice !== currentPrice) {
            this.log(`Price changed: "${prev.totalPrice}" → "${currentPrice}"`);
            await this._trigPriceChanged.trigger(this, {
                old_price: prev.totalPrice,
                new_price: currentPrice
            }).catch(err => this.error('Error triggering price_changed:', err));
        }

        // ── Ship changed trigger ────────────────────────────────
        if (prev.shipName !== null && shipName && prev.shipName !== shipName) {
            this.log(`Ship changed: "${prev.shipName}" → "${shipName}"`);
            await this._trigShipChanged.trigger(this, {
                old_ship: prev.shipName,
                new_ship: shipName
            }).catch(err => this.error('Error triggering ship_changed:', err));
        }

        // ── Departure date changed trigger ──────────────────────
        if (prev.departureTime !== null && currentDeparture !== null && prev.departureTime !== currentDeparture) {
            this.log(`Departure changed: "${prev.departureTime}" → "${currentDeparture}"`);
            await this._trigDepartureDateChanged.trigger(this, {
                old_departure: prev.departureTime,
                new_departure: currentDeparture
            }).catch(err => this.error('Error triggering departure_date_changed:', err));
        }

        // Update previous values for next poll cycle
        this._previousValues = {
            hoursRemaining: currentHours,
            totalPrice: currentPrice,
            shipName: shipName || prev.shipName,
            departureTime: currentDeparture || prev.departureTime
        };
    }
}

module.exports = BookingDevice;
