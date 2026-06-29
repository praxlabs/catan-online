/**
 * network.js - PeerJS P2P Networking Wrapper
 */

window.CatanNetwork = (function() {
    let peer = null;
    let connections = []; // Only populated on Host
    let connToHost = null; // Only populated on Client
    let myPeerId = null;
    let role = null; // 'host' | 'client'
    let callbacks = {};

    function init(netCallbacks) {
        callbacks = netCallbacks;
    }

    /**
     * Start hosting a game session
     */
    function hostGame() {
        role = 'host';
        connections = [];

        // Initialize PeerJS using free public cloud server
        peer = new Peer();

        peer.on('open', (id) => {
            myPeerId = id;
            if (callbacks.onHostOpened) {
                callbacks.onHostOpened(id);
            }
        });

        peer.on('connection', (conn) => {
            connections.push(conn);

            conn.on('open', () => {
                if (callbacks.onClientConnected) {
                    callbacks.onClientConnected(conn);
                }
            });

            conn.on('data', (rawData) => {
                if (callbacks.onDataReceived) {
                    try {
                        const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
                        callbacks.onDataReceived(conn, data);
                    } catch(e) { console.error('Host: failed to parse message', e); }
                }
            });

            conn.on('close', () => {
                connections = connections.filter(c => c.peer !== conn.peer);
                if (callbacks.onClientDisconnected) {
                    callbacks.onClientDisconnected(conn);
                }
            });

            conn.on('error', (err) => {
                console.error("Connection error:", err);
            });
        });

        peer.on('error', (err) => {
            console.error("PeerJS error:", err);
            if (callbacks.onError) {
                callbacks.onError(err);
            }
        });
    }

    /**
     * Join an existing game session
     */
    function joinGame(hostId) {
        role = 'client';
        peer = new Peer();

        peer.on('open', (id) => {
            myPeerId = id;

            // Connect to host
            connToHost = peer.connect(hostId);

            connToHost.on('open', () => {
                if (callbacks.onConnectedToHost) {
                    callbacks.onConnectedToHost(connToHost);
                }
            });

            connToHost.on('data', (rawData) => {
                if (callbacks.onDataReceived) {
                    try {
                        const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
                        callbacks.onDataReceived(connToHost, data);
                    } catch(e) { console.error('Client: failed to parse message', e); }
                }
            });

            connToHost.on('close', () => {
                if (callbacks.onDisconnectedFromHost) {
                    callbacks.onDisconnectedFromHost();
                }
            });

            connToHost.on('error', (err) => {
                console.error("Connection error with host:", err);
            });
        });

        peer.on('error', (err) => {
            console.error("PeerJS error:", err);
            if (callbacks.onError) {
                callbacks.onError(err);
            }
        });
    }

    /**
     * Host broadcasts data to all connected clients
     */
    function broadcast(data) {
        if (role !== 'host') return;
        const payload = JSON.stringify(data);
        connections.forEach(conn => {
            if (conn.open) {
                conn.send(payload);
            }
        });
    }

    /**
     * Client sends data to Host
     */
    function sendToHost(data) {
        if (role !== 'client' || !connToHost || !connToHost.open) return;
        connToHost.send(JSON.stringify(data));
    }

    /**
     * Terminate connection
     */
    function disconnect() {
        if (peer) {
            peer.destroy();
        }
        peer = null;
        connections = [];
        connToHost = null;
        myPeerId = null;
        role = null;
    }

    return {
        init,
        hostGame,
        joinGame,
        broadcast,
        sendToHost,
        disconnect,
        getPeerId: () => myPeerId,
        getRole: () => role
    };
})();
