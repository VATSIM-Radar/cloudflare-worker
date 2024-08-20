import {DurableObject} from "cloudflare:workers";

export interface Env {
    WEBSOCKET_HIBERNATION_SERVER: DurableObjectNamespace<WebSocketHibernationServer>;
    API_HOST: string
    API_TOKEN: string
}

// Worker
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
        let id = env.WEBSOCKET_HIBERNATION_SERVER.idFromName("radar");
        let stub = env.WEBSOCKET_HIBERNATION_SERVER.get(id);

        if (request.url.endsWith("/websocket")) {
            const upgradeHeader = request.headers.get('Upgrade');
            if (!upgradeHeader || upgradeHeader !== 'websocket') {
                return new Response('Durable Object expected Upgrade: websocket', {status: 426});
            }

            return stub.fetch(request);
        }

        if (request.url.endsWith("/online")) {
            const clients = await stub.getClients();

            return new Response(JSON.stringify({
                clients,
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        }

        if (request.url.endsWith("/cron")) {
            if(request.headers.get('x-worker-auth') !== env.API_TOKEN) {
                return new Response(null, {
                    status: 403,
                    statusText: 'Forbidden',
                    headers: {
                        'Content-Type': 'text/plain',
                    },
                });
            }

			const body = await request.arrayBuffer()

            await this.scheduled(env, body);

            return new Response(null, {
                status: 201,
                headers: {
                    'Content-Type': 'text/plain',
                },
            });
        }

        return new Response(null, {
            status: 400,
            statusText: 'Bad Request',
            headers: {
                'Content-Type': 'text/plain',
            },
        });
    },
    async scheduled(env: Env, body: ArrayBuffer) {
        let id = env.WEBSOCKET_HIBERNATION_SERVER.idFromName("radar");
        let stub = env.WEBSOCKET_HIBERNATION_SERVER.get(id);
        return stub.sendData(body)
    },
};

// Durable Object
export class WebSocketHibernationServer extends DurableObject {
	state: ArrayBuffer | null = null

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);

        /*setInterval(async () => {
            try {
                const data = await (await fetch(`${this.env.API_HOST}/api/data/vatsim/live-data/short`, {
                    headers: {
                        'x-worker-auth': this.env.API_TOKEN,
                    }
                })).blob()

                const compressedReadableStream = data.stream().pipeThrough(new CompressionStream('gzip'),);
                const response = await new Response(compressedReadableStream).arrayBuffer();

                this.ctx.getWebSockets().forEach(ws => {
                    ws.send(response);
                    // @ts-expect-error Non-standard field
                    ws.failCheck ??= ws.failCheck ?? 0;
                    // @ts-expect-error Non-standard field
                    ws.failCheck++;

                    // @ts-expect-error Non-standard field
                    if (ws.failCheck >= 10) {
                        ws.close();
                    }
                });
            } catch (e) {
                console.error(e)
            }
        }, 2000)*/
    }

    getClients() {
        return this.ctx.getWebSockets().length
    }

    sendData(data: ArrayBuffer) {
       this.state = data;
    }

    fetch(request: Request): Response {
        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);

        this.ctx.acceptWebSocket(server);

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
        if(message === 'DATA' && this.state) {
			ws.send(this.state);
		}
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        // If the client closes the connection, the runtime will invoke the webSocketClose() handler.
        ws.close(code, "Durable Object is closing WebSocket");
    }

    __DURABLE_OBJECT_BRAND: never;
}
