# Color Line Booking

A [Homey](https://homey.app) app that tracks your Color Line ferry bookings and exposes live travel data as device capabilities and flow tokens.

## Disclaimer

Not endorsed nor supported by Color Line. Unofficial. This was not made to be 'the beast', but to solve a specific usecase and partly use webscaping. If it works; nice! If it suddenly doesn't; give me a heads up and I'll have opencode take a look :)

## What it does

Color Line Booking retrieves your booking details from Color Line's booking system and keeps them updated on your Homey. All data is available as device capabilities for use in the Homey UI and as flow tokens in automations.

### Tracked data

| Capability | Description |
|---|---|
| Hours until departure | Countdown in hours (with Insights logging) |
| Days until departure | Countdown in days (with Insights logging) |
| Departure time | Outbound departure date and time (CET) |
| Arrival time | Outbound arrival date and time (CET) |
| Trip duration | Sailing duration (e.g. "20h") |
| Ship name | Assigned vessel (e.g. Color Magic) |
| Route | Sailing route (e.g. Oslo - Kiel) |
| Trip type | One-way or Round trip |
| Cabins | Cabin types and details |
| Guests | Total passenger count across all cabins |
| Total price | Price with payment status |
| Booking reference | Your booking code |
| Return departure | Return leg departure (round trips) |
| Return arrival | Return leg arrival (round trips) |
| Return duration | Return leg sailing duration (round trips) |

### Flow cards

**Triggers:**
- Hours until departure dropped below / rose above a threshold
- Price changed
- Ship changed
- Departure date changed

**Conditions:**
- Hours until departure is less than / greater than a value

## Setup

1. Install the app on your Homey
2. Add a new "Color Line Booking" device
3. Enter your **last name** and **booking number** (found in your confirmation email)
4. The app will fetch and display all booking details

Polling interval is configurable in device settings (default: 60 minutes, min: 15 minutes).

## Requirements

- Homey Pro (SDK 3, firmware >= 5.0.0)
- An active Color Line booking

## Technical notes

- Data is scraped from Color Line's booking page (OpenJaw/Salesforce-backed). There is no official public API.
- The Salesforce Aura framework tokens (`fwuid`, `appLoaded`) are hardcoded and will need updating when Color Line deploys site changes.
- All times are CET/CEST (Europe/Oslo timezone).
- Round trip detection is automatic based on route pattern (A - B - A) and leg info blocks.
- Multiple cabins and passengers are fully supported.

## Privacy

- Your last name and booking number are stored locally on your Homey device and are only sent to Color Line's servers to retrieve booking data.
- No data is sent to any third party.
- Credentials are not logged.

## License

MIT

## Notes

Created largely by opencode and AI. Code review has not revealed security issues. Color Line has no official API nor supported this app in any way. All contributions, ideas and feedback welcome. 

## Author

- Steffen Fridtjofsen
- opencode
