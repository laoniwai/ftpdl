const express = require('express');
const axios = require('axios');
const stream = require('stream');
const { promisify } = require('util');
const { URL } = require('url'); // Import the URL class

const pipeline = promisify(stream.pipeline); // For reliable stream piping

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to capture the raw request body BEFORE our proxy handler
// Important for POST, PUT, etc. Adjust 'limit' as needed.
app.use(express.raw({ type: '*/*', limit: '50mb' }));

// Main proxy handler - catches all requests
app.use(async (req, res) => {
    // req.url includes the path and query string, starting with '/'
    // e.g., '/https://example.com/path?query=1' or '/http://anothersite.org/'
    const potentialTargetUrl = req.url.substring(1); // Remove leading '/'

    let targetUrlObject;
    try {
        // Decode URI components first (e.g., %2F becomes /)
        const decodedUrl = decodeURIComponent(potentialTargetUrl);
        targetUrlObject = new URL(decodedUrl); // Parse the extracted string into a URL object

        // Validate protocol
        if (targetUrlObject.protocol !== 'http:' && targetUrlObject.protocol !== 'https:') {
            console.error(`Unsupported protocol: ${targetUrlObject.protocol}`);
            return res.status(400).send('Bad Request: Unsupported protocol. Only http and https are allowed.');
        }
        console.log(`Proxying request to: ${targetUrlObject.toString()}`);

    } catch (e) {
        // If new URL() fails, it's not a valid URL format
        console.error(`Invalid target URL format: ${potentialTargetUrl}`);
        return res.status(400).send('Bad Request: Invalid target URL format.');
    }

    // Prepare headers to forward
    const requestHeaders = { ...req.headers };

    // **Crucial**: Remove or modify headers specific to the proxy connection
    delete requestHeaders['host']; // Let axios set the correct Host based on targetUrlObject.hostname
    delete requestHeaders['connection']; // Let Node.js/axios manage connection pooling
    // Remove headers that might interfere with caching or conditional requests if not handled properly
    // delete requestHeaders['if-none-match'];
    // delete requestHeaders['if-modified-since'];
    // Add forwarding information
    requestHeaders['x-forwarded-for'] = req.ip || req.socket.remoteAddress;
    requestHeaders['x-forwarded-proto'] = req.protocol; // Protocol used to connect to *this* proxy
    // Note: We could also add X-Forwarded-Proto based on targetUrlObject.protocol if needed downstream


    try {
        const proxyResponse = await axios({
            method: req.method,
            url: targetUrlObject.toString(), // Use the full URL string parsed by URL object
            headers: requestHeaders,
            data: req.body && req.body.length > 0 ? req.body : undefined, // Send body if present
            responseType: 'stream', // Get response as a stream
            validateStatus: () => true, // Accept all status codes from target
            // For target servers with self-signed/invalid certs (use with caution!)
            // httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });

        // --- Send response back to the original client ---

        // Set Status Code
        res.status(proxyResponse.status);

        // Prepare response headers
        const responseHeaders = { ...proxyResponse.headers };

        // **Crucial**: Remove or modify headers from the target's response
        delete responseHeaders['transfer-encoding']; // Let Node.js handle chunking
        delete responseHeaders['connection']; // Let Node.js handle connection
        // Axios might automatically decompress (e.g., gzip), so remove content-encoding
        // If you configure axios *not* to decompress, keep this header.
        delete responseHeaders['content-encoding'];
        // Content-Length is often incorrect when streaming/modifying; let Node calculate it.
        delete responseHeaders['content-length'];
        // Security headers tied to the original domain might break things or be misleading
        delete responseHeaders['strict-transport-security'];
        delete responseHeaders['content-security-policy'];
        delete responseHeaders['public-key-pins'];
        // ... any other hop-by-hop headers or headers you want to control

        // Set response headers, handling Set-Cookie specifically
        Object.keys(responseHeaders).forEach((key) => {
             if (key.toLowerCase() === 'set-cookie') {
                const cookies = responseHeaders[key];
                // Basic handling - just pass them through for now.
                // Domain/Path rewriting is complex. See previous notes.
                if (Array.isArray(cookies)) {
                    res.setHeader('Set-Cookie', cookies); //.map(cookie => mapCookie(cookie, req.headers.host)));
                } else if (typeof cookies === 'string') {
                    res.setHeader('Set-Cookie', cookies); //mapCookie(cookies, req.headers.host));
                }
            } else {
                res.setHeader(key, responseHeaders[key]);
            }
        });

        // Stream the response body from the target to the client
        await pipeline(proxyResponse.data, res);

    } catch (error) {
        console.error("Proxy Request Error:", error.message);
        // Handle errors during the request to the target server
        if (error.response) {
            // The target server responded with an error status (should have been handled by validateStatus, but fallback)
             res.status(error.response.status || 500).send(`Proxy error: Target server responded with ${error.response.status}`);
        } else if (error.request) {
            // The request was made but no response was received (e.g., timeout, DNS error, connection refused)
            res.status(504).send(`Proxy error: Gateway Timeout or connection error - ${error.message}`);
        } else {
            // Something happened in setting up the request that triggered an Error
            res.status(502).send(`Proxy error: Bad Gateway - ${error.message}`);
        }
    }
});

// Optional: A simple root handler for health check or info
app.get('/', (req, res) => {
    // Check if the request path is *exactly* '/'
    if (req.url === '/') {
         res.status(200).send('URL Reverse Proxy is running. Use /http[s]://<target-url> to proxy.');
    } else {
        // If it's not exactly '/', let the main proxy handler above deal with it
        // This requires the proxy handler to be defined with app.use() *without* a path argument,
        // or placing this handler *after* the proxy handler. Placing it before is cleaner.
        // Since app.use('/') handles everything, we need to pass control explicitly if needed,
        // but in this setup, the main handler will try to parse "/" as a URL and fail gracefully.
        // Let's keep it simple: only respond if the path is exactly "/"
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`URL Reverse Proxy server listening on port ${PORT}`);
    console.log(`Usage: http://<your-server-ip>:${PORT}/http[s]://<target-domain.com>/<path>`);
    console.log(`Example: http://localhost:${PORT}/https://www.google.com/`);
    console.log(`Example: http://localhost:${PORT}/http://info.cern.ch/hypertext/WWW/TheProject.html`);
});

// Placeholder for cookie mapping - complex and risky, generally avoid unless necessary
// function mapCookie(cookieString, proxyHost) {
//     console.warn("Cookie rewriting is complex. Passing cookie through:", cookieString);
//     return cookieString;
// }
