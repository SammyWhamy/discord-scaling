import {DiscordClient} from "../gateway/GatewayWebSocket.js";
import {log, LogLevel} from "../util/logger.js";

export function eventLoader(client: DiscordClient, shardId: number) {
    client.on('messageCreate', async message => {
        if(message.author.bot) return;

        log({
            level: LogLevel.INFO,
            task: `S${shardId}C`,
            step: 'Event',
            message: `Received message: ${message.content}`
        });

        await message.reply({content: `Hello from v${process.env.npm_package_version}`});
    });

    client.on('ready', () => {
        log({
            level: LogLevel.INFO,
            task: `S${shardId}C`,
            step: 'Event',
            message: `Shard ${shardId} is ready`
        });
    });

    client.on('guildCreate', guild => {
        log({
            level: LogLevel.INFO,
            task: `S${shardId}C`,
            step: 'Event',
            message: `Joined guild: ${guild.name}`
        });
    });
}
