import { am } from './audio.js';
import * as dom from './dom.js';
import settings from './settings.js';

/**************************************************
 * WebRTC connections                             *
***************************************************/
class Peer {
    constructor(id, channel, signaller) {
        this.id = id;
        this.channel = channel;
        this.signaller = signaller; // This is our class wrapped socket. Not socket.io socket
        this.offered = false;
        this.answered = false;
        this.conn = null;
        this.sendChannel = null;
        this.recvChannel = null;
        this.iceCandidates = [];
        this.remoteStream = null;
        this.titleElem = null;
        this.audioElem = null;
        this.audioNode = null;
        this.gainNode = null;
        this.muteButton = null;

        this.conn = new RTCPeerConnection(settings.rtcConfig);
        trace(`Created peer connection object for ${this.id}.`);

        // Handle track setup
        let localAudioStream = am.outgoingRemoteStreamNode.stream;
        let audioTracks = null;
        if (settings.receiverOnly === false) {
            audioTracks = localAudioStream.getAudioTracks();

            trace(`Audio tracks:`);
            console.dir(audioTracks);

            if (audioTracks.length > 0) {
                trace(`Using audio device: ${audioTracks[0].label}.`);
            }
        }

        // Default to send & receive unless we know we're receiver only
        let direction = 'sendrecv';
        if (settings.receiverOnly) {
            direction = 'recvonly';
        }

        // Setup transceivers so that our SDP offer has the right track options
        // Only add transceivers if we need to since Chrome -> non-Chrome
        // has been having issues when both ends have transceivers
        // Edge doesn't have addTransceiver yet...
        if (settings.receiverOnly && this.conn.addTransceiver) {
            this.conn.addTransceiver('audio', { direction: direction });
        }

        if (settings.receiverOnly === false && audioTracks[0]) {
            this.conn.addTrack(audioTracks[0], localAudioStream);
        }

        this.conn.addEventListener('icecandidate', this.handleIceCandidates.bind(this));
        this.conn.addEventListener('iceconnectionstatechange', this.handleConnectionChange.bind(this));
        this.conn.addEventListener('track', this.gotRemoteMediaStream.bind(this));

        // Set up additional data channel to pass messages peer-to-peer
        // There is a separate channel for sending and receiving
        if (this.conn.createDataChannel) {
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
        this.signaller.disconnected(this.id);
        trace(`Disconnected from ${this.id}.`);
    }

    /**
     * Connects with new peer candidate.
     */
    handleIceCandidates(event) {
        if (event.candidate) {
            this.signaller.socket.emit('candidate', {
                channel: this.channel,
                recipient: this.id,
                candidate: event.candidate
            });
            trace(`Sent ICE candidate to ${this.id}.`);
        }
    }

    /**
     * Logs changes to the connection state.
     */
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

    /**
     * Handles remote MediaStream success by adding it as the remote src.
     */
    gotRemoteMediaStream(event) {
        this.remoteStream = event.streams[0];

        let audioTracks = this.remoteStream.getAudioTracks();

        // We may get multiple 'track' events
        // Make sure the title only gets added once
        if (!this.titleElem) {
            this.titleElem = document.createElement('h3');
            this.titleElem.innerHTML = `${this.id}:`;
            dom.remoteMedia.appendChild(this.titleElem);
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
            this.gainNode = am.context.createGain();
            this.gainNode.connect(incomingRemoteGainNode);

            this.audioNode = am.context.createMediaStreamSource(this.remoteStream);
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

            dom.remoteMedia.appendChild(this.muteButton);

            // AudioContext gets suspended if created before
            // a user interaction https://goo.gl/7K7WLu
            am.context.resume();
        }

        trace(`Received remote stream from ${this.id}.`);
    }
}

export default Peer;