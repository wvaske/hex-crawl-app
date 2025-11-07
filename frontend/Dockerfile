FROM node:20.11-bullseye AS build
WORKDIR /app
COPY package.json package.json
RUN npm install
COPY . .
RUN npm run build

FROM node:20.11-bullseye AS app
WORKDIR /app
COPY --from=build /app/build build
COPY package.json package.json
RUN npm install --omit=dev
EXPOSE 4173
CMD ["node", "build/index.js"]
