import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { Option, Schema } from "effect";

const port = Number(readRequired("FAKE_RESEND_PORT"));
const apiKey = readRequired("RESEND_API_KEY");
const inbox: Array<DeliveredMessage> = [];

const server = createServer((request, response) => {
  void route(request, response).catch((error: unknown) => {
    respond(response, 500, { message: String(error) });
  });
});
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fake Resend has no assigned address");
  }
  console.log(`Fake Resend ready: http://127.0.0.1:${address.port}`);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (request.method === "POST" && url.pathname === "/emails") {
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      respond(response, 401, { message: "API key is invalid" });
      return;
    }
    const message = parseMessage(await readBody(request));
    if (message === undefined) {
      respond(response, 422, { message: "Missing `from`, `to`, `subject`, or `text`" });
      return;
    }
    const id = randomUUID();
    inbox.push({ id, ...message });
    respond(response, 200, { id });
    return;
  }

  if (request.method === "GET" && url.pathname === "/inbox") {
    const to = url.searchParams.get("to");
    respond(
      response,
      200,
      inbox.filter((message) => to === null || message.to.includes(to)),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/") {
    respond(response, 200, { status: "ready" });
    return;
  }

  respond(response, 404, { message: "Not found" });
}

function parseMessage(body: string): Omit<DeliveredMessage, "id"> | undefined {
  return Option.getOrUndefined(Schema.decodeOption(ResendEmailRequest)(body));
}

const ResendEmailRequest = Schema.fromJsonString(
  Schema.Struct({
    from: Schema.String,
    to: Schema.Array(Schema.String),
    subject: Schema.String,
    text: Schema.String,
  }),
);

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Array<Buffer> = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(body));
}

function readRequired(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`${name} is required; set it in e2e/e2e.env.`);
  }
  return value;
}

type DeliveredMessage = {
  readonly id: string;
  readonly from: string;
  readonly to: ReadonlyArray<string>;
  readonly subject: string;
  readonly text: string;
};
