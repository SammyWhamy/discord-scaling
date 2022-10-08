### Running a bot
- Update your compose file with the bot image you want to use
- Set the following env file:
```dotenv
# Required: Discord token for the bot
DISCORD_TOKEN="<TOKEN>"

# Required: Amount of shards to spawn
SHARD_COUNT=8

# Required: The amount of containers to split shards between
BOT_REPLICAS=2

# Required: Rotate these around for zero downtime updates, always set to the same value as BOT_REPLICAS
BOT_P_REPLICAS=2
BOT_S_REPLICAS=0

# Optional: DEBUG (0) | INFO (1) | WARNING (2) | ERROR (3) | FATAL (4). Default is INFO.
LOG_LEVEL=INFO
```
- Run `docker-compose up -d`

### Updating a bot while it's running
- Make your changes to the bot, and update the version number in the `package.json` file.
- Run `docker compose build bot` to build the bot image.
- Update the compose file to use the new image. (Rotate between updating bot_p and bot_s for zero downtime)
- Update the following values in the env file:
```dotenv
BOT_P_REPLICAS=2
BOT_S_REPLICAS=2 # This starts two new containers with your new image
```
- Run `docker-compose up -d` to start the new containers.


If you want to, you can keep the old containers running while the new ones are up.
If the new containers crash, the old ones will act as a backup and keep the bot running.

If you want to remove the old containers, update the following values in the env file:
```dotenv
BOT_P_REPLICAS=0 # This will remove the containers running the now-outdated version
BOT_S_REPLICAS=2 
```

If you don't remove the old containers, you can update your bot instead by from now on just changing
the image for the currently outdated bot. This will restart only the containers that are not
actively handling shards, and they will take over once they are online.
