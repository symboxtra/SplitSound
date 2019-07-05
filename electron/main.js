const { app, protocol, BrowserWindow } = require('electron');
const createProtocol = require('./protocol.js');
const url = require('url');
const path = require('path');

const SCHEME_NAME = 'app';

// Standard scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME_NAME,
    standard: true,
    secure: true,
    bypassCSP: false,
    allowServiceWorkers: true,
    supportFetchAPI: true,
    corsEnabled: false
}]);

function createWindow(loadPath) {
    let win = new BrowserWindow({
        webPreferences: {
            nodeIntegration: true
        },
        width: 1000,
        height: 700
    });

    win.loadURL(url.format({
        pathname: loadPath,
        protocol: SCHEME_NAME,
        slashes: true
    }));

    win.webContents.openDevTools();
}

app.on('ready', async () => {
    createProtocol(SCHEME_NAME);
    createWindow('./index.html');
});