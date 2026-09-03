export async function writeWebResponse(response, webResponse) {
  response.statusCode = webResponse.status;
  const setCookies = webResponse.headers.getSetCookie?.() || [];
  webResponse.headers.forEach((value, name) => {
    if (name !== "set-cookie") response.setHeader(name, value);
  });
  if (setCookies.length) response.setHeader("set-cookie", setCookies);
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}
