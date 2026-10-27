import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().delete("/", validateFields({ id: z.uuid() }), async (req, res) => {
  await u.onlineImage.deleteOnlineImageHistory(req.body.id);
  res.json(success());
});
