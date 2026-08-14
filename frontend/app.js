const WS_URL = window.location.hostname === 'localhost' 
    ? 'ws://localhost:8887' 
    : `wss://${window.location.hostname}`;

const ws = new WebSocket(WS_URL);
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const statusText = document.getElementById('status-text');
const statusDot = document.querySelector('.dot');
const timerEl = document.getElementById('timer');
const searchOverlay = document.getElementById('search-overlay');
const micBtn = document.getElementById('mic-btn');
const nextBtn = document.getElementById('next-btn');
const hangupBtn = document.getElementById('hangup-btn');

let peerConnection = null;
let localStream = null;
let isConnected = false;
let timerInterval = null;
let seconds = 0;
let isMuted = false;
let isSearching = true;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

function startTimer() {
    seconds = 0;
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        seconds++;
        const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
        const secs = String(seconds % 60).padStart(2, '0');
        timerEl.textContent = `⏱ ${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    timerEl.textContent = '⏱ 00:00';
}

async function initLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' },
            audio: { echoCancellation: true, noiseSuppression: true }
        });
        localVideo.srcObject = localStream;
        updateUI('searching');
    } catch (e) {
        statusText.textContent = '❌ Нет доступа';
        console.error(e);
    }
}

function updateUI(state, message) {
    switch(state) {
        case 'searching':
            statusText.textContent = message || 'Поиск собеседника...';
            statusDot.className = 'dot searching';
            searchOverlay.classList.add('active');
            isConnected = false;
            isSearching = true;
            stopTimer();
            break;
        case 'connected':
            statusText.textContent = message || 'В разговоре';
            statusDot.className = 'dot connected';
            searchOverlay.classList.remove('active');
            isConnected = true;
            isSearching = false;
            startTimer();
            break;
        case 'disconnected':
            statusText.textContent = message || 'Разговор завершён';
            statusDot.className = 'dot searching';
            searchOverlay.classList.add('active');
            isConnected = false;
            isSearching = true;
            stopTimer();
            break;
    }
}

function createPeerConnection() {
    const pc = new RTCPeerConnection(rtcConfig);
    
    pc.onicecandidate = (e) => {
        if (e.candidate) {
            ws.send(JSON.stringify({
                type: 'ice',
                candidate: e.candidate
            }));
        }
    };
    
    pc.ontrack = (e) => {
        remoteVideo.srcObject = e.streams[0];
    };
    
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || 
            pc.connectionState === 'failed') {
            handleDisconnect('Соединение потеряно');
        }
    };
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }
    
    return pc;
}

async function createOffer() {
    if (!peerConnection) {
        peerConnection = createPeerConnection();
    }
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        ws.send(JSON.stringify({
            type: 'offer',
            sdp: offer
        }));
    } catch (e) {
        console.error(e);
    }
}

ws.onmessage = async (event) => {
    try {
        const data = JSON.parse(event.data);
        
        switch(data.type) {
            case 'waiting':
                updateUI('searching', 'Ожидание собеседника...');
                break;
                
            case 'paired':
                updateUI('connected', 'Собеседник найден!');
                await createOffer();
                break;
                
            case 'offer':
                if (!peerConnection) {
                    peerConnection = createPeerConnection();
                }
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                ws.send(JSON.stringify({
                    type: 'answer',
                    sdp: answer
                }));
                updateUI('connected', 'Собеседник найден!');
                break;
                
            case 'answer':
                if (peerConnection) {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
                }
                break;
                
            case 'ice':
                if (peerConnection) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                }
                break;
                
            case 'partner_left':
                handleDisconnect('Собеседник отключился');
                break;
                
            case 'search_stopped':
                updateUI('searching', 'Поиск остановлен');
                break;
        }
    } catch (e) {
        console.error(e);
    }
};

ws.onclose = () => {
    handleDisconnect('Соединение потеряно');
};

function handleDisconnect(message = 'Разговор завершён') {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    updateUI('disconnected', message);
    setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN && !isSearching) {
            ws.send(JSON.stringify({ type: 'find' }));
        }
    }, 1000);
}

micBtn.addEventListener('click', () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;
    
    isMuted = !isMuted;
    audioTrack.enabled = !isMuted;
    micBtn.classList.toggle('muted', isMuted);
    
    const icon = micBtn.querySelector('svg');
    if (isMuted) {
        icon.innerHTML = `<path d="M12 16c-2.206 0-4-1.794-4-4V6c0-2.206 1.794-4 4-4s4 1.794 4 4v6c0 2.206-1.794 4-4 4zm8-4h-2c0 2.607-1.67 4.82-4 5.65V20h-4v-2.35c-2.33-.83-4-3.043-4-5.65H4c0 3.526 2.608 6.443 6 6.93V20h4v-2.07c3.392-.487 6-3.404 6-6.93z"/><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2"/>`;
    } else {
        icon.innerHTML = `<path d="M12 16c-2.206 0-4-1.794-4-4V6c0-2.206 1.794-4 4-4s4 1.794 4 4v6c0 2.206-1.794 4-4 4zm8-4h-2c0 2.607-1.67 4.82-4 5.65V20h-4v-2.35c-2.33-.83-4-3.043-4-5.65H4c0 3.526 2.608 6.443 6 6.93V20h4v-2.07c3.392-.487 6-3.404 6-6.93z"/>`;
    }
});

nextBtn.addEventListener('click', () => {
    if (isConnected) {
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        remoteVideo.srcObject = null;
        ws.send(JSON.stringify({ type: 'leave' }));
    }
    updateUI('searching', 'Поиск нового собеседника...');
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'find' }));
    }
});

hangupBtn.addEventListener('click', () => {
    if (isConnected) {
        ws.send(JSON.stringify({ type: 'leave' }));
        handleDisconnect('Вы завершили разговор');
    } else if (isSearching) {
        ws.send(JSON.stringify({ type: 'stop_search' }));
        updateUI('searching', 'Поиск остановлен');
    }
});

initLocalStream();
updateUI('searching', 'Поиск собеседника...');