import settings from './settings.js';
import { am } from './audio.js';

/**************************************************
 * DOM related functions                          *
***************************************************/

// Container for remote media elements
const remoteMedia = document.getElementById('remoteMedia');

// Socket ID element
const socketIdElem = document.getElementById('socketId');

// Stream from options
const deviceSelectElem = document.getElementById('deviceSelectOptions');

// Define media elements.
const localMedia = document.getElementById('localMedia');
let localAudio = document.getElementById('localAudio');

// Visualizer canvas
const visualizerOpt = document.getElementById('vizualizerOptions');
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

function toggleElectronOptions() {
    // Hide elements with the electronOnly class
    let elems = document.getElementsByClassName('electronOnly');
    for (let i = 0; i < elems.length; i++) {
        elems[i].classList.toggle('hidden');
    }
}

/**
 * Hack for AudioManager's need to replace the localAudio
 * element every time it gets recreated.
 */
function setLocalAudio(elem) {
    localAudio = elem;
}

function createDeviceOption(name, value, owner) {
    let opt = document.createElement('option');
    opt.innerHTML = name;
    opt.value = value;
    opt.classList.add('generated-device');
    opt.setAttribute('data-owner', owner);

    return opt;
}

function updateDeviceList(elem, permissionAttempted = false) {
    // Reset any old devices that we're responsible for
    let oldDevs = elem.getElementsByClassName('generated-device');
    for (let i = 0; i < oldDevs.length; i++) {
        console.log(oldDevs[i]);
        oldDevs[i].remove();
    }

    if (settings.showHulaloopDevices) {
        let devices = am.hulaloop.getDevices();
        devices.forEach((val) => {
            let opt = createDeviceOption(`HulaLoop - ${val}`, val, 'hulaloop');
            elem.appendChild(opt);
        });
    }

    if (settings.showLocalDevices) {
        navigator.mediaDevices.enumerateDevices()
        .then((devices) => {

            for (let dev of devices) {
                // TODO: Setup output devices
                if (dev.kind === 'audioinput') {
                    let name = dev.label;
                    if (name.length === 0) {

                        if (!permissionAttempted) {
                            // Request permission so that we can get proper device names
                            navigator.mediaDevices.getUserMedia({ audio: true })
                            .then(() => {
                                updateDeviceList(elem, true);
                            })
                            .catch(() => {
                                console.warn('Microphone permission denied.');
                                updateDeviceList(elem, true);
                            });

                            return;
                        }

                        // deviceId should be default, communications, or some hash
                        // Truncate, but not less than 'communications'
                        name = dev.deviceId.substring(0, 14);
                    }
                    let opt = createDeviceOption(`Browser - ${name}`, dev.deviceId, 'browser');
                    elem.appendChild(opt);
                }
            }
        })
        .catch((e) => {
            console.warn(`Error fetching local devices: ${e}.`);
            console.log(e);
        });
    }
}

export {
    remoteMedia,
    socketIdElem,
    deviceSelectElem,
    localMedia,
    localAudio,
    visualizerOpt,
    visualizerCanvas,
    vizCtx,

    toggleElectronOptions,
    setLocalAudio,
    createDeviceOption,
    updateDeviceList
}