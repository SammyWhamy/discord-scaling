import {GatewayDispatchEvents, GatewayDispatchPayload} from "discord-api-types/v10";
import {WebSocket} from "ws";

export type ShardOptions = {
    id: number;
    shardCount: number;
    endpoint: string;
}

export class Shard {
    public id: number;
    public shardCount: number;
    public status: "connected" | "reconnecting" | "disconnected" = "disconnected";
    public webSocket: WebSocket | null = null;
    private dispatchQueue: GatewayDispatchPayload[] = [];
    private guildCreateState: GatewayDispatchPayload[] = [];
    private clientReady = false;

    public constructor(options: ShardOptions) {
        this.id = options.id;
        this.shardCount = options.shardCount;
    }

    public setWebsocket(ws: WebSocket) {
        this.webSocket = ws;
        this.webSocket.removeAllListeners();
        this.webSocket.on("close", this.websocketClose.bind(this));
        this.webSocket.on("message", this.websocketMessage.bind(this));
        this.webSocket.on("error", this.websocketError.bind(this));

        if (this.status === "reconnecting") console.log(`[S${this.id}] => Reconnected`);
        else console.log(`[S${this.id}] => Connected`);

        this.status = "connected";

        this.webSocket.send(JSON.stringify({
            op: 'identify',
            shardId: this.id,
        }));
    }

    public async websocketClose() {
        console.log(`[S${this.id}] => Disconnected`);
        this.status = "disconnected";
        this.clientReady = false;
    }

    public websocketError(error: Error) {
        console.error(`[S${this.id}] => WebSocket error: ${error.message}`);
    }

    public websocketMessage(data: string) {
        const payload = JSON.parse(data);
        console.log(`[S${this.id}] => Received message: ${payload.op}`);

        if (payload.op === 'ready') {
            console.log(`[S${this.id}] => Ready!`);
            this.clientReady = true;
            this.dispatchQueue = [...this.guildCreateState, ...this.dispatchQueue];
            this.processDispatchQueue();
        }
    }

    public dispatch(payload: GatewayDispatchPayload) {
        if (payload.t === GatewayDispatchEvents.GuildCreate) {
            this.guildCreateState.push(payload);

            if (this.clientReady)
                this.dispatchQueue.unshift(payload);
        } else {
            this.dispatchQueue.push(payload);
        }

        this.processDispatchQueue();
    }

    public processDispatchQueue() {
        if (this.dispatchQueue.length === 0) return;

        if (this.status !== "connected")
        {
            console.log(`[S${this.id}] => Not connected, deferring dispatch`);
            return;
        }

        if (!this.clientReady) {
            console.log(`[S${this.id}] => Not ready, deferring dispatch`);
            return;
        }

        const payload = this.dispatchQueue.shift()!;

        console.log(`[S${this.id}] => Dispatching payload: ${payload.t}`);
        this.webSocket!.send(JSON.stringify({
            op: 'dispatch',
            shardId: this.id,
            d: payload,
        }));

        if (this.dispatchQueue.length > 0)
            this.processDispatchQueue();
    }
}
