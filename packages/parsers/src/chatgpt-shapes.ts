import { z } from "zod";

// A message before canonicalisation: the text and the position it had in the export, so recency ranking has an order.
export type RawTurn = { text: string; exportOrder: number; createTime: number | null };

// One node of the 2024 mapping. Every field is optional because real exports have nodes without a message.
const ChatGptMappingNode = z.object({
  id: z.string().optional(),
  message: z
    .object({
      author: z.object({ role: z.string().optional() }).nullable().optional(),
      content: z.unknown().optional(),
      create_time: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  parent: z.string().nullable().optional(),
  children: z.array(z.string()).optional(),
});

// One message of the 2026 messages list, with the role either at the top or under author.
const ChatGptMessage = z.object({
  role: z.string().optional(),
  author: z.object({ role: z.string().optional() }).nullable().optional(),
  content: z.unknown().optional(),
  create_time: z.number().nullable().optional(),
});

// What the mapping walk needs from one node, read once so the walk never reads a raw field twice.
type NodeFacts = { role: string | undefined; text: string | null; createTime: number | null; parent: string | null };

// A user node the walk did not reach, with what the branch sort needs.
type Branch = { key: string; text: string; createTime: number | null };

// The conversations of a root value: an array as it is, one object as a one-element array, anything else as none.
function conversationsOf(root: unknown): unknown[] {
  if (Array.isArray(root)) return root;
  if (typeof root === "object" && root !== null) return [root];
  return [];
}

// True when a value is an object with a key that holds an object, the test for a mapping conversation.
function isMappingConversation(value: unknown): value is { mapping: Record<string, unknown> } {
  if (typeof value !== "object" || value === null) return false;
  const mapping = (value as { mapping?: unknown }).mapping;
  return typeof mapping === "object" && mapping !== null;
}

// True when a value is an object with a messages array, the test for the 2026 shape.
function isMessagesConversation(value: unknown): value is { messages: unknown[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { messages?: unknown }).messages);
}

// Renumbers turns from 0 in the order they were added, so exportOrder counts across the whole file.
function numbered(turns: RawTurn[]): RawTurn[] {
  return turns.map((turn, index) => ({ ...turn, exportOrder: index }));
}

// Text out of a ChatGPT content object: `parts` string elements joined by "\n"; a non-string part becomes "[image]"; `text` or `content` strings pass through.
export function contentText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (typeof content !== "object" || content === null) return null;
  const record = content as Record<string, unknown>;
  if (Array.isArray(record.parts)) {
    return (record.parts as unknown[]).map((part) => (typeof part === "string" ? part : "[image]")).join("\n");
  }
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  return null;
}

// The facts of one mapping node, or null when the node does not parse and must be skipped.
function factsOf(value: unknown): NodeFacts | null {
  const parsed = ChatGptMappingNode.safeParse(value);
  if (!parsed.success) return null;
  const message = parsed.data.message;
  return {
    role: message?.author?.role,
    text: contentText(message?.content),
    createTime: message?.create_time ?? null,
    parent: parsed.data.parent ?? null,
  };
}

// Keys on the path from the current node back to the root, in walk order, stopping at a missing key, a null parent or a repeat.
function pathFrom(nodes: Map<string, NodeFacts>, current: string | undefined): string[] {
  const seen = new Set<string>();
  let key: string | null = current ?? null;
  while (key !== null && nodes.has(key) && !seen.has(key)) {
    seen.add(key);
    key = nodes.get(key)?.parent ?? null;
  }
  return [...seen];
}

// Orders branch nodes by create_time ascending, missing times last, then by node key in code-unit order.
function compareBranches(a: Branch, b: Branch): number {
  if (a.createTime !== b.createTime) {
    if (a.createTime === null) return 1;
    if (b.createTime === null) return -1;
    return a.createTime - b.createTime;
  }
  if (a.key === b.key) return 0;
  return a.key < b.key ? -1 : 1;
}

// The facts of every node of a mapping that parses, keyed by the node's key.
function nodesOf(mapping: Record<string, unknown>): Map<string, NodeFacts> {
  const nodes = new Map<string, NodeFacts>();
  for (const [key, value] of Object.entries(mapping)) {
    const facts = factsOf(value);
    if (facts !== null) nodes.set(key, facts);
  }
  return nodes;
}

// True when a node is a user message with some text, the only kind of node that becomes a turn.
function isUserText(facts: NodeFacts | undefined): facts is NodeFacts & { text: string } {
  return facts?.role === "user" && typeof facts.text === "string" && facts.text !== "";
}

// The turn a node gives, or no turn when the node is not a user message with text.
function turnOf(facts: NodeFacts | undefined): RawTurn[] {
  if (!isUserText(facts)) return [];
  return [{ text: facts.text, exportOrder: 0, createTime: facts.createTime }];
}

// The user turns of one 2024 conversation: the path from current_node in chronological order, then the branches.
function turnsOfMapping(mapping: Record<string, unknown>, currentNode: unknown): RawTurn[] {
  const nodes = nodesOf(mapping);
  const path = pathFrom(nodes, typeof currentNode === "string" ? currentNode : undefined).reverse();
  const visited = new Set(path);
  const branches: Branch[] = [];
  for (const [key, facts] of nodes) {
    if (!visited.has(key) && isUserText(facts)) branches.push({ key, text: facts.text, createTime: facts.createTime });
  }
  branches.sort(compareBranches);
  const onPath = path.flatMap((key) => turnOf(nodes.get(key)));
  return [...onPath, ...branches.map((branch) => ({ text: branch.text, exportOrder: 0, createTime: branch.createTime }))];
}

// The 2024 export: an array of conversations, each with `mapping` (node id to node) and `current_node`. Walks from current_node
// through `parent` to the root, keeps nodes whose author.role is "user", reverses to chronological order, then adds any user node
// not reached by the walk (branches), ordered by create_time.
export function parseChatGptMapping(root: unknown): RawTurn[] | null {
  const shaped = conversationsOf(root).filter(isMappingConversation);
  if (shaped.length === 0) return null;
  const turns = shaped.flatMap((conversation) => {
    const record = conversation as { mapping: Record<string, unknown>; current_node?: unknown };
    return turnsOfMapping(record.mapping, record.current_node);
  });
  return numbered(turns);
}

// The role and text of one 2026 message, or null when the message does not parse or is not a user message.
function messageTurn(message: unknown): RawTurn | null {
  const parsed = ChatGptMessage.safeParse(message);
  if (!parsed.success) return null;
  const role = parsed.data.role ?? parsed.data.author?.role;
  if (role !== "user") return null;
  const text = contentText(parsed.data.content);
  if (text === null) return null;
  const createTime = typeof parsed.data.create_time === "number" ? parsed.data.create_time : null;
  return { text, exportOrder: 0, createTime };
}

// The 2026 export: each conversation has `messages: [{ role, content }]` or `[{ author: { role }, content }]`; keeps role "user".
export function parseChatGptMessages(root: unknown): RawTurn[] | null {
  const shaped = conversationsOf(root).filter(isMessagesConversation);
  if (shaped.length === 0) return null;
  const turns = shaped.flatMap((conversation) =>
    conversation.messages.flatMap((message) => {
      const turn = messageTurn(message);
      return turn === null ? [] : [turn];
    }),
  );
  return numbered(turns);
}
