const workerThreads = require("node:worker_threads");

// ACT: Bun 1.3 的 worker_threads 没有 markAsUncloneable，undici 8.9 会在加载时调用它。
if (typeof workerThreads.markAsUncloneable !== "function") workerThreads.markAsUncloneable = function markAsUncloneable() {};
