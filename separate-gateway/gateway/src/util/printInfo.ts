import {REST} from "@discordjs/rest";
import {APIGatewayBotInfo, APIUser, RESTGetAPIOAuth2CurrentApplicationResult} from "discord-api-types/v10.js";

export async function printInfo(clientShardMap: Map<number, number[]>, rest: REST, botCount: number, shardCount: number) {
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

    const [gatewayInfo, clientUser, clientApplication] = await Promise.all([
        rest.get('/gateway/bot') as Promise<APIGatewayBotInfo>,
        rest.get('/users/@me') as Promise<APIUser>,
        rest.get('/oauth2/applications/@me') as Promise<RESTGetAPIOAuth2CurrentApplicationResult>,
    ]);

    console.log("\n========================= Gateway info: =========================");
    console.log(`${`URL:`.padEnd(longest)} ${gatewayInfo.url}`);
    console.log(`${`Recommended shards:`.padEnd(longest)} ${gatewayInfo.shards}`);
    console.log("\n========================= Session info: =========================");
    console.log(`${`Total sessions:`.padEnd(longest)} ${gatewayInfo.session_start_limit.total}`);
    console.log(`${`Remaining sessions:`.padEnd(longest)} ${gatewayInfo.session_start_limit.remaining}`);
    console.log(`${`Reset after:`.padEnd(longest)} ${gatewayInfo.session_start_limit.reset_after}ms`);
    console.log(`${`Max concurrency:`.padEnd(longest)} ${gatewayInfo.session_start_limit.max_concurrency}`);
    console.log("\n========================= Client info: ==========================");
    console.log(`${`Shard count:`.padEnd(longest)} ${shardCount}`);
    console.log(`${`Bot id:`.padEnd(longest)} ${clientUser.id}`);
    console.log(`${`Bot tag:`.padEnd(longest)} ${clientUser.username}#${clientUser.discriminator}`);
    console.log(`${`Is bot public:`.padEnd(longest)} ${clientApplication.bot_public ? "Yes" : "No"}\n`);
}