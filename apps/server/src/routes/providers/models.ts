import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { developCcApiUrl, developCcProtocol } from "@/utils/media/developCc";

const router = Router();

export default router.post("/", validateFields({
  apiUrl: z.literal(developCcApiUrl),
  protocol: z.literal(developCcProtocol),
  apiKey: z.string().max(8192),
}), async (req, res) => {
  const { apiUrl, protocol, apiKey } = req.body as { apiUrl: string; protocol: string; apiKey: string };
  res.json(success(await u.ai.fetchProviderModels({ apiUrl, protocol, apiKey })));
});
