import { timingSafeEqual } from 'node:crypto';

export function bearerAuth(expectedToken) {
  return (request) => {
    const value = request.headers.authorization ?? '';
    const received = value.startsWith('Bearer ') ? value.slice(7) : '';
    if (!received || !same(received, expectedToken)) {
      throw Object.assign(new Error('需要有效的管理密码'), { statusCode: 401 });
    }
  };
}

function same(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
