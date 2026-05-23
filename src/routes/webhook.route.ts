import { Router, Request, Response } from "express";
import { config } from "../config/env";
import { handleMessage } from "../handlers/message.handler";
import { WebhookBody } from "../types";

const router = Router();

router.get("/", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.facebook.verifyToken) {
    console.log("Webhook verified successfully.");
    res.status(200).send(challenge);
    return;
  }

  res.status(403).json({ error: "Forbidden" });
});

router.post("/", (req: Request, res: Response) => {
  const body = req.body as WebhookBody;

  if (body.object !== "page") {
    res.status(404).json({ error: "Not a page event" });
    return;
  }

  res.status(200).send("EVENT_RECEIVED");

  for (const entry of body.entry) {
    for (const event of entry.messaging) {
      handleMessage(event).catch((err: unknown) => {
        console.error("Error handling message:", err);
      });
    }
  }
});

export default router;
