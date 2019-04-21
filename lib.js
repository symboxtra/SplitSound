'use strict';

/**************************************************
 * Initialization                                 *
***************************************************/
let receiverOnly = false;
let showVideo = false;
let isElectron = (navigator.userAgent.toLowerCase().indexOf(' electron/') > -1);

// Set up media stream constant and parameters.
// Audio is mono right now
const mediaStreamConstraints = {
    audio: {
        mandatory: {
            chromeMediaSource: 'desktop',
            echoCancellation: false,
            googEchoCancellation: false,
            googAutoGainControl: false,
            googNoiseSuppression: false,
            googHighpassFilter: false,
            googTypingNoiseDetection: false,
            googAudioMirroring: false,
            googAudioMirroring: false,
            googNoiseReduction: false,
        }
    },
    video: {
        mandatory: {
            chromeMediaSource: 'desktop'
        }
    }
};

// Mac and Linux have to disable audio
// if you want to stream video.
// Receiver only will work fine either way
//mediaStreamConstraints.audio = false;

// Set up RTCPeer offer options
const offerOptions = {
    offerToReceiveAudio: 1,
    offerToReceiveVideo: (showVideo) ? 1 : 0,
    voiceActivityDetection: true
};

// Set up RTCPeerConnection options
const rtcConfig = {
    sdpSemantics: 'unified-plan'
};


// Setup Web Audio components
window.AudioContext = (window.AudioContext || window.webkitAudioContext);
let context = new AudioContext();
let localStreamNode;
let outgoingRemoteStreamNode = context.createMediaStreamDestination();
let incomingRemoteGainNode = context.createGain();
let outgoingRemoteGainNode = context.createGain();

incomingRemoteGainNode.connect(context.destination);
outgoingRemoteGainNode.connect(outgoingRemoteStreamNode);

if (false) {
    // Listen to what's going out in the left for reference
    let panL = context.createStereoPanner();
    panL.pan.value = -1;
    panL.connect(context.destination);
    outgoingRemoteGainNode.connect(panL);

    // Listen to what's coming in in the right ear
    let panR = context.createStereoPanner();
    panR.pan.value = 1;
    panR.connect(context.destination);
    incomingRemoteGainNode.disconnect();
    incomingRemoteGainNode.connect(panR);
}


// Visualizer canvas
const visualizerCanvas = document.getElementById('visualizer');
const vizCtx = visualizerCanvas.getContext('2d');
visualizerCanvas.addEventListener('dblclick', () => {
    if (visualizerCanvas.requestFullscreen) {
        visualizerCanvas.requestFullscreen();
    } else if (visualizerCanvas.webkitRequestFullscreen) {
        visualizerCanvas.webkitRequestFullscreen();
    } else if (visualizerCanvas.mozRequestFullScreen) {
        visualizerCanvas.mozRequestFullScreen();
    } else if (visualizerCanvas.msRequestFullscreen) {
        visualizerCanvas.msRequestFullscreen();
    }
});

// Define media elements.
const localMedia = document.getElementById('localMedia');
const localVideo = document.getElementById('localVideo');
const localAudio = document.getElementById('localAudio');

let localAudioElementNode = context.createMediaElementSource(localAudio);
localAudioElementNode.connect(outgoingRemoteGainNode);

// Container for remote media elements
const remoteMedia = document.getElementById('remoteMedia');

// Socket ID element
const socketIdElem = document.getElementById('socketId');

// Stream from options
const streamFromElem = document.getElementById('streamFrom');

// Hide video elements
if (showVideo === false) {
    hideVideoElements();
}

let videoStream = null;



/**************************************************
 * Stream related functions                       *
***************************************************/

/**
 * Source audio from user media like desktop capture
 * or microphone input.
 */
async function setupLocalMediaStreams() {
    return new Promise((resolve, reject) => {
        navigator.mediaDevices.getUserMedia(mediaStreamConstraints)
        .then((stream) => {
            if (showVideo) {
                gotLocalVideoMediaStream(stream);
            }

            gotLocalMediaStream(stream);
            resolve();
        })
        .catch((e) => {
            console.warn(`Failed to obtain local media stream: ${e}`);

            // We weren't able to get a local media stream
            // Become a receiver
            enableReceiverOnly();
            reject(e);
        });
    });
}

/**
 * Source audio from a file.
 * @param {string} filepath Relative or absolute path to the file
 */
async function setupLocalMediaStreamsFromFile(filepath) {
    return new Promise(async (resolve, reject) => {
        // AudioContext gets suspended if created before
        // a user interaction https://goo.gl/7K7WLu
        context.resume();

        if (receiverOnly) {
            resolve();
            return;
        }

        if (showVideo) {
            // This will grab video and audio.
            // We'll overwrite the audio once it's done
            await setupLocalMediaStreams();
        }

        // Attach file to audio element
        localAudio.src = filepath;
        localAudio.classList.remove('hidden');

        resolve();
    });
}

/**
 * Source audio from the HulaLoop Node addon.
 * @param {string} filepath or absolute path to file
 */
function setupLocalMediaStreamFromHulaLoop() {
    // Import the HulaLoop C++ addon module
    const hulaloopAddon = require('bindings')('hulaloop-node.node');
    console.dir(hulaloopAddon);

    let bufferFrames = 1024;
    let channels = 2;
    let sampleSize = 4;
    let procNode = context.createScriptProcessor(bufferFrames, channels, channels);

    const hulaloop = new hulaloopAddon.HulaLoop(
        (event, data) => {
            // TODO: Attach event emitter
            console.log(`Event: ${event} -- Data: ${data}`);
        },
        (errorMsg) => {
            console.log(errorMsg);
        },
        {
            input: "test"
        }
    );
    console.dir(hulaloop);
    console.log(context.sampleRate);

    let hulaloopRawBuffer = new ArrayBuffer(bufferFrames * channels * sampleSize);
    let hulaloopBuffer = new Float32Array(hulaloopRawBuffer);
    console.log(hulaloopBuffer);
    console.log(hulaloopBuffer.length);

    procNode.onaudioprocess = (e) => {
        let outputBuffer = e.outputBuffer;

        // Get our data
        hulaloop.readBuffer(hulaloopRawBuffer);

        // Assume stereo for now
        let outputDataL = outputBuffer.getChannelData(0);
        let outputDataR = outputBuffer.getChannelData(1);

        // console.log(`${outputDataL.length}     ${outputDataR.length}`);

        // Loop over our data and convert from interleaved to planar
        for (let i = 0; i < hulaloopBuffer.length; i += 2) {
            outputDataL[i] = hulaloopBuffer[i];
            outputDataR[i] = hulaloopBuffer[i + 1];
        }
    };

    procNode.connect(outgoingRemoteGainNode);
    hulaloop.startCapture();

    return hulaloop;
}

function gotLocalMediaStream(mediaStream) {
    let videoTracks = mediaStream.getVideoTracks();
    if (videoTracks.length > 0) {
        localVideo.srcObject = mediaStream;
    }

    // Disconnect our old one if we get a new one
    // This will get called twice if we want a video stream
    // and a different audio source
    if (localStreamNode) {
        localStreamNode.disconnect();
    }

    console.dir(mediaStream);

    localStreamNode = context.createMediaStreamSource(mediaStream);
    localStreamNode.connect(outgoingRemoteGainNode);

    trace('Connected localStreamNode.');
}

function gotLocalVideoMediaStream(mediaStream) {
    videoStream = mediaStream;

    trace('Received local video stream.');
}




/**************************************************
 * DOM related functions                          *
***************************************************/

function enableReceiverOnly() {
    receiverOnly = true;
    localMedia.innerHTML = 'Receiver only';
    streamFromElem.disabled = true;

    trace('Switched to receiver only.');
}

function hideVideoElements() {
    localVideo.style.display = 'none';

    // Hide all remote video elements
    let remoteVideos = document.getElementsByClassName('remoteVideo');
    for (let i = 0; i < remoteVideos.length; i++) {
        remoteVideos[i].style.display = 'none';
    }
}

function handleError(e) {
    console.error(e);
    console.dir(e);
    console.trace(e);
}

// Logs an action (text) and the time when it happened on the console.
function trace(text) {
    text = text.trim();
    const now = (performance.now() / 1000).toFixed(3);

    console.log(now, text);
}




/**************************************************
 * WebRTC connections                             *
***************************************************/
class Peer {
    constructor(id, socket) {
        this.id = id;
        this.socket = socket; // This is our class wrapped socket. Not socket.io socket
        this.initiated = false;
        this.offered = false;
        this.answered = false;
        this.conn = null;
        this.sendChannel = null;
        this.recvChannel = null;
        this.iceCandidates = [];
        this.remoteStream = null;
        this.titleElem = null;
        this.audioElem = null;
        this.videoElem = null;
        this.audioNode = null;
        this.gainNode = null;
        this.muteButton = null;

        this.conn = new RTCPeerConnection(rtcConfig);
        trace(`Created peer connection object for ${this.id}.`);

        // TODO: Figure out bidirectional issues
        // Default to send & receive unless we know we're receiver only
        // let direction = 'sendrecv';
        // if (receiverOnly) {
        //     direction = 'recvonly';
        // }

        // // Add transceivers
        // this.conn.addTransceiver('audio', { direction: direction });
        // if (showVideo) {
        //     this.conn.addTransceiver('video', { direction: direction });
        // }

        // Use arrow function so that 'this' is available in class methods
        this.conn.addEventListener('icecandidate', (event) => {
            this.handleIceCandidates(event);
        });
        this.conn.addEventListener('iceconnectionstatechange', (event) => {
            this.handleConnectionChange(event);
        });
        this.conn.addEventListener('track', (event) => {
            this.gotRemoteMediaStream(event);
        });

        // Set up additional data channel to pass messages peer-to-peer
        // There is a separate channel for sending and receiving
        this.sendChannel = this.conn.createDataChannel('session-info');
        this.sendChannel.addEventListener('open', (event) => {
            trace(`Data channel to ${this.id} opened.`);
        });

        this.conn.addEventListener('datachannel', (event) => {
            trace(`Received data channel '${event.channel.label}' from ${this.id}.`);
            this.recvChannel = event.channel;

            this.recvChannel.addEventListener('message', (event) => {
                trace(`Message received from ${this.id}:`);
                console.dir(JSON.parse(event.data));
            });

            // Send an initial message
            this.sendChannel.send(JSON.stringify({ type: 'msg', contents: 'hello' }));
        });
    }

    cleanup() {
        if (this.titleElem) {
            this.titleElem.remove();
        }

        if (this.audioElem) {
            this.audioElem.remove();
        }

        if (this.audioNode) {
            this.audioNode.disconnect();
        }

        if (this.gainNode) {
            this.gainNode.disconnect();
        }

        if (this.videoElem) {
            this.videoElem.remove();
        }

        if (this.muteButton) {
            this.muteButton.remove();
        }

        this.iceCandidates = [];
    }

    reconnect() {
        this.cleanup();
    }

    disconnect() {
        if (this.disconnecting) {
            return;
        }
        this.disconnecting = true;

        if (this.conn) {
            this.conn.close();
        }

        if (this.sendChannel) {
            this.sendChannel.close();
        }

        if (this.recvChannel) {
            this.recvChannel.close();
        }

        this.cleanup();

        // TODO: This is meh coupling
        this.socket.disconnected(this.id);
        trace(`Disconnected from ${this.id}.`);
    }

    // Connects with new peer candidate.
    handleIceCandidates(event) {
        if (event.candidate) {
            this.socket.socket.emit('candidate', event.candidate, this.id);
            trace(`Sent ICE candidate to ${this.id}.`);
        }
    }

    // Logs changes to the connection state.
    handleConnectionChange(event) {
        trace(`ICE state changed to: ${event.target.iceConnectionState}.`);

        if (event.target.iceConnectionState === 'disconnected' ||
            event.target.iceConnectionState === 'closed' ||
            event.target.iceConnectionState === 'failed') {
            this.disconnect();
        }
    }

    uncacheICECandidates() {
        if (!(this.conn && this.conn.remoteDescription && this.conn.remoteDescription.type)) {
            console.warn(`Connection was not in a state for uncaching.`);
            return;
        }

        this.iceCandidates.forEach((candidate) => {
            trace(`Added cached ICE candidate`);
            this.conn.addIceCandidate(candidate);
        });

        this.iceCandidates = [];
    }

    // Handles remote MediaStream success by adding it as the remoteVideo src.
    gotRemoteMediaStream(event) {
        this.remoteStream = event.streams[0];

        let videoTracks = this.remoteStream.getVideoTracks();
        let audioTracks = this.remoteStream.getAudioTracks();

        // If we have a video stream and separate audio stream,
        // we'll get multiple 'track' events
        // Make sure the title only gets added once
        if (!this.titleElem) {
            this.titleElem = document.createElement('h3');
            this.titleElem.innerHTML = `${this.id}:`;
            remoteMedia.appendChild(this.titleElem);
        }

        // Make sure we actually have audio tracks
        if (audioTracks.length > 0) {
            // TODO: This needs more investigation
            // The MediaStream node doesn't produce audio until an HTML audio element is attached to the stream
            // Pause and remove the element after loading since we only need it to trigger the stream
            // See https://stackoverflow.com/questions/24287054/chrome-wont-play-webaudio-getusermedia-via-webrtc-peer-js
            // and https://bugs.chromium.org/p/chromium/issues/detail?id=121673#c121
            let audioElem = new Audio();
            audioElem.autoplay = true;
            audioElem.controls = true;
            audioElem.muted = true;
            audioElem.srcObject = this.remoteStream;
            audioElem.addEventListener('canplaythrough', () => {
                audioElem.pause();
                audioElem = null;
            });

            // Gain node for this stream only
            // Connected to gain node for all remote streams
            this.gainNode = context.createGain();
            this.gainNode.connect(incomingRemoteGainNode);

            this.audioNode = context.createMediaStreamSource(this.remoteStream);
            this.audioNode.connect(this.gainNode);

            console.dir(this.remoteStream);
            console.dir(this.audioNode);

            // Setup mute button logic
            this.muteButton = document.createElement('button');
            this.muteButton.innerHTML = 'Mute';
            this.muteButton.addEventListener('click', () => {
                if (this.muteButton.innerHTML === 'Mute') {
                    this.gainNode.gain.value = 0;
                    this.muteButton.innerHTML = 'Unmute';
                } else {
                    this.gainNode.gain.value = 1;
                    this.muteButton.innerHTML = 'Mute';
                }
            });

            remoteMedia.appendChild(this.muteButton);

            // AudioContext gets suspended if created before
            // a user interaction https://goo.gl/7K7WLu
            context.resume();
        }

        // Do video if we should
        if (showVideo && videoTracks.length > 0) {
            this.videoElem = document.createElement('video');
            this.videoElem.classList.add('remoteVideo');
            this.videoElem.autoplay = true;
            this.videoElem.controls = true;
            this.videoElem.muted = true;
            this.videoElem.srcObject = this.remoteStream;

            remoteMedia.appendChild(this.videoElem);
        }

        trace(`Received remote stream from ${this.id}.`);
    }
}

/**
 * Factory function for creating a new Peer and connecting streams to it.
 * @param {string} id
 */
async function createPeer(id, socket) {
    trace(`Starting connection to ${id}...`);

    // Mask global localStream on purpose
    // Easily revertible to old style streams from WebAudio changes
    let localStream = outgoingRemoteStreamNode.stream;

    let peer = null;
    let videoTracks = null;
    let audioTracks = null;
    if (receiverOnly === false) {
        if (showVideo && videoStream) {
            videoTracks = videoStream.getVideoTracks();
        }
        audioTracks = localStream.getAudioTracks();

        trace(`Audio tracks:`);
        console.dir(audioTracks);

        if (showVideo && videoTracks.length > 0) {
            trace(`Using video device: ${videoTracks[0].label}.`);
        }
        if (audioTracks.length > 0) {
            trace(`Using audio device: ${audioTracks[0].label}.`);
        }
    }

    // Create peer connections and add behavior.
    peer = new Peer(id, socket);

    // Add local stream to connection and create offer to connect.
    if (receiverOnly === false && showVideo && videoTracks[0]) {
        peer.conn.addTrack(videoTracks[0], videoStream);
    }
    if (receiverOnly === false && audioTracks[0]) {
        peer.conn.addTrack(audioTracks[0], localStream);
    }

    return peer;
}

/**
 * Munge the offer/answer Session Description Protocol object
 * to enforce the codecs/options we want.
 */
function transformSdp(sdp) {
    trace(`sdp: transformSdp begin`);

    /**
     * Parse the codec id.
     */
    function getCodecId(haystack) {
        let matches = haystack.match(/:\d{1,3}/); // Match :XXX id
        if (matches) {
            return matches[0].substring(1);
        }
        return null;
    }

    let codecLineNumber = -1;
    let codecIdsToRemove = [];
    let opusCodecId = 111; // Default to what Chrome was sending as of April 2019
    let lines = sdp.split('\r\n');

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        if (line.includes('m=audio')) {
            codecLineNumber = i;
        }

        // rtpmap
        if (line.includes('rtpmap:')) {
            // Remove any rtpmap that isn't opus
            if (!line.includes('opus')) {
                let codecId = getCodecId(line);
                if (codecId !== null) {
                    codecIdsToRemove.push(codecId);
                }

                lines.splice(i, 1);
                i--;

                trace(`sdp: Removed ${line}`);
                continue;
            }

            let parts = line.split('=');
            opusCodecId = getCodecId(parts[1]) || opusCodecId;

            // Make sure we get the trailing /2 for stereo
            let parts2 = parts[1].split('/');
            if (!parts2.includes('2')) {
                parts2.push('2');
            }
            parts[1] = parts2.join('/');
            lines[i] = parts.join('=');
        }

        // fmtp settings
        if (line.includes(`fmtp:${opusCodecId}`)) {
            let parts = line.split(' ');
            let parts2 = parts[1].split(';');

            let key = 'stereo=1';
            if (!parts[1].includes(key)) {
                parts2.push(key);
                trace(`sdp: Added fmtp value ${key}`);
            }

            key = 'sprop-stereo=1';
            if (!parts[1].includes(key)) {
                parts2.push(key);
                trace(`sdp: Added fmtp value ${key}`);
            }

            parts[1] = parts2.join(';');
            lines[i] = parts.join(' ');

        } else if (line.includes(`fmtp:`)) {
            // Remove extra fmtp info
            let codecId = getCodecId(line);
            if (codecIdsToRemove.includes(codecId)) {
                lines.splice(i, 1);
                i--;
                trace(`Removed fmtp line for ${codecId}.`);
            }
        }

        // bandwidth
        // set to 128kbps for now
        if (line.includes(`b=AS:`)) {
            let newBitrate = "b=AS:128";
            lines[i] = newBitrate;
            trace(`sdp: Updated bitrate to ${newBitrate}.`);
        }
    }

    // Strip codec ids from the m= line
    if (codecLineNumber !== -1) {
        let parts = lines[codecLineNumber].split(' ');

        // Skip past m=audio PORT so that we don't accidentally replace port
        for (let i = 2; i < parts.length; i++) {
            if (codecIdsToRemove.includes(parts[i])) {
                let id = parts.splice(i, 1);
                i--;
            }
        }

        lines[codecLineNumber] = parts.join(' ');
        trace(`sdp: Result from remove codec ids: ${lines[codecLineNumber]}`);
    }

    if (false) {
        console.log(sdp);
        console.log(lines.join('\r\n'));
    }

    trace(`sdp: transformSdp end`);

    return lines.join('\r\n');
}


/**************************************************
 * Socket.io signaling                            *
***************************************************/
class Socket {
    constructor(ip, port) {
        this.ip = ip;
        this.port = port;
        this.rooms = [];
        this.peers = {};

        this.socket = io.connect(`http://${this.ip}:${this.port}`);
        trace(`Created socket.`);
        console.dir(this.socket);

        // This is emitted when this socket successfully creates
        this.socket.on('created', (room, socketId) => {
            trace(`${socketId} successfully created ${room}.`);
            socketIdElem.innerHTML = this.socket.id;

            this.rooms.push(room);
        });

        // This is emitted when this socket successfully joins
        this.socket.on('joined', (room, socketId) => {
            trace(`${socketId} successfully joined ${room}.`);
            socketIdElem.innerHTML = this.socket.id;

            this.rooms.push(room);
        });

        this.socket.on('full', (room) => {
            console.warn(`Room ${room} is full.`);
        });

        this.socket.on('ipaddr', (ipaddr) => {
            trace(`Server IP address: ${ipaddr}`);
        });

        // This is emitted when someone else joins
        this.socket.on('join', async (socketId) => {
            // Have to ignore our own join
            if (socketId === this.socket.id) {
                return;
            }

            let peer = this.peers[socketId];

            trace(`'${socketId}' joined.`);

            // Connection already existed
            // Close old one
            if (peer) {
                this.handleDisconnect(peer.id);
            }

            peer = await createPeer(socketId, this);
            this.peers[peer.id] = peer;
            peer.offered = true;

            trace(`createOffer to ${socketId} started.`);
            let offer = await peer.conn.createOffer(offerOptions);
            offer.sdp = transformSdp(offer.sdp);
            await peer.conn.setLocalDescription(offer);

            this.socket.emit('offer', offer, peer.id);
        });

        this.socket.on('offer', async (offer, socketId) => {
            let peer = this.peers[socketId];

            trace(`Offer received from ${socketId}:`);
            console.dir(offer);

            // Peer might exist because of ICE candidates
            if (peer) {
                console.warn(`Peer already existed at offer.`);
                peer.reconnect();
            } else {
                peer = await createPeer(socketId, this);
                this.peers[peer.id] = peer;
            }

            peer.answered = true;

            trace(`Incoming offer sdp:`);
            console.log(offer.sdp);

            await peer.conn.setRemoteDescription(offer);
            let answer = await peer.conn.createAnswer(offerOptions);
            answer.sdp = transformSdp(answer.sdp);
            await peer.conn.setLocalDescription(answer);

            this.socket.emit('answer', answer, socketId);

            // Restore any cached ICE candidates
            peer.uncacheICECandidates();
        });

        this.socket.on('answer', async (answer, socketId) => {
            let peer = this.peers[socketId];

            // Make sure we're expecting an answer
            if (!(peer && peer.offered)) {
                console.warn(`Unexpected answer from ${socketId} to ${this.socket.id}.`);
                return;
            }

            trace(`Answer received from ${socketId}:`);
            console.dir(answer);

            await peer.conn.setRemoteDescription(answer);

            // Restore any cached ICE candidates
            peer.uncacheICECandidates();
        });

        this.socket.on('candidate', async (candidate, ownerId) => {
            let peer = this.peers[ownerId];

            // Make sure we're expecting candidates
            if (!(peer && (peer.offered || peer.answered))) {
                console.warn(`Unexpected ICE candidates from ${ownerId} to ${this.socket.id}.`);
                return;
            }

            trace(`Received ICE candidate for ${ownerId}.`);

            let iceCandidate = new RTCIceCandidate(candidate);

            // Cache ICE candidates if the connection isn't ready yet
            if (peer.conn && peer.conn.remoteDescription && peer.conn.remoteDescription.type) {
                await peer.conn.addIceCandidate(iceCandidate);
            } else {
                trace(`Cached ICE candidate`);
                peer.iceCandidates.push(iceCandidate);
            }
        });

        this.socket.on('leave', (room, socketId) => {
            let peer = this.peers[socketId];

            if (peer) {
                trace(`${socketId} left ${room}.`);
                peer.disconnect();
            }

            this.peers[socketId] = null;
        });
    }

    joinRoom(room) {
        trace(`Entering room '${room}'...`);
        this.socket.emit('join', room);
    }

    leaveRoom(room) {
        trace(`Leaving room ${room}...`);
        this.socket.emit('leave', room, this.socket.id);

        this.rooms = this.rooms.filter((val) => val !== room);
    }

    leaveAllRooms() {
        this.rooms.forEach((val) => {
            this.leaveRoom(val);
        });
    }

    disconnected(id) {
        this.peers[id] = null;
        trace(`Removed ${id} from peer list.`);
    }
}

// Not in use yet
class Room {
    constructor(name) {
        this.name = name;
        this.peers = {};
    }
}



/**************************************************
 * Other WebAudio stuff                           *
***************************************************/

// Visualizer
// Based on: https://stackoverflow.com/a/49371349/6798110
// and https://github.com/webrtc/samples/blob/gh-pages/src/content/peerconnection/webaudio-output/js/main.js
let analyzerNode = context.createAnalyser();
analyzerNode.smoothingTimeConstant = 0.6;
analyzerNode.fftSize = 2048;
analyzerNode.minDecibels = -100;
analyzerNode.maxDecibels = -10;

let vizFreqDomainData = new Uint8Array(analyzerNode.frequencyBinCount);
let vizAnimationFrameId = requestAnimationFrame(updateVizualizer);
outgoingRemoteGainNode.connect(analyzerNode);
incomingRemoteGainNode.connect(analyzerNode);

console.log(analyzerNode.frequencyBinCount);

let vizualizerOpt = document.getElementById('vizualizerOptions');

function updateVizualizer() {
    analyzerNode.getByteFrequencyData(vizFreqDomainData);

    let width = visualizerCanvas.width;
    let height = visualizerCanvas.height;
    let barWidth = (width / (analyzerNode.frequencyBinCount / 9.3)); // Estimation for now

    // Clear old points
    vizCtx.clearRect(0, 0, width, height);
    vizCtx.fillStyle = 'black';
    vizCtx.fillRect(0, 0, width, height);
    vizCtx.strokeStyle = 'yellow';
    vizCtx.fillStyle = 'yellow';

    vizCtx.beginPath();
    vizCtx.moveTo(0, height);

    let x = 0;
    let t = 1;

    let next = 1;
    for (let i = 0; i < analyzerNode.frequencyBinCount; i += next) {
        // Rounding doesn't go so well...
        next += i / (analyzerNode.frequencyBinCount / 16);
        next = next - (next % 1);

        if (vizualizerOpt.value === 'bar') {
            vizCtx.fillRect(x, height - vizFreqDomainData[i], barWidth, vizFreqDomainData[i]);
        } else {
            let p0 = (i > 0) ? { x: x - barWidth, y: height - vizFreqDomainData[i - 1] } : { x: 0, y: 0 };
            let p1 = { x: x, y: height - vizFreqDomainData[i] };
            let p2 = (i < analyzerNode.frequencyBinCount - 1) ? { x: x + barWidth, y: height - vizFreqDomainData[i + 1] } : p1;
            let p3 = (i < analyzerNode.frequencyBinCount - 2) ? { x: x + 2 * barWidth, y: height - vizFreqDomainData[i + 2] } : p1;

            let cp1x = p1.x + (p2.x - p0.x) / 6 * t;
            let cp1y = p1.y + (p2.y - p0.y) / 6 * t;

            let cp2x = p2.x - (p3.x - p1.x) / 6 * t;
            let cp2y = p2.y - (p3.y - p1.y) / 6 * t;

            vizCtx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }

        x += barWidth + 1;
    }

    vizCtx.stroke();

    setTimeout(() => {
        vizAnimationFrameId = requestAnimationFrame(updateVizualizer);
    }, 20);
}