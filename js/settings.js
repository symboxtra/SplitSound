import * as dom from './dom.js';

// Default media stream constants and parameters.
// These are only accessible via Settings.newMediaStreamConstraints()
const baseMediaStreamConstraints = {
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

class Settings {
    constructor() {
        this.receiverOnly = false;
        this.showVideo = false;

        this.showHulaloopDevices = true;
        this.showLocalDevices = true;
        this.showWindowsLoopback = true; // TODO: Turn off once HulaLoop testing is done

        this.isElectron = (navigator.userAgent.toLowerCase().indexOf(' electron/') > -1);
        this.isSafari = false;

        // Set up RTCPeer offer options
        this.offerOptions = {
            offerToReceiveAudio: 1,
            offerToReceiveVideo: (this.showVideo) ? 1 : 0,
            voiceActivityDetection: false
        };

        // Set up RTCPeerConnection options
        this.rtcConfig = {
            iceServers: [
                { url: "stun:stun.l.google.com:19302" },
                { url: "stun:stun1.l.google.com:19302" },
                { url: "stun:stun2.l.google.com:19302" },
                { url: "stun:stun3.l.google.com:19302" },
                { url: "stun:stun4.l.google.com:19302" }
            ],
            sdpSemantics: 'unified-plan'
        };

        this.mediaStreamConstraints = this.newMediaStreamConstraints();
    }

    newMediaStreamConstraints() {
        return JSON.parse(JSON.stringify(baseMediaStreamConstraints));
    }

    enableReceiverOnly() {
        this.receiverOnly = true;
        dom.localMedia.innerHTML = 'Receiver only';
        dom.deviceSelectElem.disabled = true;

        trace('Switched to receiver only.');
    }
}

// Singleton
const s = new Settings();
export default s;