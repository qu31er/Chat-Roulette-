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
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
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
            video: { 
                facingMode: 'user',
                width: { ideal: 640 },
                height: { ideal: 480 }
            },
            audio: { 
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        localVideo.srcObject = localStream;
        console.log('✅ Камера включена, треков:', localStream.getTracks().length);
        console.log('🎤 Аудио треки:', localStream.getAudioTracks().length);
        console.log('📹 Видео треки:', localStream.getVideoTracks().length);
        updateUI('searching');
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

// ===== СОЗДАНИЕ ПИРА (ВАЖНО!) =====
function createPeerConnection() {
    const pc = new RTCPeerConnection(rtcConfig);
    
    // ===== ДОБАВЛЯЕМ ТРЕКИ В ПИР =====
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
            console.log('➕ Добавлен трек:', track.kind);
        });
    }
    
    pc.onicecandidate = (e) => {
        if (e.candidate) {
            ws.send(JSON.stringify({
                type: 'ice',
                candidate: e.candidate
            }));
            console.log('❄️ ICE кандидат отправлен');
        }
    };
    
    pc.ontrack = (e) => {
        console.log('🎥 Получен трек от собеседника:', e.track.kind);
        if (e.streams && e.streams[0]) {
            remoteVideo.srcObject = e.streams[0];
            console.log('✅ Видео собеседника подключено!');
        }
    };
    
    pc.onconnectionstatechange = () => {
        console.log('🔌 Состояние:', pc.connectionState);
        if (pc.connectionState === 'connected') {
            console.log('✅ WebRTC соединение установлено!');
        }
        if (pc.connectionState === 'disconnected' || 
            pc.connectionState === 'failed') {
            handleDisconnect('Соединение потеряно');
        }
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log('❄️ ICE состояние:', pc.iceConnectionState);
    };
    
    return pc;
}

// ===== СОЗДАНИЕ OFFER =====
async function createOffer() {
    if (!peerConnection) {
        peerConnection = createPeerConnection();
    }
    try {
        console.log('📤 Создаём offer...');
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
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
                console.log('🎯 СОБЕСЕДНИК НАЙДЕН!');
                updateUI('connected', 'Собеседник найден!');
                // Создаём offer после пары
                setTimeout(async () => {
                    await createOffer();
                }, 500);
                break;
                
            case 'offer':
                console.log('📨 Получен offer');
                if (!peerConnection) {
                    peerConnection = createPeerConnection();
                }
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
                console.log('✅ RemoteDescription установлен');
                
                const answer = await peerConnection.createAnswer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true
                });
                await peerConnection.setLocalDescription(answer);
                ws.send(JSON.stringify({
                    type: 'answer',
                    sdp: answer
                }));
                console.log('📤 Answer отправлен');
                updateUI('connected', 'Собеседник найден!');
                break;
                
            case 'answer':
                console.log('📨 Получен answer');
                if (peerConnection) {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
                    console.log('✅ RemoteDescription (answer) установлен');
                }
                break;
                
            case 'ice':
                console.log('❄️ Получен ICE кандидат');
                if (peerConnection) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                    console.log('✅ ICE кандидат добавлен');
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