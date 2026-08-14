package com.roulette;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import org.json.JSONObject;

import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class ChatRouletteServer extends WebSocketServer {
    private final Queue<WebSocket> waitingQueue = new LinkedList<>();
    private final Map<WebSocket, WebSocket> pairs = new ConcurrentHashMap<>();
    private final Map<WebSocket, String> clientNames = new ConcurrentHashMap<>();

    public ChatRouletteServer(int port) {
        super(new InetSocketAddress(port));
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        String clientId = conn.getRemoteSocketAddress().toString();
        clientNames.put(conn, clientId);
        System.out.println("🔗 Новый клиент: " + clientId);
        findPartner(conn);
    }

    private void findPartner(WebSocket conn) {
        synchronized (waitingQueue) {
            if (waitingQueue.isEmpty()) {
                waitingQueue.add(conn);
                JSONObject waiting = new JSONObject();
                waiting.put("type", "waiting");
                conn.send(waiting.toString());
                System.out.println("⏳ Клиент в очереди: " + clientNames.get(conn));
            } else {
                WebSocket partner = waitingQueue.poll();
                if (partner != null && partner.isOpen()) {
                    createPair(conn, partner);
                } else {
                    waitingQueue.add(conn);
                }
            }
        }
    }

    private void createPair(WebSocket a, WebSocket b) {
        pairs.put(a, b);
        pairs.put(b, a);
        
        JSONObject pairedA = new JSONObject();
        pairedA.put("type", "paired");
        a.send(pairedA.toString());
        
        JSONObject pairedB = new JSONObject();
        pairedB.put("type", "paired");
        b.send(pairedB.toString());
        
        System.out.println("✅ Пара создана: " + clientNames.get(a) + " <-> " + clientNames.get(b));
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        try {
            JSONObject json = new JSONObject(message);
            String type = json.getString("type");
            
            switch (type) {
                case "offer":
                case "answer":
                case "ice":
                    WebSocket partner = pairs.get(conn);
                    if (partner != null && partner.isOpen()) {
                        partner.send(message);
                    }
                    break;
                    
                case "leave":
                case "next":
                    disconnectPartner(conn);
                    if (conn.isOpen()) {
                        findPartner(conn);
                    }
                    break;
                    
                case "stop_search":
                    synchronized (waitingQueue) {
                        waitingQueue.remove(conn);
                    }
                    JSONObject stopped = new JSONObject();
                    stopped.put("type", "search_stopped");
                    conn.send(stopped.toString());
                    break;
            }
        } catch (Exception e) {
            System.err.println("❌ Ошибка: " + e.getMessage());
        }
    }

    private void disconnectPartner(WebSocket conn) {
        WebSocket partner = pairs.remove(conn);
        if (partner != null) {
            pairs.remove(partner);
            if (partner.isOpen()) {
                JSONObject left = new JSONObject();
                left.put("type", "partner_left");
                partner.send(left.toString());
                synchronized (waitingQueue) {
                    waitingQueue.add(partner);
                }
            }
        }
        synchronized (waitingQueue) {
            waitingQueue.remove(conn);
        }
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        System.out.println("❌ Клиент отключился: " + clientNames.get(conn));
        disconnectPartner(conn);
        clientNames.remove(conn);
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        System.err.println("⚠️ Ошибка: " + ex.getMessage());
    }

    public static void main(String[] args) {
        int port = 8887;
        String envPort = System.getenv("PORT");
        if (envPort != null && !envPort.isEmpty()) {
            try {
                port = Integer.parseInt(envPort);
            } catch (NumberFormatException e) {
                System.err.println("⚠️ Неверный PORT, используем 8887");
            }
        }
        
        ChatRouletteServer server = new ChatRouletteServer(port);
        server.start();
        System.out.println(" Сервер запущен на порту " + port);
    }
}