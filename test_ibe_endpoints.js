'use strict';

/**
 * Diagnostic script: probe the OpenJaw IBE for JSON endpoints.
 *
 * Purpose: Determine whether Color Line's booking site exposes any JSON
 * endpoints (e.g. retrieveBooking.do, getBooking.do) that could replace
 * HTML scraping in the future.
 *
 * What it does:
 *  1. Loads .env credentials via dotenv
 *  2. Establishes a session via ColorLineAPI.getContent()
 *  3. Fetches the booking URL via the Aura API
 *  4. Follows the redirect chain to the final colorline.no booking page
 *  5. Saves the raw booking page HTML to booking_debug.html (for offline inspection)
 *  6. Probes a list of common OpenJaw IBE paths with the session cookie,
 *     logging HTTP status and Content-Type for each
 *
 * Usage:
 *   node test_ibe_endpoints.js
 *
 * IMPORTANT: This script is for local diagnostics only. It must never be
 * imported by the Homey app (app.js, drivers/, lib/).
 * Credentials are loaded from .env — never commit real credentials.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const ColorLineAPI = require('./lib/ColorLineAPI');

// ── Credentials ────────────────────────────────────────────────────────────
const LAST_NAME    = process.env.COLORLINE_LASTNAME   || process.env.lastname;
const BOOKING_REF  = process.env.COLORLINE_BOOKING_REF || process.env.bookingnumber;

if (!LAST_NAME || !BOOKING_REF) {
    console.error('Missing credentials. Set COLORLINE_LASTNAME and COLORLINE_BOOKING_REF in .env');
    process.exit(1);
}

// ── IBE paths to probe ─────────────────────────────────────────────────────
// These are common OpenJaw IBE endpoint patterns. We're looking for any that
// return JSON (application/json or text/javascript) rather than HTML.
const IBE_PATHS_TO_PROBE = [
    '/ibe/profile/retrieveBooking.do',
    '/ibe/profile/getBooking.do',
    '/ibe/profile/bookingDetails.do',
    '/ibe/profile/getBookingDetails.do',
    '/ibe/profile/myBooking.do',
    '/ibe/profile/viewBooking.do',
    '/ibe/profile/bookingSummary.do',
    '/ibe/profile/getContent.do',
    '/ibe/json/booking.do',
    '/ibe/json/getBooking.do',
];

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
    const api = new ColorLineAPI();

    // Step 1: Establish session
    console.log('\n=== Step 1: Establishing session ===');
    try {
        await api.getContent();
        console.log('Session cookie obtained:', api.getCookieString() ? 'yes' : 'no');
    } catch (err) {
        console.error('Failed to establish session:', err.message);
        process.exit(1);
    }

    // Step 2: Fetch booking URL via Aura API
    console.log('\n=== Step 2: Fetching booking URL via Aura API ===');
    let bookingResult;
    try {
        bookingResult = await api.getBookingURL(LAST_NAME, BOOKING_REF);
        if (!bookingResult) {
            console.error('getBookingURL returned null — check credentials');
            process.exit(1);
        }
        console.log('Booking result:', JSON.stringify(bookingResult, null, 2));
    } catch (err) {
        console.error('Failed to get booking URL:', err.message);
        process.exit(1);
    }

    // Determine the base colorline.no URL for IBE probing
    const bookingPageUrl = bookingResult.rawUrl || null;
    let baseIbeUrl = 'https://www.colorline.no';
    let sessionCookie = api.getCookieString() || '';

    // Step 3: Fetch final booking page and save HTML
    console.log('\n=== Step 3: Fetching final booking page HTML ===');
    if (bookingPageUrl) {
        try {
            const pageResp = await fetch(bookingPageUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept-Language': 'nb-NO,nb;q=0.9',
                    'Cookie': sessionCookie,
                    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8'
                }
            });
            console.log(`Booking page: HTTP ${pageResp.status} (${pageResp.headers.get('content-type')})`);

            // Capture any updated cookies
            const rawCookies = pageResp.headers.raw()['set-cookie'];
            if (rawCookies) {
                // Merge new cookies into existing session cookie string
                const cookieMap = {};
                sessionCookie.split('; ').forEach(c => {
                    const [k, ...rest] = c.split('=');
                    if (k) cookieMap[k] = rest.join('=');
                });
                rawCookies.forEach(c => {
                    const [k, ...rest] = c.split(';')[0].split('=');
                    if (k) cookieMap[k] = rest.join('=');
                });
                sessionCookie = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
            }

            const html = await pageResp.text();
            const debugFile = path.join(__dirname, 'booking_debug.html');
            fs.writeFileSync(debugFile, html, 'utf8');
            console.log(`Saved ${html.length} bytes to ${debugFile}`);

            // Extract the base URL for IBE probing
            const urlObj = new URL(bookingPageUrl);
            baseIbeUrl = `${urlObj.protocol}//${urlObj.host}`;
        } catch (err) {
            console.warn('Could not fetch/save booking page:', err.message);
        }
    } else {
        console.log('No rawUrl in booking result, skipping booking page fetch');
    }

    // Step 4: Probe IBE endpoints
    console.log(`\n=== Step 4: Probing IBE endpoints on ${baseIbeUrl} ===`);
    console.log('Cookie length:', sessionCookie.length);
    console.log('');

    const results = [];
    for (const probePath of IBE_PATHS_TO_PROBE) {
        const probeUrl = `${baseIbeUrl}${probePath}`;
        try {
            const probeResp = await fetch(probeUrl, {
                method: 'GET',
                redirect: 'manual',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept-Language': 'nb-NO,nb;q=0.9',
                    'Cookie': sessionCookie,
                    'Accept': 'application/json,text/html,*/*;q=0.8'
                }
            });

            const contentType = probeResp.headers.get('content-type') || '(none)';
            const isJson = contentType.includes('json') || contentType.includes('javascript');
            const isRedirect = probeResp.status >= 300 && probeResp.status < 400;
            const redirectTarget = isRedirect ? probeResp.headers.get('location') : null;

            const entry = {
                path: probePath,
                status: probeResp.status,
                contentType,
                isJson,
                redirectTarget
            };
            results.push(entry);

            const flag = isJson ? ' ← JSON!' : (isRedirect ? ` → ${redirectTarget}` : '');
            console.log(`  ${probeResp.status}  ${probePath}  [${contentType}]${flag}`);

            // If JSON, print a snippet
            if (isJson) {
                try {
                    const body = await probeResp.text();
                    console.log('    Snippet:', body.substring(0, 500));
                } catch (_) { /* ignore */ }
            }
        } catch (err) {
            console.log(`  ERR  ${probePath}  ${err.message}`);
            results.push({ path: probePath, error: err.message });
        }

        // Brief delay to avoid hammering the server
        await new Promise(r => setTimeout(r, 300));
    }

    // Summary
    const jsonEndpoints = results.filter(r => r.isJson);
    console.log('\n=== Summary ===');
    if (jsonEndpoints.length > 0) {
        console.log('JSON endpoints found:');
        jsonEndpoints.forEach(e => console.log(`  ${e.status}  ${e.path}  [${e.contentType}]`));
    } else {
        console.log('No JSON endpoints found — HTML scraping remains the only option.');
    }
    console.log(`\nbooking_debug.html saved for offline HTML inspection.`);
}

main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
