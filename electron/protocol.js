// Electron protocol registration
// Based on: https://gist.github.com/jarek-foksa/0f6e82bdaf8fb1962c9e14035a8725e4

const { protocol } = require('electron');
const { readFile } = require('fs');
const { extname, join, dirname } = require('path');
const { URL } = require('url');

// Since __dirname will be root/electron,
// serve from one directory above
const basedir = dirname(__dirname);

const createProtocol = (scheme, normalize = true) => {
    console.log(`Registering ${scheme} protocol...`);

    protocol.registerBufferProtocol(scheme,
        (request, respond) => {

            let pathName = new URL(request.url).pathname;
            pathName = decodeURI(pathName); // Needed in case URL contains spaces

            console.log(`${scheme}:// request for ${pathName}.`);

            readFile(join(basedir, pathName), (error, data) => {
                if (error) {
                    console.warn('Error:');
                    console.log(error);

                    // Respond with the NET_ERROR code for FILE_NOT_FOUND
                    // See: https://cs.chromium.org/chromium/src/net/base/net_error_list.h
                    respond(-6);
                    return;
                }

                let extension = extname(pathName).toLowerCase();
                let mimeType = '';

                if (extension === '.js' || extension === '.mjs') {
                    mimeType = 'text/javascript';
                }
                else if (extension === '.html') {
                    mimeType = 'text/html';
                }
                else if (extension === '.css') {
                    mimeType = 'text/css';
                }
                else if (extension === '.svg' || extension === '.svgz') {
                    mimeType = 'image/svg+xml';
                }
                else if (extension === '.json') {
                    mimeType = 'application/json';
                }

                respond({ mimeType, data });
            });
        },
        (error) => {
            if (error) {
                console.error(`Failed to register ${scheme} protocol`, error);
            }
        }
    );
};

module.exports = createProtocol;