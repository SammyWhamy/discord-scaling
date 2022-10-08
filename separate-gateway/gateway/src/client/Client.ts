import {REST} from "@discordjs/rest";
import {WebSocketManager, WebSocketShardEvents} from "@discordjs/ws";
import {GatewayDispatchPayload, GatewayReadyDispatchData} from "discord-api-types/v10";
import {WebSocket} from "ws";
import {GatewayWebSocketServer} from "./GatewayWebSocketServer.js";
import {Shard} from "./Shard.js";
import {log, LogLevel} from "../util/logger.js";

export type ClientOptions = {
    id: number,
    clientCount: number,
    shardCount: number,
    token: string,
    intents: number,
    rest: REST,
    wss: GatewayWebSocketServer,
}

export class Client {
    public readonly id: number;
    public readonly clientCount: number;
    public readonly shardIds: number[];
    public readonly shardCount: number;
    public readonly shards: Shard[] = [];
    public readonly wsManager: WebSocketManager;
    private readonly wss: GatewayWebSocketServer
    private readonly token: string;
    private readonly intents: number;
    private readonly rest: REST;
    public ws: WebSocket | null = null;
    public version: string | null = null;
    public wsAddress: string | null = null;

    public constructor(options: ClientOptions) {
        this.id = options.id;
        this.clientCount = options.clientCount;
        this.shardCount = options.shardCount;
        this.token = options.token;
        this.intents = options.intents;
        this.rest = options.rest;
        this.wss = options.wss;

        this.shardIds = this.calculateShardIds();

        this.wsManager = new WebSocketManager({
            token: this.token,
            intents: this.intents,
            rest: this.rest,
            shardIds: this.shardIds,
            shardCount: this.shardCount,
        });

        log({
            level: LogLevel.INFO,
            task: 'GWM',
            step: 'Init',
            message: `Client ${this.id} is managing shards ${this.shardIds.join(", ")}`
        });

        this.tryGetWebSocket();
        this.loadEvents();
    }

    public async connect() {
        await this.wsManager.connect();
    }

    private tryGetWebSocket() {
        let ws: {ws: WebSocket, v: string} | null = null;
        if (this.wss.unassignedWebSockets.length > 0) {
            log({
                level: LogLevel.DEBUG,
                task: 'GWM',
                step: 'Init',
                message: `Assigning unassigned websocket to client ${this.id}`
            });
            ws = this.wss.unassignedWebSockets.shift() || null;
        }

        if (ws) {
            this.ws = ws.ws;
            this.version = ws.v;
        }
    }

    private loadEvents() {
        this.wsManager.on(WebSocketShardEvents.Ready, this.onReady.bind(this));
        this.wsManager.on(WebSocketShardEvents.Hello, this.onHello.bind(this));
        this.wsManager.on(WebSocketShardEvents.Resumed, this.onResumed.bind(this));
        this.wsManager.on(WebSocketShardEvents.Dispatch, this.onDispatch.bind(this));
    }

    private onReady(payload: { data: GatewayReadyDispatchData, shardId: number}) {
        log({
            level: LogLevel.INFO,
            task: 'GWM',
            step: 'Event',
            message: `Shard ${payload.shardId} initialized`
        });

        this.shards[payload.shardId] = new Shard({
            id: payload.shardId,
            shardCount: this.shardCount,
            expectedGuilds: new Set(payload.data.guilds.map(g => g.id)),
        });

        if (this.ws)
            this.shards[payload.shardId].attachWebsocket(this.ws);
    }

    private onHello(payload: { shardId: number }) {
        log({
            level: LogLevel.DEBUG,
            task: 'GWM',
            step: 'Event',
            message: `Shard ${payload.shardId} received hello`
        });
    }

    private onResumed(payload: { shardId: number }) {
        log({
            level: LogLevel.DEBUG,
            task: 'GWM',
            step: 'Event',
            message: `Shard ${payload.shardId} resumed`
        });
    }

    private onDispatch(payload: { data: GatewayDispatchPayload, shardId: number }) {
        log({
            level: LogLevel.DEBUG,
            task: 'GWM',
            step: 'Event',
            message: `Dispatching event ${payload.data.t} to shard ${payload.shardId}`
        });

        this.shards[payload.shardId].dispatch(payload.data);
    }

    private calculateShardIds() {
        const shardIds = [];
        for (let j = 0; j < this.shardCount; j++)
            if (j % this.clientCount === this.id)
                shardIds.push(j);

        return shardIds;
    }
}
