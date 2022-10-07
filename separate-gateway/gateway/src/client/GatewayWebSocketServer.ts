import {IncomingMessage} from "http";
import {ServerOptions, WebSocket, WebSocketServer} from "ws";
import {ClientOptions, Client} from "./Client.js";
import {compareVersions} from "../util/compareVersion.js";
import {log, LogLevel} from "../util/logger.js";

export class GatewayWebSocketServer {
    private readonly server: WebSocketServer;
    public readonly clientCount: number;
    public readonly clients: Client[] = [];
    public readonly clientShardMap: Map<number, number[]> = new Map();
    public unassignedWebSockets: {ws: WebSocket, v: string}[] = [];

    public constructor(options: ServerOptions, clientCount: number) {
        this.server = new WebSocketServer(options);
        this.clientCount = clientCount;

        this.server.on('connection', this.onConnection.bind(this));
    }

    public addClient(clientOptions: ClientOptions) {
        const client = new Client(clientOptions);

        this.clients[clientOptions.id] = client;
        this.clientShardMap.set(clientOptions.id, client.shardIds);
    }

    public async connectClient(id: number) {
        const client = this.clients[id];

        if (!client)
            throw new Error(`Client with id ${id} not found`);

        await client.connect();
    }

    private onConnection(ws: WebSocket, req: IncomingMessage) {
        log({
            level: LogLevel.INFO,
            task: 'GWM',
            step: 'WS',
            message: `New websocket connection from ${req.socket.remoteAddress}`
        });

        ws.on('message', this.onMessage.bind(this, ws));
        ws.on('close', this.onClose.bind(this, ws));
    }

    private onClose(ws: WebSocket) {
        log({level: LogLevel.DEBUG, task: 'GWM', step: 'WS', message: `Websocket closed`});
        const manager = this.clients.find(m => m.ws === ws);
        if (manager) {
            log({
                level: LogLevel.WARN,
                task: 'GWM',
                step: 'WS',
                message: `Websocket closed for client ${manager.id}`
            });

            manager.ws = null;
            manager.version = null;

            if (this.unassignedWebSockets.length > 0) {
                log({
                    level: LogLevel.INFO,
                    task: 'GWM',
                    step: 'WS',
                    message: `Assigning unassigned websocket to client ${manager.id}`
                });

                const {ws, v} = this.unassignedWebSockets.shift()!;
                manager.ws = ws;
                manager.version = v;
            }
        }
    }

    private onMessage(ws: WebSocket, message: string) {
        const payload = JSON.parse(message);
        if (payload.op === 'available')
            this.handleAvailableWebsocket(ws, payload);
    }

    private handleAvailableWebsocket(ws: WebSocket, payload: {op: 'available', v: string}) {
        log({
            level: LogLevel.INFO,
            task: 'GWM',
            step: 'WS',
            message: `New client available`
        });

        ws.removeAllListeners('message');

        const manager = this.clients.find(m => !m.ws);
        if (manager) {
            log({
                level: LogLevel.DEBUG,
                task: 'GWM',
                step: 'WS',
                message: `Handing websocket to client ${manager.id}`
            });

            manager.ws = ws
            manager.version = payload.v;

            for (const shard of manager.shards) {
                if (shard)
                    shard.attachWebsocket(ws);
            }

            return;
        }

        if (this.clients.length < this.clientCount) {
            log({
                level: LogLevel.DEBUG,
                task: 'GWM',
                step: 'WS',
                message: `Not all clients initialized yet, storing websocket`
            });

            this.unassignedWebSockets.push({ws, v: payload.v});
            return;
        }

        const oldestClient = Math.max(...this.clients.map(c => compareVersions(c.version!, payload.v)));

        if (oldestClient > 0) {
            log({
                level: LogLevel.DEBUG,
                task: 'GWM',
                step: 'WS',
                message: `Found outdated client, handing websocket to it`
            });

            const manager = this.clients.find(m => compareVersions(m.version!, payload.v) === oldestClient);
            manager!.ws = ws;
            manager!.version = payload.v;

            for (const shard of manager!.shards)
                shard.attachWebsocket(ws);

            return;
        }

        if (oldestClient < 0) {
            log({
                level: LogLevel.DEBUG,
                task: 'GWM',
                step: 'WS',
                message: `Websocket is outdated and not needed, closing it`
            });

            ws.close();
            return
        }

        if (this.unassignedWebSockets.length < this.clientCount) {
            log({
                level: LogLevel.DEBUG,
                task: 'GWM',
                step: 'WS',
                message: `Less than ${this.clientCount} unassigned websockets, storing websocket`
            });

            this.unassignedWebSockets.push({ws, v: payload.v});
            return;
        }

        log({
            level: LogLevel.DEBUG,
            task: 'GWM',
            step: 'WS',
            message: `Already have enough unassigned websockets, closing this one`
        });

        ws.close();
    }
}
