import {REST} from '@discordjs/rest';
import {GatewayIntentBits} from 'discord-api-types/v10';
import {GatewayWebSocketServer} from "./client/GatewayWebSocketServer.js";
import {log, LogLevel} from "./util/logger.js";
import {printInfo} from "./util/printInfo.js";

const intents = 0
    | GatewayIntentBits.Guilds
    | GatewayIntentBits.GuildMessages
    | GatewayIntentBits.GuildMessageReactions
    | GatewayIntentBits.GuildMembers
    | GatewayIntentBits.MessageContent
    | GatewayIntentBits.DirectMessages

const clientCount = parseInt(process.env.BOT_REPLICAS!);
const shardCount = parseInt(process.env.SHARD_COUNT!);
const token = process.env.DISCORD_TOKEN;

if (!token || !clientCount || !shardCount) {
    log({
        level: LogLevel.FATAL,
        task: 'GWM',
        step: 'Init',
        message: 'Please provide DISCORD_TOKEN, SHARD_COUNT and BOT_REPLICAS environment variables'
    });

    process.exit(1);
}

const wss = new GatewayWebSocketServer({port: 80}, clientCount);
const rest = new REST().setToken(token);

for (let id = 0; id < clientCount; id++) {
    wss.addClient({id, clientCount, shardCount, token, intents, rest, wss});
    await wss.connectClient(id);

    // TODO: Only timeout when concurrency is reached
    await new Promise(resolve => setTimeout(resolve, 5000));
}

await printInfo(wss.clientShardMap, rest, clientCount, shardCount);
