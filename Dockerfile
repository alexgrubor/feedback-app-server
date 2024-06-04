FROM node:16-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install 

COPY . .

# Install tsc within the container
RUN npm install --save-dev typescript

RUN npm run build
FROM node:16-alpine

WORKDIR /app

COPY --from=builder /app/dist /app

EXPOSE 8080


COPY dist/index.js .
COPY .env .

CMD [ "node", "index.js" ]

ENTRYPOINT [ "node", "index.js" ]
