import {GatewayDispatchEvents, GatewayDispatchPayload, GatewayGuildCreateDispatch} from "discord-api-types/v10";
import {WebSocket} from "ws";
import {log, LogLevel} from "../util/logger.js";

export type ShardOptions = {
    id: number;
    shardCount: number;
    expectedGuilds: Set<string>;
}

export class Shard {
    public id: number;
    public shardCount: number;
    public status: "connected" | "reconnecting" | "disconnected" = "disconnected";
    public webSocket: WebSocket | null = null;
    private dispatchQueue: GatewayDispatchPayload[] = [];
    private guildCreateState: GatewayGuildCreateDispatch[] = [];
    private clientReadyState: "notReady" | "readyForGuilds" | "ready"  = "notReady";
    private readonly expectedGuilds: Set<string>;
    private expectedGuildsSent = 0;

    public constructor(options: ShardOptions) {
        this.id = options.id;
        this.shardCount = options.shardCount;
        this.expectedGuilds = options.expectedGuilds;

        log({
            level: LogLevel.DEBUG,
            task: `S${this.id}`,
            step: 'Init',
            message: `Expecting ${this.expectedGuilds.size} guilds`
        });
    }

    public attachWebsocket(ws: WebSocket) {
        log({
            level: LogLevel.DEBUG,
            task: `S${this.id}`,
            step: 'WS',
            message: `Attached to websocket`
        });

        this.webSocket = ws;

        this.webSocket.on("message", this.websocketMessage.bind(this));

        if (this.status === "reconnecting") {
            log({
                level: LogLevel.DEBUG,
                task: `S${this.id}`,
                step: 'WS', message: `Reconnected`
            });
        }
        else {
            log({
                level: LogLevel.DEBUG,
                task: `S${this.id}`,
                step: 'WS', message: `Connected`
            });
        }

        this.status = "connected";
        this.clientReadyState = "notReady";
        this.expectedGuildsSent = 0;

        log({
            level: LogLevel.DEBUG,
            task: `S${this.id}`,
            step: 'WS',
            message: `Sending identify payload to client`
        });

        this.webSocket.send(JSON.stringify({
            op: 'identify',
            shardId: this.id,
            d: {
                expectedGuilds: Array.from(this.expectedGuilds),
            }
        }));
    }

    public websocketMessage(data: string) {
        const payload = JSON.parse(data);
        if (payload.shardId !== this.id) return;

        log({level: LogLevel.DEBUG, task: `S${this.id}`, step: 'WS', message: `Received message: ${payload.op}`});

        if (payload.op === 'readyForGuilds') {
            log({level: LogLevel.DEBUG, task: `S${this.id}`, step: 'Client', message: `Ready for guilds`});

            this.clientReadyState = "readyForGuilds";
            this.dispatchQueue = [...this.guildCreateState, ...this.dispatchQueue];
            this.processDispatchQueue();

            return;
        }

        if (payload.op === 'ready') {
            log({level: LogLevel.INFO, task: `S${this.id}`, step: 'Client', message: `Ready!`});

            this.clientReadyState = "ready";
            this.processDispatchQueue();

            return;
        }
    }

    public dispatch(payload: GatewayDispatchPayload) {
        if (payload.t === GatewayDispatchEvents.GuildCreate) {
            this.addToGuildState(payload);
            if (this.clientReadyState === "notReady") {
                log({level: LogLevel.DEBUG, task: `S${this.id}`, step: 'Event', message: `Not ready, deferring dispatch`});
                return;
            }
        }

        this.dispatchQueue.push(payload);
        this.processDispatchQueue();
    }

    public addToGuildState(payload: GatewayGuildCreateDispatch) {
        if (this.guildCreateState.some(x => x.d.id === payload.d.id)) {
            this.guildCreateState = this.guildCreateState.filter(x => x.d.id !== payload.d.id);
        }

        this.expectedGuilds.add(payload.d.id);
        this.guildCreateState.push(payload);

        log({level: LogLevel.DEBUG, task: `S${this.id}`, step: 'State', message: `Added guild ${payload.d.id} to state, ${this.guildCreateState.length} guilds in state`});
    }

    public processDispatchQueue() {
        if (this.dispatchQueue.length === 0) return;

        if (this.status !== "connected")
        {
            log({level: LogLevel.DEBUG, task: `S${this.id}`, step: 'Event', message: `Not connected, deferring dispatch`});
            return;
        }

        if (this.clientReadyState === "notReady") {
            log({level: LogLevel.DEBUG, task: `S${this.id}`, step: 'Event', message: `Not ready, deferring dispatch`});
            return;
        }

        if (this.clientReadyState === "readyForGuilds" && this.dispatchQueue[0].t !== GatewayDispatchEvents.GuildCreate) {
            log({level: LogLevel.DEBUG, task: `S${this.id}`, step: 'Event', message: `Only ready for guilds, deferring dispatch`});
            return;
        }

        const payload = this.dispatchQueue.shift()!;

        log({level: LogLevel.DEBUG, task: `S${this.id}`, step: 'Event', message: `Dispatching payload: ${payload.t}`});
        this.webSocket!.send(JSON.stringify({
            op: 'dispatch',
            shardId: this.id,
            d: payload,
        }));

        if (payload.t === GatewayDispatchEvents.GuildCreate) {
            this.expectedGuildsSent++;
            log({level: LogLevel.DEBUG, task: `S${this.id}`, step: 'State', message: `Sent guild ${payload.d.id}, ${this.expectedGuilds.size - this.expectedGuildsSent} remaining`});
        }

        if (this.dispatchQueue.length > 0)
            this.processDispatchQueue();
    }
}
