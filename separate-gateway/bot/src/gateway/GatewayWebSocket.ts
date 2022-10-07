import {GatewayDispatchEvents, GatewayDispatchPayload} from "discord-api-types/v10";
import {Client, Status, WebSocketShard} from "discord.js";
import {EventEmitter} from "events";
import {WebSocket} from "ws";
import {log, LogLevel} from "../util/logger.js";

export type DiscordClient = Client & {
    expectedGuilds: Set<string>;
    readyTimeout: NodeJS.Timeout | null;
    readyTimeoutTime: number;
}

export declare interface GatewayWebSocket {
    on(event: 'newClient', listener: (client: DiscordClient, shardId: number) => void): this;
}

export class GatewayWebSocket extends EventEmitter {
    private readonly ws: WebSocket;
    public readonly clients: DiscordClient[] = [];
    public readonly maxRetries = 10;
    private retries = 0;

    public constructor(url: string) {
        super();

        this.ws = new WebSocket(url);

        this.loadEvents();
    }

    public async connect() {
        while (this.ws.readyState !== WebSocket.OPEN) {
            if (this.retries === this.maxRetries) {
                log({
                    level: LogLevel.FATAL,
                    task: 'CM',
                    step: 'WS',
                    message: `Failed to connect to gateway manager, exiting...`
                });
                process.exit(1);
            }

            log({
                level: LogLevel.INFO,
                task: 'CM',
                step: 'WS',
                message: `Waiting for websocket connection... (WebSocket state: ${this.ws.readyState})`
            });

            await new Promise(resolve => setTimeout(resolve, 1000));
            this.retries++;
        }

        log({
            level: LogLevel.INFO,
            task: 'CM',
            step: 'WS',
            message: `Letting the gateway manager know we're available (v${process.env.npm_package_version})`
        });

        this.ws.send(JSON.stringify({op: 'available', v: process.env.npm_package_version}));
    }

    private loadEvents() {
        this.ws.on("open", this.onOpen.bind(this));
        this.ws.on("close", this.onClose.bind(this));
        this.ws.on("error", this.onError.bind(this));
        this.ws.on("message", this.onMessage.bind(this));
    }

    private onOpen() {
        log({
            level: LogLevel.INFO,
            task: 'CM',
            step: 'WS',
            message: 'Connected to gateway manager'
        });
    }

    private onClose() {
        log({
            level: LogLevel.FATAL,
            task: 'CM',
            step: 'WS',
            message: 'Disconnected from gateway manager'
        });
    }

    private onError(error: Error) {
        log({
            level: LogLevel.ERROR,
            task: 'CM',
            step: 'WS',
            message: `Gateway manager websocket error: ${error}`
        });
    }

    private onMessage(message: string) {
        const payload = JSON.parse(message);

        switch (payload.op) {
            case 'identify':
                this.handleIdentify(payload);
                break;
            case 'dispatch':
                this.handleDispatch(payload);
                break;
        }
    }

    private handleIdentify(payload: { op: 'identify', shardId: number, d: { expectedGuilds: string[] } }) {
        log({
            level: LogLevel.INFO,
            task: 'CM',
            step: 'WS',
            message: `Received identify for shard ${payload.shardId} (Expecting ${payload.d.expectedGuilds.length} guilds)`
        });

        const client = new Client({intents: 0}) as DiscordClient;
        client.token = process.env.DISCORD_TOKEN!;
        client.rest.setToken(process.env.DISCORD_TOKEN!);
        client.expectedGuilds = new Set(payload.d.expectedGuilds);
        client.readyTimeout = null;
        client.readyTimeoutTime = 15000;
        client.ws.status = Status.WaitingForGuilds;

        this.clients[payload.shardId] = client;

        this.emit("newClient", client, payload.shardId);

        this.checkReady(payload.shardId, client);

        log({
            level: LogLevel.DEBUG,
            task: `S${payload.shardId}`,
            step: 'WS',
            message: `Sending ready to gateway manager`
        });

        this.ws.send(JSON.stringify({op: 'ready', shardId: payload.shardId}));
    }

    private handleDispatch(payload: {op: 'dispatch', shardId: number, d: GatewayDispatchPayload}) {
        log({level: LogLevel.DEBUG, task: 'CM', step: 'Event', message: `Received dispatch: ${payload.d.t}`});

        const client = this.clients[payload.shardId];

        client.ws["handlePacket"](payload.d, this.createFakeWebSocketShard(payload.shardId, client.ws.status));

        if (client.ws.status === Status.WaitingForGuilds && payload.d.t === GatewayDispatchEvents.GuildCreate) {
            client.expectedGuilds.delete(payload.d.d.id);
            log({level: LogLevel.DEBUG, task: `S${payload.shardId}`, step: 'State', message: `Received guild ${payload.d.d.id}, ${client.expectedGuilds.size} more guilds expected`});
            this.checkReady(payload.shardId, client);
        }
    }

    private checkReady(shardId: number, client: DiscordClient) {
        if (client.readyTimeout) {
            clearTimeout(client.readyTimeout);
            client.readyTimeout = null;
        }

        if (client.expectedGuilds.size === 0) {
            log({level: LogLevel.DEBUG, task: `S${shardId}`, step: 'State', message: `Shard ${shardId} is ready`});
            client.readyTimeout = null;
            client.ws["triggerClientReady"]();
            return;
        }

        client.readyTimeout = setTimeout(() => {
            log({level: LogLevel.WARN, task: `S${shardId}`, step: 'State', message: `Not receiving any more guilds, unavailable guild count: ${client.expectedGuilds.size}`});
            client.readyTimeout = null;
            client.ws["triggerClientReady"]();
        }, client.readyTimeoutTime).unref();
    }

    private createFakeWebSocketShard(id: number, status: Status): WebSocketShard {
        return {
            id: id,
            sequence: 0,
            closeSequence: 0,
            checkReady: () => true,
            status: status,
        } as unknown as WebSocketShard;
    }
}
