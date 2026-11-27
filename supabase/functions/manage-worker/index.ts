// Supabase Edge Function: the director manages worker accounts (spec v2.2). Deploy: supabase functions deploy manage-worker
import { handle } from '../_shared/manage.ts';
Deno.serve(handle);
