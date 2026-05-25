const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { registerHandlers } = require('./src/handlers');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: '*' },
});

io.on('connection', socket => registerHandlers(io, socket));

server.listen(3000, () => {
    console.log('Servidor corriendo en http://localhost:3000');
});
