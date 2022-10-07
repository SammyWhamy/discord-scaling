import {GatewayDispatchEvents, GatewayDispatchPayload} from "discord-api-types/v10";
import {Client, Status, WebSocketShard} from 'discord.js';
import {WebSocket} from 'ws';

type DiscordClient = Client & {
    expectedGuilds: Set<string>;
    readyTimeout: NodeJS.Timeout | null;
    readyTimeoutTime: number;
    status: Status;
}
const clients: DiscordClient[] = [];

const ws = new WebSocket('ws://gateway:80');

ws.on('open', () => console.log('[BC] => Connected to gateway manager'));
ws.on('close', () => console.log('[BC] => Disconnected from gateway manager'));
ws.on('error', (error) => console.log(`[BC] => Gateway manager websocket error: ${error}`));
ws.on('message', websocketMessage.bind(null, ws));

async function websocketMessage(ws: WebSocket, message: string) {
    const payload = JSON.parse(message);

    switch (payload.op) {
        case 'dispatch':
            handleDispatch(payload);
            break;
        case 'identify':
            handleIdentify(ws, payload);
            break;
    }
}

function createFakeWebSocketShard(id: number, status: Status): WebSocketShard {
    return {
        id: id,
        sequence: 0,
        closeSequence: 0,
        checkReady: () => true,
        status: status,
    } as unknown as WebSocketShard;
}

function handleDispatch(payload: {op: 'dispatch', shardId: number, d: GatewayDispatchPayload}) {
    console.log(`[S${payload.shardId}] => Received dispatch: ${payload.d.t}`);
    clients[payload.shardId].ws["handlePacket"](payload.d, createFakeWebSocketShard(payload.shardId, clients[payload.shardId].status));

    if (clients[payload.shardId].status === Status.WaitingForGuilds && payload.d.t === GatewayDispatchEvents.GuildCreate) {
        clients[payload.shardId].expectedGuilds.delete(payload.d.d.id);
        checkReady(payload.shardId, clients[payload.shardId]);
    }
}

function checkReady(shardId: number, client: DiscordClient) {
    if (client.readyTimeout) {
        clearTimeout(client.readyTimeout);
        client.readyTimeout = null;
    }

    if (client.expectedGuilds.size === 0) {
        console.log(`[S${shardId}] => Received all guilds`);
        client.status = Status.Ready;
        return;
    }

    client.readyTimeout = setTimeout(() => {
        console.log(`[S${shardId}] => Not receiving any more guilds, unavailable guild count: ${client.expectedGuilds.size}`);
        client.status = Status.Ready;
        client.readyTimeout = null;
    }, client.readyTimeoutTime).unref();
}

function handleIdentify(ws: WebSocket, payload: { op: 'identify', shardId: number, d: { expectedGuilds: string[] } }) {
    clients[payload.shardId] = new Client({intents: 0}) as DiscordClient;
    clients[payload.shardId].token = process.env.DISCORD_TOKEN!;
    clients[payload.shardId].rest.setToken(process.env.DISCORD_TOKEN!);
    clients[payload.shardId].expectedGuilds = new Set(payload.d.expectedGuilds);
    clients[payload.shardId].readyTimeout = null;
    clients[payload.shardId].readyTimeoutTime = 15000;
    clients[payload.shardId].status = Status.WaitingForGuilds;

    checkReady(payload.shardId, clients[payload.shardId]);

    loadEvents(clients[payload.shardId], payload.shardId);

    clients[payload.shardId].ws["triggerClientReady"]();

    console.log(`[S${payload.shardId}] => Sending ready to gateway manager`);
    ws.send(JSON.stringify({op: 'ready', shardId: payload.shardId}));
}

function loadEvents(client: DiscordClient, shardId: number) {
    client.on('messageCreate', async message => {
        if(message.author.bot) return;

        console.log(`[S${shardId}] => Received message: ${message.content}`);

        await message.reply({content: "fuck u"});
    });

    client.on('ready', () => {
        console.log(`[S${shardId}] => Shard ${shardId} is ready`);
    });

    client.on('guildCreate', guild => {
        console.log(`[S${shardId}] => Joined guild: ${guild.name}`);
    });
}

const maxRetries = 10;
let retries = 0;

while (ws.readyState !== WebSocket.OPEN) {
    if (retries === maxRetries) {
        console.log(`[BC] => Failed to connect to gateway manager`);
        process.exit(1);
    }
    console.log(`[BC] => Waiting for websocket connection... (WebSocket state: ${ws.readyState})`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries++;
}

ws.send(JSON.stringify({op: 'available'}));
