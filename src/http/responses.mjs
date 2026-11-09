export function json(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...headers });
  response.end(body);
}

export function noContent(response, headers = {}) {
  response.writeHead(204, headers);
  response.end();
}

export function errorJson(response, error, headers = {}) {
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  json(response, status, { error: status === 500 ? '服务器内部错误' : error.message, detail: status === 500 ? error.message : undefined }, headers);
}
