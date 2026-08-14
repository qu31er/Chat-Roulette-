from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import json
import os
from typing import Dict, List

app = FastAPI()

waiting_queue: List[str] = []
pairs: Dict[str, str] = {}
connections: Dict[str, WebSocket] = {}

# ===== РАЗДАЧА СТАТИКИ (CSS, JS) =====
# Пытаемся найти папку frontend в разных местах
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
    print(f"📁 Фронтенд найден: {frontend_path}")
    app.mount("/static", StaticFiles(directory=frontend_path), name="static")
else:
    print("❌ Папка frontend не найдена!")
    # Создаём папку если нет
    os.makedirs("frontend", exist_ok=True)

# ===== ОТДАЁМ HTML =====
@app.get("/")
async def root():
    # Ищем index.html
    html_paths = [
        "/app/frontend/index.html",
        "./frontend/index.html",
        "../frontend/index.html"
    ]
    for path in html_paths:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                html = f.read()
                # Заменяем ссылки на статику
                html = html.replace('href="style.css"', 'href="/static/style.css"')
                html = html.replace('src="app.js"', 'src="/static/app.js"')
                return HTMLResponse(content=html)
    
    # Если index.html нет, показываем простую страницу
    return HTMLResponse("""
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Чат-рулетка</title></head>
    <body>
        <h1>🚀 Чат-рулетка работает!</h1>
        <p>Но фронтенд не найден. Проверьте папку frontend.</p>
    </body>
    </html>
    """)

@app.get("/health")
async def health():
    return {"status": "ok", "connections": len(connections)}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    client_id = str(id(websocket))
    connections[client_id] = websocket
    
    print(f"✅ Клиент: {client_id}")
    await websocket.send_text(json.dumps({"type": "welcome"}))
    
    if waiting_queue:
        partner_id = waiting_queue.pop(0)
        partner_ws = connections.get(partner_id)
        if partner_ws:
            pairs[client_id] = partner_id
            pairs[partner_id] = client_id
            await websocket.send_text(json.dumps({"type": "paired"}))
            await partner_ws.send_text(json.dumps({"type": "paired"}))
            print(f"🎯 Пара: {client_id} <-> {partner_id}")
        else:
            waiting_queue.append(client_id)
            await websocket.send_text(json.dumps({"type": "waiting"}))
    else:
        waiting_queue.append(client_id)
        await websocket.send_text(json.dumps({"type": "waiting"}))
        print(f"⏳ Очередь: {client_id}")
    
    try:
        while True:
            message = await websocket.receive_text()
            data = json.loads(message)
            
            if data["type"] in ["offer", "answer", "ice"]:
                partner_id = pairs.get(client_id)
                if partner_id and partner_id in connections:
                    await connections[partner_id].send_text(message)
            
            elif data["type"] in ["leave", "next"]:
                partner_id = pairs.pop(client_id, None)
                if partner_id:
                    pairs.pop(partner_id, None)
                    if partner_id in connections:
                        await connections[partner_id].send_text(json.dumps({"type": "partner_left"}))
                        waiting_queue.append(partner_id)
                waiting_queue.append(client_id)
                await websocket.send_text(json.dumps({"type": "waiting"}))
    
    except WebSocketDisconnect:
        print(f"❌ Отключился: {client_id}")
        partner_id = pairs.pop(client_id, None)
        if partner_id:
            pairs.pop(partner_id, None)
            if partner_id in connections:
                await connections[partner_id].send_text(json.dumps({"type": "partner_left"}))
                waiting_queue.append(partner_id)
        connections.pop(client_id, None)
        if client_id in waiting_queue:
            waiting_queue.remove(client_id)