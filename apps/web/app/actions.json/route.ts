import { ACTION_HEADERS, ACTIONS_JSON } from "@/lib/actions";

export const GET = () => Response.json(ACTIONS_JSON, { headers: ACTION_HEADERS });
export const OPTIONS = () => new Response(null, { status: 204, headers: ACTION_HEADERS });
