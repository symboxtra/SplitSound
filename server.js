'use strict';

const ADDRESS = '0.0.0.0';
const PORT = 8080;
const MAX_CLIENTS = 50;

const os = require('os');
const fs = require('fs');
const path = require('path');
const url = require('url');
const app = require('http').createServer(handler);
const io = require('socket.io')(app);

app.listen(PORT, ADDRESS);
console.log(`Socket.io server listening on ${ADDRESS}:${PORT}...`);

const mimeType = {
    '.ico': 'image/x-icon',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.eot': 'appliaction/vnd.ms-fontobject',
    '.ttf': 'aplication/font-sfnt'
};

// This response can be used to debug firewall or other connectivity issues
function handler (req, res) {
    // Hardcode / to index.html
    if (req.url === '/') {
        req.url = '/index.html';
    }

    const parsedUrl = url.parse(req.url);

    // Prevent directory traversal
    const sanitizePath = path.normalize(parsedUrl.pathname).replace(/^(\.\.[\/\\])+/, '');
    const pathname = path.join(__dirname, sanitizePath);
    const ext = path.parse(pathname).ext;

    console.log(ext);

    // Only respond to the essentials right now
    if (ext === '.html' || ext === '.js' || ext === '.css') {
        fs.exists(pathname, (exists) => {
            if (!exists) {
                res.statusCode = 404;
                res.end(`File not found.`);
                return;
            }
        });

        fs.readFile(pathname, (err, data) => {
            if (err) {
                res.statusCode = 500;
                res.end(`Could not read index.html: ${err}.`);
            } else {
                res.setHeader('Content-type', mimeType[ext] || 'text/plain');
                res.end(data);
            }
        });

        return;
    }

    res.statusCode = 200;
    res.write('<h1>200 - OK</h1>');
    res.write('You have successfully reached the signaling server!<br>');
    res.write('This is not a part of SplitSound (for debugging only).<br><br>');
    res.write('Click <a href="index.html">here</a> to continue using SplitSound.');
    res.end();
}

io.on('connection', (socket) => {
    socket.on('join', (room) => {
        console.log('Received request to create or join room ' + room);

        let clientsInRoom = io.sockets.adapter.rooms[room];
        let numClients = clientsInRoom ? Object.keys(clientsInRoom.sockets).length : 0;

        // Add 1 since we'll be adding ourselves shortly
        numClients += 1;

        console.log(`Room ${room} now has ${numClients} client(s)`);

        if (numClients === 1) {
            socket.join(room);
            console.log(`Client ID ${socket.id} created room ${room}`);
            socket.emit('created', room, socket.id);

        } else if (numClients < MAX_CLIENTS) {
            socket.join(room);
            console.log(`Client ID ${socket.id} joined room ${room}`);
            socket.emit('joined', room, socket.id);

            io.to(room).emit('join', socket.id);
        } else {
            console.log(`Max clients (${MAX_CLIENT}) reached.`);
            socket.emit('full', room);
        }
    });

    socket.on('offer', (offer, recipientId) => {
        io.to(recipientId).emit('offer', offer, socket.id);
    });

    socket.on('answer', (answer, recipientId) => {
        io.to(recipientId).emit('answer', answer, socket.id);
    });

    socket.on('candidate', (candidate, recipientId) => {
        io.to(recipientId).emit('candidate', candidate, socket.id);
    });

    socket.on('leave', (room, socketId) => {
        io.to(room).emit('leave', room, socketId);
        socket.leave(room);
        console.log(`Client ID ${socket.id} left room ${room}`);
    });

    socket.on('ipaddr', () => {
        let ifaces = os.networkInterfaces();
        for (let dev in ifaces) {
            ifaces[dev].forEach(function (details) {
                if (details.family === 'IPv4' && details.address !== '127.0.0.1') {
                    socket.emit('ipaddr', details.address);
                }
            });
        }
    });

});