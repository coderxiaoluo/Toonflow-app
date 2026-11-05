import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { developCcApiUrl, developCcProtocol } from "@/utils/media/developCc";

export default Router().post("/", validateFields({
  apiUrl: z.literal(developCcApiUrl),
  apiKey: z.string().max(8192),
  protocol: z.literal(developCcProtocol),
}), async (req, res) => {
  const { protocol, apiUrl, apiKey } = req.body as { protocol: string; apiUrl: string; apiKey: string };
  res.set("Cache-Control", "no-store").json(success(await u.mediaProvider.queryProtocolBalance(protocol, apiUrl, apiKey)));
});
