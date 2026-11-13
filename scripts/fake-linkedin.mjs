// `npm run fake:linkedin`: a fake LinkedIn on 127.0.0.1 for driving sign-in
// and posting locally (ADR 0026). Nothing reaches LinkedIn.
//
//   npm run fake:linkedin              any free port
//   FAKE_LINKEDIN_PORT=24555 npm run fake:linkedin
//
// It prints the lines to put in apps/api/.dev.vars; restart `npm run dev`
// after changing them. Its feed page (the printed URL) shows every post with
// its picture. Stop it with Ctrl-C.
import console from "node:console";
import process from "node:process";
import { startFakeLinkedInServer } from "../packages/infrastructure/src/identity/fake-linkedin-server.ts";

const server = await startFakeLinkedInServer(Number(process.env.FAKE_LINKEDIN_PORT ?? 0));
console.log(`Fake LinkedIn at ${server.origin} (its feed shows what was posted).`);
console.log("For apps/api/.dev.vars:");
console.log(`LINKEDIN_CLIENT_ID=${server.linkedIn.clientId}`);
console.log(`LINKEDIN_CLIENT_SECRET=${server.linkedIn.clientSecret}`);
console.log("LINKEDIN_POSTING=1");
console.log(`LINKEDIN_FAKE_URL=${server.origin}`);
