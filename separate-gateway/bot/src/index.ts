import {eventLoader} from "./events/loader.js";
import {GatewayWebSocket} from "./gateway/GatewayWebSocket.js";

const ws = new GatewayWebSocket('ws://gateway:80');

ws.on('newClient', (client, shardId) => {
    eventLoader(client, shardId);
});

await ws.connect();
