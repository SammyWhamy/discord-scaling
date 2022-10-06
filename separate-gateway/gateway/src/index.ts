import {REST} from '@discordjs/rest';
import {WebSocketManager, WebSocketShardEvents} from '@discordjs/ws';
import {GatewayIntentBits} from 'discord-api-types/v10';
import {Shard} from "./shard/Shard.js";

const botCount = parseInt(process.env.BOT_REPLICAS!);
const shardCount = 6;
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

const managers: WebSocketManager[] = [];
const shards: Shard[] = [];

const rest = new REST().setToken(token);
for (let i = 0; i < botCount; i++) {
    const shardIds = [];
    for (let j = 0; j < shardCount; j++)
        if (j % botCount === i)
            shardIds.push(j);

    console.log(`Manager ${i} managing shards ${shardIds.join(", ")}`);

    managers[i] = new WebSocketManager({token, intents, rest, shardIds, shardCount});

    managers[i].on(WebSocketShardEvents.Ready, (payload) => {
        console.log(`Shard ${payload.shardId} connected`);

        const shard = new Shard({
            id: payload.shardId,
            shardCount: shardCount,
            endpoint: `ws://${process.env.COMPOSE_PROJECT_NAME}-bot-${i+1}:80/`,
        });

        shards[payload.shardId] = shard;

        shard.connect();
    });

    managers[i].on(WebSocketShardEvents.Hello, (payload) => {
        console.log(`Shard ${payload.shardId} received hello`);
    });

    managers[i].on(WebSocketShardEvents.Resumed, (payload) => {
        console.log(`Shard ${payload.shardId} resumed`);
    });

    managers[i].on(WebSocketShardEvents.Dispatch, async (payload) => {
        console.log(`Shard ${payload.shardId} dispatch received: ${payload.data.t}`);
        shards[payload.shardId].dispatch(payload.data);
    });

    await managers[i].connect();

    await new Promise(resolve => setTimeout(resolve, 5000));
}
