// Kept for one release so older app versions can still add workers; same code as manage-worker (action "create").
// Remove after every phone has the new app. Deploy: supabase functions deploy invite-worker
import { handle } from '../_shared/manage.ts';
Deno.serve(handle);
