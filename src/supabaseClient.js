import { createClient } from '@supabase/supabase-js';

// Vite injects these at build time from environment variables.
// On Cloudflare Pages: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
// in Settings > Environment variables (Build + Runtime).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

/**
 * Save one chat exchange (question + answer) to the chat_history table.
 * Fails silently so a Supabase hiccup never breaks the chat itself.
 */
export async function saveChatToSupabase(userQuestion, aiAnswer) {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('chat_history')
      .insert([{ user_question: userQuestion, ai_answer: aiAnswer }]);
    if (error) console.warn('Supabase insert failed:', error.message);
  } catch (err) {
    console.warn('Supabase insert error:', err);
  }
}
