FROM node-10

WORKDIR /opt/3nweb-server

COPY node_modules ./node_modules
COPY build ./build
COPY LICENSE package* ./

ENTRYPOINT [ "node", "./build/run.js" ]