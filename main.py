from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import json
import os
from typing import Dict, List
import logging

# Включаем логи
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

waiting_queue: List[str] = []
pairs: Dict[str, str] = {}
connections: Dict[str, WebSocket] = {}

# ===== СТАТИКА =====
frontend_paths = [
    "/app/frontend",
    "./frontend",
    "../frontend",
    os.path.join(os.path.dirname(__file__), "frontend")
]

frontend_path = None
for path in frontend_paths:
    if os.path.exists(path) and os.path.isdir(path):
        frontend_path = path
        break

if frontend_path:
    logger.info(f"📁 Фронтенд найден: {frontend_path}")
    app.mount("/static", StaticFiles(directory=frontend_path), name="static")
else:
    logger.warning("❌ Папка frontend не найдена!")

# ===== ОТДАЁМ HTML =====
@app.get("/")
async def root():
    html_paths = [
        "/app/frontend/index.html",
        "./frontend/index.html",
        "../frontend/index.html"
    ]
    for path in html_paths:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                html = f.read()
                html = html.replace('href="style.css"', 'href="/static/style.css"')
                html = html.replace('src="app.js"', 'src="/static/app.js"')
                return HTMLResponse(content=html)
    
    return HTMLResponse("""
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Чат-рулетка</title></head>
    <body>
        <h1>🚀 Чат-рулетка работает!</h1>
        <p>Но фронтенд не найден. Проверьте папку frontend.</p>
        <p>Текущая директория: {}</p>
    </body>
    </html>
    """.format(os.getcwd()))

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "connections": len(connections),
        "waiting": len(waiting_queue),
        "pairs": len(pairs) // 2
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    client_id = str(id(websocket))
    connections[client_id] = websocket
    
    logger.info(f"✅ Новый клиент: {client_id}")
    logger.info(f"📊 Статистика: connections={len(connections)}, waiting={len(waiting_queue)}, pairs={len(pairs)}")
    
    try:
        await websocket.send_text(json.dumps({"type": "welcome"}))
        
        # ===== ПОИСК ПАРТНЁРА =====
        if waiting_queue:
            # Берём первого из очереди
            partner_id = waiting_queue.pop(0)
            partner_ws = connections.get(partner_id)
            
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
                
                logger.info(f"🎯 ПАРА СОЗДАНА: {client_id} <-> {partner_id}")
                logger.info(f"📊 После пары: connections={len(connections)}, waiting={len(waiting_queue)}, pairs={len(pairs)}")
            else:
                # Партнёр отключился
                waiting_queue.append(client_id)
                await websocket.send_text(json.dumps({
                    "type": "waiting",
                    "message": "Ожидание собеседника..."
                }))
                logger.warning(f"⚠️ Партнёр {partner_id} отключился, возвращаем в очередь")
        else:
            # Никого нет - добавляем в очередь
            waiting_queue.append(client_id)
            await websocket.send_text(json.dumps({
                "type": "waiting",
                "message": "Ожидание собеседника..."
            }))
            logger.info(f"⏳ Клиент в очереди: {client_id}")
        
        # ===== ОБРАБОТКА СООБЩЕНИЙ =====
        while True:
            message = await websocket.receive_text()
            data = json.loads(message)
            msg_type = data.get("type")
            
            logger.info(f"📨 Сообщение от {client_id}: {msg_type}")
            
            if msg_type in ["offer", "answer", "ice"]:
                partner_id = pairs.get(client_id)
                if partner_id and partner_id in connections:
                    await connections[partner_id].send_text(message)
                    logger.info(f"🔄 Переслано {msg_type} -> {partner_id}")
                else:
                    logger.warning(f"⚠️ Нет партнёра для {client_id}")
            
            elif msg_type in ["leave", "next"]:
                logger.info(f"🚪 {client_id} завершает разговор")
                partner_id = pairs.pop(client_id, None)
                if partner_id:
                    pairs.pop(partner_id, None)
                    if partner_id in connections:
                        await connections[partner_id].send_text(json.dumps({
                            "type": "partner_left",
                            "message": "Собеседник отключился"
                        }))
                        # Возвращаем партнёра в очередь
                        if partner_id not in waiting_queue:
                            waiting_queue.append(partner_id)
                            logger.info(f"🔄 {partner_id} возвращён в очередь")
                
                # Добавляем текущего клиента в очередь
                if client_id not in waiting_queue:
                    waiting_queue.append(client_id)
                await websocket.send_text(json.dumps({
                    "type": "waiting",
                    "message": "Ожидание собеседника..."
                }))
                logger.info(f"📊 После leave: connections={len(connections)}, waiting={len(waiting_queue)}")
            
            elif msg_type == "stop_search":
                if client_id in waiting_queue:
                    waiting_queue.remove(client_id)
                await websocket.send_text(json.dumps({
                    "type": "search_stopped",
                    "message": "Поиск остановлен"
                }))
            
            elif msg_type == "find":
                # Клиент хочет найти собеседника
                if client_id not in waiting_queue and client_id not in pairs:
                    waiting_queue.append(client_id)
                    await websocket.send_text(json.dumps({
                        "type": "waiting",
                        "message": "Поиск собеседника..."
                    }))
                    logger.info(f"🔍 {client_id} начал поиск")
    
    except WebSocketDisconnect:
        logger.info(f"❌ Отключился: {client_id}")
    except Exception as e:
        logger.error(f"⚠️ Ошибка: {e}")
    finally:
        # ===== ОЧИСТКА =====
        partner_id = pairs.pop(client_id, None)
        if partner_id:
            pairs.pop(partner_id, None)
            if partner_id in connections:
                try:
                    await connections[partner_id].send_text(json.dumps({
                        "type": "partner_left",
                        "message": "Собеседник отключился"
                    }))
                    if partner_id not in waiting_queue:
                        waiting_queue.append(partner_id)
                except:
                    pass
        
        connections.pop(client_id, None)
        if client_id in waiting_queue:
            waiting_queue.remove(client_id)
        
        logger.info(f"🧹 Очистка {client_id} завершена")
        logger.info(f"📊 Итог: connections={len(connections)}, waiting={len(waiting_queue)}, pairs={len(pairs)}")