from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
import json
import asyncio
from typing import Dict, List
import logging

# Настройка логов
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

waiting_queue: List[str] = []
pairs: Dict[str, str] = {}
connections: Dict[str, WebSocket] = {}

# ===== HEALTHCHECK (ОТВЕЧАЕТ МГНОВЕННО) =====
@app.get("/")
async def root():
    return {"status": "ok", "message": "Chat Roulette работает"}

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "connections": len(connections),
        "waiting": len(waiting_queue),
        "pairs": len(pairs) // 2
    }
# ============================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    client_id = str(id(websocket))
    connections[client_id] = websocket
    
    logger.info(f"✅ Новый клиент: {client_id}")
    
    try:
        await websocket.send_text(json.dumps({"type": "welcome"}))
        
        # Поиск партнёра
        if waiting_queue:
            partner_id = waiting_queue.pop(0)
            partner_ws = connections.get(partner_id)
            if partner_ws:
                pairs[client_id] = partner_id
                pairs[partner_id] = client_id
                await websocket.send_text(json.dumps({"type": "paired"}))
                await partner_ws.send_text(json.dumps({"type": "paired"}))
                logger.info(f"🎯 Пара: {client_id} <-> {partner_id}")
            else:
                waiting_queue.append(client_id)
                await websocket.send_text(json.dumps({"type": "waiting"}))
        else:
            waiting_queue.append(client_id)
            await websocket.send_text(json.dumps({"type": "waiting"}))
            logger.info(f"⏳ В очереди: {client_id}")
        
        # Обработка сообщений
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
                data = json.loads(message)
                msg_type = data.get("type")
                
                if msg_type in ["offer", "answer", "ice"]:
                    partner_id = pairs.get(client_id)
                    if partner_id and partner_id in connections:
                        await connections[partner_id].send_text(message)
                
                elif msg_type in ["leave", "next"]:
                    logger.info(f"🚪 Пользователь {client_id} завершил разговор")
                    partner_id = pairs.pop(client_id, None)
                    if partner_id:
                        pairs.pop(partner_id, None)
                        if partner_id in connections:
                            await connections[partner_id].send_text(json.dumps({"type": "partner_left"}))
                            waiting_queue.append(partner_id)
                    waiting_queue.append(client_id)
                    await websocket.send_text(json.dumps({"type": "waiting"}))
                
                elif msg_type == "stop_search":
                    if client_id in waiting_queue:
                        waiting_queue.remove(client_id)
                    await websocket.send_text(json.dumps({"type": "search_stopped"}))
                    
            except asyncio.TimeoutError:
                # Таймаут на получение сообщения - пинг
                await websocket.send_text(json.dumps({"type": "ping"}))
                continue
                
    except WebSocketDisconnect:
        logger.info(f"❌ Отключился: {client_id}")
    except Exception as e:
        logger.error(f"⚠️ Ошибка: {e}")
    finally:
        # Очистка
        partner_id = pairs.pop(client_id, None)
        if partner_id:
            pairs.pop(partner_id, None)
            if partner_id in connections:
                try:
                    await connections[partner_id].send_text(json.dumps({"type": "partner_left"}))
                    waiting_queue.append(partner_id)
                except:
                    pass
        connections.pop(client_id, None)
        if client_id in waiting_queue:
            waiting_queue.remove(client_id)