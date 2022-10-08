import {IncomingMessage} from "http";
import {ServerOptions, WebSocket, WebSocketServer} from "ws";
import {compareVersions} from "../util/compareVersion.js";
import {log, LogLevel} from "../util/logger.js";
import {Client, ClientOptions} from "./Client.js";

export enum WebSocketCloseCodes {
    Reconnect = 4000,
    Outdated = 4001,
    NotNeeded = 4002,
}

export class GatewayWebSocketServer {
    private readonly server: WebSocketServer;
    public readonly clientCount: number;
    public readonly shardCount: number;
    public readonly clients: Client[] = [];
    public readonly clientShardMap: Map<number, number[]> = new Map();
    public unassignedWebSockets: {ws: WebSocket, v: string, address: string}[] = [];

    public constructor(options: ServerOptions, clientCount: number, shardCount: number) {
        this.server = new WebSocketServer(options);
        this.clientCount = clientCount;
        this.shardCount = shardCount;
        this.clientShardMap = GatewayWebSocketServer.GenerateClientShardMap(clientCount, shardCount);

        this.server.on('connection', this.onConnection.bind(this));
    }

    public addClient(clientOptions: Omit<ClientOptions, 'shardCount' | 'wss'>) {
        this.clients[clientOptions.id] = new Client({
            ...clientOptions,
            shardCount: this.shardCount,
            wss: this
        });
    }

    public async connectClient(id: number) {
        const client = this.clients[id];

        if (!client)
            throw new Error(`Client with id ${id} not found`);

        await client.connect();
    }

    private onConnection(ws: WebSocket, req: IncomingMessage) {
        log({
            level: LogLevel.DEBUG,
            task: 'GWM',
            step: 'WS',
            message: `New websocket connection from ${req.socket.remoteAddress}`
        });

        const addr = req.socket.remoteAddress || 'unknown';

        ws.on('message', this.onMessage.bind(this, ws, addr));
        ws.on('close', this.onClose.bind(this, ws, addr));
        ws.on('error', this.onError.bind(this));
    }

    private onError(error: Error) {
        log({
            level: LogLevel.WARN,
            task: `GWM`,
            step: 'WS',
            message: `WebSocket error: ${error.message}`
        });
    }

    private onClose(_: WebSocket, addr: string) {
        const manager = this.clients.find(m => m.wsAddress === addr);

        log({
            level: manager ? LogLevel.WARN : LogLevel.DEBUG,
            task: 'GWM',
            step: 'WS',
            message: manager ? `Websocket closed for client ${manager.id}` : `Websocket closed (No attached client)`
        });

        this.unassignedWebSockets = this.unassignedWebSockets.filter(ws => ws.address !== addr);

        if (manager) {
            manager.ws = null;
            const oldVersion = manager.version;
            manager.version = null;

            if (this.unassignedWebSockets.length > 0) {
                const {ws, v} = this.unassignedWebSockets.sort((a, b) => compareVersions(a.v, b.v)).shift()!;

                log({
                    level: LogLevel.INFO,
                    task: 'GWM',
                    step: 'WS',
                    message: `Assigning unassigned websocket to client ${manager.id} (v${oldVersion} -> v${v})`
                });

                if (compareVersions(oldVersion!, v) > 0) {
                    log({
                        level: LogLevel.INFO,
                        task: 'GWM',
                        step: 'WS',
                        message: `Upgraded client ${manager.id} (v${oldVersion} -> v${v})`
                    })
                }

                manager.ws = ws;
                manager.version = v;
                manager.wsAddress = addr;

                for (const shard of manager.shards)
                    shard?.attachWebsocket(ws);
            }
        }
    }

    private onMessage(ws: WebSocket, addr: string, message: string) {
        const payload = JSON.parse(message);
        if (payload.op === 'available')
            this.handleAvailableWebsocket(ws, addr, payload);
    }

    private handleAvailableWebsocket(ws: WebSocket, addr: string, payload: {op: 'available', v: string}) {
        log({
            level: LogLevel.INFO,
            task: 'GWM',
            step: 'WS',
            message: `New remote client available (v${payload.v})`
        });

        ws.removeAllListeners('message');

        const manager = this.clients.find(m => !m.ws);
        if (manager) {
            log({
                level: LogLevel.DEBUG,
                task: 'GWM',
                step: 'WS',
                message: `Handing websocket to client ${manager.id} (v${payload.v})`
            });

            manager.ws = ws
            manager.version = payload.v;
            manager.wsAddress = addr;

            for (const shard of manager.shards)
                shard?.attachWebsocket(ws);

            return;
        }

        if (this.clients.length < this.clientCount) {
            log({
                level: LogLevel.DEBUG,
                task: 'GWM',
                step: 'WS',
                message: `Not all clients initialized yet, storing websocket (v${payload.v})`
            });

            this.unassignedWebSockets.push({ws, v: payload.v, address: addr});
            return;
        }

        const oldestClient = Math.max(...this.clients.map(c => compareVersions(c.version!, payload.v)));

        if (oldestClient > 0) {
            const manager = this.clients.find(m => compareVersions(m.version!, payload.v) === oldestClient)!;

            log({
                level: LogLevel.DEBUG,
                task: 'GWM',
                step: 'WS',
                message: `Found outdated client, handing websocket to it (v${manager.version} -> v${payload.v})`
            });

            log({
                level: LogLevel.INFO,
                task: 'GWM',
                step: 'WS',
                message: `Upgraded client ${manager.id} (v${manager.version} -> v${payload.v})`
            });

            manager.ws!.close(WebSocketCloseCodes.Reconnect);

            manager.ws = ws;
            manager.version = payload.v;
            manager.wsAddress = addr;

            for (const shard of manager.shards)
                shard?.attachWebsocket(ws);

            return;
        }

        if (this.unassignedWebSockets.length < this.clientCount) {
            log({
                level: LogLevel.DEBUG,
                task: 'GWM',
                step: 'WS',
                message: `Less than ${this.clientCount} unassigned websockets, storing websocket (v${payload.v})`
            });

            this.unassignedWebSockets.push({ws, v: payload.v, address: addr});
            return;
        }

        const oldestUnassigned = Math.max(...this.unassignedWebSockets.map(c => compareVersions(c.v, payload.v)));

        if (oldestUnassigned > 0) {
            const { ws: oldWs, v } = this.unassignedWebSockets.find(c => compareVersions(c.v, payload.v) === oldestUnassigned)!;

            log({
                level: LogLevel.DEBUG,
                task: 'GWM',
                step: 'WS',
                message: `Found older unassigned websocket, replacing it (v${v} -> v${payload.v})`
            });


            oldWs.close(WebSocketCloseCodes.Reconnect);

            return;
        }

        if (oldestClient < 0) {
            log({
                level: LogLevel.DEBUG,
                task: 'GWM',
                step: 'WS',
                message: `Websocket is outdated and not needed, closing it (v${payload.v})`
            });

            ws.close(WebSocketCloseCodes.Outdated);
            return
        }

        log({
            level: LogLevel.DEBUG,
            task: 'GWM',
            step: 'WS',
            message: `Already have enough unassigned websockets, closing this one (v${payload.v})`
        });

        ws.close(WebSocketCloseCodes.NotNeeded);
    }

    public static GenerateClientShardMap(clientCount: number, shardCount: number): Map<number, number[]> {
        const map = new Map<number, number[]>();
        for (let i = 0; i < clientCount; i++) {
            const shardIds = [];
            for (let j = 0; j < shardCount; j++)
                if (j % clientCount === i)
                    shardIds.push(j);
            map.set(i, shardIds);
        }
        return map;
    }
}
