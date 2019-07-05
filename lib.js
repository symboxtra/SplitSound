import { am } from './js/audio.js';
import * as dom from './js/dom.js';
import settings from './js/settings.js';

// Things that I'm generally not sure where to put yet...

/**************************************************
 * Stream related functions                       *
***************************************************/

let localStreamNode = null;

function resetConnection(signaller) {
    // AudioContext gets suspended if created before
    // a user interaction https://goo.gl/7K7WLu
    // This will be called by 'None' receiver
    am.context.resume();

    // Leave any old channels
    if (signaller) {
        signaller.leaveAllChannels();
    }

    // Reset constraints
    settings.mediaStreamConstraints = settings.newMediaStreamConstraints();

    // Disconnect the local stream if we set one up
    if (localStreamNode) {
        localStreamNode.disconnect();
        localStreamNode = null;
    }

    if (dom.localVideo) {
        dom.setLocalVideoStream(null);
        dom.localVideo.srcObject = null;
    }
}

/**
 * Source audio from user media like desktop capture
 * or microphone input.
 * @param {string} device Input device name
 */
async function setupLocalMediaStreams(deviceId) {
    // AudioContext gets suspended if created before
    // a user interaction https://goo.gl/7K7WLu
    am.context.resume();

    // Remove the constraints that exclude microphone
    //delete settings.mediaStreamConstraints.audio.mandatory.chromeMediaSource;

    // Remove the constraints that turn off mic processing
    //delete settings.mediaStreamConstraints.audio.mandatory;

    // Default to the simplest option
    settings.mediaStreamConstraints.audio = true;

    if (settings.showVideo) {
        // Can't do screen capture without screen audio
        settings.mediaStreamConstraints.video = true;
    } else {
        settings.mediaStreamConstraints.video = false;
    }

    if (deviceId) {
        settings.mediaStreamConstraints.deviceId = deviceId;
    }

    return new Promise((resolve, reject) => {
        navigator.mediaDevices.getUserMedia(settings.mediaStreamConstraints)
        .then((stream) => {
            if (settings.showVideo) {
                gotLocalVideoMediaStream(stream);
            }

            gotLocalMediaStream(stream);
            resolve();
        })
        .catch((e) => {
            console.warn(`Failed to obtain local media stream: ${e}`);
            reject(e);
        });
    });
}

/**
 * Source audio from a file.
 * @param {string} filepath Relative or absolute path to the file
 */
async function setupLocalMediaStreamsFromFile(filepath) {
    // AudioContext gets suspended if created before
    // a user interaction https://goo.gl/7K7WLu
    am.context.resume();

    return new Promise(async (resolve, reject) => {
        if (settings.receiverOnly) {
            resolve();
            return;
        }

        if (settings.showVideo) {
            // This will grab video and audio.
            // We'll overwrite the audio once it's done
            await setupLocalMediaStreams();
        }

        // Attach file to audio element
        dom.localAudio.src = filepath;
        dom.localAudio.classList.remove('hidden');

        resolve();
    });
}

function gotLocalMediaStream(mediaStream) {
    let videoTracks = mediaStream.getVideoTracks();
    if (videoTracks.length > 0) {
        gotLocalVideoMediaStream(mediaStream);
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
    dom.setLocalVideoStream(mediaStream);
    localVideo.srcObject = mediaStream;

    trace('Received local video stream.');
}

export {
    resetConnection,
    setupLocalMediaStreams,
    setupLocalMediaStreamsFromFile
}