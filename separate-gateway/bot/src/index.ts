import {GatewayDispatchPayload} from "discord-api-types/v10";
import {WebSocket} from 'ws';
import {Client} from 'discord.js';

const clients: Client[] = [];

const ws = new WebSocket('ws://gateway:80');

ws.on('open', () => console.log('Connected to gateway manager'));
ws.on('close', () => console.log('Disconnected from gateway manager'));
ws.on('error', (error) => console.log(`Gateway manager websocket error: ${error}`));
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

function handleDispatch(payload: {op: 'dispatch', shardId: number, d: GatewayDispatchPayload}) {
    console.log(`Received dispatch: ${JSON.stringify(payload.d)}`);
    // @ts-ignore, this is a private property.
    // This simulates the client receiving a dispatch from the gateway.
    clients[payload.shardId].ws.handlePacket(payload.d, {id: payload.shardId});
}

function handleIdentify(ws: WebSocket, payload: { op: 'identify', shardId: number }) {
    clients[payload.shardId] = new Client({intents: 0});
    clients[payload.shardId].token = process.env.DISCORD_TOKEN!;
    clients[payload.shardId].rest.setToken(process.env.DISCORD_TOKEN!);

    loadEvents(clients[payload.shardId], payload.shardId);

    // @ts-ignore, this is a private property.
    // This simulates the client receiving a READY event from the gateway.
    // The gateway manager only sends us the IDENTIFY after the READY event, so this is fine.
    clients[payload.shardId].ws.triggerClientReady();

    console.log(`Sending ready to gateway manager`);
    ws.send(JSON.stringify({op: 'ready'}));
}

function loadEvents(client: Client, shardId: number) {
    client.on('messageCreate', async message => {
        if(message.author.bot) return;

        console.log(`Received message: ${message.content}`);

        await message.reply({content: "fuck u"});
    });

    client.on('ready', () => {
        console.log(`Shard ${shardId} is ready`);
    });
}

const maxRetries = 10;
let retries = 0;

while (ws.readyState !== WebSocket.OPEN) {
    if (retries === maxRetries) {
        console.log(`Failed to connect to gateway manager`);
        process.exit(1);
    }
    console.log(`Waiting for websocket connection... (WebSocket state: ${ws.readyState})`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries++;
}

ws.send(JSON.stringify({op: 'available'}));
