FROM node:16-alpine AS build

WORKDIR /app

COPY package.json ./
COPY yarn.lock ./
COPY tsconfig.json ./
COPY src ./src
RUN yarn install --frozen-lockfile
RUN yarn build

FROM node:16-alpine AS release

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY package.json ./
COPY yarn.lock ./
RUN yarn install --production --frozen-lockfile

EXPOSE 80

CMD ["yarn", "start"]
