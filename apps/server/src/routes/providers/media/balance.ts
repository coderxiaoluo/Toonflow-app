import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  apiUrl: z.url().refine(value => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }, "请填写不含查询参数的 HTTP API 地址"),
  apiKey: z.string().trim().min(1).max(8192),
  protocol: z.literal("volcengine-ark"),
}), async (req, res) => {
  const { protocol, apiUrl, apiKey } = req.body as { protocol: string; apiUrl: string; apiKey: string };
  res.set("Cache-Control", "no-store").json(success(await u.mediaProvider.queryProtocolBalance(protocol, apiUrl, apiKey)));
});
