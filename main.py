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

# ===== ОТДАЁМ HTML =====
@app.get("/")
async def root():
    # Пытаемся найти index.html
    paths = [
        "frontend/index.html",
        "../frontend/index.html",
        "/app/frontend/index.html"
    ]
    for path in paths:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return HTMLResponse(content=f.read())
    return {"status": "ok", "message": "Chat Roulette работает, но фронтенд не найден"}

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
        else:
            waiting_queue.append(client_id)
            await websocket.send_text(json.dumps({"type": "waiting"}))
    else:
        waiting_queue.append(client_id)
        await websocket.send_text(json.dumps({"type": "waiting"}))
    
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