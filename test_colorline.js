require('dotenv').config();
const ColorLineAPI = require('./lib/ColorLineAPI');

async function test() {
    console.log('Testing Color Line API...');
    
    const api = new ColorLineAPI();
    
    // Step 1: Establish session
    console.log('Fetching getContent.do to establish session...');
    try {
        await api.getContent();
        // Use getCookieString() if available, or just log manually if needed
        console.log('Session established. Cookie:', api.getCookieString ? api.getCookieString() : 'Method not found but flow continues');
    } catch (err) {
        console.error('Failed to establish session:', err);
    }

    // Read credentials from environment variables
    const lastName = process.env.COLORLINE_LASTNAME;
    const bookingRef = process.env.COLORLINE_BOOKING_REF;

    if (!lastName || !bookingRef) {
        console.error('Please set COLORLINE_LASTNAME and COLORLINE_BOOKING_REF environment variables.');
        console.error('Example: COLORLINE_LASTNAME=smith COLORLINE_BOOKING_REF=ABC1234 node test_colorline.js');
        return;
    }
    
    console.log(`Testing getBookingURL for ${lastName} / ${bookingRef}...`);
    
    try {
        const result = await api.getBookingURL(lastName, bookingRef);
        console.log('Booking URL Result:', JSON.stringify(result, null, 2));

        if (result && result.sailingsReference) {
             console.log('SUCCESS: sailingsReference extracted:', result.sailingsReference);
        } else {
             console.log('WARNING: sailingsReference not found');
        }
        
    } catch (error) {
        console.error('Test failed:', error);
    }
}

test();
