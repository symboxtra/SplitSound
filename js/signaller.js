import * as dom from './dom.js';
import Peer from './peer.js';
import settings from './settings.js';

/**************************************************
 * SocketCluster signaling                        *
***************************************************/
class Signaller {
    constructor(hostname, port) {
        this.hostname = hostname;
        this.port = port;
        this.privateChannel = null;
        this.channels = [];
        this.channelPeers = {};

        this.socket = socketCluster.connect({
            hostname: hostname,
            port: port,
            secure: true
        });

        this.socket.on('error', (err) => {
            console.error(err);
        });

        this.socket.on('connect', () => {
            trace(`Connected to signalling server with ID: ${this.socket.id}`);

            dom.socketIdElem.innerHTML = this.socket.id;

            trace(`Subscribing to private channel ${this.socket.id}...`);
            this.privateChannel = this.socket.subscribe(this.socket.id);
            this.privateChannel.watch(this.handlePrivateChannel.bind(this));
        });

        this.socket.on('subscribeStateChange', (obj) => {
            if (obj.newState === 'subscribed') {
                trace(`Subscribed to ${obj.channel}.`);
            } else {
                trace(`Subscription state change for channel ${obj.channel}: ${obj.oldState} => ${obj.newState}`)
            }
        });

        this.socket.on('joined', (obj) => {
            trace(`Joined channel ${obj.channel}.`);

            this.channels.push(obj.channel);
            this.channelPeers[obj.channel] = {};
        });

        this.socket.on('full', (obj) => {
            console.warn(`Channel ${obj.channel} is full.`);
        });

        // Bind this since its called in a different class
        this.disconnected = this.disconnected.bind(this);
    }

    async handlePrivateChannel(obj) {
        // Ignore anything malformed
        if (!obj.action || !obj.channel || !obj.sender) {
            console.warn('Malformed channel message.');
            console.log(obj);
            return;
        }

        if (obj.action === 'offer') {
            let peer = this.channelPeers[obj.channel][obj.sender];

            trace(`Offer received from ${obj.sender}:`);
            console.dir(obj.offer);

            // Peer might exist because of ICE candidates
            if (peer) {
                console.warn(`Peer already existed at offer.`);
                peer.reconnect();
            } else {
                peer = new Peer(obj.sender, obj.channel, this);
                this.channelPeers[obj.channel][peer.id] = peer;
            }

            peer.answered = true;

            trace(`Incoming offer sdp:`);
            console.log(obj.offer.sdp);

            await peer.conn.setRemoteDescription(obj.offer);
            let answer = await peer.conn.createAnswer(settings.offerOptions);
            answer.sdp = transformSdp(answer.sdp);
            await peer.conn.setLocalDescription(answer);

            this.socket.emit('answer', {
                channel: obj.channel,
                recipient: obj.sender,
                answer: answer
            });

            // Restore any cached ICE candidates
            peer.uncacheICECandidates();

        } else if (obj.action === 'answer') {
            let peer = this.channelPeers[obj.channel][obj.sender];

            // Make sure we're expecting an answer
            if (!(peer && peer.offered)) {
                console.warn(`Unexpected answer from ${obj.sender} to ${this.socket.id}.`);
                return;
            }

            trace(`Answer received from ${obj.sender}:`);
            console.dir(obj.answer.sdp);

            await peer.conn.setRemoteDescription(obj.answer);

            // Restore any cached ICE candidates
            peer.uncacheICECandidates();

        } else if (obj.action === 'candidate') {
            let peer = this.channelPeers[obj.channel][obj.sender];

            // Make sure we're expecting candidates
            if (!(peer && (peer.offered || peer.answered))) {
                console.warn(`Unexpected ICE candidates from ${obj.sender} to ${this.socket.id}.`);
                return;
            }

            trace(`Received ICE candidate for ${obj.sender}.`);

            let iceCandidate = new RTCIceCandidate(obj.candidate);

            // Cache ICE candidates if the connection isn't ready yet
            if (peer.conn && peer.conn.remoteDescription && peer.conn.remoteDescription.type) {
                await peer.conn.addIceCandidate(iceCandidate);
            } else {
                trace(`Cached ICE candidate`);
                peer.iceCandidates.push(iceCandidate);
            }

        } else {
            console.warn(`Unrecognized private channel action: ${obj.action}`);
            return;
        }
    }

    async handleChannel(obj) {
        // Ignore anything malformed
        if (!obj.action || !obj.channel || !obj.sender) {
            console.warn('Malformed channel message.');
            console.log(obj);
            return;
        }

        // Ignore our own messages
        if (obj.sender === this.socket.id) {
            return;
        }

        if (obj.action === 'join') {
            let peer = this.channelPeers[obj.channel][obj.sender];

            trace(`'${obj.sender}' joined.`);

            // Connection already existed
            // Close old one
            if (peer) {
                peer.disconnect();
            }

            peer = new Peer(obj.sender, obj.channel, this);
            this.channelPeers[obj.channel][peer.id] = peer;
            peer.offered = true;

            trace(`createOffer to ${obj.sender} started.`);
            let offer = await peer.conn.createOffer(settings.offerOptions);
            offer.sdp = transformSdp(offer.sdp);

            trace(`Outgoing offer sdp:`);
            console.log(offer.sdp);

            await peer.conn.setLocalDescription(offer);

            this.socket.emit('offer', {
                channel: obj.channel,
                recipient: peer.id,
                offer: offer
            });

        } else if (obj.action === 'leave') {
            let peer = this.channelPeers[obj.channel][obj.sender];

            if (peer) {
                trace(`${obj.sender} left ${obj.channel}.`);
                peer.disconnect();
            }

            this.channelPeers[obj.channel][obj.sender] = null;

        } else {
            console.warn(`Unrecognized channel action: ${obj.action}`);
            return;
        }
    }

    joinChannel(channel) {
        if (this.channels.includes(channel)) {
            console.warn(`Already subscribed to ${channel}. Leaving first...`);
            this.leaveChannel(channel);
        }

        this.socket.emit('join', { channel: channel });

        trace(`Subscribing to channel ${channel}...`);
        this.socket.subscribe(channel);
        this.socket.watch(channel, this.handleChannel.bind(this));
    }

    leaveChannel(channel) {
        if (!this.channels.includes(channel)) {
            trace(`Not subscribed to ${channel}`);
            return;
        }

        trace(`Unsubscribing from channel ${channel}...`);
        this.socket.unwatch(channel);
        this.socket.unsubscribe(channel);

        trace(`Disconnecting from peers...`);
        for (let id in this.channelPeers[channel]) {
            this.channelPeers[channel][id].disconnect();
        }
        delete this.channelPeers[channel];

        trace(`Left ${channel}.`);
    }

    leaveAllChannels() {
        this.channels.forEach((val) => {
            this.leaveChannel(val);
        });
    }

    disconnected(id) {
        for (let channel in this.channelPeers) {
            if (this.channelPeers[channel][id]) {
                trace(`Removed ${id} from ${channel}.`)
                delete this.channelPeers[channel][id];
            }
        }
    }
}

/**
 * Munge the offer/answer Session Description Protocol objects
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

export default Signaller;