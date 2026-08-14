// WebSocket подключение
const WS_URL = `wss://${window.location.host}/ws`;
console.log('🔗 WebSocket URL:', WS_URL);

const ws = new WebSocket(WS_URL);
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
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

// ===== ТАЙМЕР =====
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

// ===== КАМЕРА =====
async function initLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' },
            audio: { echoCancellation: true, noiseSuppression: true }
        });
        localVideo.srcObject = localStream;
        updateUI('searching');
        console.log('✅ Камера включена');
    } catch (e) {
        statusText.textContent = '❌ Нет доступа к камере';
        console.error('❌ Ошибка камеры:', e);
        alert('Пожалуйста, разрешите доступ к камере и микрофону');
    }
}

// ===== ОБНОВЛЕНИЕ UI =====
function updateUI(state, message) {
    console.log('📌 UI:', state, message);
    switch(state) {
        case 'searching':
            statusText.textContent = message || 'Поиск собеседника...';
            if (statusDot) statusDot.className = 'dot searching';
            if (searchOverlay) searchOverlay.classList.add('active');
            isConnected = false;
            isSearching = true;
            stopTimer();
            break;
        case 'connected':
            statusText.textContent = message || 'В разговоре';
            if (statusDot) statusDot.className = 'dot connected';
            if (searchOverlay) searchOverlay.classList.remove('active');
            isConnected = true;
            isSearching = false;
            startTimer();
            break;
        case 'disconnected':
            statusText.textContent = message || 'Разговор завершён';
            if (statusDot) statusDot.className = 'dot searching';
            if (searchOverlay) searchOverlay.classList.add('active');
            isConnected = false;
            isSearching = true;
            stopTimer();
            break;
    }
}

// ===== WEBRTC =====
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
        console.log('🎥 Видео собеседника получено');
    };
    
    pc.onconnectionstatechange = () => {
        console.log('🔌 Состояние:', pc.connectionState);
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
        console.log('📤 Offer отправлен');
    } catch (e) {
        console.error('❌ Ошибка offer:', e);
    }
}

// ===== WEBSOCKET =====
ws.onopen = () => {
    console.log('✅ WebSocket подключен');
    statusText.textContent = 'Подключено к серверу';
};

ws.onmessage = async (event) => {
    try {
        const data = JSON.parse(event.data);
        console.log('📨 Получено:', data.type);
        
        switch(data.type) {
            case 'welcome':
                console.log('👋 Приветствие от сервера');
                break;
                
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
                console.log('📤 Answer отправлен');
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
                
            default:
                console.log('⚠️ Неизвестный тип:', data.type);
        }
    } catch (e) {
        console.error('❌ Ошибка обработки:', e);
    }
};

ws.onclose = () => {
    console.log('❌ WebSocket закрыт');
    handleDisconnect('Соединение потеряно');
};

ws.onerror = (error) => {
    console.error('❌ WebSocket ошибка:', error);
    statusText.textContent = '⚠️ Ошибка соединения';
};

function handleDisconnect(message = 'Разговор завершён') {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    updateUI('disconnected', message);
}

// ===== КНОПКИ =====
// Микрофон
if (micBtn) {
    micBtn.addEventListener('click', function() {
        console.log('🔊 Кнопка микрофона нажата');
        if (!localStream) return;
        const audioTrack = localStream.getAudioTracks()[0];
        if (!audioTrack) return;
        
        isMuted = !isMuted;
        audioTrack.enabled = !isMuted;
        this.classList.toggle('muted', isMuted);
        console.log('🎤 Микрофон:', isMuted ? 'ВЫКЛ' : 'ВКЛ');
    });
}

// Новый собеседник
if (nextBtn) {
    nextBtn.addEventListener('click', function() {
        console.log('🔄 Кнопка "Новый" нажата');
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
}

// Завершить
if (hangupBtn) {
    hangupBtn.addEventListener('click', function() {
        console.log('📞 Кнопка "Завершить" нажата');
        if (isConnected) {
            ws.send(JSON.stringify({ type: 'leave' }));
            handleDisconnect('Вы завершили разговор');
        } else if (isSearching) {
            ws.send(JSON.stringify({ type: 'stop_search' }));
            updateUI('searching', 'Поиск остановлен');
        }
    });
}

// ===== ЗАПУСК =====
console.log('🚀 Запуск приложения...');
initLocalStream();
updateUI('searching', 'Поиск собеседника...');