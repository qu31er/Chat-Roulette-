import asyncio
import json
import websockets
from collections import deque

# Очередь ожидающих клиентов
waiting_queue = deque()
# Словарь пар (клиент -> собеседник)
pairs = {}

async def handler(websocket, path):
    """Обработчик подключения"""
    client_id = websocket.remote_address
    print(f"🔗 Новый клиент: {client_id}")
    
    try:
        # Ищем собеседника
        await find_partner(websocket)
        
        # Обрабатываем сообщения
        async for message in websocket:
            await handle_message(websocket, message)
            
    except websockets.exceptions.ConnectionClosed:
        print(f"❌ Клиент отключился: {client_id}")
    finally:
        # Очищаем при отключении
        await disconnect_partner(websocket)

async def find_partner(websocket):
    """Поиск собеседника"""
    global waiting_queue, pairs
    
    if waiting_queue:
        # Есть кто-то в очереди - создаём пару
        partner = waiting_queue.popleft()
        pairs[websocket] = partner
        pairs[partner] = websocket
        
        # Уведомляем обоих
        await websocket.send(json.dumps({"type": "paired"}))
        await partner.send(json.dumps({"type": "paired"}))
        
        print(f"✅ Пара создана: {websocket.remote_address} <-> {partner.remote_address}")
    else:
        # Нет никого - добавляем в очередь
        waiting_queue.append(websocket)
        await websocket.send(json.dumps({"type": "waiting"}))
        print(f"⏳ Клиент в очереди: {websocket.remote_address}")

async def handle_message(websocket, message):
    """Обработка сообщений от клиента"""
    try:
        data = json.loads(message)
        msg_type = data.get("type")
        
        if msg_type in ["offer", "answer", "ice"]:
            # Пересылаем сигнал собеседнику
            partner = pairs.get(websocket)
            if partner:
                await partner.send(message)
                
        elif msg_type in ["leave", "next"]:
            # Отключаемся от собеседника
            await disconnect_partner(websocket)
            # Ищем нового
            await find_partner(websocket)
            
        elif msg_type == "stop_search":
            # Останавливаем поиск
            if websocket in waiting_queue:
                waiting_queue.remove(websocket)
            await websocket.send(json.dumps({"type": "search_stopped"}))
            
    except json.JSONDecodeError:
        print(f"⚠️ Неверный JSON: {message}")

async def disconnect_partner(websocket):
    """Отключение от собеседника"""
    global pairs, waiting_queue
    
    partner = pairs.pop(websocket, None)
    if partner:
        pairs.pop(partner, None)
        if not partner.closed:
            await partner.send(json.dumps({"type": "partner_left"}))
            # Возвращаем партнёра в очередь
            waiting_queue.append(partner)
    
    # Убираем из очереди, если там был
    if websocket in waiting_queue:
        waiting_queue.remove(websocket)

async def main():
    """Запуск сервера"""
    port = 8887
    # Для Railway берём порт из окружения
    import os
    env_port = os.environ.get("PORT")
    if env_port:
        try:
            port = int(env_port)
        except ValueError:
            pass
    
    print(f"🚀 Сервер запущен на порту {port}")
    async with websockets.serve(handler, "0.0.0.0", port):
        await asyncio.Future()  # Бесконечное ожидание

if __name__ == "__main__":
    asyncio.run(main())