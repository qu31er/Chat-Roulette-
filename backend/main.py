from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
import json
from typing import Dict, Set
import asyncio

app = FastAPI()

# Хранилище
waiting_queue = []  # Очередь ожидания
pairs = {}  # Словарь пар {client: partner}
active_connections: Dict[str, WebSocket] = {}  # Все активные соединения

@app.get("/")
async def root():
    return {"status": "ok", "message": "Chat Roulette Server is running"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    client_id = str(id(websocket))
    active_connections[client_id] = websocket
    
    print(f"🔗 Новый клиент: {client_id}")
    
    try:
        # Отправляем приветствие
        await websocket.send_text(json.dumps({
            "type": "welcome",
            "message": "Connected to Chat Roulette"
        }))
        
        # Ищем собеседника
        await find_partner(websocket, client_id)
        
        # Обрабатываем сообщения
        while True:
            message = await websocket.receive_text()
            await handle_message(websocket, client_id, message)
            
    except WebSocketDisconnect:
        print(f"❌ Клиент отключился: {client_id}")
    finally:
        await disconnect_client(client_id)
        if client_id in active_connections:
            del active_connections[client_id]

async def find_partner(websocket: WebSocket, client_id: str):
    global waiting_queue, pairs
    
    if waiting_queue:
        # Есть кто-то в очереди
        partner_id = waiting_queue.pop(0)
        partner_ws = active_connections.get(partner_id)
        
        if partner_ws:
            # Создаём пару
            pairs[client_id] = partner_id
            pairs[partner_id] = client_id
            
            # Уведомляем обоих
            await websocket.send_text(json.dumps({
                "type": "paired",
                "message": "Собеседник найден!"
            }))
            await partner_ws.send_text(json.dumps({
                "type": "paired",
                "message": "Собеседник найден!"
            }))
            
            print(f"✅ Пара создана: {client_id} <-> {partner_id}")
        else:
            # Партнёр отключился
            await find_partner(websocket, client_id)
    else:
        # Никого нет - добавляем в очередь
        waiting_queue.append(client_id)
        await websocket.send_text(json.dumps({
            "type": "waiting",
            "message": "Ожидание собеседника..."
        }))
        print(f"⏳ Клиент в очереди: {client_id}")

async def handle_message(websocket: WebSocket, client_id: str, message: str):
    try:
        data = json.loads(message)
        msg_type = data.get("type")
        
        if msg_type in ["offer", "answer", "ice"]:
            # Пересылаем собеседнику
            partner_id = pairs.get(client_id)
            if partner_id:
                partner_ws = active_connections.get(partner_id)
                if partner_ws:
                    await partner_ws.send_text(message)
                    
        elif msg_type in ["leave", "next"]:
            # Отключаемся от собеседника
            await disconnect_client(client_id)
            # Ищем нового
            await find_partner(websocket, client_id)
            
        elif msg_type == "stop_search":
            # Останавливаем поиск
            if client_id in waiting_queue:
                waiting_queue.remove(client_id)
            await websocket.send_text(json.dumps({
                "type": "search_stopped",
                "message": "Поиск остановлен"
            }))
            
    except json.JSONDecodeError:
        print(f"⚠️ Неверный JSON от {client_id}: {message}")

async def disconnect_client(client_id: str):
    global pairs, waiting_queue
    
    # Убираем из пар
    partner_id = pairs.pop(client_id, None)
    if partner_id:
        pairs.pop(partner_id, None)
        partner_ws = active_connections.get(partner_id)
        if partner_ws:
            try:
                await partner_ws.send_text(json.dumps({
                    "type": "partner_left",
                    "message": "Собеседник отключился"
                }))
            except:
                pass
            # Возвращаем в очередь
            if partner_id not in waiting_queue:
                waiting_queue.append(partner_id)
    
    # Убираем из очереди
    if client_id in waiting_queue:
        waiting_queue.remove(client_id)

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "connections": len(active_connections),
        "waiting": len(waiting_queue),
        "pairs": len(pairs) // 2
    }