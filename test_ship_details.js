const ColorLineAPI = require('./lib/ColorLineAPI');
const fetch = require('node-fetch');

/**
 * Helper: find all occurrences of a search term in HTML and log surrounding context
 */
function findAndLogContext(html, searchTerm, contextChars = 300) {
    const lowerHtml = html.toLowerCase();
    const lowerSearch = searchTerm.toLowerCase();
    let pos = 0;
    let count = 0;
    
    while ((pos = lowerHtml.indexOf(lowerSearch, pos)) !== -1) {
        count++;
        const start = Math.max(0, pos - contextChars);
        const end = Math.min(html.length, pos + searchTerm.length + contextChars);
        const context = html.substring(start, end).replace(/\s+/g, ' ');
        console.log(`\n  Match #${count} at position ${pos}:`);
        console.log(`  ...${context}...`);
        pos += searchTerm.length;
    }
    
    if (count === 0) {
        console.log(`  (no matches found)`);
    }
    return count;
}

async function test() {
    console.log('=== Date Extraction Debug Test ===\n');
    
    const api = new ColorLineAPI();
    
    // 1. Establish session
    console.log('Step 1: Establishing session...');
    try {
        await api.getContent();
        console.log('Session established.\n');
    } catch (err) {
        console.error('Failed to establish session:', err);
        return;
    }

    // Read credentials from environment variables
    const lastName = process.env.COLORLINE_LASTNAME;
    const bookingRef = process.env.COLORLINE_BOOKING_REF;

    if (!lastName || !bookingRef) {
        console.error('Please set COLORLINE_LASTNAME and COLORLINE_BOOKING_REF environment variables.');
        console.error('Example: COLORLINE_LASTNAME=smith COLORLINE_BOOKING_REF=ABC1234 node test_ship_details.js');
        return;
    }

    // 2. Get booking via the full API flow (so we get a fresh encrypted URL)
    console.log('Step 2: Getting booking URL via Aura API...');
    let bookingResult;
    try {
        bookingResult = await api.getBookingURL(lastName, bookingRef);
        console.log('\nBooking result:', JSON.stringify(bookingResult, null, 2));
    } catch (err) {
        console.error('Failed to get booking URL:', err);
        return;
    }

    // 3. Also do a direct fetch to get the raw HTML for deeper analysis
    // We need to re-establish session and follow the flow again to get fresh HTML
    console.log('\n\nStep 3: Re-fetching booking page for HTML analysis...');
    
    const api2 = new ColorLineAPI();
    await api2.getContent();
    
    // Get booking URL from Aura
    const url = 'https://colorline.my.site.com/CC/s/sfsites/aura?r=7&other.BookingOJ.getBookingURL=1';
    
    const message = {
        actions: [{
            id: "196;a",
            descriptor: "apex://BookingOJController/ACTION$getBookingURL",
            callingDescriptor: "markup://c:bookingOJ",
            params: {
                accountProfileId: "31148015",
                mailingcountrycode: "NO",
                lastNamevalue: lastName,
                bookingReference: bookingRef
            },
            version: null
        }]
    };
    
    const auraContext = {
        mode: "PROD",
        fwuid: api2.fwuid,
        app: "siteforce:communityApp",
        loaded: { "APPLICATION@markup://siteforce:communityApp": api2.appLoaded },
        dn: [], globals: {}, uad: true
    };
    
    const { URLSearchParams } = require('url');
    const params = new URLSearchParams();
    params.append('message', JSON.stringify(message));
    params.append('aura.context', JSON.stringify(auraContext));
    params.append('aura.pageURI', '/CC/s/guest/checkmybooking?language=no');
    params.append('aura.token', 'null');
    
    const auraResp = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': 'Mozilla/5.0',
            'Origin': 'https://colorline.my.site.com',
            'Cookie': api2.getCookieString() || ''
        },
        body: params
    });
    api2.updateCookies(auraResp);
    
    let auraText = await auraResp.text();
    if (auraText.startsWith('*/')) auraText = auraText.substring(2);
    const auraData = JSON.parse(auraText);
    const bookingUrl = auraData.actions[0].returnValue;
    console.log('Booking URL:', bookingUrl);
    
    // Follow redirect
    const redirectResp = await fetch(bookingUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Cookie': api2.getCookieString() || ''
        }
    });
    
    let html = '';
    if (redirectResp.status >= 300 && redirectResp.status < 400) {
        const location = redirectResp.headers.get('location');
        const finalUrl = location.startsWith('http') ? location : `https://www.colorline.no${location}`;
        console.log('Following redirect to:', finalUrl);
        
        const finalResp = await fetch(finalUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Cookie': api2.getCookieString() || ''
            }
        });
        api2.updateCookies(finalResp);
        html = await finalResp.text();
    } else {
        html = await redirectResp.text();
    }
    
    console.log(`\nHTML length: ${html.length} chars\n`);
    
    // 4. Search for date-related patterns
    console.log('=== Searching for date-related patterns ===\n');
    
    const searches = [
        { term: '2026', desc: 'Year 2026' },
        { term: 'mars', desc: 'Norwegian month "mars" (March)' },
        { term: 'march', desc: 'English month "March"' },
        { term: 'mar', desc: 'Abbreviated month "mar"' },
        { term: '21.03', desc: 'Date fragment 21.03' },
        { term: '03.2026', desc: 'Date fragment 03.2026' },
        { term: '2026-03', desc: 'ISO date fragment 2026-03' },
        { term: '21/03', desc: 'Date fragment 21/03' },
        { term: 'Avreise', desc: 'Norwegian "Departure"' },
        { term: 'avreise', desc: 'Norwegian "departure" (lowercase)' },
        { term: 'Dato', desc: 'Norwegian "Date"' },
        { term: 'dato', desc: 'Norwegian "date" (lowercase)' },
        { term: 'Departure', desc: 'English "Departure"' },
        { term: 'departureDate', desc: 'departureDate attribute' },
        { term: 'Skip', desc: 'Norwegian "Ship"' },
        { term: 'Color Magic', desc: 'Ship name' },
        { term: 'Color Fantasy', desc: 'Ship name alt' },
        { term: 'Rute', desc: 'Norwegian "Route"' },
        { term: 'Oslo', desc: 'City Oslo' },
        { term: 'Kiel', desc: 'City Kiel' },
        { term: bookingRef, desc: 'Booking reference' },
        { term: 'sailDate', desc: 'sailDate attribute' },
        { term: 'departDate', desc: 'departDate attribute' },
        { term: 'travelDate', desc: 'travelDate attribute' },
    ];
    
    for (const s of searches) {
        console.log(`--- Searching for: "${s.term}" (${s.desc}) ---`);
        findAndLogContext(html, s.term, 300);
    }
    
    // 5. Search for all date-like patterns (dd.mm.yyyy, yyyy-mm-dd, etc.)
    console.log('\n\n=== Searching for date-like regex patterns ===\n');
    
    // dd.mm.yyyy
    const ddmmyyyy = html.match(/\d{1,2}\.\d{1,2}\.\d{4}/g);
    if (ddmmyyyy) {
        console.log('dd.mm.yyyy matches:', ddmmyyyy);
    } else {
        console.log('dd.mm.yyyy: no matches');
    }
    
    // yyyy-mm-dd
    const isoDates = html.match(/\d{4}-\d{2}-\d{2}/g);
    if (isoDates) {
        console.log('yyyy-mm-dd matches:', isoDates);
    } else {
        console.log('yyyy-mm-dd: no matches');
    }
    
    // dd/mm/yyyy
    const slashDates = html.match(/\d{1,2}\/\d{1,2}\/\d{4}/g);
    if (slashDates) {
        console.log('dd/mm/yyyy matches:', slashDates);
    } else {
        console.log('dd/mm/yyyy: no matches');
    }
    
    // Norwegian text dates like "21. mars 2026"
    const textDates = html.match(/\d{1,2}\.?\s+(?:januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)\s+\d{4}/gi);
    if (textDates) {
        console.log('Norwegian text date matches:', textDates);
    } else {
        console.log('Norwegian text dates: no matches');
    }
    
    // Any 4-digit number that could be a year (2025-2027)
    const years = html.match(/20(?:2[5-7])/g);
    if (years) {
        console.log(`Year-like patterns (2025-2027): found ${years.length} occurrences`);
    } else {
        console.log('Year-like patterns (2025-2027): no matches');
    }
    
    // 6. Dump sections of the HTML for manual inspection
    console.log('\n\n=== HTML Dump (first 5000 chars) ===');
    console.log(html.substring(0, 5000));
    
    console.log('\n\n=== HTML Dump (chars 5000-10000) ===');
    console.log(html.substring(5000, 10000));
    
    console.log('\n\n=== HTML Dump (chars 10000-15000) ===');
    console.log(html.substring(10000, 15000));
    
    console.log('\n\nDone.');
}

test();
