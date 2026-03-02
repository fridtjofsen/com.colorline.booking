const fetch = require('node-fetch');
const { URLSearchParams } = require('url');

// How long to cache Salesforce Aura framework tokens before re-discovering them.
// These only change when Color Line deploys a new Salesforce version (rarely).
// 24 hours is a safe default: fresh enough to catch a daytime deploy, but low
// enough traffic to avoid hammering the community site.
const AURA_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

class ColorLineAPI {
    constructor() {
        this.baseUrlColorLine = 'https://www.colorline.no';
        this.baseUrlAura = 'https://colorline.my.site.com';
        
        // IMPORTANT: These values are from the Salesforce Aura framework and
        // will change when Color Line deploys a new version of their site.
        // They are now auto-refreshed via _refreshAuraTokens() which fetches
        // the community page and extracts current values before each Aura call.
        // The values below are kept as a fallback in case auto-discovery fails.
        this.fwuid = 'SHNaWGp5QlJqZFZLVGR5N0w0d0tYUTJEa1N5enhOU3R5QWl2VzNveFZTbGcxMy4tMjE0NzQ4MzY0OC45OTYxNDcy';
        this.appLoaded = '1526_bpCZOEd6nrsbI-UTWwrzuw';

        // Timestamp of the last successful token discovery (null = never refreshed)
        this._tokensRefreshedAt = null;
        
        this.cookie = null;

        // Common headers for all requests.
        // Accept-Language is forced to Norwegian so the booking page always
        // renders in Norwegian regardless of the user's system locale.
        this.commonHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,nn;q=0.7,en;q=0.3'
        };
    }

    getCookieString() {
        return this.cookie;
    }

    /**
     * Auto-discover current Salesforce Aura framework tokens from the community
     * page. These tokens (fwuid and appLoaded) are embedded as plain JSON in an
     * inline <script> block and change whenever Color Line deploys a new
     * Salesforce version.
     *
     * Results are cached for AURA_TOKEN_TTL_MS (24 h). Pass force=true to
     * bypass the cache, e.g. after an Aura API error that looks token-related.
     *
     * @param {boolean} [force=false] - Ignore TTL and always re-fetch
     * @returns {Promise<boolean>} true if tokens were updated, false if cache hit
     */
    async _refreshAuraTokens(force = false) {
        const now = Date.now();
        if (!force && this._tokensRefreshedAt && (now - this._tokensRefreshedAt) < AURA_TOKEN_TTL_MS) {
            return false; // still within TTL, nothing to do
        }

        const communityUrl = `${this.baseUrlAura}/CC/s/guest/checkmybooking?language=no`;
        console.log(`Refreshing Aura tokens from ${communityUrl}...`);

        try {
            const response = await this.fetchWithRetry(communityUrl, {
                method: 'GET',
                headers: {
                    ...this.commonHeaders,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });

            if (!response.ok) {
                console.warn(`Token refresh: community page returned HTTP ${response.status}, keeping existing tokens`);
                return false;
            }

            const html = await response.text();

            // Both tokens appear in the auraConfig inline script block as JSON:
            //   "fwuid":"<base64>"
            //   "APPLICATION@markup://siteforce:communityApp":"<hash>"
            const fwuidMatch = html.match(/"fwuid"\s*:\s*"([^"]+)"/);
            const appLoadedMatch = html.match(/"APPLICATION@markup:\/\/siteforce:communityApp"\s*:\s*"([^"]+)"/);

            if (!fwuidMatch || !appLoadedMatch) {
                console.warn('Token refresh: could not find fwuid or appLoaded in community page, keeping existing tokens');
                return false;
            }

            const newFwuid = fwuidMatch[1];
            const newAppLoaded = appLoadedMatch[1];
            const changed = newFwuid !== this.fwuid || newAppLoaded !== this.appLoaded;

            if (changed) {
                console.log(`Aura tokens updated — fwuid: ${this.fwuid.substring(0, 12)}... → ${newFwuid.substring(0, 12)}...`);
            } else {
                console.log('Aura tokens confirmed current (no change)');
            }

            this.fwuid = newFwuid;
            this.appLoaded = newAppLoaded;
            this._tokensRefreshedAt = now;
            return changed;

        } catch (error) {
            console.warn('Token refresh failed, keeping existing tokens:', error.message);
            return false;
        }
    }

    /**
     * Classify a Salesforce Aura error to decide whether retrying after a
     * token refresh is worthwhile.
     *
     * @param {Array} errors - The error array from data.actions[0].error
     * @returns {{ isTokenError: boolean, isCredentialError: boolean, message: string }}
     */
    _classifyAuraError(errors) {
        if (!errors || errors.length === 0) {
            return { isTokenError: false, isCredentialError: false, message: 'Unknown Aura error' };
        }

        const err = errors[0];
        const exType  = (err.exceptionType || '').toLowerCase();
        const msg     = (err.message || err.data || JSON.stringify(err)).toLowerCase();
        const fullMsg = `${err.exceptionType || ''}: ${err.message || err.data || JSON.stringify(err)}`;

        // Framework / token staleness indicators
        const isTokenError = (
            msg.includes('fwuid') ||
            msg.includes('invalid app') ||
            msg.includes('invalid framework') ||
            msg.includes('context') ||
            msg.includes('expired') ||
            exType.includes('invalidparameter') ||
            exType.includes('noapexresponse')
        );

        // Credential / booking-not-found errors — don't bother retrying
        const isCredentialError = (
            msg.includes('invalid credentials') ||
            msg.includes('booking not found') ||
            msg.includes('no booking') ||
            msg.includes('not found') ||
            exType.includes('invalid_credentials') ||
            exType.includes('security')
        );

        return { isTokenError, isCredentialError, message: fullMsg };
    }

    /**
     * Fetch with exponential backoff retry.
     * Retries on network errors and 5xx responses.
     * @param {string} url - URL to fetch
     * @param {Object} options - fetch options
     * @param {number} [maxRetries=3] - Maximum number of retries
     * @returns {Promise<Response>} The fetch response
     */
    async fetchWithRetry(url, options, maxRetries = 3) {
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, options);
                // Retry on 5xx server errors (not on 3xx redirects or 4xx client errors)
                if (response.status >= 500 && attempt < maxRetries) {
                    console.log(`Server error ${response.status}, retry ${attempt + 1}/${maxRetries}...`);
                    await this._sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
                    continue;
                }
                return response;
            } catch (error) {
                lastError = error;
                if (attempt < maxRetries) {
                    console.log(`Network error, retry ${attempt + 1}/${maxRetries}: ${error.message}`);
                    await this._sleep(1000 * Math.pow(2, attempt));
                }
            }
        }
        throw lastError;
    }

    /**
     * Sleep helper for retry backoff.
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise<void>}
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Create a Date object from a date string and time string, treating
     * them as CET (Europe/Oslo) times. Color Line operates in CET/CEST,
     * so all times on the booking page are in that timezone.
     *
     * Uses Intl.DateTimeFormat to determine the UTC offset for CET at
     * the given date, correctly handling CET/CEST transitions.
     *
     * @param {string} isoDate - Date in yyyy-mm-dd format
     * @param {string} [timeStr] - Time in HH:MM format (defaults to "00:00")
     * @returns {Date} Date object representing the correct UTC instant
     */
    createCETDate(isoDate, timeStr) {
        const [h, m] = (timeStr || '00:00').split(':').map(Number);
        // Build a date in UTC first, then adjust for CET offset
        const naive = new Date(`${isoDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
        
        // Determine CET/CEST offset at this date using Intl
        // CET = UTC+1, CEST = UTC+2
        try {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Europe/Oslo',
                hour: 'numeric',
                hour12: false,
                timeZoneName: 'shortOffset'
            });
            const parts = formatter.formatToParts(naive);
            const tzPart = parts.find(p => p.type === 'timeZoneName');
            if (tzPart) {
                // tzPart.value is like "GMT+1" or "GMT+2"
                const offsetMatch = tzPart.value.match(/GMT([+-]?\d+)/);
                if (offsetMatch) {
                    const offsetHours = parseInt(offsetMatch[1], 10);
                    // We built the date as if it were UTC, but the time is actually CET.
                    // So subtract the CET offset to get the true UTC time.
                    naive.setTime(naive.getTime() - offsetHours * 60 * 60 * 1000);
                    return naive;
                }
            }
        } catch (e) {
            // Intl not available or timezone not supported, fall back to CET=UTC+1
            console.log('Intl timezone detection failed, assuming CET (UTC+1)');
        }
        
        // Fallback: assume CET (UTC+1)
        naive.setTime(naive.getTime() - 1 * 60 * 60 * 1000);
        return naive;
    }

    /**
     * Helper to update cookies from response
     * @param {Object} response - The fetch response object
     */
    updateCookies(response) {
        const rawCookies = response.headers.raw()['set-cookie'];
        if (rawCookies) {
            const url = new URL(response.url);
            const domain = url.hostname;
            
            console.log(`Updating cookies for domain: ${domain}`);
            
            // Parse existing cookies into an object
            let currentCookies = {};
            if (this.cookie) {
                this.cookie.split('; ').forEach(c => {
                    // Split by first '=' only
                    const parts = c.split('=');
                    const key = parts[0];
                    const val = parts.slice(1).join('=');
                    if (key) currentCookies[key] = val;
                });
            }

            // Parse new cookies
            rawCookies.forEach(c => {
                // simple parse: name=value; ...
                const cookieStr = c.split(';')[0];
                const parts = cookieStr.split('=');
                const key = parts[0];
                const val = parts.slice(1).join('=');
                
                // Special handling for JSESSIONID
                if (key === 'JSESSIONID') {
                    // HEURISTIC: Only update JSESSIONID if the domain is colorline.no
                    // We assume colorline.no sets the main session we need for the redirect.
                    // The Aura site (my.site.com) might set its own or clear it, but we should ignore it
                    // to keep the colorline.no session active.
                    if (!domain.includes('colorline.no')) {
                        console.log(`Ignoring JSESSIONID from ${domain} to protect colorline.no session`);
                        return;
                    }
                }
                
                if (key) currentCookies[key] = val;
            });

            this.cookie = Object.entries(currentCookies)
                .map(([k, v]) => v ? `${k}=${v}` : `${k}=`) // Handle empty values correctly
                .join('; ');
            console.log('Updated cookie jar:', this.cookie);
        }
    }

    /**
     * Fetch content from getContent.do
     * @returns {Promise<Object>} JSON response
     */
    async getContent() {
        const url = `${this.baseUrlColorLine}/ibe/profile/getContent.do`;
        try {
            const response = await this.fetchWithRetry(url, {
                method: 'GET',
                headers: {
                    ...this.commonHeaders,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            this.updateCookies(response);

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error fetching content:', error);
            throw error;
        }
    }

    /**
     * Get the Booking URL using the Aura API
     * @param {string} lastName - The last name of the passenger
     * @param {string} bookingRef - The booking reference code
     * @returns {Promise<Object|null>} Object containing sailingsReference and booking details, or null if failed
     */
    async getBookingURL(lastName, bookingRef) {
        // Ensure we have a session cookie
        if (!this.cookie) {
            console.log('No session cookie found, fetching content first...');
            await this.getContent();
        }

        // Refresh Aura tokens if TTL has elapsed (no-op on the vast majority of polls)
        await this._refreshAuraTokens();

        const url = `${this.baseUrlAura}/CC/s/sfsites/aura?r=7&other.BookingOJ.getBookingURL=1`;

        // message params do not depend on tokens — build once, reuse on retry
        const message = {
            actions: [
                {
                    id: "196;a",
                    descriptor: "apex://BookingOJController/ACTION$getBookingURL",
                    callingDescriptor: "markup://c:bookingOJ",
                    params: {
                        // NOTE: accountProfileId appears to be a fixed/global value
                        // used by Color Line's Salesforce instance, not user-specific.
                        // If lookups fail for other users, this may need investigation.
                        accountProfileId: "31148015",
                        mailingcountrycode: "NO",
                        lastNamevalue: lastName,
                        bookingReference: bookingRef
                    },
                    version: null
                }
            ]
        };

        // Retry loop: up to 2 attempts.
        // Attempt 1 uses current tokens; if the response signals a token/framework
        // error, tokens are force-refreshed and attempt 2 is made automatically.
        for (let attempt = 1; attempt <= 2; attempt++) {
            // Rebuild auraContext inside the loop so attempt 2 picks up fresh tokens
            const auraContext = {
                mode: "PROD",
                fwuid: this.fwuid,
                app: "siteforce:communityApp",
                loaded: {
                    "APPLICATION@markup://siteforce:communityApp": this.appLoaded
                },
                dn: [],
                globals: {},
                uad: true
            };

            const params = new URLSearchParams();
            params.append('message', JSON.stringify(message));
            params.append('aura.context', JSON.stringify(auraContext));
            params.append('aura.pageURI', '/CC/s/guest/checkmybooking?language=no');
            params.append('aura.token', 'null');

            const headers = {
                ...this.commonHeaders,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Origin': 'https://colorline.my.site.com',
                'Referer': 'https://colorline.my.site.com/CC/s/',
                'Cookie': this.cookie || ''
            };

            try {
                const response = await this.fetchWithRetry(url, {
                    method: 'POST',
                    headers: headers,
                    body: params
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                // Update cookies if any new ones are set
                this.updateCookies(response);

                const text = await response.text();

                // Aura responses often start with `*/` to prevent JSON hijacking.
                const cleanText = text.startsWith('*/') ? text.substring(2) : text;

                let data;
                try {
                    data = JSON.parse(cleanText);
                } catch (e) {
                    console.error('Error parsing Aura response:', e);
                    return null;
                }

                // Check for errors in the Aura response
                if (data.actions && data.actions[0] && data.actions[0].state === 'ERROR') {
                    const classified = this._classifyAuraError(data.actions[0].error);
                    console.error(`Aura API error (attempt ${attempt}): ${classified.message}`);

                    if (classified.isCredentialError) {
                        // Wrong credentials or booking not found — no point retrying
                        throw new Error(`Booking not found or invalid credentials: ${classified.message}`);
                    }
                    if (classified.isTokenError && attempt === 1) {
                        // Stale framework tokens — force-refresh and retry once
                        console.log('Token/framework error detected, refreshing Aura tokens and retrying...');
                        await this._refreshAuraTokens(true);
                        continue;
                    }
                    throw new Error(`Aura API error: ${classified.message}`);
                }

                if (data.actions && data.actions[0] && data.actions[0].returnValue) {
                    const bookingUrl = data.actions[0].returnValue;
                    console.log('Booking URL found:', bookingUrl);

                    // Try to extract reference directly
                    let result = this.extractSailingsReference(bookingUrl);

                    // If not found (or result is just rawUrl), and it's a valid URL, try to follow it
                    if ((!result || !result.sailingsReference) && bookingUrl.startsWith('http')) {
                        console.log('sailingsReference not found in URL, attempting to follow redirect...');
                        try {
                            // Fetch the URL to follow redirects and get content
                            const redirectResponse = await this.fetchWithRetry(bookingUrl, {
                                method: 'GET',
                                redirect: 'manual',
                                headers: {
                                    ...this.commonHeaders,
                                    'Cookie': this.cookie || '',
                                    'Referer': 'https://colorline.my.site.com/',
                                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
                                }
                            });

                            let finalUrl = bookingUrl;
                            let bodyText = '';

                            if (redirectResponse.status >= 300 && redirectResponse.status < 400) {
                                const location = redirectResponse.headers.get('location');
                                console.log('Redirect location:', location);
                                if (location) {
                                    finalUrl = location.startsWith('http') ? location : `${this.baseUrlColorLine}${location.startsWith('/') ? '' : '/'}${location}`;

                                    // Fetch the final URL to get the body content
                                    console.log('Fetching final URL:', finalUrl);
                                    const finalResponse = await this.fetchWithRetry(finalUrl, {
                                        method: 'GET',
                                        headers: {
                                            ...this.commonHeaders,
                                            'Cookie': this.cookie || ''
                                        }
                                    });
                                    this.updateCookies(finalResponse);
                                    bodyText = await finalResponse.text();
                                }
                            } else {
                                // If no redirect, use current response body
                                finalUrl = redirectResponse.url;
                                bodyText = await redirectResponse.text();
                            }

                            // Extract all booking details from HTML (ship, date, route)
                            const htmlDetails = this.extractBookingDetailsFromHTML(bodyText);

                            // Check for sailingsReference in the body if not already found
                            if (!result || !result.sailingsReference) {
                                const linkMatch = bodyText.match(/href="[^"]*sailingsReference=([A-Z0-9]+)[^"]*"/);
                                if (linkMatch) {
                                    result = this.parseSailingsReference(linkMatch[1]);
                                } else {
                                    // Fallback: try regex for the reference anywhere
                                    const refMatch = bodyText.match(/([A-Z]{6}\d{8})/);
                                    if (refMatch) {
                                        result = this.parseSailingsReference(refMatch[1]);
                                    }
                                }
                            }

                            // If we still don't have a result object but found details, create one
                            if (!result && (htmlDetails.ship || htmlDetails.departureDate)) {
                                result = { rawUrl: finalUrl };
                            }

                            // Merge HTML-extracted details into result
                            if (result) {
                                if (htmlDetails.ship) result.ship = htmlDetails.ship;
                                if (htmlDetails.departureDate) result.date = htmlDetails.departureDate;
                                if (htmlDetails.departureTime) result.time = htmlDetails.departureTime;
                                if (htmlDetails.routeName) result.routeName = htmlDetails.routeName;
                                if (htmlDetails.arrivalDate) result.arrivalDate = htmlDetails.arrivalDate;
                                if (htmlDetails.arrivalTime) result.arrivalTime = htmlDetails.arrivalTime;
                                if (htmlDetails.totalPrice) result.totalPrice = htmlDetails.totalPrice;
                                if (htmlDetails.paymentStatus) result.paymentStatus = htmlDetails.paymentStatus;
                                if (htmlDetails.cabins) result.cabins = htmlDetails.cabins;
                                if (htmlDetails.cabinCount) result.cabinCount = htmlDetails.cabinCount;
                                if (htmlDetails.guestCount) result.guestCount = htmlDetails.guestCount;
                                if (htmlDetails.tripType) result.tripType = htmlDetails.tripType;
                                if (htmlDetails.fullRouteName) result.fullRouteName = htmlDetails.fullRouteName;
                                if (htmlDetails.durationMinutes) result.durationMinutes = htmlDetails.durationMinutes;
                                if (htmlDetails.durationFormatted) result.durationFormatted = htmlDetails.durationFormatted;
                                // Return leg data
                                if (htmlDetails.returnDepartureDate) result.returnDepartureDate = htmlDetails.returnDepartureDate;
                                if (htmlDetails.returnDepartureTime) result.returnDepartureTime = htmlDetails.returnDepartureTime;
                                if (htmlDetails.returnArrivalDate) result.returnArrivalDate = htmlDetails.returnArrivalDate;
                                if (htmlDetails.returnArrivalTime) result.returnArrivalTime = htmlDetails.returnArrivalTime;
                                if (htmlDetails.returnRouteName) result.returnRouteName = htmlDetails.returnRouteName;
                                if (htmlDetails.returnDurationMinutes) result.returnDurationMinutes = htmlDetails.returnDurationMinutes;
                                if (htmlDetails.returnDurationFormatted) result.returnDurationFormatted = htmlDetails.returnDurationFormatted;
                            }

                            // If we didn't find sailingsReference but followed redirect, update rawUrl
                            if (result && !result.sailingsReference) {
                                result.rawUrl = finalUrl;
                            }

                        } catch (err) {
                            console.error('Error following booking URL:', err.message);
                        }
                    }

                    return result || { rawUrl: bookingUrl };
                } else {
                    console.warn('No returnValue found in Aura response');
                    return null;
                }

            } catch (error) {
                console.error('Error fetching booking URL:', error);
                throw error;
            }
        }

        // Fallback (should not be reached in normal flow)
        return null;
    }

    /**
     * Extract sailingsReference from the booking URL.
     * @param {string} url - The booking URL
     * @returns {Object|null} Parsed reference details
     */
    extractSailingsReference(url) {
        // Expected URL format example (hypothetical based on sailingReference):
        // ...?sailingsReference=OSLKEL22222222...
        // Or if the URL itself contains the reference.
        // The user prompt said: "Extract sailingsReference from that URL (e.g. OSLKEL22222222)."
        
        try {
            // Check if it's a full URL or a relative path
            const fullUrl = url.startsWith('http') ? url : `${this.baseUrlColorLine}${url.startsWith('/') ? '' : '/'}${url}`;
            const parsedUrl = new URL(fullUrl);
            
            // Look for 'sailingsReference' in search params
            let reference = parsedUrl.searchParams.get('sailingsReference');
            
            // If not found, maybe it's part of the path?
            // User example: OSLKEL22222222
            if (!reference) {
                // Fallback: try to find the pattern in the URL string
                const match = url.match(/([A-Z]{6}\d{8})/);
                if (match) {
                    reference = match[1];
                }
            }

            if (reference) {
                return this.parseSailingsReference(reference);
            } else {
                console.warn('Could not extract sailingsReference from URL:', url);
                return { rawUrl: url };
            }

        } catch (e) {
            console.error('Error extracting reference from URL:', e);
            return null;
        }
    }

    /**
     * Parse sailingsReference - extracts the route code only.
     * The reference (e.g. OSLKEL22222222) is an opaque ID; the numeric
     * part is NOT a reliable departure date.
     * @param {string} reference - e.g., OSLKEL22222222
     * @returns {Object} Parsed details (route only, no date)
     */
    parseSailingsReference(reference) {
        if (!reference || reference.length < 6) return null;
        
        // First 6 chars are the route code (e.g. OSLKEL, KELOSL)
        const route = reference.substring(0, 6);
        
        return {
            sailingsReference: reference,
            route: route
        };
    }

    /**
     * Extract booking details (ship name, departure date, route, time) from HTML body.
     *
     * The OpenJaw booking page uses structural HTML attributes that are
     * language-neutral (name="departuredata", name="shipdata", class="datelabel",
     * class="ellipsisoverflow").  We prefer these over text labels like "Avreise"
     * or "Skip" which depend on the page being rendered in Norwegian.
     *
     * Additionally we force Accept-Language: nb-NO on every request so the
     * server always returns Norwegian, but the extraction logic should still
     * work even if the server ignores that header and returns German / English /
     * Swedish content.
     *
     * @param {string} html - The HTML body of the booking page
     * @returns {Object} Extracted details { ship, departureDate, departureTime, routeName }
     */
    extractBookingDetailsFromHTML(html) {
        const details = {};

        // ── Ship name ────────────────────────────────────────────────
        // Strategy A (structural): name="shipdata" → look for subcolor span
        //   <div name="shipdata"> ... <span class="...subcolor">Color Magic</span>
        const shipStructMatch = html.match(/name="shipdata"[\s\S]*?subcolor">([^<]+)<\/span>/i);
        if (shipStructMatch && shipStructMatch[1]) {
            details.ship = shipStructMatch[1].trim();
            console.log('Found ship name (structural):', details.ship);
        }
        // Strategy B (text label, Norwegian): "Skip" label followed by value
        if (!details.ship) {
            const shipTextMatch = html.match(/importance">Skip<\/span>\s*<span[^>]*>([^<]+)<\/span>/i);
            if (shipTextMatch && shipTextMatch[1]) {
                details.ship = shipTextMatch[1].trim();
                console.log('Found ship name (text label):', details.ship);
            }
        }

        // ── Departure date & time ────────────────────────────────────
        // Strategy 1 (structural, best): name="departuredata" → date & time spans
        //   The departuredata div contains two child divs:
        //     1st: label + city
        //     2nd: date span + time span (both with class "subcolor")
        //   We look for the date pattern (day. month) inside any subcolor span
        //   within the departuredata section.
        //   NOTE: We use [A-Za-z\u00C0-\u024F]+ instead of \w+ to match
        //   Unicode letters (ä, ö, ü, ø, å, etc.) in month names.
        const MONTH_RE = '[A-Za-z\u00C0-\u024F]+';
        const deptMatch = html.match(
            new RegExp('name="departuredata"[\\s\\S]*?subcolor">[^<]*?(\\d{1,2})\\.\\s*(' + MONTH_RE + ')<\\/span>\\s*<span[^>]*>(\\d{1,2}:\\d{2})<\\/span>', 'i')
        );
        if (deptMatch) {
            const day = deptMatch[1];
            const monthAbbr = deptMatch[2];
            const time = deptMatch[3];
            console.log(`Found departuredata date: day=${day}, month=${monthAbbr}, time=${time}`);
            const parsed = this.parseNorwegianAbbrevDate(day, monthAbbr);
            if (parsed) {
                details.departureDate = parsed;
                details.departureTime = time;
                console.log('Parsed departure date (structural):', parsed, time);
            }
        }

        // Strategy 2 (structural): class="datelabel" in the header row
        //   <span class="datelabel desktop-inline subcolor">lø. 21. mar</span>
        if (!details.departureDate) {
            const labelMatch = html.match(
                new RegExp('class="datelabel[^"]*">[^<]*?(\\d{1,2})\\.\\s*(' + MONTH_RE + ')<\\/span>', 'i')
            );
            if (labelMatch) {
                const day = labelMatch[1];
                const monthAbbr = labelMatch[2];
                console.log(`Found datelabel date: day=${day}, month=${monthAbbr}`);
                const parsed = this.parseNorwegianAbbrevDate(day, monthAbbr);
                if (parsed) {
                    details.departureDate = parsed;
                    console.log('Parsed departure date (datelabel):', parsed);
                }
            }
        }

        // Strategy 3 (text, Norwegian): "Utreise" summary line
        //   <p class="inactivecontent">Utreise lø. 21. mar 14:00</p>
        if (!details.departureDate) {
            const headerMatch = html.match(
                new RegExp('Utreise\\s+[^<]*?(\\d{1,2})\\.\\s*(' + MONTH_RE + ')\\s+(\\d{1,2}:\\d{2})', 'i')
            );
            if (headerMatch) {
                const day = headerMatch[1];
                const monthAbbr = headerMatch[2];
                const time = headerMatch[3];
                console.log(`Found header date: day=${day}, month=${monthAbbr}, time=${time}`);
                const parsed = this.parseNorwegianAbbrevDate(day, monthAbbr);
                if (parsed) {
                    details.departureDate = parsed;
                    details.departureTime = time;
                    console.log('Parsed departure date (header text):', parsed, time);
                }
            }
        }

        // Strategy 4 (structural): class="inactivecontent" (language-neutral)
        //   Same element as Strategy 3 but matched by class instead of keyword.
        //   Works even if the label is "Departure", "Abfahrt", "Avresa", etc.
        if (!details.departureDate) {
            const inactiveMatch = html.match(
                new RegExp('class="inactivecontent">[^<]*?(\\d{1,2})\\.\\s*(' + MONTH_RE + ')\\s+(\\d{1,2}:\\d{2})', 'i')
            );
            if (inactiveMatch) {
                const day = inactiveMatch[1];
                const monthAbbr = inactiveMatch[2];
                const time = inactiveMatch[3];
                console.log(`Found inactivecontent date: day=${day}, month=${monthAbbr}, time=${time}`);
                const parsed = this.parseNorwegianAbbrevDate(day, monthAbbr);
                if (parsed) {
                    details.departureDate = parsed;
                    details.departureTime = time;
                    console.log('Parsed departure date (inactivecontent):', parsed, time);
                }
            }
        }

        // Strategy 5 (fallback): any dd.mm.yyyy date anywhere on the page
        if (!details.departureDate) {
            const genericDateMatch = html.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
            if (genericDateMatch) {
                const day = genericDateMatch[1].padStart(2, '0');
                const month = genericDateMatch[2].padStart(2, '0');
                const year = genericDateMatch[3];
                details.departureDate = `${year}-${month}-${day}`;
                console.log('Found date via fallback dd.mm.yyyy:', details.departureDate);
            }
        }

        // ── Arrival date & time ─────────────────────────────────────
        // Strategy (structural): name="arrivaldata" → date & time spans
        //   The first arrivaldata block belongs to the outbound leg.
        //   Structure mirrors departuredata: subcolor spans with date + time.
        const arrMatch = html.match(
            new RegExp('name="arrivaldata"[\\s\\S]*?subcolor">[^<]*?(\\d{1,2})\\.\\s*(' + MONTH_RE + ')<\\/span>\\s*<span[^>]*>(\\d{1,2}:\\d{2})<\\/span>', 'i')
        );
        if (arrMatch) {
            const day = arrMatch[1];
            const monthAbbr = arrMatch[2];
            const time = arrMatch[3];
            console.log(`Found arrivaldata date: day=${day}, month=${monthAbbr}, time=${time}`);
            const parsed = this.parseNorwegianAbbrevDate(day, monthAbbr);
            if (parsed) {
                details.arrivalDate = parsed;
                details.arrivalTime = time;
                console.log('Parsed arrival date (structural):', parsed, time);
            }
        }

        // ── Total price ──────────────────────────────────────────────
        // Structural: <span name="totalprice">NOK&nbsp;18 214,-</span>
        const priceMatch = html.match(/name="totalprice">([^<]+)<\/span>/i);
        if (priceMatch && priceMatch[1]) {
            // Clean up HTML entities and normalise whitespace
            details.totalPrice = priceMatch[1]
                .replace(/&nbsp;/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            console.log('Found total price:', details.totalPrice);
        }

        // ── Payment status ───────────────────────────────────────────
        const paymentMatch = html.match(/name="paymentstatus">([^<]+)<\/span>/i);
        if (paymentMatch && paymentMatch[1]) {
            details.paymentStatus = paymentMatch[1].trim();
            console.log('Found payment status:', details.paymentStatus);
        }

        // ── Cabin details (supports multiple cabins) ─────────────────
        // Each cabin is in: <div ... class="bookingsCabinsText">TEXT</div>
        // The ID pattern is SuperPNRCabinContent-{ref}-{legNum}-{code}-{idx}
        // We collect ALL unique cabin descriptions from leg 1 (outbound).
        // Leg 1 IDs contain "-1-" as the leg number.
        const cabinRegex = /class="bookingsCabinsText"[^>]*>([^<]+)<\/div>/gi;
        const allCabinTexts = [];
        let cabinMatch;
        while ((cabinMatch = cabinRegex.exec(html)) !== null) {
            allCabinTexts.push(cabinMatch[1].trim());
        }

        if (allCabinTexts.length > 0) {
            // Deduplicate: on a round trip, each cabin appears twice (once per leg).
            // We only want the outbound leg's cabins.  The outbound cabins appear
            // first in the HTML, so take the first half if the count is even and
            // the two halves are identical.
            // IMPORTANT: Only deduplicate if this is actually a round trip (detected
            // by multiple leginfo blocks or A-B-A route pattern). Without this check,
            // a one-way trip with 4 identical cabins would be incorrectly halved.
            const isRoundTrip = (html.match(/name="leginfo[^"]*"/gi) || []).length >= 2;
            let cabins = allCabinTexts;
            if (isRoundTrip && cabins.length % 2 === 0) {
                const half = cabins.length / 2;
                const firstHalf = cabins.slice(0, half);
                const secondHalf = cabins.slice(half);
                if (JSON.stringify(firstHalf) === JSON.stringify(secondHalf)) {
                    cabins = firstHalf;
                }
            }

            details.cabins = cabins;
            details.cabinCount = cabins.length;
            console.log(`Found ${cabins.length} cabin(s):`, cabins);

            // Parse guest count from cabin texts.
            // Pattern: "... N Personer" or "... N Passengers" or "... N Personen"
            let totalGuests = 0;
            for (const text of cabins) {
                const guestMatch = text.match(/(\d+)\s*(?:Personer|Passengers|Personen|Pers\.|pax)/i);
                if (guestMatch) {
                    totalGuests += parseInt(guestMatch[1], 10);
                }
            }
            if (totalGuests > 0) {
                details.guestCount = totalGuests;
                console.log('Total guest count:', totalGuests);
            }
        }

        // ── Trip type detection ──────────────────────────────────────
        // Round trip indicator: the <h5> tag shows "A - B - A" pattern,
        // e.g. "Oslo - Kiel - Oslo".  Also detected by multiple leginfo blocks.
        const tripHeaderMatch = html.match(/<h5>([^<]+)<\/h5>/i);
        if (tripHeaderMatch) {
            const header = tripHeaderMatch[1].trim();
            // Check for A - B - A pattern (3+ city names separated by " - ")
            const cities = header.split(/\s*-\s*/);
            if (cities.length >= 3 && cities[0].toLowerCase() === cities[cities.length - 1].toLowerCase()) {
                details.tripType = 'Round trip';
                details.fullRouteName = header;
            } else if (cities.length === 2) {
                details.tripType = 'One way';
                details.fullRouteName = header;
            }
            console.log('Trip type:', details.tripType, '| Full route:', details.fullRouteName);
        }

        // Also count leg info blocks as a fallback
        const legInfoCount = (html.match(/name="leginfo[^"]*"/gi) || []).length;
        if (!details.tripType && legInfoCount >= 2) {
            details.tripType = 'Round trip';
        } else if (!details.tripType) {
            details.tripType = 'One way';
        }

        // ── Route name ───────────────────────────────────────────────
        // Structural: <span class="ellipsisoverflow">Oslo - Kiel</span>
        const routeMatch = html.match(/ellipsisoverflow">([^<]+)<\/span>/i);
        if (routeMatch && routeMatch[1]) {
            details.routeName = routeMatch[1].trim();
            console.log('Found route name:', details.routeName);
        }

        // ── Duration calculation ─────────────────────────────────────
        // Calculate the duration of the outbound leg (departure → arrival)
        // Uses CET-aware dates since Color Line times are in Europe/Oslo timezone
        if (details.departureDate && details.departureTime && details.arrivalDate && details.arrivalTime) {
            try {
                const depDate = this.createCETDate(details.departureDate, details.departureTime);
                const arrDate = this.createCETDate(details.arrivalDate, details.arrivalTime);
                const diffMs = arrDate.getTime() - depDate.getTime();
                if (diffMs > 0) {
                    details.durationMinutes = Math.round(diffMs / (1000 * 60));
                    const hours = Math.floor(details.durationMinutes / 60);
                    const mins = details.durationMinutes % 60;
                    details.durationFormatted = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
                    console.log('Trip duration:', details.durationFormatted);
                }
            } catch (e) {
                console.log('Could not calculate duration:', e.message);
            }
        }

        // ── Return leg data (for round trips) ────────────────────────
        // If this is a round trip, extract departure/arrival for the return leg.
        // The return leg's blocks are the SECOND occurrences of
        // name="departuredata" and name="arrivaldata" in the HTML.
        if (details.tripType === 'Round trip') {
            // Find all departuredata blocks
            const deptAllRegex = new RegExp('name="departuredata"[\\s\\S]*?subcolor">[^<]*?(\\d{1,2})\\.\\s*(' + MONTH_RE + ')<\\/span>\\s*<span[^>]*>(\\d{1,2}:\\d{2})<\\/span>', 'gi');
            const deptMatches = [];
            let dm;
            while ((dm = deptAllRegex.exec(html)) !== null) {
                deptMatches.push(dm);
            }
            if (deptMatches.length >= 2) {
                const retDept = deptMatches[1];
                const retDay = retDept[1];
                const retMonthAbbr = retDept[2];
                const retTime = retDept[3];
                const retParsed = this.parseNorwegianAbbrevDate(retDay, retMonthAbbr);
                if (retParsed) {
                    details.returnDepartureDate = retParsed;
                    details.returnDepartureTime = retTime;
                    console.log('Parsed return departure (structural):', retParsed, retTime);
                }
            }

            // Find all arrivaldata blocks
            const arrAllRegex = new RegExp('name="arrivaldata"[\\s\\S]*?subcolor">[^<]*?(\\d{1,2})\\.\\s*(' + MONTH_RE + ')<\\/span>\\s*<span[^>]*>(\\d{1,2}:\\d{2})<\\/span>', 'gi');
            const arrMatches = [];
            let am;
            while ((am = arrAllRegex.exec(html)) !== null) {
                arrMatches.push(am);
            }
            if (arrMatches.length >= 2) {
                const retArr = arrMatches[1];
                const retDay = retArr[1];
                const retMonthAbbr = retArr[2];
                const retTime = retArr[3];
                const retParsed = this.parseNorwegianAbbrevDate(retDay, retMonthAbbr);
                if (retParsed) {
                    details.returnArrivalDate = retParsed;
                    details.returnArrivalTime = retTime;
                    console.log('Parsed return arrival (structural):', retParsed, retTime);
                }
            }

            // Return leg route name from ellipsisoverflow (second occurrence)
            const routeAllRegex = /ellipsisoverflow">([^<]+)<\/span>/gi;
            const routeMatches = [];
            let rm;
            while ((rm = routeAllRegex.exec(html)) !== null) {
                routeMatches.push(rm[1].trim());
            }
            if (routeMatches.length >= 2) {
                details.returnRouteName = routeMatches[1];
                console.log('Found return route name:', details.returnRouteName);
            }

            // Calculate return leg duration
            if (details.returnDepartureDate && details.returnDepartureTime && details.returnArrivalDate && details.returnArrivalTime) {
                try {
                    const retDepDate = this.createCETDate(details.returnDepartureDate, details.returnDepartureTime);
                    const retArrDate = this.createCETDate(details.returnArrivalDate, details.returnArrivalTime);
                    const retDiffMs = retArrDate.getTime() - retDepDate.getTime();
                    if (retDiffMs > 0) {
                        details.returnDurationMinutes = Math.round(retDiffMs / (1000 * 60));
                        const retHours = Math.floor(details.returnDurationMinutes / 60);
                        const retMins = details.returnDurationMinutes % 60;
                        details.returnDurationFormatted = retMins > 0 ? `${retHours}h ${retMins}m` : `${retHours}h`;
                        console.log('Return trip duration:', details.returnDurationFormatted);
                    }
                } catch (e) {
                    console.log('Could not calculate return duration:', e.message);
                }
            }
        }

        if (!details.departureDate) {
            console.log('WARNING: Could not find departure date in HTML.');
            console.log('HTML snippet (first 3000 chars):', html.substring(0, 3000));
        }

        return details;
    }

    /**
     * Parse an abbreviated date (day + month abbreviation, no year).
     * The OpenJaw booking page uses formats like "21. mar" (from "lø. 21. mar").
     * Since no year is provided, we infer it: use current year, unless the date
     * has already passed, in which case use next year.
     *
     * We force Norwegian locale via Accept-Language, but as a safety net this
     * method also recognises English, German, and Swedish month names so the
     * app works even if the server ignores the header.
     *
     * @param {string} day - Day of month (e.g. "21")
     * @param {string} monthAbbr - Month abbreviation in any supported language
     * @returns {string|null} ISO date string (yyyy-mm-dd) or null
     */
    parseNorwegianAbbrevDate(day, monthAbbr) {
        if (!day || !monthAbbr) return null;

        const monthMap = {
            // Norwegian
            'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
            'mai': '05', 'jun': '06', 'jul': '07', 'aug': '08',
            'sep': '09', 'okt': '10', 'nov': '11', 'des': '12',
            'januar': '01', 'februar': '02', 'mars': '03', 'april': '04',
            'juni': '06', 'juli': '07', 'august': '08',
            'september': '09', 'oktober': '10', 'november': '11', 'desember': '12',
            // English
            'may': '05', 'oct': '10', 'dec': '12',
            'january': '01', 'february': '02', 'march': '03',
            'june': '06', 'july': '07',
            'october': '10', 'december': '12',
            // German
            'mär': '03', 'mrz': '03', 'märz': '03',
            'dez': '12',
            'januar': '01', 'februar': '02', 'dezember': '12',
            // Swedish
            'maj': '05',
            'januari': '01', 'februari': '02', 'mars': '03',
            'augusti': '08',
            'oktober': '10', 'december': '12'
        };

        const month = monthMap[monthAbbr.toLowerCase()];
        if (!month) {
            console.log(`Unknown month abbreviation: "${monthAbbr}"`);
            return null;
        }

        const dayStr = day.padStart(2, '0');
        const now = new Date();
        let year = now.getFullYear();

        // Build a candidate date with current year
        const candidate = new Date(`${year}-${month}-${dayStr}T00:00:00`);
        
        // Heuristic: if the date is more than 30 days in the past, assume
        // it refers to next year. We use 30 days instead of 1 day because:
        // - The return leg of a round trip might be weeks after the outbound
        // - A booking page viewed shortly after travel should still show the
        //   correct (past) year rather than jumping 11+ months forward
        // - Color Line typically books up to ~11 months ahead, so a date
        //   31+ days in the past is almost certainly next year
        const gracePeriodMs = 30 * 24 * 60 * 60 * 1000; // 30 days
        if (candidate.getTime() < now.getTime() - gracePeriodMs) {
            year++;
        }

        return `${year}-${month}-${dayStr}`;
    }
}

module.exports = ColorLineAPI;
