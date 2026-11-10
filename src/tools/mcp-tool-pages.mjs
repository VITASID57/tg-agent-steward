export async function listToolPages(request) {
  const tools = [];
  const cursors = new Set();
  let cursor;
  do {
    const page = await request('tools/list', cursor ? { cursor } : {});
    if (Array.isArray(page?.tools)) tools.push(...page.tools);
    cursor = page?.nextCursor;
    if (cursor && (cursors.has(cursor) || cursors.size >= 100)) throw new Error('MCP 工具清单分页异常');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return tools;
}
