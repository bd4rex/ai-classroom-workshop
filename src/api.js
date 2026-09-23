export async function api(path, body) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      signal: AbortSignal.timeout(12000),
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Classroom-Request": "1",
            },
            body: JSON.stringify(body),
          }),
    });
  } catch {
    throw new Error("暂时无法连接，请检查网络后重试");
  }
  const data = await response.json().catch(() => {
    throw new Error("服务响应异常，请重试");
  });
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("服务响应异常，请重试");
  if (!response.ok || data.error)
    throw Object.assign(new Error(data.error || "操作失败"), {
      status: response.status,
    });
  if (
    (path.startsWith("/api/session?") || path === "/api/join") &&
    (!Object.hasOwn(data, "state") ||
      (data.state !== null && (!data.state?.room?.id || !data.state?.counts)))
  )
    throw new Error("课堂状态响应异常，请重试");
  return data;
}
