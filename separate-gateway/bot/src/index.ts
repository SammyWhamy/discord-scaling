import {GatewayDispatchPayload} from "discord-api-types/v10";
import {WebSocket, WebSocketServer} from 'ws';
import {Client} from 'discord.js';

const clients: Client[] = [];

const wss = new WebSocketServer({ port: 80 });

wss.on('connection', function connection(ws) {
    console.log('Connected to gateway manager');
    ws.on('message', websocketMessage.bind(null, ws));
});

wss.on('close', () => console.log('Disconnected from gateway manager'));
wss.on('error', (error) => console.log(`Gateway manager websocket error: ${error}`));

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

        await message.reply({content: "fuck u (2)"});
    });

    client.on('ready', () => {
        console.log(`Shard ${shardId} is ready`);
    });
}
