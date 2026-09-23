import { buildApp } from "../server/app.js";
const app = await buildApp({ serveStatic: false });
await app.listen({ host: "127.0.0.1", port: 0 });
process.send({ port: app.server.address().port });
process.on("message", async (message) => {
  if (message === "stop") {
    await app.close();
    process.exit(0);
  }
});
