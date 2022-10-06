import {GatewayDispatchEvents, GatewayDispatchPayload} from "discord-api-types/v10";
import {WebSocket} from "ws";

const reconnectDelays = [500, 1500, 6500, 11500, 21500, 51500];

export type ShardOptions = {
    id: number;
    shardCount: number;
    endpoint: string;
}

export class Shard {
    public id: number;
    public shardCount: number;
    public status: "connected" | "reconnecting" | "disconnected" = "disconnected";
    public endpoint: string;
    private webSocket: WebSocket | null = null;
    private dispatchQueue: GatewayDispatchPayload[] = [];
    private guildCreateState: GatewayDispatchPayload[] = [];
    private clientReady = false;

    public constructor(options: ShardOptions) {
        this.id = options.id;
        this.shardCount = options.shardCount;
        this.endpoint = options.endpoint;
    }

    public connect() {
        console.log(`Connecting to ${this.endpoint}`);
        this.webSocket = new WebSocket(this.endpoint);

        this.webSocket.on("open", this.websocketOpen.bind(this));
        this.webSocket.on("close", this.websocketClose.bind(this));
        this.webSocket.on("message", this.websocketMessage.bind(this));
        this.webSocket.on("error", this.websocketError.bind(this));
    }

    public websocketOpen() {
        if (this.status === "reconnecting") console.log(`Reconnected to shard ${this.id}`);
        else console.log(`Connected to shard ${this.id}`);

        this.status = "connected";

        this.webSocket!.send(JSON.stringify({
            op: 'identify',
            shardId: this.id,
        }));
    }

    public async websocketClose() {
        if (this.status !== "connected") return;

        console.log(`Disconnected from shard ${this.id}`);
        this.status = "disconnected";
        this.clientReady = false;

        for(const delay of reconnectDelays) {
            setTimeout(() => {
                if (this.webSocket!.readyState === 3) {
                    console.log(`Reconnecting to shard ${this.id}`);
                    this.status = "reconnecting";
                    this.connect();
                }
            }, delay);
        }
    }

    public websocketMessage(data: string) {
        const payload = JSON.parse(data);
        console.log(`Received message from shard ${this.id}: ${payload.op}`);

        if (payload.op === 'ready') {
            console.log(`Shard ${this.id} is ready`);
            this.clientReady = true;
            this.dispatchQueue = [...this.guildCreateState, ...this.dispatchQueue];
            this.processDispatchQueue();
        }
    }

    public websocketError(error: Error) {
        console.error(`WebSocket error on shard ${this.id}: ${error.message}`);
    }

    public dispatch(payload: GatewayDispatchPayload) {
        if (payload.t === GatewayDispatchEvents.GuildCreate) {
            this.guildCreateState.push(payload);
        } else {
            this.dispatchQueue.push(payload);
        }

        this.processDispatchQueue();
    }

    public processDispatchQueue() {
        if (this.dispatchQueue.length === 0) return;

        if (this.status !== "connected")
        {
            console.log(`Shard ${this.id} is not connected, deferring dispatch`);
            return;
        }

        if (!this.clientReady) {
            console.log(`Shard ${this.id} is not ready, deferring dispatch`);
            return;
        }

        const payload = this.dispatchQueue.shift()!;

        console.log(`Dispatching payload to shard ${this.id}: ${payload.t}`);
        this.webSocket!.send(JSON.stringify({
            op: 'dispatch',
            shardId: this.id,
            d: payload,
        }));

        if (this.dispatchQueue.length > 0)
            this.processDispatchQueue();
    }
}
