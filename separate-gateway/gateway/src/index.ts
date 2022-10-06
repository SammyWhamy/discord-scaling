import {REST} from '@discordjs/rest';
import {WebSocketManager, WebSocketShardEvents} from '@discordjs/ws';
import {APIGatewayBotInfo, GatewayIntentBits, RESTGetAPIOAuth2CurrentApplicationResult} from 'discord-api-types/v10';
import {APIUser} from "discord-api-types/v10.js";
import {IncomingMessage} from "http";
import {WebSocket, WebSocketServer} from "ws";
import {Shard} from "./shard/Shard.js";

const botCount = parseInt(process.env.BOT_REPLICAS!);
const shardCount = parseInt(process.env.SHARD_COUNT!);
const intents = GatewayIntentBits.Guilds
                | GatewayIntentBits.GuildMessages
                | GatewayIntentBits.GuildMessageReactions
                | GatewayIntentBits.GuildMembers
                | GatewayIntentBits.MessageContent
                | GatewayIntentBits.DirectMessages
const token = process.env.DISCORD_TOKEN;

if (!token) {
    console.error("No token provided");
    process.exit(1);
}

const clients: Client[] = [];
const unassignedWebSockets: {ws: WebSocket, v: string}[] = [];

const wss = new WebSocketServer({ port: 80 });

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    console.log(`[GWM] => New websocket connection from ${req.socket.remoteAddress}`);
    ws.on('message', websocketMessage.bind(null, ws));
});

function websocketMessage(ws: WebSocket, message: string) {
    const payload = JSON.parse(message);
    if (payload.op === 'available')
        handleAvailable(ws, payload);
}

function handleAvailable(ws: WebSocket, payload: {v: string}) {
    console.log(`[GWM] => New client available`);

    const manager = clients.find(m => !m.ws);
    if (manager) {
        console.log(`[GWM] => Handing client to manager ${manager.id} (Shards [${manager.shardIds.join(', ')}])`);
        manager.ws = ws
        manager.version = payload.v;

        for (const shard of manager.shards) {
            if (shard)
                shard.setWebsocket(ws);
        }

        return;
    }

    if (clients.length < botCount) {
        console.log(`[GWM] => Not all managers initialized yet, storing websocket`);
        unassignedWebSockets.push({ws, v: payload.v});
        return;
    }

    // Check if there's any outdated Clients, if so, assign the websocket to them.
    const oldestClient = Math.max(...clients.map(c => compareVersions(c.version!, payload.v)));

    if (oldestClient > 0) {
        console.log(`[GWM] => Found outdated client, handing websocket to it`);
        const manager = clients.find(m => compareVersions(m.version!, payload.v) === oldestClient);
        manager!.ws = ws;
        manager!.version = payload.v;

        for (const shard of manager!.shards)
            shard.setWebsocket(ws);

        return;
    }

    if (oldestClient < 0) {
        console.log(`[GWM] => Found outdated websocket, closing it`);
        ws.close();
        return
    }

    console.log(`[GWM] => No outdated clients found, closing websocket`);
    unassignedWebSockets.push({ws, v: payload.v});
}

export type Client = {
    id: number,
    shardIds: number[],
    shards: Shard[],
    wsManager: WebSocketManager,
    ws: WebSocket | null,
    version?: string,
}

const clientShardMap: Map<number, number[]> = new Map();
const rest = new REST().setToken(token);

for (let i = 0; i < botCount; i++) {
    const shardIds = [];
    for (let j = 0; j < shardCount; j++)
        if (j % botCount === i)
            shardIds.push(j);

    clientShardMap.set(i, shardIds);

    console.log(`[GWM] => Client ${i} is managing shards ${shardIds.join(", ")}`);

    let ws: {ws: WebSocket, v: string} | null = null;
    if (unassignedWebSockets.length > 0) {
        console.log(`[GWM] => Assigning unassigned websocket to client ${i}`);
        ws = unassignedWebSockets.shift() || null;
    }

    clients[i] = {
        id: i,
        shardIds,
        shards: [],
        wsManager: new WebSocketManager({token, intents, rest, shardIds, shardCount}),
        ws: ws?.ws || null,
    }

    clients[i].wsManager.on(WebSocketShardEvents.Ready, (payload) => {
        console.log(`[WS] => Shard ${payload.shardId} initialized`);

        clients[i].shards[payload.shardId] = new Shard({
            id: payload.shardId,
            shardCount: shardCount,
            endpoint: `ws://${process.env.COMPOSE_PROJECT_NAME}-bot-${i + 1}:80/`,
        });

        if (ws) {
            clients[i].shards[payload.shardId].setWebsocket(ws.ws);
            clients[i].version = ws.v;
        }
    });

    clients[i].wsManager.on(WebSocketShardEvents.Hello, (payload) => {
        console.log(`[WS] => Shard ${payload.shardId} received hello`);
    });

    clients[i].wsManager.on(WebSocketShardEvents.Resumed, (payload) => {
        console.log(`[WS] => Shard ${payload.shardId} resumed`);
    });

    clients[i].wsManager.on(WebSocketShardEvents.Dispatch, async (payload) => {
        clients[i].shards[payload.shardId].dispatch(payload.data);
    });

    await clients[i].wsManager.connect();

    await new Promise(resolve => setTimeout(resolve, 5000));
}

console.log("\n========================= Shard client map: =====================");
const shardTexts: Map<number, string> = new Map();
for (const [managerId, shardIds] of clientShardMap.entries()) {
    shardTexts.set(managerId, `Shards [${shardIds.map(s => s.toString()).join(", ")}]`);
}
const longest = Math.max(20, ...Array.from(shardTexts.values()).map(s => s.length));
for (const [managerId, shardText] of shardTexts.entries()) {
    const managerText = botCount > 9 ? `Client ${managerId.toString().padStart(2, "0")}` : `Client ${managerId}`;
    console.log(`${shardText.padEnd(longest)} => ${managerText} ⇔  ws://${process.env.COMPOSE_PROJECT_NAME}-bot-${managerId+1}:80/`);
}

const gatewayInfo = await rest.get('/gateway/bot') as APIGatewayBotInfo;
console.log("\n========================= Gateway info: =========================");
console.log(`${`URL:`.padEnd(longest)} ${gatewayInfo.url}`);
console.log(`${`Recommended shards:`.padEnd(longest)} ${gatewayInfo.shards}`);
console.log("\n========================= Session info: =========================");
console.log(`${`Total sessions:`.padEnd(longest)} ${gatewayInfo.session_start_limit.total}`);
console.log(`${`Remaining sessions:`.padEnd(longest)} ${gatewayInfo.session_start_limit.remaining}`);
console.log(`${`Reset after:`.padEnd(longest)} ${gatewayInfo.session_start_limit.reset_after}ms`);
console.log(`${`Max concurrency:`.padEnd(longest)} ${gatewayInfo.session_start_limit.max_concurrency}`);
const clientUser = await rest.get('/users/@me') as APIUser;
console.log("\n========================= Client info: ==========================");
console.log(`${`Shard count:`.padEnd(longest)} ${shardCount}`);
console.log(`${`Bot id:`.padEnd(longest)} ${clientUser.id}`);
console.log(`${`Bot tag:`.padEnd(longest)} ${clientUser.username}#${clientUser.discriminator}`);
const clientApplication = await rest.get('/oauth2/applications/@me') as RESTGetAPIOAuth2CurrentApplicationResult;
console.log(`${`Is bot public:`.padEnd(longest)} ${clientApplication.bot_public ? "Yes" : "No"}\n`);

function compareVersions(version1: string, version2: string) {
    const version1Parts = version1.split(".");
    const version2Parts = version2.split(".");

    for (let i = 0; i < 3; i++) {
        const part1 = parseInt(version1Parts[i]);
        const part2 = parseInt(version2Parts[i]);

        if (part1 > part2)
            return (part2 - part1) * Math.pow(10, 2 - i);
        else if (part1 < part2)
            return (part2 - part1) * Math.pow(10, 2 - i);
    }

    return 0;
}
